"""Combined diagnostics/cancellation boundaries; real bodies, synthetic data only."""
import asyncio
import copy
import io
import itertools
import unittest
from unittest.mock import AsyncMock

from loguru import logger

from worker.tests import test_briefing_cli as cli
from worker.tests.test_briefing_publication import DAY, StoredBriefings, runtime, summary

AUDIENCES = ['executive', 'staff', 'cs']
PRIVATE = 'synthetic-sensitive-cancellation-input'


class CombinedBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_216_outcome_combinations_preserve_rows_mapping_failure_and_notification(self):
        states = ['ok', 'summary_error', 'summary_cancel', 'detail_error', 'detail_cancel', 'publish_error']
        for combination in itertools.product(states, repeat=3):
            with self.subTest(outcomes=combination):
                state = dict(zip(AUDIENCES, combination))
                db = StoredBriefings()
                old = copy.deepcopy(db.rows)

                async def generate(aud, *_):
                    if state[aud] == 'summary_error':
                        raise ValueError(PRIVATE)
                    if state[aud] == 'summary_cancel':
                        raise asyncio.CancelledError(PRIVATE)
                    return summary(aud)

                async def details(result, *_):
                    mode = state[result['audience']]
                    if mode == 'detail_error':
                        raise ValueError(PRIVATE)
                    if mode == 'detail_cancel':
                        raise asyncio.CancelledError(PRIVATE)
                    return []

                env, tracker = cli.cli_runtime(db, details, generate=generate)
                original = env['_upsert_briefing']

                def publish(db, result, date, pages):
                    self.assertIsInstance(pages, list)
                    if state[result['audience']] == 'publish_error':
                        raise RuntimeError(PRIVATE)
                    return original(db, result, date, pages)

                env['_upsert_briefing'] = publish
                expected = {aud for aud in AUDIENCES if state[aud] == 'ok'}
                self.assertEqual(await env['run'](DAY), len(expected))
                self.assertEqual({r['audience'] for r in db.publications}, expected)
                for aud in set(AUDIENCES) - expected:
                    self.assertEqual(db.rows[aud], old[aud])
                if len(expected) == 3:
                    tracker.finish.assert_awaited_once_with(rows_done=3)
                    env['enqueue_for_subscribers'].assert_called_once()
                else:
                    tracker.finish.assert_not_awaited()
                    env['enqueue_for_subscribers'].assert_not_called()
                    if expected:
                        self.assertEqual(db.jobs[-1]['status'], 'error')
                        self.assertEqual(db.jobs[-1]['rows_done'], len(expected))
                        self.assertNotIn(PRIVATE, db.jobs[-1]['error_msg'])
                    else:
                        tracker.error.assert_awaited_once()
                        self.assertNotIn(PRIVATE, tracker.error.await_args.args[0])
                for level in ['info', 'warning', 'error']:
                    self.assertNotIn(PRIVATE, repr(getattr(env['logger'], level).call_args_list))

    async def test_duplicate_audience_results_keep_detail_iterator_alignment(self):
        db = StoredBriefings()
        details = AsyncMock(side_effect=[asyncio.CancelledError(PRIVATE), []])
        env, _ = runtime(db, details)
        self.assertEqual(await env['run'](DAY, audiences=['staff', 'staff']), 1)
        self.assertEqual([r['audience'] for r in db.publications], ['staff'])
        self.assertEqual(db.jobs[-1]['rows_done'], 1)
        self.assertNotIn(PRIVATE, db.jobs[-1]['error_msg'])

    async def test_single_cancelled_detail_is_zero_success_and_no_notification(self):
        db = StoredBriefings()
        env, tracker = runtime(db, AsyncMock(side_effect=asyncio.CancelledError(PRIVATE)))
        self.assertEqual(await env['run'](DAY, audiences=['cs']), 0)
        self.assertEqual(db.publications, [])
        tracker.error.assert_awaited_once_with('briefing_failure stage=details audience=cs kind=CancelledError')
        env['enqueue_for_subscribers'].assert_not_called()

    async def test_all_cancelled_summaries_never_call_details_or_retry(self):
        db = StoredBriefings()
        detail = AsyncMock(return_value=[])
        generate = AsyncMock(side_effect=asyncio.CancelledError(PRIVATE))
        env, tracker = runtime(db, detail, generate=generate)
        self.assertEqual(await env['run'](DAY), 0)
        self.assertEqual(generate.await_count, 3)
        detail.assert_not_awaited()
        tracker.error.assert_awaited_once()
        env['enqueue_for_subscribers'].assert_not_called()

    async def test_returned_cancelled_detail_value_is_not_a_publishable_payload(self):
        db = StoredBriefings()
        env, _ = runtime(db, AsyncMock(return_value=asyncio.CancelledError(PRIVATE)))
        self.assertEqual(await env['run'](DAY), 0)
        self.assertEqual(db.publications, [])

    async def test_returned_cancelled_summary_value_is_not_a_summary_dictionary(self):
        db = StoredBriefings()
        detail = AsyncMock(return_value=[])
        env, _ = runtime(db, detail, generate=AsyncMock(return_value=asyncio.CancelledError(PRIVATE)))
        self.assertEqual(await env['run'](DAY), 0)
        detail.assert_not_awaited()

    async def test_cancelled_audience_and_lost_publication_response_are_not_replayed(self):
        db = StoredBriefings(failure='lost_response')

        async def details(result, *_):
            if result['audience'] != 'staff':
                raise asyncio.CancelledError(PRIVATE)
            return []

        env, tracker = runtime(db, details)
        self.assertEqual(await env['run'](DAY), 0)
        self.assertEqual(len(db.publications), 1)  # Committed, response unconfirmed.
        self.assertEqual(db.publications[0]['audience'], 'staff')
        tracker.error.assert_awaited_once()
        env['enqueue_for_subscribers'].assert_not_called()

    async def test_synchronous_publication_is_not_immediately_preempted_by_cancel_request(self):
        db = StoredBriefings()
        env, _ = runtime(db, AsyncMock(return_value=[]))
        original = env['_upsert_briefing']
        requested = False

        def publish(*args):
            nonlocal requested
            if not requested:
                requested = True
                asyncio.current_task().cancel()
            return original(*args)

        env['_upsert_briefing'] = publish
        task = asyncio.create_task(env['run'](DAY))
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertGreaterEqual(len(db.publications), 1)
        self.assertTrue(all(isinstance(r['insight_pages'], list) for r in db.publications))

    async def test_cancellation_while_finishing_tracking_preserves_committed_rows(self):
        db = StoredBriefings()
        env, tracker = runtime(db, AsyncMock(return_value=[]))
        entered = asyncio.Event()

        async def finish(**_):
            entered.set()
            await asyncio.Event().wait()

        tracker.finish.side_effect = finish
        task = asyncio.create_task(env['run'](DAY))
        await entered.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(len(db.publications), 3)
        env['enqueue_for_subscribers'].assert_not_called()
        tracker.error.assert_not_awaited()

    async def test_cancelling_before_task_starts_does_not_enter_run(self):
        db = StoredBriefings()
        env, tracker = runtime(db, AsyncMock(return_value=[]))
        task = asyncio.create_task(env['run'](DAY))
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        tracker.start.assert_not_awaited()
        self.assertEqual(db.publications, [])

    async def test_other_summary_error_retries_once_but_cancelled_summary_does_not(self):
        calls = []

        async def generate(aud, *_):
            calls.append(aud)
            if aud == 'staff':
                raise asyncio.CancelledError(PRIVATE)
            if aud == 'cs':
                raise ValueError(PRIVATE)
            return summary(aud)

        env, _ = cli.cli_runtime(StoredBriefings(), AsyncMock(return_value=[]), generate=generate)
        self.assertEqual(await env['run'](DAY), 1)
        self.assertEqual(calls.count('staff'), 1)
        self.assertEqual(calls.count('cs'), 2)
        env['asyncio'].sleep.assert_awaited_once_with(300)


class CombinedDiagnosticTests(unittest.TestCase):
    def test_cancelled_diagnostic_has_safe_kind_and_requested_audience(self):
        env, _ = runtime(StoredBriefings())
        self.assertEqual(env['_failure_diagnostic']('details', 'staff', asyncio.CancelledError(PRIVATE)),
                         'briefing_failure stage=details audience=staff kind=CancelledError')

    def test_actual_loguru_cancelled_message_does_not_expose_private_args(self):
        env, _ = runtime(StoredBriefings())
        stream = io.StringIO()
        sink = logger.add(stream, level='ERROR')
        try:
            logger.error(env['_failure_diagnostic']('summary', 'cs', asyncio.CancelledError(PRIVATE)))
        finally:
            logger.remove(sink)
        self.assertIn('audience=cs kind=CancelledError', stream.getvalue())
        self.assertNotIn(PRIVATE, stream.getvalue())
