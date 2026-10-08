"""Offline actual detector-function tests; no SDK or environment loading."""
import ast
import unittest
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).parents[2]


@dataclass
class Anomaly:
    module: str
    severity: str
    anomaly_type: str
    entity_type: str | None = None
    entity_id: str | None = None
    entity_name: str | None = None
    description: str | None = None
    meta: dict = field(default_factory=dict)


def source(name, additions=None):
    tree = ast.parse((ROOT / name).read_text(encoding="utf-8"))
    tree.body = [n for n in tree.body if not isinstance(n, (ast.Import, ast.ImportFrom))
                 and not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Call))
                 and not isinstance(n, ast.If)]
    env = {"Anomaly": Anomaly, "date": date, "timedelta": timedelta,
           "Client": object, "logger": SimpleNamespace(info=lambda *a, **k: None,
                                                        warning=lambda *a, **k: None)}
    if additions:
        env.update(additions)
    exec(compile(tree, name, "exec"), env)
    return env


RULES = source("worker/detectors/rank_observation.py")
PRODUCT = source("worker/detectors/ranking_detector.py", RULES)
BRAND = source("worker/detectors/brand_ranking_detector.py", RULES)
TODAY = date(2026, 10, 6)


def product(rank, stock=False, price=100, own=True):
    return {"rank": rank, "is_sold_out": stock, "final_price": price,
            "product_name": "fixture", "brand_name": "fixture", "is_own": own}


class Tests(unittest.TestCase):
    def products(self, today, previous):
        PRODUCT["_load_ranking"] = lambda client, d: today if d == TODAY else previous
        return PRODUCT["detect_ranking"](None, TODAY)

    def brands(self, today, previous):
        BRAND["_load_own_brand_slugs"] = lambda c: {"own"}
        BRAND["_load_slug_to_uuid"] = lambda c: {"own": "uuid", "competitor": "uuid2"}
        BRAND["_load_brand_ranking_with_name"] = lambda c, d, g: {
            k: {"rank": v, "brand_name": k} for k, v in today.items()}
        BRAND["_load_brand_ranking"] = lambda c, d, g: previous if d != TODAY else {}
        return BRAND["detect_brand_ranking"](None, TODAY)

    def test_own_thresholds_low_and_metadata(self):
        for results in (self.products({"p": product(20)}, {"p": product(10)}),
                        self.brands({"own": 15}, {"own": 10})):
            self.assertTrue(results)
            self.assertTrue(all(a.severity == "low" for a in results))
            self.assertTrue(all(a.meta["policy_version"] == "legacy-rank-noise-v1"
                                for a in results))

    def test_multi_decline_never_high(self):
        results = self.products({str(i): product(30) for i in range(3)},
                                {str(i): product(10) for i in range(3)})
        self.assertIn("rank_multi_drop_own", [a.anomaly_type for a in results])
        self.assertTrue(all(a.severity == "low" for a in results))

    def test_missing_maps_do_not_prove_exit_or_entry_return(self):
        self.assertEqual(self.products({"other": product(10)}, {"p": product(10)}), [])
        self.assertEqual(self.products({"p": product(8, own=False)}, {}), [])
        self.assertEqual(self.brands({"competitor": 8}, {"own": 10}), [])
        self.assertEqual(self.brands({"own": 8}, {}), [])

    def test_observed_entry_return_and_brand_crossing_remain_low(self):
        cases = [self.products({"p": product(8, own=False)}, {"p": product(40, own=False)}),
                 self.products({"p": product(40)}, {"p": product(60)}),
                 self.brands({"own": 60}, {"own": 40}),
                 self.brands({"competitor": 8}, {"competitor": 40})]
        for results in cases:
            self.assertTrue(results)
            self.assertTrue(all(a.severity == "low" for a in results))

    def test_literal_stock_transition_preserves_high_unknown_not_false(self):
        for previous in (None, 0, "false", False):
            results = self.products({"p": product(10, True)}, {"p": product(10, previous)})
            stock = [a for a in results if a.anomaly_type == "sold_out"]
            self.assertEqual(len(stock), 1 if previous is False else 0)
            if stock:
                self.assertEqual(stock[0].severity, "high")

    def test_price_high_not_suppressed(self):
        results = self.products({"p": product(10, price=70)}, {"p": product(10)})
        self.assertEqual([(a.anomaly_type, a.severity) for a in results],
                         [("price_drop", "high")])

    def test_rank_notification_exclusion_only_and_actual_runner(self):
        sent = []
        runner = source("worker/detectors/runner.py", {
            **RULES, "enqueue_for_subscribers": lambda *a, **k: sent.append(a[0])})
        candidates = [Anomaly("x", "high", "rank_drop_own"),
                      Anomaly("x", "medium", "brand_new_entrant_top10"),
                      Anomaly("x", "high", "sold_out"),
                      Anomaly("x", "medium", "review_rating_drop"),
                      Anomaly("x", "high", "future_rule"),
                      Anomaly("x", "high", "rank_drop_own",
                              meta={"policy_version": "confirmed-v4"})]
        runner["_enqueue_anomalies"](candidates, TODAY)
        self.assertEqual(sent, ["anomaly_high"] * 3 + ["anomaly_med"])

    def test_loader_store_cohort_and_invalid_ranks(self):
        calls = []
        class Query:
            def __getattr__(self, name):
                if name == "execute":
                    return lambda: SimpleNamespace(data=[])
                return lambda *args: (calls.append((name, args)) or self)
        client = SimpleNamespace(table=lambda table: Query())
        # Reload original loader rather than the patched test seam.
        loader = source("worker/detectors/ranking_detector.py", RULES)
        self.assertEqual(loader["_load_ranking"](client, TODAY), {})
        for pair in (("store_code", "musinsa"), ("category_code", "000"),
                     ("gender_filter", "A"), ("age_filter", "AGE_BAND_ALL")):
            self.assertIn(("eq", pair), calls)
        for invalid in (None, 0, -1, True, "10"):
            self.assertFalse(RULES["valid_rank"](invalid))

    def test_actual_loader_preserves_independent_stock_price_with_invalid_ranks(self):
        for prior_rank, current_rank, prior_stock, current_stock, price, expected in (
            (0, 10, False, True, 70, {"sold_out", "price_drop"}),
            (None, 10, False, True, None, {"sold_out"}),
            (0, 10, None, True, 70, {"price_drop"}),
            (10, None, False, True, 70, {"price_drop"}),
            (10, 0, False, True, 70, {"price_drop"}),
            (0, 10, False, True, 100, {"sold_out"}),
            (0, 10, False, None, 70, {"price_drop"}),
        ):
            with self.subTest(prior_rank=prior_rank, current_rank=current_rank,
                              prior_stock=prior_stock, price=price):
                rows = {}
                for day, rank, stock, value in (
                    (TODAY - timedelta(days=1), prior_rank, prior_stock, 100),
                    (TODAY, current_rank, current_stock, price),
                ):
                    rows[day.isoformat()] = [{"product_id": "p", "rank_position": rank,
                                             "is_sold_out": stock, "final_price": value,
                                             "product_name": "fixture", "brand_name": "fixture"}]
                class Query:
                    def __init__(self, table):
                        self.table = table
                        self.day = None

                    def eq(self, key, value):
                        if key == "snapshot_date":
                            self.day = value
                        return self

                    def execute(self):
                        return SimpleNamespace(data=rows[self.day] if self.table == "ranking_snapshots"
                                               else [{"id": "p"}])

                    def __getattr__(self, name):
                        return lambda *args: self
                client = SimpleNamespace(table=lambda table: Query(table))
                detector = source("worker/detectors/ranking_detector.py", RULES)
                results = detector["detect_ranking"](client, TODAY)
                self.assertEqual({a.anomaly_type for a in results}, expected)
                self.assertTrue(all(a.severity == "high" for a in results))


if __name__ == "__main__":
    unittest.main(verbosity=2)
