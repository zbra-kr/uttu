"""Reuse an existing normal source factory, without extracting credential values.

No factory fallback, key/env inspection, session mutation, writer, or retry.
The existing application loader performs its ordinary in-process authentication.
"""
import importlib.util
import sys
from pathlib import Path

from .central_sales_readonly import LocalReadBlocked
from .erp_aggregate_source import DAILY_SQL, _binds, execute_central_daily_sales

MDA_FACTORY = Path('/Users/macmini/projects/MDA/worker/matchers/snowflake_erp.py')


def _existing_module(path, name):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError('EXISTING_FACTORY_UNAVAILABLE')
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def existing_mda_connection():
    app = _existing_module(MDA_FACTORY, '_uttu_existing_mda_sales_factory')
    app._load_env()
    return app._snowflake_conn()


class ExistingReadFailure(RuntimeError):
    def __init__(self, code, metadata):
        super().__init__(code)
        self.metadata = metadata


def read_existing_daily_once(scope, factory=existing_mda_connection):
    binds = _binds(scope)  # reject before initializing the existing factory
    captured = {'brand': 'CO', 'from': scope['from'], 'to': scope['to'], 'aggregate': 'daily'}
    metadata = {'connection_attempts': 0, 'connection_established': False,
                'phase': 'CONNECT', 'statements': 0, 'aggregate_selects': 0,
                'connection_closed': False, 'session_settings_changed': False, 'read_failure_code': None}
    connection = None
    try:
        metadata['connection_attempts'] = 1
        connection = factory()
        metadata['connection_established'] = True

        class Cursor:
            def __init__(self, raw):
                self.raw = raw

            def __getattr__(self, name):
                return getattr(self.raw, name)

            def execute(self, sql, parameters=None):
                if sql == "SHOW PARAMETERS LIKE 'STATEMENT_TIMEOUT_IN_SECONDS' IN SESSION":
                    metadata['phase'] = 'TIMEOUT_PREFLIGHT'
                elif sql == 'EXPLAIN USING JSON '+DAILY_SQL and tuple(parameters) == binds:
                    metadata['phase'] = 'SCAN_PREFLIGHT'
                elif sql == DAILY_SQL and tuple(parameters) == binds and metadata['aggregate_selects'] == 0:
                    metadata['phase'] = 'DAILY_SELECT'
                    metadata['aggregate_selects'] += 1
                else:
                    raise LocalReadBlocked('EXISTING_READ_SCOPE_BLOCKED')
                metadata['statements'] += 1
                return self.raw.execute(sql, parameters)

        class Connection:
            def cursor(self):
                return Cursor(connection.cursor())

        receipt = execute_central_daily_sales(Connection(), captured)
        metadata['phase'] = 'COMPLETE'
        return {'scope': captured, 'receipt': receipt, 'metadata': metadata}
    except Exception as error:
        code = str(error) if isinstance(error, LocalReadBlocked) else 'EXISTING_FACTORY_OR_READ_FAILED'
        metadata['read_failure_code'] = code
        metadata['exception_class'] = type(error).__name__
        number = getattr(error, 'errno', None)
        metadata['driver_error_number'] = number if type(number) is int else None
        raise ExistingReadFailure(code, metadata) from None
    finally:
        if connection is not None:
            try:
                connection.close()
                check = getattr(connection, 'is_closed', None)
                if callable(check) and check() is not True:
                    raise RuntimeError('DRIVER_CLOSE_UNCONFIRMED')
                metadata['connection_closed'] = True
            except Exception as close_error:
                metadata['connection_closed'] = False
                metadata['close_exception_class'] = type(close_error).__name__
                raise ExistingReadFailure('EXISTING_CONNECTION_CLOSE_FAILED', metadata) from None


def existing_mda_product_reader():
    app = _existing_module(MDA_FACTORY, '_uttu_existing_mda_sales_factory')
    app._load_env()
    module = _existing_module(Path('/Users/macmini/projects/MDA/worker/ingest/supabase_writer.py'),
                              '_uttu_existing_mda_product_reader')
    return module.get_client()


def probe_existing_mapping_counts(factory=existing_mda_product_reader):
    """One existing-client metadata projection, only after public destination check.

    Actual confirmed crosswalk count cannot be inferred from products hints.
    """
    from urllib.parse import urlparse

    result = {'status': 'NOT_RUN', 'query_count': 0, 'destination_verified': False,
              'own_product_count': None, 'sample_rows': None,
              'verified_mapping_count': None, 'unmapped_total': None,
              'scope': 'existing own products; not inferred CO brand binding'}
    try:
        client = factory()
        destination = urlparse(str(client.supabase_url))
        if destination.scheme != 'https' or destination.hostname != 'ogtrvberttzupxrffpoh.supabase.co' or destination.username or destination.password or destination.port:
            result['status'] = 'DESTINATION_NOT_VERIFIED_NO_QUERY'
            return result
        result['destination_verified'] = True
        result['query_count'] = 1
        response = client.table('products').select('erp_style_code,brand_id', count='exact').eq('is_own', True).order('id').limit(21).execute()
        rows = response.data
        if type(rows) is not list or len(rows) > 21 or any(type(row) is not dict for row in rows):
            result['status'] = 'PRODUCT_RESPONSE_INVALID'
            return result
        result['own_product_count'] = response.count if type(response.count) is int and response.count >= 0 else None
        result['sample_rows'] = len(rows)
        result['sample_missing_style_hint'] = sum(not isinstance(row.get('erp_style_code'), str) or not row['erp_style_code'].strip() for row in rows)
        result['sample_missing_brand_key'] = sum(not isinstance(row.get('brand_id'), str) or not row['brand_id'].strip() for row in rows)
        result['status'] = 'PRODUCT_HINT_COUNTS_ONLY_NOT_CONFIRMED_CROSSWALK'
        result['mapping_evidence_gap'] = 'products has no ERP brand/confirmed evidence/version binding; hints are not verified mapping'
    except Exception as error:
        result['status'] = 'EXISTING_PRODUCT_READ_FAILED'
        result['exception_class'] = type(error).__name__
        code = getattr(error, 'code', None)
        result['safe_error_code'] = code if code in ('42P01', '42703', '42501', 'PGRST204', 'PGRST205') else None
    return result


def existing_uttu_product_reader():
    """Normal UTTU worker module/loader; call in a clean process, not after MDA init."""
    if '_uttu_existing_mda_sales_factory' in sys.modules:
        raise RuntimeError('FACTORY_PROCESS_ISOLATION_REQUIRED')
    module = _existing_module(Path('/Users/macmini/projects/uttu/worker/tasks/daily_summary.py'),
                              '_uttu_existing_daily_summary_client')
    return module._client()
