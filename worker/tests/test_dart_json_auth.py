"""Offline real fetcher/caller regressions; no SDK, credentials, network or DB."""
import ast
import asyncio
import io
import traceback
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx
from loguru import logger

from worker.dart import fetcher

PRIVATE = 'synthetic-private-provider-url-key'
ERROR = 'dart_json_failed stage=fetch_json classification=authentication_error'


def caller_env():
    # Execute unchanged caller function bodies without module-level dotenv/SDK setup.
    source = Path(__file__).parents[1] / 'scrapers' / 'dart_scraper.py'
    tree = ast.parse(source.read_text())
    names = {'collect_disclosures', 'collect_financials', 'run', 'main'}
    nodes = [n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name in names]
    future = ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0)
    env = dict(datetime=datetime, timedelta=timedelta, KST=timezone.utc, logger=Mock(),
               fetch_disclosures=fetcher.fetch_disclosures, fetch_audit_financials=Mock(return_value=[]))
    exec(compile(ast.fix_missing_locations(ast.Module(body=[future, *nodes], type_ignores=[])),
                 str(source), 'exec'), env)
    return env


class DartJsonAuthTests(unittest.IsolatedAsyncioTestCase):
    def response(self, status, **extra):
        return httpx.Response(200, json={'status': status, 'message': PRIVATE, **extra},
                              request=httpx.Request('GET', 'https://example.invalid/' + PRIVATE))

    def client(self, responses):
        client = Mock()
        client.get = AsyncMock(side_effect=responses)
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        return client

    async def test_status_contract_and_fixed_diagnostics(self):
        stream = io.StringIO()
        sink = logger.add(stream, level='DEBUG', diagnose=False, backtrace=False)
        try:
            for status in ['010', '013', '000', '011']:
                client = self.client([self.response(status, list=[{'fixture': True}])])
                with patch.object(fetcher.asyncio, 'sleep', new=AsyncMock()) as sleep:
                    if status in ['010', '011']:
                        with self.assertRaises(RuntimeError) as caught:
                            await fetcher._get_json(client, 'https://example.invalid/' + PRIVATE,
                                                    {'crtfc_key': PRIVATE})
                        if status == '010':
                            exc = caught.exception
                            self.assertEqual(str(exc), ERROR)
                            self.assertIsNone(exc.__context__)
                            self.assertIsNone(exc.__cause__)
                            self.assertNotIn(PRIVATE, ''.join(traceback.format_exception(exc)))
                            logger.opt(exception=exc).error(str(exc))
                        else:
                            self.assertTrue(str(caught.exception).startswith('DART API 오류 011:'))
                    else:
                        result = await fetcher._get_json(client, 'offline-url', {'crtfc_key': PRIVATE})
                        expected = {} if status == '013' else {
                            'status': '000', 'message': PRIVATE, 'list': [{'fixture': True}]}
                        self.assertEqual(result, expected)
                    sleep.assert_awaited_once_with(fetcher.RATE_LIMIT_SEC)
                client.get.assert_awaited_once()
            self.assertIn(ERROR, stream.getvalue())
            self.assertNotIn(PRIVATE, stream.getvalue())
        finally:
            logger.remove(sink)

    async def test_cancellation_is_propagated_without_retry(self):
        client = self.client([asyncio.CancelledError()])
        with patch.object(fetcher.asyncio, 'sleep', new=AsyncMock()):
            with self.assertRaises(asyncio.CancelledError):
                await fetcher._get_json(client, 'offline-url', {})
        client.get.assert_awaited_once()

    async def test_real_public_fetchers_preserve_empty_and_success(self):
        for function, args in [(fetcher.fetch_company, ('key', 'corp')),
                               (fetcher.fetch_disclosures, ('key', 'corp', '20200101', '20201231')),
                               (fetcher.fetch_financials, ('key', 'corp', 2020))]:
            for status in ['010', '013', '000']:
                with self.subTest(function=function.__name__, status=status):
                    client = self.client([self.response(status, list=[{'fixture': True}], total_count=1)])
                    with patch.object(fetcher.httpx, 'AsyncClient', return_value=client), \
                            patch.object(fetcher.asyncio, 'sleep', new=AsyncMock()):
                        if status == '010':
                            with self.assertRaisesRegex(RuntimeError, ERROR):
                                await function(*args)
                        else:
                            result = await function(*args)
                            if function == fetcher.fetch_company:
                                self.assertEqual(result.get('status'), '000' if status == '000' else None)
                            else:
                                self.assertEqual(result, [{'fixture': True}] if status == '000' else [])
                    client.get.assert_awaited_once()

    async def test_real_collectors_stop_before_fallback_and_business_writes(self):
        for name in ['collect_disclosures', 'collect_financials']:
            for responses in [[self.response('010')], [self.response('013'), self.response('010')]]:
                if name == 'collect_disclosures' and len(responses) > 1:
                    responses = [self.response('000', list=[{'fixture': True}], total_count=2),
                                 self.response('010')]
                env = caller_env()
                db = Mock()
                query = db.table.return_value
                query.select.return_value = query
                query.in_.return_value = query
                query.not_.is_.return_value = query
                query.or_.return_value = query
                query.execute.return_value.data = [{'id': 'id', 'corp_code': 'corp', 'corp_name': 'fixture'}]
                client = self.client(responses)
                with patch.object(fetcher.httpx, 'AsyncClient', return_value=client), \
                        patch.object(fetcher.asyncio, 'sleep', new=AsyncMock()):
                    with self.assertRaisesRegex(RuntimeError, ERROR):
                        await env[name](db, 'fixture-key', ['id'], years=1)
                self.assertEqual(client.get.await_count, len(responses))
                env['fetch_audit_financials'].assert_not_called()
                query.update.assert_not_called()
                query.upsert.assert_not_called()
                self.assertTrue(all(c.args == ('companies',) for c in db.table.call_args_list))
                for call in env['logger'].method_calls:
                    self.assertNotIn('disclosures_none', str(call))
                    self.assertNotIn('financials_no_data', str(call))

    async def test_financial_no_data_still_uses_fallback_and_marks_checked(self):
        env = caller_env()
        db = Mock()
        query = db.table.return_value
        query.select.return_value = query
        query.in_.return_value = query
        query.not_.is_.return_value = query
        query.or_.return_value = query
        query.execute.return_value.data = [{'id': 'id', 'corp_code': 'corp', 'corp_name': 'fixture'}]
        client = self.client([self.response('013'), self.response('013')])
        with patch.object(fetcher.httpx, 'AsyncClient', return_value=client), \
                patch.object(fetcher.asyncio, 'sleep', new=AsyncMock()):
            self.assertEqual(await env['collect_financials'](db, 'key', ['id'], years=1), 0)
        env['fetch_audit_financials'].assert_called_once_with('key', 'corp', years=1)
        query.update.assert_called_once()
        self.assertEqual(set(query.update.call_args.args[0]), {'dart_fin_checked_at'})
        query.upsert.assert_not_called()
        self.assertEqual(client.get.await_count, 2)

    async def test_run_stops_and_main_records_safe_failure(self):
        env = caller_env()
        db = Mock()
        query = db.table.return_value
        query.select.return_value = query
        query.in_.return_value = query
        query.not_.is_.return_value = query
        query.execute.return_value.data = [{'id': 'id'}]
        env.update(_supabase_client=lambda: db,
                   os=SimpleNamespace(environ={'DART_API_KEY': 'fixture-key'}),
                   resolve_corp_codes=AsyncMock(), refresh_company_details=AsyncMock(),
                   collect_disclosures=AsyncMock(side_effect=RuntimeError(ERROR)),
                   collect_financials=AsyncMock())
        tracker = SimpleNamespace(start=AsyncMock(), finish=AsyncMock(), error=AsyncMock())
        with patch.dict('sys.modules', {'worker.utils.job_tracker': SimpleNamespace(JobTracker=lambda *a, **k: tracker)}):
            with self.assertRaisesRegex(RuntimeError, ERROR):
                await env['main'](ids=['id'])
        env['collect_financials'].assert_not_awaited()
        tracker.finish.assert_not_awaited()
        tracker.error.assert_awaited_once_with(ERROR)
