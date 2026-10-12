"""Actual bounded reader/collector/run bodies; synthetic rows, no external services."""

import ast
import asyncio
import copy
import json
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import UUID

from worker.agent import _cs_review_inputs as cs
from worker.tests.test_briefing_publication import StoredBriefings, runtime

DAY = date(2026, 10, 11)
QUERIES = Path(__file__).parents[1] / "agent" / "_briefing_queries.py"
WRITER = Path(__file__).parents[1] / "agent" / "briefing_writer.py"


def row(n=1, written="2026-10-10", own=True, rating=5, pid=None):
    return {
        "id": str(UUID(int=n)),
        "product_id": pid or str(UUID(int=10000 + n)),
        "review_date": written,
        "created_at": "2026-10-10T00:00:00+00:00",
        "rating": rating,
        "helpful_count": n,
        "review_text": f"synthetic-review-{n}",
        "products": {"is_own": own, "name": "Synthetic product", "brands": {"slug": "synthetic"}},
    }


class Database:
    def __init__(self, rows=(), fault=None, own_ids=()):
        self.rows = list(rows)
        self.own_ids = list(own_ids)
        self.fault = fault
        self.calls = []

    def table(self, table):
        owner = self

        class Query:
            def __init__(self):
                self.table = table
                self.filters = []
                self.bounds = None
                self.cap = None

            def select(self, columns, **opts):
                self.columns = columns
                self.opts = opts
                return self

            def eq(self, field, value):
                self.filters.append(("eq", field, value))
                return self

            def gte(self, field, value):
                self.filters.append(("gte", field, value))
                return self

            def lte(self, field, value):
                self.filters.append(("lte", field, value))
                return self

            def in_(self, field, value):
                self.filters.append(("in", field, value))
                return self

            def order(self, field, **opts):
                self.sort = (field, opts.get("desc", False))
                return self

            def limit(self, cap):
                self.cap = cap
                return self

            def range(self, start, end):
                self.bounds = (start, end)
                return self

            def retry(self, enabled):
                self.retry_enabled = enabled
                return self

            @property
            def request(self):
                def send(_headers):
                    result = self.execute()
                    if result is None:
                        return SimpleNamespace(status_code=200, headers={}, json=lambda: None)
                    rows = result.data
                    offset = self.bounds[0]
                    size = len(rows) if isinstance(rows, list) else 0
                    span = f"{offset}-{offset + size - 1}" if size else "*"
                    return SimpleNamespace(
                        status_code=500 if getattr(result, "error", None) else 200,
                        headers={"content-range": f"{span}/{result.count}"},
                        json=lambda: rows,
                    )

                return SimpleNamespace(http_method="GET", send=send)

            def execute(self):
                owner.calls.append(self)
                if self.table == "products":
                    return SimpleNamespace(data=[{"id": pid} for pid in owner.own_ids][: self.cap])
                assert self.table == "reviews"
                result = copy.deepcopy(owner.rows)
                for op, field, value in self.filters:

                    def actual(r):
                        if field == "products.is_own":
                            return r["products"]["is_own"]
                        return r[field]

                    result = [
                        r
                        for r in result
                        if {
                            "eq": lambda a: a == value,
                            "gte": lambda a: a >= value,
                            "lte": lambda a: a <= value,
                            "in": lambda a: a in value,
                        }[op](actual(r))
                    ]
                if hasattr(self, "sort"):
                    field, desc = self.sort
                    result.sort(key=lambda r: r[field], reverse=desc)
                total = len(result)
                if self.bounds:
                    start, end = self.bounds
                    result = result[start : end + 1]
                elif self.cap is not None:
                    result = result[: self.cap]
                response = SimpleNamespace(data=result, count=total)
                return owner.fault(self, response) if owner.fault else response

        return Query()


def extracted(path, names, env):
    tree = ast.parse(path.read_text())
    nodes = [ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)]
    nodes += [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    exec(
        compile(
            ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(path), "exec"
        ),
        env,
    )
    return env


class CSReviewInputTests(unittest.TestCase):
    def test_outside_first100_fixture_baseline_zero_new_scope_positive(self):
        # Hundreds of synthetic products; reviewed product lies beyond the first500 too.
        products = [str(UUID(int=10000 + n)) for n in range(1, 602)]
        db = Database([row(601)], own_ids=products)
        env = extracted(
            QUERIES,
            {"get_own_product_ids", "fetch_review_summary", "_prev"},
            {
                "date": date,
                "timedelta": __import__("datetime").timedelta,
                "logger": SimpleNamespace(warning=Mock()),
                "read_cs_review_inputs": cs.read_cs_review_inputs,
            },
        )
        # The baseline source is provided to the same test by BASELINE_SOURCE during reproduction.
        baseline = globals().get("BASELINE_SOURCE")
        if baseline:
            env = extracted(baseline, {"get_own_product_ids", "fetch_review_summary", "_prev"}, env)
            result = env["fetch_review_summary"](db, DAY, env["get_own_product_ids"](db))
            self.assertEqual(result["count"], 1)
        else:
            self.assertEqual(env["fetch_review_summary"](db, DAY, products[:100])["count"], 1)
            self.assertTrue(all(q.table == "reviews" for q in db.calls))

    def test_zero_is_complete_and_positive_includes_zero_rating(self):
        for rows, expected in [([], 0), ([row(1, rating=0), row(2)], 2)]:
            with self.subTest(expected=expected):
                result = cs.read_cs_review_inputs(Database(rows), DAY)
                self.assertEqual(result["review_summary_yesterday"]["count"], expected)
                self.assertEqual(result["review_input_scope"]["state"], "complete")
                self.assertEqual(result["review_input_scope"]["collection_complete"], "unverified")
                self.assertNotIn("id", repr(result["low_reviews"]))

    def test_full_scope_more_than_sdk_cap_and_bounded_samples(self):
        db = Database([row(n, rating=1 if n % 2 else 5) for n in range(1, 1002)])
        result = cs.read_cs_review_inputs(db, DAY)
        self.assertEqual(result["review_summary_yesterday"]["count"], 1001)
        self.assertEqual(len(db.calls), 5)
        self.assertEqual(len(result["low_reviews"]), 10)
        self.assertEqual(len(result["high_reviews"]), 10)
        self.assertEqual(result["low_reviews"][0]["text"], "synthetic-review-1001")
        self.assertEqual(result["weekly_review_pattern"][0]["count"], 1001)
        for query in db.calls:
            self.assertEqual(query.opts, {"count": "exact"})
            self.assertIn("products!inner", query.columns)
            self.assertNotIn("user", query.columns)
            self.assertEqual(query.sort, ("id", False))
            self.assertEqual(query.bounds[1] - query.bounds[0] + 1, cs.PAGE_SIZE)
            self.assertIsNone(query.cap)

    def test_network_failures_first_and_later_page_raise_without_retry(self):
        for at in [0, cs.PAGE_SIZE]:
            db = Database([row(n) for n in range(1, 302)])

            def fault(query, response):
                if query.bounds[0] == at:
                    raise OSError("synthetic-sensitive-error")
                return response

            db.fault = fault
            with self.assertRaisesRegex(cs.CSReviewInputError, "^CS review input read failed$"):
                cs.read_cs_review_inputs(db, DAY)
            self.assertEqual(len(db.calls), 1 if at == 0 else 2)

    def test_null_malformed_partial_count_changes_and_duplicate_fail_closed(self):
        def fault(kind):
            def apply(query, response):
                if kind == "null-response":
                    return None
                if kind == "null-data":
                    response.data = None
                if kind == "missing-count":
                    response.count = None
                if kind == "false-count":
                    response.count = False
                if kind == "negative-count":
                    response.count = -1
                if kind == "partial":
                    response.data = response.data[:1]
                if kind == "changed-count" and query.bounds[0]:
                    response.count += 1
                if kind == "duplicate-page" and query.bounds[0]:
                    response.data[0] = row(250)
                if kind == "duplicate-row":
                    response.data[1] = response.data[0]
                if kind == "wrong-order":
                    response.data.reverse()
                if kind == "error":
                    response.error = "synthetic"
                return response

            return apply

        for kind in [
            "null-response",
            "null-data",
            "missing-count",
            "false-count",
            "negative-count",
            "partial",
            "changed-count",
            "duplicate-page",
            "duplicate-row",
            "wrong-order",
            "error",
        ]:
            with self.subTest(kind=kind), self.assertRaises(cs.CSReviewInputError):
                cs.read_cs_review_inputs(
                    Database([row(n) for n in range(1, 302)], fault(kind)), DAY
                )

    def test_safety_ceiling_fails_before_processing_rows(self):
        def cap(query, response):
            response.count = cs.MAX_REVIEWS + 1
            return response

        db = Database([row()], cap)
        with self.assertRaises(cs.CSReviewInputError):
            cs.read_cs_review_inputs(db, DAY)
        self.assertEqual(len(db.calls), 1)

    def test_written_period_own_join_and_inserted_cutoff_are_separate(self):
        future = row(6)
        future["created_at"] = "2099-01-01T00:00:00+00:00"
        db = Database(
            [
                row(1, "2026-10-04"),
                row(2, "2026-10-05"),
                row(3),
                row(4, "2026-10-11"),
                row(5, own=False),
                future,
            ]
        )
        result = cs.read_cs_review_inputs(db, DAY)
        self.assertEqual(result["review_summary_yesterday"]["count"], 1)
        self.assertEqual(result["weekly_review_pattern"][0]["count"], 2)
        self.assertEqual(result["review_input_scope"]["daily_written_date"], "2026-10-10")
        self.assertTrue(any(field == "created_at" for _, field, _ in db.calls[0].filters))
        self.assertTrue(any(field == "review_date" for _, field, _ in db.calls[0].filters))

    def test_monday_still_reads_sunday_daily_with_empty_current_week(self):
        result = cs.read_cs_review_inputs(Database([row(1, "2026-10-11")]), date(2026, 10, 12))
        self.assertEqual(result["review_summary_yesterday"]["count"], 1)
        self.assertEqual(result["weekly_review_pattern"], [])
        self.assertIsNone(result["review_input_scope"]["weekly_written_start"])

    def test_bad_row_or_backend_filter_violation_is_not_zero(self):
        for key, value in [
            ("rating", None),
            ("id", "invalid"),
            ("products", None),
            ("review_text", None),
            ("helpful_count", -1),
            ("created_at", "2026-10-10"),
            ("review_date", "2026-10-11"),
            ("product_id", "invalid"),
            ("products", {"is_own": False, "name": "Synthetic", "brands": {"slug": "synthetic"}}),
        ]:

            def mutate(query, response):
                response.data[0][key] = value
                return response

            with self.subTest(key=key), self.assertRaises(cs.CSReviewInputError):
                cs.read_cs_review_inputs(Database([row()], mutate), DAY)

    def test_collect_once_and_formatter_include_written_and_inserted_scope(self):
        db = Database([row()])
        env = extracted(
            QUERIES,
            {"collect_cs_inputs"},
            {"read_cs_review_inputs": cs.read_cs_review_inputs, "WEEKDAY_KO": {}, "date": date},
        )
        inputs = env["collect_cs_inputs"](db, DAY)
        self.assertEqual(len(db.calls), 1)
        fmt = extracted(
            WRITER, {"_format_cs_message", "_briefing_model_inputs"},
            {"_header": lambda *_: "synthetic", "_j": json.dumps,
             "_BRIEFING_INPUT_FIELDS": {"cs": {key: None for key in inputs
                                                 if key not in {"date", "weekday"}}}}
        )
        text = fmt["_format_cs_message"](inputs)
        self.assertIn("review_date", text)
        self.assertIn("created_at", text)
        self.assertIn("어제 작성일", text)
        self.assertNotIn("어제 수집", text)

    def test_weekly_product_counts_and_bounded_text_samples(self):
        pid = str(UUID(int=30000))
        reviews = [row(1, rating=1, pid=pid), row(2, rating=2, pid=pid), row(3, rating=5)]
        reviews[0]["review_text"] = "synthetic" * 1000
        result = cs.read_cs_review_inputs(Database(reviews), DAY)
        self.assertEqual(result["problem_products_top"][0]["low_review_count"], 2)
        self.assertEqual(result["strength_products_top"][0]["high_review_count"], 1)
        self.assertEqual(result["weekly_review_pattern"][0]["count"], 3)
        self.assertTrue(all(len(r["text"]) <= 200 for r in result["low_reviews"]))

    def test_nullable_brand_relation_preserves_review_in_unknown_bucket(self):
        review = row()
        review["products"]["brands"] = None
        result = cs.read_cs_review_inputs(Database([review]), DAY)
        self.assertEqual(result["review_summary_yesterday"]["count"], 1)
        self.assertEqual(result["weekly_review_pattern"][0]["brand_slug"], "unknown")
        self.assertEqual(result["review_input_scope"]["missing_brand_rows"], 1)

    def test_incomplete_collection_stops_run_before_generation_and_preserves_rows(self):
        db = StoredBriefings()
        previous = copy.deepcopy(db.rows)
        env, tracker = runtime(db)
        env["collect_cs_inputs"].side_effect = cs.CSReviewInputError("CS review input read failed")
        with self.assertRaises(cs.CSReviewInputError):
            asyncio.run(env["run"](DAY))
        env["generate_briefing"].assert_not_awaited()
        self.assertEqual(db.publications, [])
        self.assertEqual(db.rows, previous)
        tracker.error.assert_awaited_once_with("briefing inputs incomplete; generation not started")


if __name__ == "__main__":
    unittest.main()
