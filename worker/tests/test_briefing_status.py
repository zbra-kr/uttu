"""Schema-compatible terminal status through real CLI/run, with offline writes."""
import copy
import unittest
from types import SimpleNamespace

from worker.tests import test_briefing_cli as cli
from worker.tests.test_briefing_publication import StoredBriefings


class SchemaJobs(StoredBriefings):
    def __init__(self, reject_status=False):
        super().__init__()
        self.job = None
        self.reject_status = reject_status

    def table(self, name):
        if name != 'collection_jobs':
            return super().table(name)
        owner = self

        class Query:
            def update(self, payload):
                self.payload = copy.deepcopy(payload)
                return self

            def eq(self, column, value):
                assert column == 'id' and value == 1
                return self

            def execute(self):
                if owner.reject_status:
                    raise RuntimeError('offline status write rejected')
                if self.payload.get('status') not in {'running', 'done', 'error'}:
                    raise ValueError('collection_jobs_status_check')
                owner.job.update(self.payload)
                owner.jobs.append(copy.deepcopy(owner.job))
                return SimpleNamespace(data=[copy.deepcopy(owner.job)])

        return Query()


def schema_runtime(db, failed_audiences):
    async def detail(result, *_):
        if result['audience'] in failed_audiences:
            raise RuntimeError('offline detail failure')
        return []

    env, tracker = cli.cli_runtime(db, detail)

    async def start():
        db.job = {'status': 'running', 'rows_done': 0,
                  'target': env['JobTracker'].call_args.kwargs['target'],
                  'error_msg': None, 'finished_at': None}

    async def finish(rows_done):
        db.table('collection_jobs').update({'status': 'done', 'rows_done': rows_done,
                                           'finished_at': 'offline-finished'}).eq('id', 1).execute()

    async def error(message):
        db.table('collection_jobs').update({'status': 'error', 'error_msg': message,
                                           'finished_at': 'offline-finished'}).eq('id', 1).execute()

    tracker.start.side_effect = start
    tracker.finish.side_effect = finish
    tracker.error.side_effect = error
    return env


class BriefingStatusTests(unittest.TestCase):
    def test_zero_partial_and_complete_runs_obey_existing_three_state_schema(self):
        for failed, count, status, exit_code in [({'executive', 'staff', 'cs'}, 0, 'error', 1),
                                                ({'cs'}, 2, 'error', 1),
                                                (set(), 3, 'done', 0)]:
            with self.subTest(count=count):
                db = SchemaJobs()
                previous = copy.deepcopy(db.rows)
                env = schema_runtime(db, failed)
                self.assertEqual(cli.BriefingCliTests.invoke(self, env), exit_code)
                self.assertEqual(db.job['status'], status)
                self.assertEqual(db.job['rows_done'], count)
                self.assertEqual(db.job['target'], 3)
                self.assertTrue(db.job['finished_at'])
                self.assertEqual(len(db.publications), count)
                if failed:
                    self.assertIn('offline detail failure', db.job['error_msg'])
                for audience in failed:
                    self.assertEqual(db.rows[audience], previous[audience])

    def test_rejected_partial_status_write_exits_failure_without_reverting_outputs(self):
        db = SchemaJobs(reject_status=True)
        previous_cs = copy.deepcopy(db.rows['cs'])
        env = schema_runtime(db, {'cs'})
        self.assertEqual(cli.BriefingCliTests.invoke(self, env), 1)
        self.assertEqual({row['audience'] for row in db.publications}, {'executive', 'staff'})
        self.assertEqual(db.rows['cs'], previous_cs)
        self.assertEqual(db.job['status'], 'running')
        records = env['logger'].info.call_args_list
        self.assertFalse(any(call.args[0] in {'briefing_run_done', 'briefing_cli_complete'}
                             for call in records))


if __name__ == '__main__':
    unittest.main()
