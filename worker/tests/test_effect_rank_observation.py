"""Offline regressions using real detector/loader code and an in-memory query double.

Run with unittest and existing dependencies; no live client or notifications.
"""
import importlib
import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

MODULES = [importlib.import_module('worker.detectors.' + n) for n in
           ('magazine_boost_detector', 'snap_boost_detector', 'promo_effectiveness_detector')]

DAY = date(2026, 10, 5)


def row(offset, rank, **extra):
    return dict(id=str(offset), musinsa_no='1', snapshot_date=(DAY+timedelta(days=offset)).isoformat(),
                rank_position=rank, review_count=10, category_code='000', gender_filter='A',
                store_code='musinsa', age_filter='AGE_BAND_ALL', **extra)


class Query:
    def __init__(self, rows):
        self.rows = rows[:]
    def select(self, fields, *, count):
        assert count == "exact"
        return self
    def eq(self, key, value):
        self.rows = [r for r in self.rows if r[key] == value]
        return self
    def in_(self, key, values):
        self.rows = [r for r in self.rows if r[key] in values]
        return self
    def gte(self, key, value):
        self.rows = [r for r in self.rows if r[key] >= value]
        return self
    def lte(self, key, value):
        self.rows = [r for r in self.rows if r[key] <= value]
        return self
    def order(self, key):
        self.rows.sort(key=lambda r: r[key])
        return self
    def range(self, lo, hi):
        self.count = len(self.rows)
        self.rows = self.rows[lo:hi+1]
        return self
    def execute(self):
        return SimpleNamespace(data=self.rows, count=self.count)


class Client:
    def __init__(self, rows):
        self.rows = rows
    def table(self, name):
        assert name == 'ranking_snapshots'
        return Query(self.rows)


class EffectRanks(unittest.TestCase):
    def detect(self, module, rows):
        common = dict(musinsa_no='1', product_id='p', product_name='product', is_own=True)
        if module is MODULES[0]:
            loader, detector = '_load_articles_with_products', module.detect_magazine_boost
            item = dict(common, article_id='a', title='article', pub_date=DAY, view_count=500)
        elif module is MODULES[1]:
            loader, detector = '_load_snap_products', module.detect_snap_boost
            item = dict(common, snap_id='s', snap_uuid='s', collected_at=DAY, engagement=500,
                        view_count=500, like_count=0, goods_click_count=0)
        else:
            loader, detector = '_load_promo_items', module.detect_promo_effectiveness
            item = dict(common, promo_id='p', promo_title='promo', promo_type='sale',
                        snapshot_date=DAY, brand_slug='b', discount_rate=10)
        with patch.object(module, loader, return_value=[item]):
            return detector(Client(rows), DAY+timedelta(days=5))

    def check_all(self, rows, severity=None):
        for module in MODULES:
            with self.subTest(module=module.__name__, rows=rows):
                result = self.detect(module, rows)
                if severity is None:
                    self.assertEqual(result, [])
                else:
                    self.assertEqual(len(result), 1)
                    self.assertEqual(result[0].severity, severity)
                    self.assertEqual(result[0].meta['rank_delta'], rows[0]['rank_position']-rows[1]['rank_position'])
                    self.assertNotIn('신규 진입', result[0].description)

    def test_missing_before(self):
        self.check_all([row(1, 20)])
    def test_missing_after(self):
        self.check_all([row(-1, 80)])
    def test_normal_and_thresholds(self):
        for before, after, severity in [(80,20,'high'),(70,30,'medium'),(70,20,'high'),
                                        (80,60,'medium'),(80,70,'low'),(29,20,None),
                                        (80,81,None)]:
            self.check_all([row(-1,before),row(1,after)],severity)
    def test_age_category_gender_store_mixing(self):
        for field, value in [('age_filter','AGE_BAND_20'),('category_code','001'),
                             ('gender_filter','M'),('store_code','beauty')]:
            before=row(-1,80); before[field]=value
            self.check_all([before,row(1,20)])
            # Unrelated age rank cannot overwrite a real cohort observation.
            self.check_all([row(-1,80),row(1,20),dict(row(-1,21),**{field:value})],'high')
    def test_window_bounds_and_fallback(self):
        self.check_all([row(-4,80),row(1,20)])
        self.check_all([row(-1,80),row(6,20)])
        self.check_all([row(-3,80),row(2,20)],'high')
    def test_invalid_before_after(self):
        for bad in (None,0,-1,True,'80',80.0):
            self.check_all([row(-1,bad),row(1,20)])
            self.check_all([row(-1,80),row(1,bad)])
    def test_duplicate_identical_and_conflicting(self):
        self.check_all([row(-1,80),row(1,20),row(-1,80)],'high')
        for offset in (-1,1):
            for ordered in ([row(-1,80),row(1,20),row(offset,25)],
                            [row(offset,25),row(-1,80),row(1,20)]):
                self.check_all(ordered)
    def test_duplicates_across_page_boundary(self):
        for module in MODULES:
            rows=[dict(row(-1,80),id=f'{i:04}') for i in range(1000)]
            rows += [dict(row(-1,25),id='1000'),dict(row(1,20),id='1001')]
            self.assertEqual(self.detect(module,rows),[])
    def test_nearest_before_best_after_and_event_day_excluded(self):
        rows = [row(-3,100),row(-1,29),row(0,1),row(1,20),row(2,25)]
        self.check_all(rows)
        for module in MODULES:
            result=self.detect(module,[row(-3,100),row(-1,80),row(1,60),row(2,20)])
            self.assertEqual([(a.meta['rank_before'],a.meta['rank_after'],a.severity)
                              for a in result],[(80,20,'high')])
    def test_invalid_duplicate_cannot_be_overwritten(self):
        for ordered in ([row(-1,0),row(-1,80),row(1,20)],
                        [row(-1,80),row(-1,0),row(1,20)]):
            self.check_all(ordered)
    def test_promo_review_conflict_rejected(self):
        other=row(-1,80); other['review_count']=100
        self.assertEqual(self.detect(MODULES[2],[row(-1,80),other,row(1,20)]),[])

    def test_promo_review_surge_preserved(self):
        after=row(1,75); after['review_count']=30
        result=self.detect(MODULES[2],[row(-1,80),after])
        self.assertEqual([(a.anomaly_type,a.severity) for a in result],[('promo_review_surge','high')])


if __name__ == '__main__':
    unittest.main()
