"""Offline real-function tests: fake model and in-memory DB only."""
import asyncio
import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from worker.tests.test_briefing_evidence import offline_runtime
from worker.tests.test_briefing_publication import DAY, StoredBriefings, runtime, summary

ID = '11111111-1111-4111-8111-111111111111'
LINK = f'/anomaly?id={ID}&date=2026-10-10&module=ranking'
INPUTS = {'anomalies_all': {'high': [{'link': LINK, 'brand_slug': 'covered'}]},
          'own_ranking_delta': [{'product_id': ID, 'brand_slug': 'real-brand'}],
          'news': [{'source_url': 'https://example.invalid/source'}]}


def client(payload):
    return SimpleNamespace(messages=SimpleNamespace(create=AsyncMock(return_value=SimpleNamespace(
        content=[SimpleNamespace(text=json.dumps(payload))],
        usage=SimpleNamespace(input_tokens=0, output_tokens=0)))))


def payload(link):
    result = summary()
    result['insights'] = [{'title': '관찰', 'body': '조회 표본', 'link': link}]
    return result


class LinkProvenanceTests(unittest.IsolatedAsyncioTestCase):
    async def test_valid_and_empty_links_preserved(self):
        env = offline_runtime()
        for link in [LINK, f'/product?id={ID}', '/brand?slug=real-brand', '/ranking', '']:
            generated = await env['generate_briefing']('staff', INPUTS, client(payload(link)))
            page = await env['generate_insight_page'](
                0, generated['insights'][0], INPUTS, 'staff', client({'article': '관찰'}))
            self.assertEqual(page['link'], link)
        page = await env['generate_insight_page'](
            0, {'title': '관찰', 'body': '조회 표본'}, {}, 'cs', client({'article': '관찰'}))
        self.assertEqual(page['link'], '')

    async def test_invalid_links_rejected_at_summary_and_detail(self):
        env = offline_runtime()
        for link in [f'/anomaly?id={ID.replace("1", "2")}',
                     LINK.replace('2026-10-10', '2026-10-09'), LINK + '&extra=true',
                     LINK.split('&')[0], '/product?id=invented', '/brand?slug=invented',
                     '/brand?slug=covered', '/ranking?gender=M',
                     'https://example.invalid/fabricated-evidence',
                     'https://example.invalid/source', '//example.invalid/source',
                     'javascript:alert(1)', ' ', None, 1]:
            with self.subTest(link=link):
                with self.assertRaises(ValueError):
                    await env['generate_briefing']('staff', INPUTS, client(payload(link)))
                model = client({'article': '관찰'})
                with self.assertRaises(ValueError):
                    await env['generate_insight_page'](0, payload(link)['insights'][0], INPUTS, 'staff', model)
                model.messages.create.assert_not_awaited()

    async def test_unsafe_exact_source_link_is_not_internal_navigation(self):
        env = offline_runtime()
        for link in ['https://example.invalid/source', '//example.invalid',
                     '/api/redirect?url=https://example.invalid', '/product\\evil',
                     '/%2f%2fexample.invalid', '/product?id=x\n', '/brand?slug=x#fragment']:
            with self.subTest(link=link), self.assertRaises(ValueError):
                await env['generate_briefing']('staff', {'own_ranking_delta': [{'link': link}]}, client(payload(link)))

    async def test_failure_preserves_old_revision_and_propagates(self):
        for stage in ['summary', 'detail']:
            db = StoredBriefings()
            previous = copy.deepcopy(db.rows)
            env, tracker = runtime(db)
            env['collect_staff_inputs'].return_value = INPUTS
            model = client(payload('https://example.invalid/fabricated-evidence'))
            env['anthropic'].AsyncAnthropic.return_value = model
            env['asyncio'] = SimpleNamespace(gather=asyncio.gather,
                                            CancelledError=asyncio.CancelledError, sleep=AsyncMock())
            env['generate_briefing'] = (offline_runtime()['generate_briefing'] if stage == 'summary'
                                       else AsyncMock(return_value=payload('/product?id=invented')))
            self.assertEqual(await env['run'](DAY, audiences=['staff']), 0)
            self.assertEqual(db.rows, previous)
            self.assertEqual(db.publications, [])
            tracker.error.assert_awaited_once()
            env['enqueue_for_subscribers'].assert_not_called()
            self.assertEqual(model.messages.create.await_count, 2 if stage == 'summary' else 0)
