import unittest

from worker.matchers.erp_existing_connection import ExistingReadFailure, read_existing_daily_once
from worker.matchers.erp_session_bounded_read import (
    SET_OWNED_TIMEOUT,
    read_with_owned_session_bound,
)
from worker.tests.test_erp_aggregate_source import SCOPE, Cursor


class SessionCursor(Cursor):
    def execute(self, sql, binds=None, timeout=None):
        self.connection.timeouts.append(timeout)
        if sql == SET_OWNED_TIMEOUT:
            self.connection.settings.append(sql)
            if self.connection.reject_set:
                raise PermissionError('synthetic session denial')
            self.connection.timeout = '10'
        if getattr(self.connection, 'fail_data', False) and sql.startswith('SELECT'):
            raise RuntimeError('synthetic query failure')
        super().execute(sql, binds)

    def fetchall(self):
        return [('STATEMENT_TIMEOUT_IN_SECONDS', self.connection.timeout)]


class Session:
    def __init__(self, reject_set=False, fail_close=False, timeout='172800'):
        self.reject_set, self.fail_close, self.timeout = reject_set, fail_close, timeout
        self.timeouts, self.settings, self.cursors = [], [], []
        self.closed = False

    def cursor(self):
        c = SessionCursor()
        c.connection = self
        self.cursors.append(c)
        return c

    def close(self):
        if self.fail_close:
            raise RuntimeError('synthetic close detail must not escape')
        self.closed = True

    def is_closed(self):
        return self.closed


class Tests(unittest.TestCase):
    def test_call_timeout_and_owned_session_confirmed_before_only_select(self):
        c = Session()
        r = read_with_owned_session_bound(SCOPE, lambda: c)
        self.assertEqual(r['session_bound']['timeout_before'], 172800)
        self.assertEqual(r['session_bound']['timeout_confirmed'], 10)
        self.assertEqual(c.settings, [SET_OWNED_TIMEOUT])
        self.assertTrue(all(t == 10 for t in c.timeouts))
        self.assertEqual(r['metadata']['aggregate_selects'], 1)
        self.assertTrue(c.closed)

    def test_session_denial_stops_without_select_or_alternative(self):
        c = Session(reject_set=True)
        with self.assertRaises(ExistingReadFailure):
            read_with_owned_session_bound(SCOPE, lambda: c)
        self.assertEqual(len(c.cursors), 1)
        self.assertEqual(c.settings, [SET_OWNED_TIMEOUT])
        self.assertTrue(c.closed)

    def test_successful_read_cannot_hide_close_failure(self):
        c = Session(fail_close=True, timeout='10')
        with self.assertRaisesRegex(ExistingReadFailure, '^EXISTING_CONNECTION_CLOSE_FAILED$') as e:
            read_existing_daily_once(SCOPE, lambda: c)
        self.assertIsNone(e.exception.metadata['read_failure_code'])
        self.assertFalse(e.exception.metadata['connection_closed'])

    def test_original_read_and_close_failures_both_retained(self):
        c = Session(fail_close=True)
        with self.assertRaises(ExistingReadFailure) as e:
            read_existing_daily_once(SCOPE, lambda: c)
        self.assertEqual(str(e.exception), 'EXISTING_CONNECTION_CLOSE_FAILED')
        self.assertEqual(e.exception.metadata['read_failure_code'], 'TIMEOUT_UNCONFIRMED')
        self.assertEqual(e.exception.metadata['close_exception_class'], 'RuntimeError')

    def test_bounded_outer_connection_close_failure_never_returns_receipt(self):
        c = Session(fail_close=True)
        with self.assertRaisesRegex(ExistingReadFailure, '^OWNED_CONNECTION_CLOSE_FAILED$'):
            read_with_owned_session_bound(SCOPE, lambda: c)

    def test_bounded_query_and_outer_close_diagnostics_both_retained(self):
        c = Session(fail_close=True)
        c.fail_data = True
        with self.assertRaises(ExistingReadFailure) as e:
            read_with_owned_session_bound(SCOPE, lambda: c)
        self.assertEqual(str(e.exception), 'OWNED_CONNECTION_CLOSE_FAILED')
        self.assertEqual(e.exception.metadata['read_failure_code'], 'LOCAL_READ_FAILED')
        self.assertEqual(e.exception.metadata['read_failure_diagnostic']['phase'], 'DAILY_SELECT')
