import json
import re
import unittest
from pathlib import Path

from worker.matchers.central_sales_readonly import SQL, LocalReadBlocked, execute_central_sales


class Cursor:
    def __init__(self, rows=None, timeout="10", size=1000):
        self.calls = []
        self.timeout = timeout
        self.size = size
        self.rows = rows if rows is not None else [("CO", "SYN-STYLE", "20261001", 123.45)]
        self.closed = False

    def execute(self, sql, binds=None):
        self.calls.append((sql, binds))
        self.description = [(x,) for x in (["key", "value"] if sql.startswith("SHOW") else ["BRANDCD", "STYLECD", "SALEDT", "SALES_VAT_EX"])]

    def fetchall(self):
        return [("STATEMENT_TIMEOUT_IN_SECONDS", self.timeout)]

    def fetchone(self):
        return [json.dumps({"GlobalStats": {"bytesAssigned": self.size, "partitionsAssigned": 1}})]

    def fetchmany(self, limit):
        assert limit == 201
        return self.rows

    def close(self):
        self.closed = True


class Connection:
    def __init__(self, cursor):
        self.cur = cursor

    def cursor(self):
        return self.cur


class LocalReadTests(unittest.TestCase):
    def test_scope_changes_at_cursor_and_show_do_not_change_binds(self):
        scope = {"brand": "CO", "from": "2026-10-01", "to": "2026-10-10"}
        class MutatingCursor(Cursor):
            def execute(self, sql, binds=None):
                super().execute(sql, binds)
                scope.update(brand="LK", **{"from": "2026-11-01", "to": "2026-11-10"})
        cursor = MutatingCursor()
        class MutatingConnection(Connection):
            def cursor(self):
                scope.update(brand="CK", **{"from": "2026-09-01", "to": "2026-09-10"})
                return self.cur
        execute_central_sales(MutatingConnection(cursor), scope)
        for sql, binds in cursor.calls:
            if not sql.startswith("SHOW"):
                self.assertEqual(binds, ("CO", "20261001", "20261010"))

    def test_invalid_captured_scope_still_does_not_open_cursor(self):
        with self.assertRaisesRegex(LocalReadBlocked, "INVALID_SCOPE"):
            execute_central_sales(None, {"brand": "CK", "from": "2026-10-01", "to": "2026-11-01"})

    def test_sql_protocol_matches_existing_server_boundary(self):
        source = (Path(__file__).resolve().parents[2] / "viewer/src/lib/erp/central-sales-read.ts").read_text()
        literal = re.search(r"export const CENTRAL_SQL = `([^`]+)`;", source).group(1)
        self.assertEqual(SQL, literal)

    def test_fixed_bound_local_existing_connection_and_close(self):
        c = Cursor()
        value = execute_central_sales(Connection(c), {"brand": "CO", "from": "2026-10-01", "to": "2026-10-10", "sql": "DROP X"})
        self.assertTrue(value["complete"])
        self.assertEqual(c.calls[-1], (SQL, ("CO", "20261001", "20261010")))
        self.assertTrue(c.closed)
        self.assertEqual(value["rows"][0]["SALES_VAT_EX"], 123.45)  # internal FLOAT unchanged, never exact money

    def test_timeout_not_confirmed_no_data_query(self):
        c = Cursor(timeout="0")
        with self.assertRaisesRegex(LocalReadBlocked, "TIMEOUT_UNCONFIRMED"):
            execute_central_sales(Connection(c), {"brand": "CO", "from": "2026-10-01", "to": "2026-10-10"})
        self.assertEqual(len(c.calls), 1)
        self.assertTrue(c.closed)

    def test_budget_excess_no_data_query(self):
        c = Cursor(size=16777217)
        with self.assertRaisesRegex(LocalReadBlocked, "SCAN_BUDGET_UNCONFIRMED"):
            execute_central_sales(Connection(c), {"brand": "CO", "from": "2026-10-01", "to": "2026-10-10"})
        self.assertEqual(len(c.calls), 2)
        self.assertTrue(c.closed)

    def test_row_limit_not_complete_or_zero(self):
        c = Cursor(rows=[("CO", "SYN", "20261001", 0)] * 201)
        value = execute_central_sales(Connection(c), {"brand": "CO", "from": "2026-10-01", "to": "2026-10-10"})
        self.assertFalse(value["complete"])

    def test_invalid_scope_before_cursor(self):
        for scope in [{"brand": "CO' OR 1=1"}, {"brand": "CO", "from": "2026-02-30", "to": "2026-10-10"}, {"brand": "CO", "from": "2026-10-01", "to": "2026-11-01"}]:
            with self.assertRaisesRegex(LocalReadBlocked, "INVALID_SCOPE"):
                execute_central_sales(None, scope)

    def test_safe_driver_error_never_exposes_raw_exception(self):
        class Broken(Cursor):
            def execute(self, sql, binds=None):
                raise RuntimeError("PRIVATE_SENTINEL")
        c = Broken()
        with self.assertRaisesRegex(LocalReadBlocked, "LOCAL_READ_FAILED") as error:
            execute_central_sales(Connection(c), {"brand": "CO", "from": "2026-10-01", "to": "2026-10-10"})
        self.assertNotIn("PRIVATE_SENTINEL", str(error.exception))
        self.assertTrue(c.closed)

    def test_cursor_acquisition_and_close_errors_are_sanitized(self):
        class Missing:
            def cursor(self):
                raise RuntimeError("PRIVATE_SENTINEL")
        with self.assertRaisesRegex(LocalReadBlocked, "LOCAL_CURSOR_UNAVAILABLE"):
            execute_central_sales(Missing(), {"brand": "CO", "from": "2026-10-01", "to": "2026-10-10"})
        class CloseError(Cursor):
            def close(self):
                raise RuntimeError("PRIVATE_SENTINEL")
        with self.assertRaisesRegex(LocalReadBlocked, "LOCAL_CURSOR_CLOSE_FAILED"):
            execute_central_sales(Connection(CloseError()), {"brand": "CO", "from": "2026-10-01", "to": "2026-10-10"})

    def test_incomplete_row_projection_is_blocked(self):
        c = Cursor(rows=[("CO", "SYN-STYLE", "20261001")])
        with self.assertRaisesRegex(LocalReadBlocked, "PROJECTION_INVALID"):
            execute_central_sales(Connection(c), {"brand": "CO", "from": "2026-10-01", "to": "2026-10-10"})


if __name__ == "__main__":
    unittest.main()
