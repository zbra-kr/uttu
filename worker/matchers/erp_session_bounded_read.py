"""Owned-connection-only timeout recovery; no global/security/persistent mutation."""
from .erp_aggregate_source import _binds
from .erp_existing_connection import (
    ExistingReadFailure,
    existing_mda_connection,
    existing_uttu_product_reader,
    read_existing_daily_once,
)

SHOW_TIMEOUT = "SHOW PARAMETERS LIKE 'STATEMENT_TIMEOUT_IN_SECONDS' IN SESSION"
SET_OWNED_TIMEOUT = 'ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 10'


def _timeout(cursor):
    cursor.execute(SHOW_TIMEOUT, timeout=10)
    columns = [c[0].lower() for c in cursor.description]
    rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    values = [r.get('value') for r in rows if r.get('key') == 'STATEMENT_TIMEOUT_IN_SECONDS']
    if len(values) != 1 or not str(values[0]).isdigit():
        raise RuntimeError('SESSION_TIMEOUT_UNREADABLE')
    return int(values[0])


def read_with_owned_session_bound(scope, factory=existing_mda_connection):
    _binds(scope)
    captured = scope.copy()
    connection = None
    metadata = {'factory_calls': 0, 'timeout_before': None, 'timeout_confirmed': None,
                'session_limit_changed': False, 'global_or_security_changed': False,
                'driver_timeout_seconds': 10, 'owned_connection_closed': False, 'read_failure_code': None}
    try:
        metadata['factory_calls'] = 1
        connection = factory()
        cursor = connection.cursor()
        try:
            metadata['timeout_before'] = _timeout(cursor)
            if not 1 <= metadata['timeout_before'] <= 10:
                cursor.execute(SET_OWNED_TIMEOUT, timeout=10)
                metadata['session_limit_changed'] = True
            metadata['timeout_confirmed'] = _timeout(cursor)
            if not 1 <= metadata['timeout_confirmed'] <= 10:
                raise RuntimeError('SESSION_TIMEOUT_UNCONFIRMED')
        finally:
            cursor.close()

        class TimedCursor:
            def __init__(self, raw):
                self.raw = raw

            def __getattr__(self, name):
                return getattr(self.raw, name)

            def execute(self, sql, parameters=None):
                return self.raw.execute(sql, parameters, timeout=10)

        class OwnedConnection:
            def cursor(self):
                return TimedCursor(connection.cursor())

            def close(self):
                # Outer owner closes once after the existing read guard unwinds.
                pass

        result = read_existing_daily_once(captured, lambda: OwnedConnection())
        result['session_bound'] = metadata
        return result
    except ExistingReadFailure as error:
        metadata['read_failure_code'] = str(error)
        metadata['read_failure_diagnostic'] = dict(error.metadata)
        error.metadata['session_bound'] = metadata
        raise
    except Exception as error:
        metadata['read_failure_code'] = 'OWNED_SESSION_BOUND_FAILED'
        metadata['exception_class'] = type(error).__name__
        number = getattr(error, 'errno', None)
        metadata['driver_error_number'] = number if type(number) is int else None
        raise ExistingReadFailure('OWNED_SESSION_BOUND_FAILED', metadata) from None
    finally:
        if connection is not None:
            try:
                connection.close()
                check = getattr(connection, 'is_closed', None)
                if callable(check) and check() is not True:
                    raise RuntimeError('DRIVER_CLOSE_UNCONFIRMED')
                metadata['owned_connection_closed'] = True
                metadata['driver_closed_confirmed'] = True if callable(check) else None
            except Exception as close_error:
                metadata['owned_connection_closed'] = False
                metadata['close_exception_class'] = type(close_error).__name__
                raise ExistingReadFailure('OWNED_CONNECTION_CLOSE_FAILED', metadata) from None


def probe_existing_style_hint_counts(factory=existing_uttu_product_reader):
    """Two HEAD counts, no product dump. Catalog covernat is not ERP-proof."""
    from urllib.parse import urlparse

    result = {'queries': 0, 'destination_verified': False, 'nonempty_own_style_hints': None,
              'covernat_catalog_nonempty_style_hints': None, 'verified_erp_mapping_count': None,
              'co_filter_meaning': 'existing catalog brands.slug=covernat; not independently confirmed ERP mapping'}
    try:
        client = factory()
        url = urlparse(str(client.supabase_url))
        if url.scheme != 'https' or url.hostname != 'ogtrvberttzupxrffpoh.supabase.co' or url.username or url.password or url.port:
            result['status'] = 'DESTINATION_UNVERIFIED_NO_QUERY'
            return result
        result['destination_verified'] = True
        for co, key in [(False, 'nonempty_own_style_hints'), (True, 'covernat_catalog_nonempty_style_hints')]:
            query = client.table('products').select('id,brands!inner(slug)' if co else 'id', count='exact', head=True).eq('is_own', True).not_.is_('erp_style_code', 'null').neq('erp_style_code', '')
            if co:
                query = query.eq('brands.slug', 'covernat')
            result['queries'] += 1
            response = query.execute()
            if type(response.count) is not int or response.count < 0:
                raise RuntimeError('HINT_COUNT_UNAVAILABLE')
            result[key] = response.count
        result['status'] = 'EXACT_HINT_COUNTS_NOT_CROSSWALK_PROOF'
    except Exception as error:
        result['status'] = 'HINT_COUNT_READ_FAILED'
        result['exception_class'] = type(error).__name__
        code = getattr(error, 'code', None)
        result['safe_error_code'] = code if code in ('42703', '42P01', '42501', 'PGRST204') else None
    return result
