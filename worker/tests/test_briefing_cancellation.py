"""Real orchestration with offline storage/models; cancellation is never a page list."""
import asyncio
import copy
import unittest
from unittest.mock import AsyncMock, Mock

from worker.tests import test_briefing_cli as cli
from worker.tests.test_briefing_publication import DAY, StoredBriefings, runtime, summary


class BriefingCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_normal_audiences_publish_and_notify(self):
        db = StoredBriefings()
        env, tracker = runtime(db, AsyncMock(return_value=[]))
        self.assertEqual(await env['run'](DAY), 3)
        self.assertEqual(len(db.publications), 3)
        self.assertTrue(all(isinstance(r['insight_pages'], list) for r in db.publications))
        tracker.finish.assert_awaited_once_with(rows_done=3)
        env['enqueue_for_subscribers'].assert_called_once()

    async def test_individual_detail_cancellation_skips_publication_and_marks_partial_error(self):
        db = StoredBriefings()
        old = copy.deepcopy(db.rows)

        async def detail(result, *_):
            if result['audience'] == 'staff':
                raise asyncio.CancelledError('synthetic-private-cancel-message')
            return []

        env, tracker = runtime(db, detail)
        upsert = Mock(wraps=env['_upsert_briefing'])
        env['_upsert_briefing'] = upsert
        self.assertEqual(await env['run'](DAY), 2)
        self.assertEqual(db.rows['staff'], old['staff'])
        self.assertEqual({c.args[1]['audience'] for c in upsert.call_args_list}, {'executive', 'cs'})
        self.assertTrue(all(isinstance(c.args[3], list) for c in upsert.call_args_list))
        self.assertEqual(db.jobs[-1]['status'], 'error')
        self.assertEqual(db.jobs[-1]['rows_done'], 2)
        self.assertNotIn('synthetic-private', db.jobs[-1]['error_msg'])
        tracker.finish.assert_not_awaited()
        env['enqueue_for_subscribers'].assert_not_called()

    async def test_cancelled_summary_is_not_retried_or_sent_to_detail_generator(self):
        db = StoredBriefings()

        async def generate(audience, *_):
            if audience == 'staff':
                raise asyncio.CancelledError()
            return summary(audience)

        detail = AsyncMock(return_value=[])
        env, tracker = runtime(db, detail, generate=AsyncMock(side_effect=generate))
        self.assertEqual(await env['run'](DAY), 2)
        self.assertEqual(env['generate_briefing'].await_count, 3)
        self.assertEqual({c.args[0]['audience'] for c in detail.await_args_list}, {'executive', 'cs'})
        self.assertEqual(db.jobs[-1]['status'], 'error')
        env['enqueue_for_subscribers'].assert_not_called()

    async def test_all_individual_details_cancelled_preserves_all_old_rows(self):
        db = StoredBriefings()
        old = copy.deepcopy(db.rows)
        env, tracker = runtime(db, AsyncMock(side_effect=asyncio.CancelledError()))
        self.assertEqual(await env['run'](DAY), 0)
        self.assertEqual(db.rows, old)
        self.assertEqual(db.publications, [])
        tracker.error.assert_awaited_once()
        tracker.finish.assert_not_awaited()
        env['enqueue_for_subscribers'].assert_not_called()

    async def test_cancelling_entire_run_propagates_during_summary_or_details(self):
        for phase in ['summary', 'details']:
            with self.subTest(phase=phase):
                entered = asyncio.Event()
                children_cancelled = []

                async def pending(*_):
                    entered.set()
                    try:
                        await asyncio.Event().wait()
                    except asyncio.CancelledError:
                        children_cancelled.append(True)
                        raise

                db = StoredBriefings()
                old = copy.deepcopy(db.rows)
                env, tracker = runtime(db, pending if phase == 'details' else AsyncMock(return_value=[]),
                                       generate=pending if phase == 'summary' else None)
                task = asyncio.create_task(env['run'](DAY))
                await entered.wait()
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                self.assertEqual(len(children_cancelled), 3)
                self.assertEqual(db.rows, old)
                self.assertEqual(db.publications, [])
                tracker.error.assert_not_awaited()
                tracker.finish.assert_not_awaited()
                env['enqueue_for_subscribers'].assert_not_called()


class CancellationCliTests(unittest.TestCase):
    def test_individual_detail_cancellation_exits_failure_with_two_confirmed_outputs(self):
        async def detail(result, *_):
            if result['audience'] == 'staff':
                raise asyncio.CancelledError()
            return []

        env, _ = cli.cli_runtime(StoredBriefings(), detail)
        self.assertEqual(cli.BriefingCliTests.invoke(self, env), 1)
        cli.BriefingCliTests.assert_outcome(self, env, False, 2, 3)


if __name__ == '__main__':
    unittest.main()
