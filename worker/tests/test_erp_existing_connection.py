"""New factory-binding checks only, with no actual SDK import or keys."""
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from worker.matchers.erp_existing_connection import (
    ExistingReadFailure,
    existing_uttu_product_reader,
    probe_existing_mapping_counts,
    read_existing_daily_once,
)
from worker.tests.test_erp_aggregate_source import SCOPE, Cursor


class Connection:
    def __init__(self, cursor):
        self.cur = cursor
        self.closed = False

    def cursor(self):
        return self.cur

    def close(self):
        self.closed = True


class FactoryTests(unittest.TestCase):
    def test_existing_factory_called_once_and_owned_connection_closed(self):
        connection = Connection(Cursor())
        calls = []
        def factory():
            calls.append('open')
            return connection
        result = read_existing_daily_once(SCOPE, factory)
        self.assertEqual(calls, ['open'])
        self.assertEqual(result['metadata']['aggregate_selects'], 1)
        self.assertEqual(result['metadata']['statements'], 3)
        self.assertTrue(result['metadata']['connection_closed'])
        self.assertTrue(connection.closed)

    def test_unbounded_existing_session_stops_without_settings_or_data_read(self):
        connection = Connection(Cursor(timeout='172800'))
        with self.assertRaises(ExistingReadFailure) as caught:
            read_existing_daily_once(SCOPE, lambda: connection)
        self.assertEqual(str(caught.exception), 'TIMEOUT_UNCONFIRMED')
        self.assertEqual(caught.exception.metadata['aggregate_selects'], 0)
        self.assertEqual(len(connection.cur.calls), 1)
        self.assertFalse(caught.exception.metadata['session_settings_changed'])
        self.assertTrue(connection.closed)

    def test_product_wrong_destination_never_queries_and_cannot_manufacture_counts(self):
        def forbidden(*_):
            self.fail('wrong destination queried')
        client = SimpleNamespace(supabase_url='https://unverified.invalid', table=forbidden)
        result = probe_existing_mapping_counts(lambda: client)
        self.assertEqual(result['status'], 'DESTINATION_NOT_VERIFIED_NO_QUERY')
        self.assertEqual(result['query_count'], 0)
        self.assertIsNone(result['unmapped_total'])
        self.assertIsNone(result['verified_mapping_count'])

    def test_uttu_factory_rejects_mda_initialized_process_before_client_creation(self):
        with patch.dict(sys.modules, {'_uttu_existing_mda_sales_factory': object()}):
            with self.assertRaisesRegex(RuntimeError, 'PROCESS_ISOLATION_REQUIRED'):
                existing_uttu_product_reader()


if __name__ == '__main__':
    unittest.main()
