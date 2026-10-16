import unittest

from worker.matchers.erp_code_candidates import build_code_candidates
from worker.matchers.style_market_evidence import (
    read_linked_market_products,
    read_style_color_sales,
)


class Tests(unittest.TestCase):
    def test_direct_and_composite_all_resolutions_conflict(self):
        p = {"id": "p", "style_no": "CO1BK", "erp_style_code": None}
        products = {"samples": [p], "peers": [p], "peer_scope_complete": True}
        direct = {
            "complete": True,
            "rows": [{"BRANDCD": "CO", "STYLECD": "CO1BK", "MASTER_KEY_ROWS": 1}],
        }
        composite = {
            "complete": True,
            "rows": [{"BRANDCD": "CO", "STYLECD": "CO1", "COLORCD": "BK", "MASTER_KEY_ROWS": 1}],
        }
        r = build_code_candidates(products, direct, composite)
        self.assertEqual(r["candidates"], [])
        self.assertEqual(r["conflicts"][0]["reason"], "CODE_RESOLUTION_AMBIGUOUS")
        composite["complete"] = False
        self.assertEqual(
            build_code_candidates(products, direct, composite)["conflicts"][0]["reason"],
            "READ_INCOMPLETE",
        )

    def test_bad_or_incomplete_scope_does_not_initialize_factories(self):
        with self.assertRaises(RuntimeError):
            read_style_color_sales(
                [],
                {"brand": "CO", "from": "2026-10-01", "to": "2026-10-14", "aggregate": "daily"},
                lambda: self.fail("opened"),
            )
        r = read_linked_market_products(
            {"complete": False, "rows": []}, ["a", "b"], lambda: self.fail("opened")
        )
        self.assertFalse(r["complete"])
