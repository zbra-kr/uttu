"""Composed input -> audience prompt -> provenance -> detail -> atomic write checks."""
import asyncio
import copy
import json
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

from worker.agent import _cs_review_inputs as cs
from worker.tests import test_effect_rank_observation as effects
from worker.tests.test_briefing_link_scope import formatted_runtime
from worker.tests.test_briefing_publication import StoredBriefings, runtime, summary
from worker.tests.test_cs_review_inputs import DAY, QUERIES, Database, extracted, row
from worker.tests.test_effect_rank_observation import row as rank_row


class IntegratedRevisionTests(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, fault=None, invalid=False, detail_fault=False):
        reviews = Database([row(n, rating=1) for n in range(1, 1002)], fault=fault)
        collector = extracted(QUERIES, {'collect_cs_inputs'}, {
            'read_cs_review_inputs': cs.read_cs_review_inputs, 'WEEKDAY_KO': {}, 'date': date,
        })['collect_cs_inputs']
        # Actual three detectors produce no event for an absent before observation.
        helper = effects.EffectRanks()
        for module in effects.MODULES:
            self.assertEqual(helper.detect(module, [rank_row(1, 20)]), [])
        event = helper.detect(effects.MODULES[0], [rank_row(-1, 80), rank_row(1, 20)])[0]
        staff = {'date': DAY, 'weekday': '일', 'magazine_effectiveness': [
            {'product_id': 'p', 'rank_delta': event.meta['rank_delta']}],
            'low_reviews': [{'product_id': 'hidden-cs'}]}
        db = StoredBriefings()
        previous = copy.deepcopy(db.rows)
        env, tracker = runtime(db)
        env['collect_cs_inputs'] = lambda *_: collector(reviews, DAY)
        env['collect_staff_inputs'].return_value = staff
        env['collect_executive_inputs'].return_value = {
            'date': DAY, 'weekday': '일', 'dart_disclosures': [{'link': '/company?id=c'}]}
        real = formatted_runtime()
        env['generate_briefing'] = real['generate_briefing']
        env['generate_insight_page'] = real['generate_insight_page']
        env['asyncio'] = SimpleNamespace(gather=asyncio.gather,
                                        CancelledError=asyncio.CancelledError, sleep=AsyncMock())
        calls = []

        async def model(**kwargs):
            text = kwargs['messages'][0]['content']
            calls.append(text)
            if '## 배경 데이터' in text:
                answer = {} if detail_fault and '(cs,' in text else {'article': 'complete synthetic detail'}
            else:
                audience = ('cs' if '리뷰 조회 범위' in text else
                            'staff' if '자사 상품 랭킹 변동' in text else 'executive')
                link = {'cs': '/product?id=' + row(1)['product_id'],
                        'staff': '/product?id=p', 'executive': '/company?id=c'}[audience]
                if invalid and audience == 'cs':
                    link = '/product?id=p'  # staff evidence cannot authorize CS
                answer = summary(audience, insights=[{'title': 'observed', 'body': 'synthetic', 'link': link}])
            return SimpleNamespace(content=[SimpleNamespace(text=json.dumps(answer))],
                                   usage=SimpleNamespace(input_tokens=0, output_tokens=0))

        env['anthropic'].AsyncAnthropic.return_value = SimpleNamespace(
            messages=SimpleNamespace(create=AsyncMock(side_effect=model)))
        if fault:
            with self.assertRaises(cs.CSReviewInputError):
                await env['run'](DAY, audiences=['staff', 'cs', 'executive'])
            self.assertEqual(db.rows, previous)
            self.assertEqual(calls, [])
            tracker.error.assert_awaited_once()
        else:
            result = await env['run'](DAY, audiences=['staff', 'cs', 'executive'])
            self.assertEqual(result, 2 if invalid or detail_fault else 3)
            if invalid or detail_fault:
                self.assertEqual(db.rows['cs'], previous['cs'])
                self.assertNotIn('cs', [p['audience'] for p in db.publications])
                env['enqueue_for_subscribers'].assert_not_called()
            else:
                self.assertEqual(len(db.publications), 3)
                self.assertEqual(db.rows['cs']['insight_pages'][0]['link'],
                                 '/product?id=' + row(1)['product_id'])
                cs_messages = [c for c in calls if 'review_input_scope' in c or '리뷰 조회 범위' in c]
                self.assertEqual(len(cs_messages), 2)
                self.assertTrue(all('complete' in c and '1001' in c for c in cs_messages))
                self.assertTrue(all('magazine_effectiveness' not in c for c in cs_messages))
                self.assertTrue(all('hidden-cs' not in c for c in calls))
                tracker.finish.assert_awaited_once_with(rows_done=3)
        return db

    async def test_normal_all_audiences_complete_bundle(self):
        await self.scenario()

    async def test_second_review_page_incomplete_preserves_every_previous_revision(self):
        def fault(query, response):
            if query.bounds[0] == cs.PAGE_SIZE:
                response.data = None
            return response
        await self.scenario(fault=fault)

    async def test_cross_audience_link_preserves_cs_previous_bundle(self):
        await self.scenario(invalid=True)

    async def test_detail_failure_preserves_cs_previous_bundle(self):
        await self.scenario(detail_fault=True)
