"""Offline atomic-publication tests: real worker bodies, no clients or inference."""
import ast
import asyncio
import copy
import json
import unittest
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from worker.tests.test_briefing_evidence import SOURCE, offline_runtime

DAY = date(2026, 10, 4)


def summary(audience='staff', revision='new', insights=None):
    return {'audience': audience, 'headline': revision, 'daily_brief': [revision],
            'weekly_brief': [], 'card_comments': {},
            'insights': [{'title': revision, 'body': revision, 'link': '/ranking'}]
            if insights is None else insights,
            'news_picks': [], 'model': 'offline', 'input_tokens': 0,
            'output_tokens': 0, 'generation_ms': 1}


class StoredBriefings:
    def __init__(self, failure=None):
        self.rows = {aud: {'briefing_date': DAY.isoformat(), **summary(aud, 'old'),
                          'generated_at': '2026-10-04T06:00:00+00:00',
                          'insight_pages': [{'article': 'old'}]}
                     for aud in ['executive', 'staff', 'cs']}
        self.failure, self.publications, self.jobs = failure, [], []

    def table(self, name):
        owner = self

        class Query:
            def upsert(self, payload, on_conflict):
                assert name == 'daily_briefings'
                assert on_conflict == 'briefing_date,audience'
                self.payload = copy.deepcopy(payload)
                return self

            def update(self, payload):
                assert name == 'collection_jobs', 'Separate detail writes are forbidden'
                self.payload = payload
                return self

            def eq(self, column, value):
                assert name == 'collection_jobs' and column == 'id' and value == 1
                return self

            def execute(self):
                if name == 'collection_jobs':
                    assert self.payload['status'] in {'running', 'done', 'error'}
                    owner.jobs.append(self.payload.copy())
                    return SimpleNamespace(data=[])
                if owner.failure == 'reject':
                    raise RuntimeError('offline publication rejected before commit')
                owner.rows[self.payload['audience']] = self.payload
                owner.publications.append(copy.deepcopy(self.payload))
                if owner.failure == 'lost_response':
                    raise RuntimeError('offline response lost after commit')
                return SimpleNamespace(data=[] if owner.failure == 'empty_response' else [self.payload])

        return Query()


def runtime(db, detail=None, revision='new', generate=None):
    env = offline_runtime()
    tree = ast.parse(SOURCE.read_text(encoding='utf8'))
    node = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'run')
    tracker = SimpleNamespace(job_id=1, start=AsyncMock(), finish=AsyncMock(), error=AsyncMock())
    stamp = datetime(2026, 10, 4, 8, tzinfo=timezone.utc)
    env.update({'date': date, 'datetime': SimpleNamespace(now=Mock(return_value=stamp)),
                '_supabase': lambda: db, 'AUDIENCES': ['executive', 'staff', 'cs'],
                'anthropic': SimpleNamespace(AsyncAnthropic=Mock(return_value=object())),
                'os': SimpleNamespace(environ={'ANTHROPIC_API_KEY': 'offline-placeholder'}),
                'JobTracker': Mock(return_value=tracker),
                'collect_executive_inputs': Mock(return_value={}),
                'collect_staff_inputs': Mock(return_value={}),
                'collect_cs_inputs': Mock(return_value={}),
                'generate_briefing': generate or AsyncMock(side_effect=lambda aud, *_: summary(aud, revision)),
                'enqueue_for_subscribers': Mock(return_value=0),
                'logger': SimpleNamespace(info=Mock(), warning=Mock(), error=Mock())})
    if detail is not None:
        env['generate_insight_pages'] = detail
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), str(SOURCE), 'exec'), env)
    return env, tracker


class BriefingPublicationTests(unittest.IsolatedAsyncioTestCase):
    async def test_previous_complete_revision_remains_until_new_bundle_is_ready(self):
        db = StoredBriefings()
        previous = copy.deepcopy(db.rows)
        started, release = asyncio.Event(), asyncio.Event()

        async def detail(*_):
            started.set()
            await release.wait()
            return [{'article': 'new'}]

        env, tracker = runtime(db, detail)
        task = asyncio.create_task(env['run'](DAY, audiences=['staff']))
        try:
            await asyncio.wait_for(started.wait(), timeout=2)
            self.assertEqual(db.rows, previous)
            self.assertEqual(db.publications, [])
        finally:
            release.set()
            result = await task
        self.assertEqual(result, 1)
        self.assertEqual(len(db.publications), 1)
        self.assertEqual(db.rows['staff']['headline'], 'new')
        self.assertEqual(db.rows['staff']['insight_pages'], [{'article': 'new'}])
        self.assertEqual(db.rows['staff']['generated_at'], '2026-10-04T08:00:00+00:00')
        tracker.finish.assert_awaited_once_with(rows_done=1)

    async def test_detail_generation_failure_preserves_previous_revision(self):
        db = StoredBriefings()
        previous = copy.deepcopy(db.rows)
        env, tracker = runtime(db, AsyncMock(side_effect=RuntimeError('detail failed')))
        self.assertEqual(await env['run'](DAY, audiences=['staff']), 0)
        self.assertEqual(db.rows, previous)
        tracker.error.assert_awaited_once()
        env['enqueue_for_subscribers'].assert_not_called()

    async def test_actual_individual_detail_failure_blocks_publication(self):
        db = StoredBriefings()
        previous = copy.deepcopy(db.rows)
        env, tracker = runtime(db)
        env['anthropic'].AsyncAnthropic.return_value = SimpleNamespace(
            messages=SimpleNamespace(create=AsyncMock(side_effect=RuntimeError('model failed'))))
        self.assertEqual(await env['run'](DAY, audiences=['staff']), 0)
        self.assertEqual(db.rows, previous)
        tracker.error.assert_awaited_once()

    async def test_bundle_publication_rejection_preserves_previous_summary_and_details(self):
        db = StoredBriefings('reject')
        previous = copy.deepcopy(db.rows)
        env, tracker = runtime(db, AsyncMock(return_value=[{'article': 'new'}]))
        self.assertEqual(await env['run'](DAY, audiences=['staff']), 0)
        self.assertEqual(db.rows, previous)
        tracker.error.assert_awaited_once()

    async def test_lost_or_empty_response_is_unconfirmed_but_cannot_mix_revisions(self):
        for failure in ['lost_response', 'empty_response']:
            with self.subTest(failure=failure):
                db = StoredBriefings(failure)
                env, tracker = runtime(db, AsyncMock(return_value=[{'article': 'new'}]))
                self.assertEqual(await env['run'](DAY, audiences=['staff']), 0)
                self.assertEqual(len(db.publications), 1)  # no automatic write retry
                self.assertEqual(db.rows['staff']['headline'], 'new')
                self.assertEqual(db.rows['staff']['insight_pages'], [{'article': 'new'}])
                tracker.error.assert_awaited_once()
                env['enqueue_for_subscribers'].assert_not_called()

    async def test_interleaved_reruns_publish_whole_bundles_in_completion_order(self):
        db = StoredBriefings()
        started, release = asyncio.Event(), asyncio.Event()

        async def detail_a(*_):
            started.set()
            await release.wait()
            return [{'article': 'A'}]

        a, _ = runtime(db, detail_a, revision='A')
        b, _ = runtime(db, AsyncMock(return_value=[{'article': 'B'}]), revision='B')
        task = asyncio.create_task(a['run'](DAY, audiences=['staff']))
        try:
            await asyncio.wait_for(started.wait(), timeout=2)
            self.assertEqual(await b['run'](DAY, audiences=['staff']), 1)
            self.assertEqual(db.rows['staff']['headline'], 'B')
            self.assertEqual(db.rows['staff']['insight_pages'], [{'article': 'B'}])
        finally:
            release.set()
            self.assertEqual(await task, 1)
        self.assertEqual([r['headline'] for r in db.publications], ['B', 'A'])
        self.assertEqual(db.rows['staff']['insight_pages'], [{'article': 'A'}])

    async def test_partial_audiences_publish_only_complete_bundles_and_mark_error(self):
        db = StoredBriefings()
        previous_cs = copy.deepcopy(db.rows['cs'])

        async def detail(result, *_):
            if result['audience'] == 'cs':
                raise RuntimeError('CS detail failed')
            return [{'article': 'new'}]

        env, tracker = runtime(db, detail)
        self.assertEqual(await env['run'](DAY, audiences=['staff', 'cs']), 1)
        self.assertEqual(db.rows['cs'], previous_cs)
        self.assertEqual(db.jobs[0]['status'], 'error')
        self.assertEqual(db.jobs[0]['rows_done'], 1)
        tracker.finish.assert_not_awaited()
        env['enqueue_for_subscribers'].assert_not_called()

    async def test_duplicate_audiences_keep_each_summary_paired_with_its_own_details(self):
        db = StoredBriefings()
        generate = AsyncMock(side_effect=[summary('staff', 'first'), summary('staff', 'second')])

        async def detail(result, *_):
            return [{'article': result['headline']}]

        env, _ = runtime(db, detail, generate=generate)
        self.assertEqual(await env['run'](DAY, audiences=['staff', 'staff']), 2)
        self.assertEqual([(r['headline'], r['insight_pages']) for r in db.publications], [
            ('first', [{'article': 'first'}]), ('second', [{'article': 'second'}])])

    async def test_malformed_model_detail_responses_preserve_previous_complete_revision(self):
        valid_chart = {'type': 'bar', 'title': 'Observed rank', 'x_labels': ['D'],
                       'series': [{'name': 'Rank', 'values': [1]}]}
        malformed = [
            '', 'not JSON', '{}', json.dumps({'article': ' \n\t'}),
            json.dumps({'article': None}), json.dumps({'article': 1}),
            json.dumps({'article': 'valid', 'key_metrics': {}}),
            json.dumps({'article': 'valid', 'key_metrics': [None]}),
            json.dumps({'article': 'valid', 'key_metrics': [{'label': 'L', 'value': 1}]}),
            json.dumps({'article': 'valid', 'key_metrics': [{'label': 'L', 'value': 'V', 'change': 1}]}),
            json.dumps({'article': 'valid', 'chart': {}}),
            json.dumps({'article': 'valid', 'chart': {**valid_chart, 'x_labels': 'D'}}),
            json.dumps({'article': 'valid', 'chart': {**valid_chart, 'series': {}}}),
            json.dumps({'article': 'valid', 'chart': {**valid_chart, 'series': [{'name': 'name', 'values': [1]}]}}),
            json.dumps({'article': 'valid', 'chart': {**valid_chart, 'series': valid_chart['series'] * 2}}),
            json.dumps({'article': 'valid', 'chart': {**valid_chart, 'reversed': 'false'}}),
            json.dumps({'article': 'valid', 'chart': {**valid_chart, 'series': [{'name': 'R', 'values': []}]}}),
            json.dumps({'article': 'valid', 'chart': {**valid_chart, 'series': [{'name': 'R', 'values': [True]}]}}),
            json.dumps({'article': 'valid', 'chart': {**valid_chart, 'series': [{'name': 'R', 'values': [float('nan')]}]}}),
        ]
        for response in malformed:
            with self.subTest(response=response):
                db = StoredBriefings()
                previous = copy.deepcopy(db.rows)
                env, tracker = runtime(db)
                env['anthropic'].AsyncAnthropic.return_value = SimpleNamespace(
                    messages=SimpleNamespace(create=AsyncMock(return_value=SimpleNamespace(
                        content=[SimpleNamespace(text=response)]))))
                self.assertEqual(await env['run'](DAY, audiences=['staff']), 0)
                self.assertEqual(db.rows, previous)
                self.assertEqual(db.publications, [])
                tracker.error.assert_awaited_once()
                env['enqueue_for_subscribers'].assert_not_called()

    async def test_valid_model_detail_shapes_publish_through_actual_generators(self):
        chart = {'type': 'line', 'title': 'Observed rank', 'x_labels': ['D'],
                 'series': [{'name': 'Rank', 'values': [1]}], 'reversed': True}
        for optional in [{}, {'key_metrics': None, 'chart': None},
                         {'key_metrics': [{'label': 'Rank', 'value': '1', 'change': '+1'}], 'chart': chart}]:
            with self.subTest(optional=optional):
                db = StoredBriefings()
                env, tracker = runtime(db)
                env['anthropic'].AsyncAnthropic.return_value = SimpleNamespace(
                    messages=SimpleNamespace(create=AsyncMock(return_value=SimpleNamespace(
                        content=[SimpleNamespace(text=json.dumps({'article': 'New complete article', **optional}))]))))
                self.assertEqual(await env['run'](DAY, audiences=['staff']), 1)
                self.assertEqual(db.rows['staff']['insight_pages'][0]['article'], 'New complete article')
                tracker.finish.assert_awaited_once_with(rows_done=1)

    async def test_malformed_summary_insights_are_not_treated_as_valid_empty_details(self):
        for insights in ['', {}, [{'title': {}, 'body': 'body'}], [{'title': 'title', 'body': ' ' }],
                         [{'title': 'title', 'body': 'body', 'link': {}}]]:
            with self.subTest(insights=insights):
                db = StoredBriefings()
                previous = copy.deepcopy(db.rows)
                generate = AsyncMock(side_effect=lambda aud, *_: summary(aud, insights=insights))
                env, tracker = runtime(db, generate=generate)
                self.assertEqual(await env['run'](DAY, audiences=['staff']), 0)
                self.assertEqual(db.rows, previous)
                self.assertEqual(db.publications, [])
                tracker.error.assert_awaited_once()

    async def test_zero_insights_is_a_complete_empty_bundle_without_detail_model_calls(self):
        db = StoredBriefings()
        generate = AsyncMock(side_effect=lambda aud, *_: summary(aud, insights=[]))
        env, _ = runtime(db, generate=generate)
        env['generate_insight_page'] = AsyncMock(side_effect=AssertionError('No inference expected'))
        self.assertEqual(await env['run'](DAY, audiences=['staff']), 1)
        self.assertEqual(db.rows['staff']['insights'], [])
        self.assertEqual(db.rows['staff']['insight_pages'], [])
        env['generate_insight_page'].assert_not_awaited()

    async def test_zero_successful_audiences_preserves_all_previous_revisions_after_summary_retry(self):
        db = StoredBriefings()
        previous = copy.deepcopy(db.rows)
        generate = AsyncMock(side_effect=RuntimeError('summary failed'))
        detail = AsyncMock(side_effect=AssertionError('No details for failed summaries'))
        env, tracker = runtime(db, detail, generate=generate)
        env['asyncio'] = SimpleNamespace(gather=asyncio.gather, sleep=AsyncMock())
        self.assertEqual(await env['run'](DAY), 0)
        self.assertEqual(generate.await_count, 6)  # three audiences, one summary retry
        self.assertEqual(db.rows, previous)
        self.assertEqual(db.publications, [])
        detail.assert_not_awaited()
        tracker.error.assert_awaited_once()
        env['enqueue_for_subscribers'].assert_not_called()


if __name__ == '__main__':
    unittest.main()
