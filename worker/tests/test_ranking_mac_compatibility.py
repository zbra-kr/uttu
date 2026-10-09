"""Mac-local own-brand propagation with real collector bodies and offline DB fixtures."""
import asyncio
import unittest
from types import SimpleNamespace

from worker.tests.test_ranking_collection_accounting import DB, Log, Query, Tracker, items, load


class CompatibilityQuery(Query):
    def __init__(self, db, table):
        super().__init__(db, table)
        self.columns = None
        self.null_brand_only = False

    def select(self, columns):
        self.columns = columns
        return super().select(columns)

    def is_(self, column, value):
        if column == "brand_id" and value == "null":
            self.null_brand_only = True
        return super().is_(column, value)

    def execute(self):
        db = self.db
        db.operations.append((self.table, self.action, self.columns, self.null_brand_only))
        if self.table == "brands" and self.action == "select":
            db.brand_columns.append(self.columns)
            return SimpleNamespace(data=[r for r in db.brands if r["slug"] in self.nos])
        if self.table == "products" and self.action == "select":
            db.product_selects += 1
            return SimpleNamespace(data=[{"musinsa_no": no, "id": "p" + no}
                                         for no in self.nos if no not in db.missing
                                         and not (self.null_brand_only and no in db.linked)])
        if self.table == "products" and self.action == "update":
            db.updates.append((self.job_id, dict(self.payload)))
            if db.update_failure is not None:
                raise db.update_failure
            return SimpleNamespace(data=[{"id": self.job_id, **self.payload}])
        if self.table == "ranking_snapshots" and db.snapshot_cancel_batch == len(db.attempts) + 1:
            db.attempts.append(list(self.payload))
            raise asyncio.CancelledError("offline snapshot cancellation")
        return super().execute()


class CompatibilityDB(DB):
    def __init__(self, brands=(), linked=(), update_failure=None, snapshot_cancel_batch=None, **kwargs):
        super().__init__(**kwargs)
        self.brands = list(brands)
        self.linked = set(linked)
        self.update_failure = update_failure
        self.snapshot_cancel_batch = snapshot_cancel_batch
        self.updates, self.brand_columns, self.operations = [], [], []

    def table(self, name):
        return CompatibilityQuery(self, name)


def own_brand():
    return {"id": "b-own", "slug": "fixture", "is_own": True}


class Tests(unittest.IsolatedAsyncioTestCase):
    def fixture(self, db, data):
        log = Log()
        env = load(log)
        scraper = env["RankingScraper"](db)

        async def fetch(*args):
            return data

        scraper._fetch_ranking = fetch
        return env, scraper, log

    async def test_own_brand_promotes_product_without_writing_brand_ownership(self):
        db = CompatibilityDB(brands=[own_brand()])
        _, scraper, _ = self.fixture(db, items(1, brand=True))
        self.assertEqual(await scraper.run_combo("000", "A", "AGE_BAND_ALL"), 1)
        self.assertEqual(db.updates, [("p1", {"brand_id": "b-own", "is_own": True})])
        self.assertEqual(db.brand_columns, ["id, slug, is_own"])
        self.assertEqual(scraper.rows_acknowledged, 1)
        self.assertEqual(scraper.rows_outcome_unknown, 0)
        self.assertFalse(any(table == "brands" and action == "update"
                             for table, action, _, _ in db.operations))

    async def test_nonown_or_missing_flag_never_demotes_existing_ownership(self):
        for flag in (False, None):
            with self.subTest(flag=flag):
                brand = {"id": "b-other", "slug": "fixture"}
                if flag is not None:
                    brand["is_own"] = flag
                db = CompatibilityDB(brands=[brand])
                _, scraper, _ = self.fixture(db, items(1, brand=True))
                await scraper.run_combo("000", "A", "AGE_BAND_ALL")
                self.assertEqual(db.updates, [("p1", {"brand_id": "b-other"})])
                self.assertNotIn("is_own", db.updates[0][1])

    async def test_only_null_brand_products_are_enriched(self):
        db = CompatibilityDB(brands=[own_brand()], linked={"2"})
        _, scraper, _ = self.fixture(db, items(2, brand=True))
        self.assertEqual(await scraper.run_combo("000", "A", "AGE_BAND_ALL"), 2)
        self.assertEqual(db.updates, [("p1", {"brand_id": "b-own", "is_own": True})])
        self.assertEqual(scraper.rows_acknowledged, 2)
        self.assertTrue(any(table == "products" and null_only
                            for table, _, _, null_only in db.operations))

    async def test_mixed_brand_scope_and_unresolved_product_remain_exact(self):
        data = items(4, brand=True)
        for row, slug in zip(data, ["fixture", "other", "absent", "fixture"]):
            row["image"]["onClickLike"]["eventLog"]["amplitude"]["payload"]["brand_id"] = slug
        db = CompatibilityDB(brands=[own_brand(), {"id": "b-other", "slug": "other", "is_own": False}], missing={"4"})
        _, scraper, _ = self.fixture(db, data)
        self.assertEqual(await scraper.run_combo("000", "A", "AGE_BAND_ALL"), 3)
        self.assertEqual(db.updates, [("p1", {"brand_id": "b-own", "is_own": True}), ("p2", {"brand_id": "b-other"})])
        self.assertEqual(scraper.unresolved_mapping_rows, 1)
        self.assertEqual(scraper.rows_acknowledged, 3)

    async def test_empty_brand_lookup_does_not_invent_ownership_or_lose_acknowledgements(self):
        db = CompatibilityDB()
        _, scraper, _ = self.fixture(db, items(1, brand=True))
        self.assertEqual(await scraper.run_combo("000", "A", "AGE_BAND_ALL"), 1)
        self.assertEqual(db.updates, [])
        self.assertEqual(scraper.rows_acknowledged, 1)

    async def test_repeated_cohorts_count_submissions_with_ownership_preserved(self):
        db = CompatibilityDB(brands=[own_brand()])
        _, scraper, log = self.fixture(db, items(1, brand=True))
        self.assertEqual(await scraper.run(["000"]), 21)
        self.assertEqual(scraper.cohorts_completed, 21)
        self.assertEqual(len(db.updates), 21)
        self.assertTrue(all(payload == {"brand_id": "b-own", "is_own": True} for _, payload in db.updates))
        summary = next(fields for _, event, fields in log.events if event == "ranking_run_done")
        self.assertIn("not_unique_rows", summary["count_basis"])

    async def test_update_failure_retains_snapshot_count_and_error_tracker(self):
        db = CompatibilityDB(brands=[own_brand()], update_failure=RuntimeError("offline product failure"))
        env, scraper, log = self.fixture(db, items(1, brand=True))
        env.update(_supabase_client=lambda: db, RankingScraper=lambda client: scraper, JobTracker=Tracker)
        with self.assertRaisesRegex(RuntimeError, "offline product failure"):
            await env["main"]()
        self.assertEqual(db.updates, [("p1", {"brand_id": "b-own", "is_own": True})])
        self.assertEqual(scraper.rows_acknowledged, 1)
        self.assertEqual(scraper.rows_outcome_unknown, 0)
        self.assertEqual(scraper.cohorts_completed, 0)
        self.assertEqual(db.tracker.calls[1], ("progress", 1))
        self.assertFalse(any(event == "done" for event, _ in db.tracker.calls))
        warning = next(fields for _, event, fields in log.events if event == "ranking_run_incomplete_observations")
        self.assertEqual(warning["outcome"], "error")

    async def test_enrichment_cancellation_preserves_ownership_payload_and_original_cancel(self):
        cancellation = asyncio.CancelledError("offline enrichment cancellation")
        db = CompatibilityDB(brands=[own_brand()], update_failure=cancellation)
        env, scraper, log = self.fixture(db, items(1, brand=True))
        env.update(_supabase_client=lambda: db, RankingScraper=lambda client: scraper, JobTracker=Tracker)
        with self.assertRaises(asyncio.CancelledError) as caught:
            await env["main"]()
        self.assertIs(caught.exception, cancellation)
        self.assertEqual(db.updates, [("p1", {"brand_id": "b-own", "is_own": True})])
        self.assertEqual(scraper.rows_acknowledged, 1)
        self.assertEqual(scraper.rows_outcome_unknown, 0)
        self.assertEqual(db.tracker.calls[1], ("progress", 1))
        self.assertFalse(any(event == "done" for event, _ in db.tracker.calls))
        warning = next(fields for _, event, fields in log.events if event == "ranking_run_incomplete_observations")
        self.assertEqual(warning["outcome"], "cancelled")

    async def test_second_snapshot_batch_failure_never_starts_ownership_enrichment(self):
        db = CompatibilityDB(brands=[own_brand()], fail_batch=2)
        _, scraper, _ = self.fixture(db, items(601, brand=True))
        with self.assertRaisesRegex(RuntimeError, "outcome unknown"):
            await scraper.run(["000"])
        self.assertEqual(scraper.rows_acknowledged, 500)
        self.assertEqual(scraper.rows_outcome_unknown, 101)
        self.assertEqual(db.updates, [])
        self.assertEqual(db.brand_columns, [])
        self.assertEqual(len(db.attempts), 2)

    async def test_second_snapshot_batch_cancellation_keeps_unknown_and_no_retry(self):
        db = CompatibilityDB(brands=[own_brand()], snapshot_cancel_batch=2)
        _, scraper, log = self.fixture(db, items(601, brand=True))
        with self.assertRaises(asyncio.CancelledError):
            await scraper.run(["000"])
        self.assertEqual(scraper.rows_acknowledged, 500)
        self.assertEqual(scraper.rows_outcome_unknown, 101)
        self.assertEqual(db.updates, [])
        self.assertEqual(len(db.attempts), 2)
        warning = next(fields for _, event, fields in log.events if event == "ranking_run_incomplete_observations")
        self.assertEqual(warning["outcome"], "cancelled")
