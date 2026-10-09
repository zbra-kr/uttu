"""Offline prompt regression: no database, model client, credentials or inference."""

import ast
import asyncio
import json
import math
import re
import time
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

SOURCE = Path(__file__).parents[1] / 'agent' / 'briefing_writer.py'


def prompt_constants():
    tree = ast.parse(SOURCE.read_text())
    allowed = {'_SYSTEM_EXECUTIVE', '_SYSTEM_STAFF', '_SYSTEM_CS', '_SYSTEM_INSIGHT_PAGE', '_EVIDENCE_RULES', '_SYSTEM_PROMPTS'}
    nodes = []
    for node in tree.body:
        target = node.targets[0] if isinstance(node, ast.Assign) else getattr(node, 'target', None)
        if isinstance(target, ast.Name) and target.id in allowed:
            nodes.append(node)
    env = {}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), env)
    return env


class EvidencePromptTests(unittest.TestCase):
    def test_all_audiences_allow_no_evidence_and_less_than_ten(self):
        for prompt in prompt_constants()['_SYSTEM_PROMPTS'].values():
            self.assertIn('0~10개', prompt)
            self.assertIn('근거가 없으면 빈 배열 []', prompt)
            self.assertNotIn('정확히 10개', prompt)
            self.assertIn('빈 배열을', prompt)
            self.assertIn("'문제 없음'의 증거로 사용 금지", prompt)

    def test_correlation_is_not_effect(self):
        prompt = prompt_constants()['_SYSTEM_STAFF']
        self.assertNotIn('실제 효과 확인된 것', prompt)
        self.assertIn('콘텐츠 효과의 검증 결과가 아니다', prompt)
        self.assertIn('높은 ROI 확인을 주장하지 말 것', prompt)
        self.assertIn('동일 상품·카테고리·성별·연령·비교 날짜', prompt)

    def test_known_sample_claim_is_explicitly_corrected_in_instructions(self):
        prompt = prompt_constants()['_SYSTEM_CS']
        self.assertIn("'어제 리뷰 4건 전원 5점' 대신", prompt)
        self.assertIn('조회 표본 4건 중 4건 5점', prompt)
        self.assertIn('미수집·지연 수집·조회 제한', prompt)

    def test_detail_does_not_amplify_summary_or_force_metrics(self):
        prompt = prompt_constants()['_SYSTEM_INSIGHT_PAGE']
        self.assertIn('인사이트 요약 자체는 근거가 아니다', prompt)
        self.assertIn('원자료로 확인된 숫자만 0~4개', prompt)
        self.assertIn('ROI 확인을 주장하지 말 것', prompt)
        self.assertIn('입력 link가 있으면 쿼리 문자열까지 그대로 복사', prompt)




def offline_runtime():
    """Execute the real pure/async function bodies with explicit offline dependencies."""
    tree = ast.parse(SOURCE.read_text())
    names = {'_extract_json_dict', 'generate_briefing', 'generate_insight_pages',
             'generate_insight_page', '_validate_insight_detail', '_upsert_briefing',
             '_failure_diagnostic', '_failure_kind'}
    nodes = [ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0)]
    nodes += [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names]
    env = {**prompt_constants(), 'json': json, 'math': math, 're': re, 'time': time, 'asyncio': asyncio,
           'datetime': datetime, 'KST': timezone.utc,
           'MODEL': 'offline-test', 'format_user_message': lambda *_: 'offline input',
           '_j': json.dumps, 'logger': SimpleNamespace(warning=Mock())}
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(SOURCE), 'exec'), env)
    return env


class EmptyInsightRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_generation_parser_preserves_empty_insights(self):
        env = offline_runtime()
        payload = {'headline': '확인 필요', 'daily_brief': [], 'card_comments': {}, 'insights': []}
        for audience in ['executive', 'staff', 'cs']:
            create = AsyncMock(return_value=SimpleNamespace(
                content=[SimpleNamespace(text='```json\n' + json.dumps(payload) + '\n```')],
                usage=SimpleNamespace(input_tokens=0, output_tokens=0)))
            result = await env['generate_briefing'](audience, {}, SimpleNamespace(messages=SimpleNamespace(create=create)))
            self.assertEqual(result['insights'], [])
            self.assertEqual(result['headline'], '확인 필요')
            self.assertEqual(create.await_count, 1)
            self.assertEqual(create.call_args.kwargs['system'], env['_SYSTEM_PROMPTS'][audience])
            # Empty results do not schedule any detail-model calls.
            detail = AsyncMock(side_effect=AssertionError('No detail generation expected'))
            env['generate_insight_page'] = detail
            self.assertEqual(await env['generate_insight_pages'](result, {}, object()), [])
            detail.assert_not_awaited()
            # The persistence adapter accepts an empty array unchanged, with a fake DB only.
            db = Mock()
            db.table.return_value.upsert.return_value.execute.return_value.data = [
                {'briefing_date': '2026-10-03', 'audience': audience}]
            env['_upsert_briefing'](db, result, date(2026, 10, 3), [])
            self.assertEqual(db.table.return_value.upsert.call_args.args[0]['insights'], [])

    async def test_missing_optional_insights_schedule_no_details(self):
        env = offline_runtime()
        detail = AsyncMock(side_effect=AssertionError('No detail generation expected'))
        env['generate_insight_page'] = detail
        for result in [{'audience': 'cs'}, {'audience': 'cs', 'insights': None}]:
            self.assertEqual(await env['generate_insight_pages'](result, {}, object()), [])
        detail.assert_not_awaited()

    async def test_detail_failure_propagates_without_publishing_a_fallback_revision(self):
        env = offline_runtime()
        client = SimpleNamespace(messages=SimpleNamespace(create=AsyncMock(side_effect=RuntimeError('offline failure'))))
        insight = {'title': '확인 필요', 'body': '근거 부족', 'link': '/reviews?brand=example'}
        with self.assertRaisesRegex(RuntimeError, 'offline failure'):
            await env['generate_insight_page'](0, insight, {}, 'cs', client)


if __name__ == '__main__':
    unittest.main()
