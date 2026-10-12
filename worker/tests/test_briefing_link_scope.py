"""Actual audience formatters and explicit evidence schemas, entirely offline."""
import ast
import asyncio
import copy
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

from worker.tests.test_briefing_evidence import SOURCE, offline_runtime
from worker.tests.test_briefing_link_provenance import client, payload
from worker.tests.test_briefing_publication import DAY, StoredBriefings, runtime


def formatted_runtime():
    env = offline_runtime()
    names = {'_j', '_header', '_format_staff_message', '_format_cs_message',
             '_format_executive_message', 'format_user_message'}
    nodes = [node for node in ast.parse(SOURCE.read_text()).body
             if isinstance(node, ast.FunctionDef) and node.name in names]
    env['date'] = date
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), env)
    return env


def inputs(**sections):
    return {'date': DAY, 'weekday': '일', **sections}


class LinkScopeTests(unittest.IsolatedAsyncioTestCase):
    async def assert_rejected(self, data, link, audience='staff'):
        env = formatted_runtime()
        with self.assertRaises(ValueError):
            await env['generate_briefing'](audience, data, client(payload(link)))
        model = client({'article': '관찰'})
        with self.assertRaises(ValueError):
            await env['generate_insight_page'](0, payload(link)['insights'][0], data, audience, model)
        model.messages.create.assert_not_awaited()

    async def test_five_independent_counterexamples(self):
        link = '/product?id=hidden'
        data = inputs(unused_metadata={'link': link})
        self.assertNotIn(link, formatted_runtime()['format_user_message']('staff', data))
        await self.assert_rejected(data, link)
        link = '/product?id=unrelated'
        await self.assert_rejected(inputs(own_ranking_delta=[
            {'product_id': 'real', 'meta': {'debug': {'link': link}}}]), link)
        for char in ['\x00', '\x1b', '\x7f']:
            with self.subTest(code=ord(char)):
                link = '/product?id=x' + char
                await self.assert_rejected(inputs(own_ranking_delta=[{'link': link}]), link)

    async def test_all_controls_and_path_boundaries(self):
        for suffix in [chr(code) for code in [*range(32), *range(127, 160)]] + [
                '%00', '%1b', '%1B', '%7f', '%0D%0A']:
            with self.subTest(suffix=repr(suffix)):
                link = '/product?id=x' + suffix
                await self.assert_rejected(inputs(own_ranking_delta=[{'link': link}]), link)
        for link in ['//evil.invalid', '/%70roduct?id=x', '/product/../company?id=x',
                     '/product\\evil', '/product#fragment', 'https://evil.invalid']:
            await self.assert_rejected(inputs(own_ranking_delta=[{'link': link}]), link)

    async def test_explicit_sections_children_queries_and_empty_contract(self):
        env = formatted_runtime()
        encoded = '/brand?slug=a%26b%23c&label=%EB%B8%8C%EB%9E%9C%EB%93%9C&x=a+b'
        cases = [('staff', 'own_ranking_delta', [{'link': encoded}], encoded),
                 ('staff', 'anomalies_all', {'high': [{'link': '/anomaly?id=real'}]}, '/anomaly?id=real'),
                 ('staff', 'category_trends', [{'top_brands': [{'brand_slug': 'real'}]}], '/brand?slug=real'),
                 ('staff', 'active_promotions', [{'own_brand_items': [{'brand_slug': 'own'}]}], '/brand?slug=own'),
                 ('executive', 'dart_disclosures', [{'link': '/company?id=real'}], '/company?id=real'),
                 ('cs', 'low_reviews', [{'product_id': 'real'}], '/product?id=real')]
        for audience, section, rows, link in cases:
            data = inputs(**{section: rows}, unused_metadata={'link': '/product?id=hidden'})
            result = await env['generate_briefing'](audience, data, client(payload(link)))
            model = client({'article': '관찰'})
            page = await env['generate_insight_page'](0, result['insights'][0], data, audience, model)
            self.assertEqual(page['link'], link)
            self.assertNotIn('unused_metadata', model.messages.create.call_args.kwargs['messages'][0]['content'])
        for audience in ['staff', 'executive', 'cs']:
            for link in ['', '/ranking']:
                result = await env['generate_briefing'](audience, inputs(), client(payload(link)))
                self.assertEqual(result['insights'][0]['link'], link)
            no_link = payload('')['insights'][0]
            del no_link['link']
            self.assertEqual((await env['generate_insight_page'](
                0, no_link, inputs(), audience, client({'article': '관찰'})))['link'], '')
        await self.assert_rejected(inputs(own_ranking_delta=[{'link': encoded}]), encoded.replace('%26', '&'))

    async def test_cross_audience_and_unknown_children_cannot_authorize(self):
        await self.assert_rejected(inputs(low_reviews=[{'product_id': 'cs-only'}]), '/product?id=cs-only')
        await self.assert_rejected(inputs(own_ranking_delta=[{'brand_slug': 'staff-only'}]),
                                   '/brand?slug=staff-only', 'cs')
        await self.assert_rejected(inputs(category_trends=[{'metadata': [{'brand_slug': 'hidden'}]}]),
                                   '/brand?slug=hidden')
        await self.assert_rejected(inputs(news_hot=[{'link': '/product?id=news'}]),
                                   '/product?id=news', 'executive')

    async def test_new_failures_preserve_previous_complete_revision(self):
        for data, link in [(inputs(unused_metadata={'link': '/product?id=hidden'}), '/product?id=hidden'),
                           (inputs(own_ranking_delta=[{'meta': {'link': '/product?id=nested'}}]), '/product?id=nested'),
                           *[(inputs(own_ranking_delta=[{'link': '/product?id=x' + c}]), '/product?id=x' + c)
                             for c in ['\x00', '\x1b', '\x7f']]]:
            for stage in ['summary', 'detail']:
                db = StoredBriefings()
                previous = copy.deepcopy(db.rows)
                env, tracker = runtime(db)
                env['collect_staff_inputs'].return_value = data
                model = client(payload(link))
                env['anthropic'].AsyncAnthropic.return_value = model
                env['asyncio'] = SimpleNamespace(gather=asyncio.gather,
                                                CancelledError=asyncio.CancelledError, sleep=AsyncMock())
                env['generate_briefing'] = (formatted_runtime()['generate_briefing'] if stage == 'summary'
                                           else AsyncMock(return_value=payload(link)))
                self.assertEqual(await env['run'](DAY, audiences=['staff']), 0)
                self.assertEqual(db.rows, previous)
                self.assertEqual(db.publications, [])
                tracker.error.assert_awaited_once()
                env['enqueue_for_subscribers'].assert_not_called()


class FormatterSchemaTests(unittest.TestCase):
    def test_schema_exactly_matches_final_formatter_sections(self):
        tree = ast.parse(SOURCE.read_text())
        env = formatted_runtime()
        for audience, schema in env['_BRIEFING_INPUT_FIELDS'].items():
            node = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                        and n.name == f'_format_{audience}_message')
            fields = {n.args[0].value for n in ast.walk(node) if isinstance(n, ast.Call)
                      and isinstance(n.func, ast.Attribute) and n.func.attr == 'get'
                      and isinstance(n.func.value, ast.Name) and n.func.value.id == 'inputs'}
            self.assertEqual(set(schema), fields)
