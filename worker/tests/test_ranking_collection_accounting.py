"""Actual collector bodies with offline HTTP/DB mocks; no SDK/env/live requests."""
import ast
import asyncio
import random
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

ROOT = Path(__file__).parents[2]


class Log:
    def __init__(self):
        self.events = []

    def __getattr__(self, level):
        return lambda event, **fields: self.events.append((level, event.split()[0], fields))


def load(log):
    env = {"asyncio": asyncio, "random": random, "logger": log, "Any": object,
           "Client": object, "_kst_today": lambda: "2026-10-08"}
    base = ast.parse((ROOT / "worker/scrapers/base.py").read_text())
    base.body = [n for n in base.body if isinstance(n, (ast.ClassDef, ast.Assign))]
    exec(compile(base, "base.py", "exec"), env)
    tree = ast.parse((ROOT / "worker/scrapers/musinsa_ranking.py").read_text())
    tree.body = [n for n in tree.body if isinstance(n, ast.Assign)
                 and not any(isinstance(t, ast.Name) and t.id == "KST" for t in n.targets)
                 or isinstance(n, ast.ClassDef)
                 or isinstance(n, ast.AsyncFunctionDef) and n.name == "main"]
    # Remove only main's import so its actual body resolves the offline tracker.
    for n in tree.body:
        if isinstance(n, ast.AsyncFunctionDef):
            n.body = [x for x in n.body if not isinstance(x, ast.ImportFrom)]
    exec(compile(tree, "musinsa_ranking.py", "exec"), env)
    return env


def items(n, *, start=1, brand=False):
    return [{"id": str(i), "image": {"rank": i, "onClickLike": {
        "eventLog": {"amplitude": {"payload": {"brand_id": "fixture" if brand else None}}}}},
        "info": {}} for i in range(start, start + n)]


class Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.action, self.payload, self.nos = None, None, []
        self.job_id = None

    def select(self, columns):
        self.action = "select"
        return self

    def in_(self, column, values):
        self.nos = values
        return self

    def is_(self, *args):
        return self

    def eq(self, column, value):
        self.job_id = value
        return self

    def insert(self, payload):
        self.action, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.action, self.payload = "update", payload
        return self

    def upsert(self, payload, **kwargs):
        self.action, self.payload = "upsert", payload
        return self

    def execute(self):
        db = self.db
        if self.table == "collection_jobs":
            if self.action == "insert":
                db.job = {"id": 1, **self.payload}
                return SimpleNamespace(data=[dict(db.job)])
            if db.fail_job_updates:
                raise RuntimeError("fixture metadata write failed")
            db.job.update(self.payload)
            return SimpleNamespace(data=[dict(db.job)])
        if self.table == "products" and self.action == "select":
            db.product_selects += 1
            return SimpleNamespace(data=[{"musinsa_no": no, "id": "p" + no}
                                         for no in self.nos if no not in db.missing])
        if self.table == "ranking_snapshots":
            db.attempts.append(list(self.payload))
            if len(db.attempts) == db.fail_batch:
                # Deliberately unknowable server outcome: mock can accept then throw.
                raise RuntimeError("fixture transport outcome unknown")
            db.acknowledged.append(list(self.payload))
        if self.table == "brands" and db.fail_brand:
            raise RuntimeError("fixture enrichment failed")
        return SimpleNamespace(data=[])


class DB:
    def __init__(self, missing=(), fail_batch=None, fail_brand=False):
        self.missing = set(missing)
        self.fail_batch, self.fail_brand = fail_batch, fail_brand
        self.acknowledged, self.attempts = [], []
        self.product_selects = 0
        self.job = None
        self.fail_job_updates = False

    def table(self, name):
        return Query(self, name)


class Tracker:
    def __init__(self, client, **kwargs):
        self.options, self.calls = kwargs, []
        client.tracker = self

    async def start(self):
        self.calls.append(("start", None))

    async def finish(self, rows_done):
        self.calls.append(("done", rows_done))

    async def progress(self, rows_done):
        self.calls.append(("progress", rows_done))

    async def error(self, msg):
        self.calls.append(("error", msg))


def real_tracker(log):
    tree = ast.parse((ROOT / "worker/utils/job_tracker.py").read_text())
    tree.body = [n for n in tree.body if isinstance(n, ast.ClassDef)]
    env = {"Client": object, "Optional": Optional, "datetime": datetime,
           "KST": timezone.utc, "logger": log}
    exec(compile(tree, "job_tracker.py", "exec"), env)
    return env["JobTracker"]


class Tests(unittest.IsolatedAsyncioTestCase):
    def fixture(self, data, db=None):
        log = Log()
        env = load(log)
        db = db or DB()
        scraper = env["RankingScraper"](db)

        async def fetch(*args):
            return data

        scraper._fetch_ranking = fetch
        return env, scraper, db, log

    def warnings(self, log):
        return [f for level, event, f in log.events
                if level == "warning" and event == "ranking_run_incomplete_observations"]

    async def test_101_301_601_rows_no_cap_and_batches(self):
        for n in (101, 301, 601):
            with self.subTest(rows=n):
                _, scraper, db, _ = self.fixture(items(n))
                self.assertEqual(await scraper.run_combo("000", "A", "AGE_BAND_ALL"), n)
                self.assertEqual(scraper.rows_acknowledged, n)
                self.assertEqual(sum(map(len, db.acknowledged)), n)
                self.assertTrue(all(len(batch) <= 500 for batch in db.attempts))

    async def test_multiple_modules_and_fetch_retry_only_count_final_response(self):
        env, scraper, db, log = self.fixture([])
        payload = {"data": {"modules": [{"type": "OTHER", "items": items(12)},
                   {"type": "MULTICOLUMN", "items": items(301)},
                   {"type": "MULTICOLUMN", "items": items(300, start=302)}]}}
        calls = []

        class HTTP:
            def __init__(self, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def get(self, *args, **kwargs):
                calls.append(kwargs)
                if len(calls) == 1:
                    raise RuntimeError("fixture transient source failure")
                return SimpleNamespace(raise_for_status=lambda: None, text="fixture normal",
                                       json=lambda: payload)

        async def no_sleep(*args):
            pass

        env["httpx"] = SimpleNamespace(AsyncClient=HTTP)
        env["asyncio"] = SimpleNamespace(sleep=no_sleep)
        scraper._sleep = no_sleep
        del scraper._fetch_ranking
        self.assertEqual(await scraper.run_combo("000", "A", "AGE_BAND_ALL"), 601)
        self.assertEqual(len(calls), 2)
        self.assertEqual([len(b) for b in db.acknowledged], [500, 101])
        self.assertEqual(scraper.rows_acknowledged, 601)
        self.assertEqual(len([e for e in log.events if e[1] == "retry"]), 1)

    async def test_unresolved_mapping_aggregated_without_ids_or_cohort_spam(self):
        _, scraper, db, log = self.fixture(items(101), DB(missing={"101"}))
        self.assertEqual(await scraper.run(), 27300)
        self.assertEqual(sum(map(len, db.acknowledged)), 27300)
        warning, = self.warnings(log)
        self.assertEqual(warning["unresolved_mapping_rows"], 273)
        self.assertEqual(warning["unresolved_mapping_cohorts"], 273)
        self.assertEqual(warning["cohorts_completed"], 273)
        self.assertEqual(warning["outcome"], "done")
        self.assertNotIn("musinsa_no", warning)
        self.assertEqual(db.product_selects, 546)

    async def test_all_empty_and_all_unranked_warn_once(self):
        for data, field in (([], "source_empty_cohorts"),
                            ([{"id": "advert", "image": {}}], "ranked_empty_cohorts")):
            with self.subTest(kind=field):
                _, scraper, db, log = self.fixture(data)
                self.assertEqual(await scraper.run(), 0)
                self.assertEqual(db.attempts, [])
                warning, = self.warnings(log)
                self.assertEqual(warning[field], 273)
                self.assertEqual(warning["cohorts_completed"], 273)

    async def test_273_cohorts_main_records_rows_without_mixing_target_units(self):
        env, scraper, db, log = self.fixture(items(101))
        env.update(_supabase_client=lambda: db, RankingScraper=lambda client: scraper,
                   JobTracker=Tracker)
        await env["main"]()
        self.assertEqual(db.tracker.calls, [("start", None), ("done", 27573)])
        self.assertNotIn("target", db.tracker.options)
        self.assertEqual(scraper.cohorts_completed, 273)
        self.assertEqual(self.warnings(log), [])
        summary, = [f for _, event, f in log.events if event == "ranking_run_done"]
        self.assertEqual(summary["cohort_target"], 273)
        self.assertIn("not_unique_rows", summary["count_basis"])

    async def test_partial_batch_error_keeps_acknowledged_and_unknown_no_retry(self):
        env, scraper, db, log = self.fixture(items(601), DB(fail_batch=2))
        env.update(_supabase_client=lambda: db, RankingScraper=lambda client: scraper,
                   JobTracker=Tracker)
        with self.assertRaisesRegex(RuntimeError, "outcome unknown"):
            await env["main"]()
        self.assertEqual(db.tracker.calls[:2], [("start", None), ("progress", 500)])
        self.assertEqual(db.tracker.calls[2][0], "error")
        self.assertFalse(any(call[0] == "done" for call in db.tracker.calls))
        warning, = self.warnings(log)
        self.assertEqual(warning["rows_acknowledged"], 500)
        self.assertEqual(warning["rows_outcome_unknown"], 101)
        self.assertEqual(warning["cohorts_completed"], 0)
        self.assertEqual(len(db.attempts), 2)

    async def test_first_batch_failure_is_unknown_not_zero_persisted(self):
        _, scraper, db, log = self.fixture(items(101), DB(fail_batch=1))
        with self.assertRaisesRegex(RuntimeError, "outcome unknown"):
            await scraper.run()
        warning, = self.warnings(log)
        self.assertEqual(warning["rows_acknowledged"], 0)
        self.assertEqual(warning["rows_outcome_unknown"], 101)
        self.assertEqual(len(db.attempts), 1)
        self.assertEqual(warning["outcome"], "error")

    async def test_all_unresolved_has_one_warning_and_no_snapshot_write(self):
        _, scraper, db, log = self.fixture(items(101), DB(missing=map(str, range(1, 102))))
        self.assertEqual(await scraper.run(["000"]), 0)
        warning, = self.warnings(log)
        self.assertEqual(warning["unresolved_mapping_rows"], 2121)
        self.assertEqual(warning["unresolved_mapping_cohorts"], 21)
        self.assertEqual(db.attempts, [])

    async def test_enrichment_failure_retains_ranking_acknowledgements(self):
        _, scraper, _, log = self.fixture(items(101, brand=True), DB(fail_brand=True))
        with self.assertRaisesRegex(RuntimeError, "enrichment failed"):
            await scraper.run()
        warning, = self.warnings(log)
        self.assertEqual(warning["rows_acknowledged"], 101)
        self.assertEqual(warning["rows_outcome_unknown"], 0)
        self.assertEqual(warning["cohorts_completed"], 0)
        self.assertEqual(warning["outcome"], "error")

    async def test_later_fetch_failure_retains_prior_cohort_and_error(self):
        _, scraper, _, log = self.fixture(items(101))
        calls = 0

        async def fetch(*args):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("fixture source failure")
            return items(101)

        scraper._fetch_ranking = fetch
        with self.assertRaisesRegex(RuntimeError, "source failure"):
            await scraper.run()
        warning, = self.warnings(log)
        self.assertEqual(warning["rows_acknowledged"], 101)
        self.assertEqual(warning["cohorts_attempted"], 2)
        self.assertEqual(warning["cohorts_completed"], 1)
        self.assertEqual(warning["rows_outcome_unknown"], 0)

    async def test_repeated_run_resets_counts_not_unique_or_cumulative_claim(self):
        _, scraper, db, _ = self.fixture(items(101))
        self.assertEqual(await scraper.run(["000"]), 2121)
        self.assertEqual(await scraper.run(["000"]), 2121)
        self.assertEqual(scraper.rows_acknowledged, 2121)
        self.assertEqual(sum(map(len, db.acknowledged)), 4242)

    async def test_cancel_second_real_fetch_finalizes_real_tracker_and_reraises(self):
        for fail_metadata in (False, True):
            with self.subTest(metadata_failure=fail_metadata):
                env, scraper, db, log = self.fixture(items(101))
                entered = asyncio.Event()
                closed = []
                calls = []

                class HTTP:
                    def __init__(self, **kwargs):
                        pass

                    async def __aenter__(self):
                        return self

                    async def __aexit__(self, *args):
                        closed.append(True)

                    async def get(self, *args, **kwargs):
                        calls.append(1)
                        if len(calls) == 2:
                            db.fail_job_updates = fail_metadata
                            entered.set()
                            await asyncio.Event().wait()
                        return SimpleNamespace(raise_for_status=lambda: None, text="fixture normal",
                            json=lambda: {"data": {"modules": [
                                {"type": "MULTICOLUMN", "items": items(101)}]}})

                async def no_sleep(*args):
                    pass

                env["httpx"] = SimpleNamespace(AsyncClient=HTTP)
                scraper._sleep = no_sleep
                del scraper._fetch_ranking
                env.update(_supabase_client=lambda: db, RankingScraper=lambda client: scraper,
                           JobTracker=real_tracker(log))
                task = asyncio.create_task(env["main"]())
                await asyncio.wait_for(entered.wait(), 1)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                self.assertTrue(task.cancelled())
                self.assertEqual(len(closed), 2)
                self.assertFalse(scraper._semaphore.locked())
                self.assertEqual(scraper.rows_acknowledged, 101)
                self.assertEqual(len(db.attempts), 1)
                self.assertEqual(db.job["target"], None)
                if fail_metadata:
                    self.assertEqual(db.job["status"], "running")
                    self.assertEqual(db.job["rows_done"], 0)
                    self.assertNotIn("finished_at", db.job)
                    self.assertTrue(any(e[1] == "job_tracker_error_failed" for e in log.events))
                else:
                    self.assertEqual(db.job["status"], "error")
                    self.assertEqual(db.job["rows_done"], 101)
                    self.assertIn("cancelled", db.job["error_msg"])
                    self.assertIn("finished_at", db.job)
                warning, = self.warnings(log)
                self.assertEqual(warning["outcome"], "cancelled")
                self.assertEqual(warning["cohorts_completed"], 1)
                self.assertEqual(warning["rows_outcome_unknown"], 0)

    async def test_actual_loguru_message_format_renders_aggregate_counts(self):
        from loguru import logger
        rendered = []
        default_rendered = []
        default_sink = logger.add(default_rendered.append)
        sink = logger.add(rendered.append, format="{time:HH:mm:ss} | {level:<7} | {message}")
        try:
            env, scraper, _, _ = self.fixture(items(101), DB(missing={"101"}))
            env["logger"] = logger
            self.assertEqual(await scraper.run(["000"]), 2100)
        finally:
            logger.remove(sink)
            logger.remove(default_sink)
        default_warning, = [str(m) for m in default_rendered
                            if "ranking_run_incomplete_observations" in str(m)]
        self.assertIn("rows_acknowledged=2100", default_warning)
        self.assertIn("unresolved_mapping_rows=21", default_warning)
        self.assertIn("rows_outcome_unknown=0", default_warning)
        warnings = [str(m) for m in rendered if "ranking_run_incomplete_observations" in str(m)]
        self.assertEqual(len(warnings), 1)
        text = warnings[0]
        for expected in ("rows_acknowledged=2100", "unresolved_mapping_rows=21",
                         "unresolved_mapping_cohorts=21", "cohort_target=21",
                         "source_empty_cohorts=0", "rows_outcome_unknown=0",
                         "count_basis=successful_upsert_submission_acknowledgements_not_unique_rows"):
            self.assertIn(expected, text)
        self.assertNotIn("musinsa_no", text)
        successes = [str(m) for m in rendered if "ranking_run_done" in str(m)]
        self.assertEqual(len(successes), 1)
        self.assertIn("rows_acknowledged=2100", successes[0])

    async def test_bot_blocked_never_retries(self):
        env, scraper, _, _ = self.fixture([])
        calls = []

        async def blocked():
            calls.append(1)
            raise env["BotBlockedError"]("fixture blocked")

        with self.assertRaises(env["BotBlockedError"]):
            await scraper._with_retry(blocked, label="fixture")
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
