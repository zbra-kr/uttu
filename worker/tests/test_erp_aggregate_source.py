"""Synthetic supplied-connection execution, no SDK/client construction."""
import json
import re
import unittest
from pathlib import Path

from worker.matchers.central_sales_readonly import LocalReadBlocked
from worker.matchers.erp_aggregate_source import (
    DAILY_SQL,
    execute_central_daily_sales,
    execute_central_style_daily_sales,
)

SCOPE = {"brand": "CO", "from": "2026-10-01", "to": "2026-10-14", "aggregate": "daily"}


class Cursor:
    def __init__(self, style=False, rows=None, timeout="10", size=1000):
        self.style, self.rows, self.timeout, self.size = style, rows, timeout, size
        self.calls, self.closed, self.description = [], False, []

    def execute(self, sql, binds=None):
        self.calls.append((sql, binds))
        self.description = [(n,) for n in (["key", "value"] if sql.startswith("SHOW") else ["BRANDCD"]+(["STYLECD"] if self.style else [])+["SALEDT", "SALES_VAT_EX", "SOURCE_ROWS", "AMOUNT_ROWS"])]

    def fetchall(self):
        return [("STATEMENT_TIMEOUT_IN_SECONDS", self.timeout)]

    def fetchone(self):
        return [json.dumps({"GlobalStats": {"bytesAssigned": self.size, "partitionsAssigned": 1}})]

    def fetchmany(self, limit):
        return self.rows if self.rows is not None else [("CO",)+(("SYN-STYLE",) if self.style else ())+ (f"202610{day:02}", 100.125 if day <= 7 else 50.25, 1, 1) for day in range(1, 15)]

    def close(self):
        self.closed = True


class Connection:
    def __init__(self, cursor, on_open=lambda: None):
        self.cur, self.on_open = cursor, on_open

    def cursor(self):
        self.on_open()
        return self.cur


def fixture_inputs():
    return {"synthetic": True, "scope": SCOPE, "daily": execute_central_daily_sales(Connection(Cursor()), SCOPE), "styleDaily": execute_central_style_daily_sales(Connection(Cursor(style=True)), SCOPE, ["SYN-STYLE"])}


class SourceTests(unittest.TestCase):
    def test_daily_reviewed_sql_guard_and_json_counts(self):
        text = (Path(__file__).parents[2]/"viewer/src/lib/erp/central-sales-read.ts").read_text()
        self.assertEqual(DAILY_SQL, re.search(r"CENTRAL_DAILY_SQL = `([^`]+)`", text).group(1))
        c = Cursor()
        out = execute_central_daily_sales(Connection(c), SCOPE)
        self.assertTrue(out["complete"])
        self.assertEqual(len(out["rows"]), 14)
        self.assertEqual(out["rows"][0]["SOURCE_ROWS"], "1")
        self.assertEqual(c.calls[-1], (DAILY_SQL, ("CO", "20261001", "20261014")))
        self.assertTrue(c.closed)
        json.dumps(out, allow_nan=False)

    def test_style_binds_captured_before_driver_boundary(self):
        scope, styles = SCOPE.copy(), ["SYN-STYLE"]
        def mutate():
            scope.update(brand="LE", **{"from": "2026-11-01", "to": "2026-11-14"})
            styles[0] = "OTHER"
        c = Cursor(style=True)
        self.assertTrue(execute_central_style_daily_sales(Connection(c, mutate), scope, styles)["complete"])
        self.assertEqual(c.calls[-1][1], ("CO", "20261001", "20261014", "SYN-STYLE"))
        self.assertIn("AND STYLECD IN (%s)", c.calls[-1][0])

    def test_invalid_inputs_never_open_connection(self):
        for scope in [{**SCOPE, "brand": "LE"}, {**SCOPE, "to": "2026-10-15"}]:
            with self.assertRaises(LocalReadBlocked):
                execute_central_daily_sales(None, scope)
        for styles in [[], ["SYN"]*2, [str(i) for i in range(11)]]:
            with self.assertRaises(LocalReadBlocked):
                execute_central_style_daily_sales(None, SCOPE, styles)

    def test_timeout_budget_and_sentinel_fail_closed(self):
        for c in [Cursor(timeout="0"), Cursor(size=16777217)]:
            with self.assertRaises(LocalReadBlocked):
                execute_central_daily_sales(Connection(c), SCOPE)
            self.assertTrue(c.closed)
            self.assertLess(len(c.calls), 3)
        self.assertFalse(execute_central_daily_sales(Connection(Cursor(rows=[("CO", "20261001", None, 1, 0)]*32)), SCOPE)["complete"])


if __name__ == "__main__":
    unittest.main()
