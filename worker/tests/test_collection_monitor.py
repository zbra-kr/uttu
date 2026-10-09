"""Offline monitor outcomes: fake jobs, clock, observations and notifications."""
import importlib.util
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

SOURCE = Path(__file__).parents[2] / 'scripts' / 'collection_monitor.py'
spec = importlib.util.spec_from_file_location('offline_collection_monitor', SOURCE)
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class MonitorFixture:
    def __init__(self, results=None, observe=None, ticks=None, sleep_error=None):
        self.calls, self.messages, self.sleeps = [], [], []
        self.results = results or {}
        self.observe = observe or (lambda name, *_: 'completed' if name in monitor.SCRAPERS else None)
        self.ticks = iter(ticks or [0, 0])
        self.sleep_error = sleep_error

    def runner(self, command, **options):
        name = {'worker.detectors.runner': 'detect', 'worker.agent.news_collector': 'news',
                'worker.agent.briefing_writer': 'briefing'}[command[-1]]
        self.calls.append((name, options))
        result = self.results.get(name, 0)
        if isinstance(result, BaseException):
            raise result
        return result if hasattr(result, 'returncode') else SimpleNamespace(
            returncode=result, stdout='offline fixture', stderr='')

    def notify(self, title, body=None):
        self.messages.append((title, body))

    def sleep(self, delay):
        self.sleeps.append(delay)
        if self.sleep_error:
            raise self.sleep_error

    def run(self):
        return monitor.run_monitor(Path('offline-root'), '20261005', self.notify,
                                   clock=lambda: next(self.ticks), sleeper=self.sleep,
                                   runner=self.runner, observe=self.observe)


class CollectionMonitorTests(unittest.TestCase):
    def test_success_exit_and_original_job_order_and_timeout_policy(self):
        f = MonitorFixture()
        self.assertEqual(f.run(), 0)
        self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])
        self.assertNotIn('timeout', f.calls[0][1])
        self.assertEqual(f.calls[1][1]['timeout'], 1800)
        self.assertEqual(f.calls[2][1]['timeout'], 7200)
        self.assertEqual(f.sleeps, [])
        self.assertIn('완료 기록', f.messages[-1][0])
        self.assertIn('실패: 없음', f.messages[-1][1])

    def test_detection_failure_keeps_permissive_downstream_policy_but_exit_fails(self):
        f = MonitorFixture({'detect': 1})
        self.assertEqual(f.run(), 1)
        self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])
        self.assertIn('실패: detect', f.messages[-1][1])
        self.assertNotIn('전체 수집·브리핑 완료 기록', f.messages[-1][0])

    def test_full_collection_timeout_remains_force_pass_without_success_claim(self):
        f = MonitorFixture(observe=lambda name, *_: 'completed' if name in monitor.SCRAPERS
                           and name != 'full_collection' else None, ticks=[0, 21600])
        self.assertEqual(f.run(), 1)
        self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])
        self.assertIn('시간 초과: full_collection', f.messages[-1][1])

    def test_optional_news_failure_or_timeout_still_runs_briefing(self):
        for result, group in [(1, '실패'), (subprocess.TimeoutExpired('offline', 1800), '시간 초과')]:
            with self.subTest(group=group):
                f = MonitorFixture({'news': result})
                self.assertEqual(f.run(), 1)
                self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])
                self.assertIn(f'{group}: news', f.messages[-1][1])

    def test_briefing_failure_or_timeout_cannot_be_reported_as_all_success(self):
        for result, group in [(1, '실패'), (subprocess.TimeoutExpired('offline', 7200), '시간 초과')]:
            with self.subTest(group=group):
                f = MonitorFixture({'briefing': result})
                self.assertEqual(f.run(), 1)
                self.assertIn(f'{group}: briefing', f.messages[-1][1])

    def test_launch_block_or_runner_exception_settles_without_retrying(self):
        for result, group in [(FileNotFoundError('offline'), '시작 불가/미실행'),
                              (RuntimeError('offline'), '실패')]:
            with self.subTest(group=group):
                f = MonitorFixture({'detect': result})
                self.assertEqual(f.run(), 1)
                self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])
                self.assertIn(f'{group}: detect', f.messages[-1][1])

    def test_hourly_summary_keeps_failure_separate_and_jobs_do_not_repeat(self):
        reads = 0

        def observe(name, *_):
            nonlocal reads
            if name == 'reviews':
                reads += 1
                return None if reads == 1 else 'completed'
            return 'completed' if name in monitor.SCRAPERS else None

        f = MonitorFixture({'news': 1}, observe=observe, ticks=[0, 3600, 3601])
        self.assertEqual(f.run(), 1)
        self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])
        hourly = next(body for title, body in f.messages if '1시간 요약' in title)
        self.assertIn('실패: news', hourly)
        self.assertIn('진행/미확인: reviews', hourly)
        self.assertEqual(f.sleeps, [30])

    def test_existing_downstream_markers_avoid_duplicate_jobs(self):
        f = MonitorFixture(observe=lambda *_: 'completed')
        self.assertEqual(f.run(), 0)
        self.assertEqual(f.calls, [])

    def test_existing_detection_zero_count_heuristic_keeps_explicit_empty_success(self):
        for output, expected in [('anomalies_saved count=0', 1),
                                 ('anomalies_saved count=0 total=0', 0)]:
            with self.subTest(output=output):
                result = SimpleNamespace(returncode=0, stdout=output, stderr='')
                f = MonitorFixture({'detect': result})
                self.assertEqual(f.run(), expected)
                self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])

    def test_interrupt_leaves_external_collectors_unconfirmed_and_returns_130(self):
        f = MonitorFixture(observe=lambda *_: None, sleep_error=KeyboardInterrupt())
        self.assertEqual(f.run(), 130)
        self.assertEqual(f.calls, [])
        body = f.messages[-1][1]
        self.assertIn('수집기 상태 미확인: ranking', body)
        self.assertIn('시작 불가/미실행: detect, news, briefing', body)
        self.assertNotIn('시작 불가/미실행: ranking', body)

    def test_interrupt_during_downstream_attempt_does_not_claim_that_job_stopped(self):
        f = MonitorFixture({'detect': KeyboardInterrupt()})
        self.assertEqual(f.run(), 130)
        self.assertEqual([name for name, _ in f.calls], ['detect'])
        body = f.messages[-1][1]
        unknown = next(line for line in body.splitlines() if '상태 미확인:' in line)
        self.assertIn('detect', unknown)
        self.assertIn('시작 불가/미실행: news, briefing', body)
        self.assertNotIn('시작 불가/미실행: detect', body)

    def test_observation_exception_aborts_without_starting_jobs_or_claiming_completion(self):
        def observe(*_):
            raise OSError('offline log unavailable')

        f = MonitorFixture(observe=observe)
        self.assertEqual(f.run(), 1)
        self.assertEqual(f.calls, [])
        self.assertIn('수집기 상태 미확인: ranking', f.messages[-1][1])
        self.assertIn('시작 불가/미실행: detect, news, briefing', f.messages[-1][1])

    def test_dart_failed_skip_is_settled_as_failure_and_later_done_as_completed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'logs').mkdir()
            path = root / 'logs' / 'dart_20261005.log'
            path.write_text('=== skip: FAILED exit=1 ===\n', encoding='utf8')
            self.assertEqual(monitor.log_outcome('dart', root, '20261005'), 'failed')
            path.write_text('=== skip: FAILED exit=1 ===\n=== done: ===\n', encoding='utf8')
            self.assertEqual(monitor.log_outcome('dart', root, '20261005'), 'completed')
            self.assertIsNone(monitor.log_outcome('ranking', root, '20261005'))

    def test_failure_suffix_or_quoted_completion_text_is_not_a_completion_event(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'logs').mkdir()
            path = root / 'logs' / 'reviews_20261005.log'
            for line in ['job_tracker_finish_failed error=offline',
                         '2026-10-05 | WARNING | job_tracker:finish:98 - job_tracker_finish_failed',
                         'warning mentions job_tracker_finish',
                         'warning - job_tracker_finish', 'warning | job_tracker_finish',
                         'warning: "job_tracker_finish"', 'review_smart_done_failed']:
                with self.subTest(line=line):
                    path.write_text(line + '\n', encoding='utf8')
                    self.assertIsNone(monitor.log_outcome('reviews', root, '20261005'))

    def test_exact_bare_and_formatted_events_and_shell_markers_still_complete(self):
        for line in ['job_tracker_finish', 'job_tracker_finish rows_done=10',
                     '2026-10-05 | DEBUG | job_tracker:finish:96 - job_tracker_finish',
                     '00:00:00 | DEBUG | job_tracker_finish rows_done=10']:
            with self.subTest(line=line):
                self.assertIsNotNone(monitor.completion_message(line, ['job_tracker_finish']))
        self.assertIsNotNone(monitor.completion_message('=== done: timestamp ===', ['=== done:']))
        self.assertIsNotNone(monitor.completion_message('=== ALL DONE: timestamp ===', ['all done']))
        self.assertIsNone(monitor.completion_message('warning: ALL DONE', ['all done']))
        self.assertIsNone(monitor.completion_message('=== ALL DONE_FAILED ===', ['all done']))

    def test_failed_completion_marker_does_not_settle_external_collector(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'logs').mkdir()
            (root / 'logs' / 'reviews_20261005.log').write_text(
                'job_tracker_finish_failed\n', encoding='utf8')

            def observe(name, *_):
                if name == 'reviews':
                    return monitor.log_outcome(name, root, '20261005')
                return 'completed' if name in monitor.SCRAPERS else None

            f = MonitorFixture(observe=observe, sleep_error=KeyboardInterrupt())
            self.assertEqual(f.run(), 130)
            unknown = next(line for line in f.messages[-1][1].splitlines() if '상태 미확인:' in line)
            self.assertIn('reviews', unknown)


if __name__ == '__main__':
    unittest.main()


class LocalReviewSkipPreservationTests(unittest.TestCase):
    def test_recovery_lock_skip_settles_without_claiming_completion(self):
        f = MonitorFixture(observe=lambda name, *_: 'skipped' if name == 'reviews' else 'completed' if name in monitor.SCRAPERS else None)
        self.assertEqual(f.run(), 1)
        self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])
        self.assertIn('별도 수집/복구 작업으로 생략: reviews', f.messages[-1][1])
        self.assertTrue(any('정기 리뷰 수집 생략' in title for title, _ in f.messages))
        self.assertNotIn('전체 수집·브리핑 완료 기록', f.messages[-1][0])

    def test_actual_wrapper_skip_log_is_recognized(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'logs').mkdir()
            (root / 'logs/reviews_20261007.log').write_text('Collection skipped: another review task is active\n')
            self.assertEqual(monitor.log_outcome('reviews', root, '20261007'), 'skipped')


class LatestAttemptTests(unittest.TestCase):
    def outcome(self, name, content):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'logs').mkdir()
            (root / 'logs' / f'{name}_20261005.log').write_text(content)
            return monitor.log_outcome(name, root, '20261005')

    def test_new_ranking_start_invalidates_previous_completion(self):
        self.assertIsNone(self.outcome('ranking', '=== done: old ===\n=== start: new ===\n'))

    def test_review_retry_invalidates_previous_recovery_skip(self):
        self.assertIsNone(self.outcome('reviews', 'Collection skipped: another review task is active\njob_tracker_start\n'))
        self.assertEqual(self.outcome('reviews', 'Collection skipped: another review task is active\njob_tracker_start\nreview_smart_done\n'), 'completed')

    def test_latest_review_skip_overrides_previous_completion(self):
        self.assertEqual(self.outcome('reviews', 'review_smart_done\nCollection skipped: another review task is active\n'), 'skipped')

    def test_full_collection_new_attempt_is_pending(self):
        self.assertIsNone(self.outcome('full_collection', '=== ALL DONE: old ===\n=== START brand_detail: new ===\n'))


class MonitorEventTests(unittest.TestCase):
    def run_events(self, sink=None):
        f = MonitorFixture()
        records = []
        code = monitor.run_monitor(Path('offline-root'), '20261005', f.notify,
                                   clock=lambda: next(f.ticks), sleeper=f.sleep,
                                   runner=f.runner, observe=f.observe,
                                   event_sink=sink or records.append,
                                   utcnow=lambda: datetime(2026, 10, 5, 17, tzinfo=timezone.utc))
        return code, f, records

    def test_owned_stages_have_correlated_start_exit_settlement_and_no_output(self):
        code, f, records = self.run_events()
        self.assertEqual(code, 0)
        self.assertEqual(len({r['monitor_run_id'] for r in records}), 1)
        self.assertTrue(all(r['recorded_at_utc'] == '2026-10-05T17:00:00+00:00' for r in records))
        self.assertTrue(all(r['content_acceptance'] == 'unverified' for r in records))
        for stage in ['detect', 'news', 'briefing']:
            rows = [r for r in records if r.get('stage') == stage]
            self.assertEqual([r['event'] for r in rows], ['stage_started', 'process_exited', 'stage_settled'])
            self.assertEqual(rows[1]['exit_code'], 0)
            self.assertEqual(rows[2]['evidence'], 'owned_process')
            self.assertTrue(all(r['attempt'] == 1 for r in rows))
        self.assertNotIn('offline fixture', str(records))
        self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])

    def test_repeated_monitor_invocations_get_distinct_run_ids(self):
        _, _, first = self.run_events()
        _, _, second = self.run_events()
        self.assertNotEqual(first[0]['monitor_run_id'], second[0]['monitor_run_id'])

    def test_external_marker_is_observation_without_collector_identity(self):
        _, _, records = self.run_events()
        row = next(r for r in records if r.get('stage') == 'ranking')
        self.assertEqual(row['evidence'], 'daily_log_marker')
        self.assertEqual(row['collector_run_identity'], 'unavailable')
        self.assertIsNone(row['attempt'])

    def test_broken_metadata_sink_does_not_change_launches_or_settlement(self):
        def broken(_):
            raise OSError('offline sink')
        code, f, _ = self.run_events(broken)
        self.assertEqual(code, 0)
        self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])

    def test_quoted_recovery_skip_is_not_a_skip_event(self):
        self.assertIsNone(LatestAttemptTests().outcome('reviews', 'warning mentions Collection skipped: old\n'))


class SettlementEvidenceTests(unittest.TestCase):
    def records(self, fixture):
        records = []
        code = monitor.run_monitor(Path('offline-root'), '20261005', fixture.notify,
                                   clock=lambda: next(fixture.ticks), sleeper=fixture.sleep,
                                   runner=fixture.runner, observe=fixture.observe,
                                   event_sink=records.append)
        return code, records

    def test_force_pass_is_policy_timeout_without_log_marker(self):
        f = MonitorFixture(observe=lambda name, *_: 'completed' if name in monitor.SCRAPERS
                           and name != 'full_collection' else None, ticks=[0, 21600])
        code, records = self.records(f)
        self.assertEqual(code, 1)
        row = next(r for r in records if r.get('stage') == 'full_collection')
        self.assertEqual(row['outcome'], 'timed_out')
        self.assertEqual(row['evidence'], 'policy_timeout')
        self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])

    def test_missing_executable_has_launch_error_without_process_exit(self):
        f = MonitorFixture({'detect': FileNotFoundError('offline')})
        code, records = self.records(f)
        self.assertEqual(code, 1)
        rows = [r for r in records if r.get('stage') == 'detect']
        self.assertEqual([r['event'] for r in rows], ['stage_started', 'launch_error', 'stage_settled'])
        self.assertEqual(rows[-1]['outcome'], 'blocked')
        self.assertEqual(rows[-1]['evidence'], 'launch_error')
        self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])


class PostExitEvidenceTests(unittest.TestCase):
    def test_success_notification_oserror_preserves_confirmed_process_evidence(self):
        f = MonitorFixture()
        records = []
        failed_once = False

        def notify(title, body=None):
            nonlocal failed_once
            if title == '✅ 이상탐지 완료' and not failed_once:
                failed_once = True
                raise OSError('offline notification')
            f.notify(title, body)

        code = monitor.run_monitor(Path('offline-root'), '20261005', notify,
                                   clock=lambda: next(f.ticks), sleeper=f.sleep,
                                   runner=f.runner, observe=f.observe,
                                   event_sink=records.append)
        self.assertEqual(code, 1)
        rows = [r for r in records if r.get('stage') == 'detect']
        self.assertEqual([r['event'] for r in rows],
                         ['stage_started', 'process_exited', 'post_exit_error', 'stage_settled'])
        self.assertEqual(rows[1]['exit_code'], 0)
        self.assertEqual(rows[-1]['evidence'], 'owned_process')
        self.assertEqual(rows[-1]['outcome'], 'blocked')
        self.assertEqual([name for name, _ in f.calls], ['detect', 'news', 'briefing'])
