"""Actual CLI/orchestration bodies with offline publication and model boundaries."""
import argparse
import ast
import asyncio
import copy
import io
import sys
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from worker.tests.test_briefing_publication import DAY, SOURCE, StoredBriefings, runtime, summary


def cli_runtime(db, detail=None, generate=None):
    env, tracker = runtime(db, detail or AsyncMock(return_value=[]), generate=generate)
    tree = ast.parse(SOURCE.read_text(encoding='utf8'))
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
    env.update({'argparse': argparse, 'sys': sys, '_today_kst': lambda: DAY,
                'asyncio': SimpleNamespace(run=asyncio.run, gather=asyncio.gather,
                                           sleep=AsyncMock())})
    exec(compile(ast.fix_missing_locations(ast.Module(body=[main], type_ignores=[])),
                 str(SOURCE), 'exec'), env)
    return env, tracker


class BriefingCliTests(unittest.TestCase):
    def invoke(self, env, *args):
        with patch.object(sys, 'argv', ['briefing_writer', *args]):
            with self.assertRaises(SystemExit) as exit_result:
                env['main']()
        return exit_result.exception.code

    def assert_outcome(self, env, complete, count, requested):
        logger = env['logger']
        records = logger.info.call_args_list + logger.warning.call_args_list
        marker = 'briefing_run_done' if complete else 'briefing_run_incomplete'
        matches = [call for call in records if call.args[0] == marker]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].kwargs['success'], count)
        self.assertEqual(matches[0].kwargs['requested'], requested)
        if not complete:
            self.assertFalse(any(call.args[0] == 'briefing_run_done' for call in records))
            logger.error.assert_any_call('briefing_cli_incomplete', success=count,
                                         requested=requested, dry_run=False)

    def test_all_three_confirmed_publications_exit_success(self):
        db = StoredBriefings()
        env, tracker = cli_runtime(db)
        self.assertEqual(self.invoke(env), 0)
        self.assertEqual(len(db.publications), 3)
        tracker.finish.assert_awaited_once_with(rows_done=3)
        self.assert_outcome(env, True, 3, 3)

    def test_partial_detail_failure_exits_failure_and_preserves_published_audiences(self):
        db = StoredBriefings()
        previous_cs = copy.deepcopy(db.rows['cs'])

        async def detail(result, *_):
            if result['audience'] == 'cs':
                raise RuntimeError('offline detail failure')
            return []

        env, tracker = cli_runtime(db, detail)
        self.assertEqual(self.invoke(env), 1)
        self.assertEqual({row['audience'] for row in db.publications}, {'executive', 'staff'})
        self.assertEqual(db.rows['cs'], previous_cs)
        tracker.finish.assert_not_awaited()
        self.assert_outcome(env, False, 2, 3)

    def test_zero_confirmed_publications_exit_failure(self):
        db = StoredBriefings('reject')
        previous = copy.deepcopy(db.rows)
        env, tracker = cli_runtime(db)
        self.assertEqual(self.invoke(env), 1)
        self.assertEqual(db.rows, previous)
        tracker.error.assert_awaited_once()
        self.assert_outcome(env, False, 0, 3)

    def test_generation_failure_retries_offline_then_exits_failure(self):
        generate = AsyncMock(side_effect=RuntimeError('offline generation failure'))
        db = StoredBriefings()
        env, _ = cli_runtime(db, generate=generate)
        self.assertEqual(self.invoke(env), 1)
        self.assertEqual(generate.await_count, 6)
        self.assertEqual(db.publications, [])
        env['asyncio'].sleep.assert_awaited_once_with(300)
        self.assert_outcome(env, False, 0, 3)

    def test_single_requested_audience_requires_one_confirmed_publication(self):
        for failure, expected in [(None, 0), ('reject', 1), ('empty_response', 1),
                                  ('lost_response', 1)]:
            with self.subTest(failure=failure):
                db = StoredBriefings(failure)
                env, _ = cli_runtime(db)
                self.assertEqual(self.invoke(env, '--audience', 'cs'), expected)
                self.assert_outcome(env, expected == 0, 1 if expected == 0 else 0, 1)
                self.assertEqual(env['generate_briefing'].await_count, 1)
                # Lost/empty responses may have committed; never retry publication.
                self.assertLessEqual(len(db.publications), 1)

    def test_explicit_dry_run_succeeds_without_generation_or_publication(self):
        db = StoredBriefings()
        env, tracker = cli_runtime(db)
        for name in ['collect_executive_inputs', 'collect_staff_inputs', 'collect_cs_inputs']:
            env[name].return_value = {'date': DAY.isoformat(), 'weekday': 'Sunday'}
        with redirect_stdout(io.StringIO()):
            self.assertEqual(self.invoke(env, '--dry-run'), 0)
        self.assertEqual(db.publications, [])
        env['generate_briefing'].assert_not_awaited()
        tracker.start.assert_not_awaited()
        env['logger'].info.assert_any_call('briefing_cli_complete', success=0,
                                         requested=3, dry_run=True)

    def test_unexpected_run_exception_exits_failure_even_in_dry_run(self):
        for args in [(), ('--dry-run',)]:
            with self.subTest(args=args):
                env, _ = cli_runtime(StoredBriefings())
                env['_supabase'] = lambda: (_ for _ in ()).throw(RuntimeError('offline setup failure'))
                self.assertEqual(self.invoke(env, *args), 1)
                env['logger'].error.assert_called_once_with(
                    'briefing_cli_failed: {kind}; {reason}', kind='RuntimeError',
                    reason='worker execution or publication tracking failed')

    def test_rendered_failure_diagnostics_do_not_include_raw_exception_secrets(self):
        secret = 'fixture-secret https://example.invalid/path?token=fixture-secret'
        for exception, reason in [
                (KeyError(secret), 'required configuration or briefing field is missing'),
                (ValueError(secret), 'invalid configuration or briefing data'),
                (TypeError(secret), 'invalid configuration or briefing data'),
                (OSError(secret), 'dependency access failed'),
                (RuntimeError(secret), 'worker execution or publication tracking failed')]:
            with self.subTest(kind=type(exception).__name__):
                env, _ = cli_runtime(StoredBriefings())

                def fail():
                    raise exception

                env['_supabase'] = fail
                self.assertEqual(self.invoke(env), 1)
                call = env['logger'].error.call_args
                rendered = call.args[0].format(**call.kwargs)
                self.assertEqual(rendered, f'briefing_cli_failed: {type(exception).__name__}; {reason}')
                self.assertNotIn('fixture-secret', rendered)
                self.assertNotIn('example.invalid', rendered)
                self.assertEqual(set(call.kwargs), {'kind', 'reason'})

    def test_empty_audience_list_retains_all_three_defaults(self):
        db = StoredBriefings()
        env, _ = cli_runtime(db)
        self.assertEqual(asyncio.run(env['run'](DAY, audiences=[])), 3)
        self.assertEqual({row['audience'] for row in db.publications}, {'executive', 'staff', 'cs'})
        self.assert_outcome(env, True, 3, 3)

    def test_duplicate_audiences_retain_separate_confirmed_attempts(self):
        generate = AsyncMock(side_effect=[summary('staff', 'first'), summary('staff', 'second')])
        db = StoredBriefings()
        env, _ = cli_runtime(db, generate=generate)
        audiences = ['staff', 'staff']
        self.assertEqual(asyncio.run(env['run'](DAY, audiences=audiences)), 2)
        self.assertEqual(audiences, ['staff', 'staff'])
        self.assertEqual([row['headline'] for row in db.publications], ['first', 'second'])
        self.assert_outcome(env, True, 2, 2)

    def test_repeated_cli_audience_flag_selects_last_value_without_duplicate_jobs(self):
        db = StoredBriefings()
        env, _ = cli_runtime(db)
        self.assertEqual(self.invoke(env, '--audience', 'staff', '--audience', 'cs'), 0)
        self.assertEqual([row['audience'] for row in db.publications], ['cs'])
        self.assert_outcome(env, True, 1, 1)


if __name__ == '__main__':
    unittest.main()
