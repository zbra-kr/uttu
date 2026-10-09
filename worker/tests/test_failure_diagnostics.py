"""Offline real-function tests; no credential loading, network, or database clients."""
import ast
import copy
import io
import json
import struct
import sys
import traceback
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx
from loguru import logger

from worker.dart.fetcher import DartResponseError, _get_bytes, _validate_zip_response
from worker.tests import test_briefing_cli as cli
from worker.tests.test_briefing_publication import StoredBriefings, runtime

SECRET = 'fixture-sensitive-body-request-model-token'


class DartResponseTests(unittest.IsolatedAsyncioTestCase):
    def test_valid_zip_is_passed_through_unchanged(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as archive:
            archive.writestr('CORPCODE.xml', '<result/>')
        payload = out.getvalue()
        self.assertIs(_validate_zip_response(payload), payload)

    def test_non_zip_and_error_envelopes_fail_with_only_fixed_metadata(self):
        fixtures = [(b'', 'empty_response'),
                    (json.dumps({'status': '020', 'message': SECRET}).encode(), 'json_error_envelope'),
                    (f'<result><status>020</status><message>{SECRET}</message></result>'.encode(), 'xml_error_envelope'),
                    (b'{"status":"000"}', 'unexpected_json'),
                    (b'[]', 'unexpected_json'), (b'<result/>', 'unexpected_xml'),
                    (b'PK' + SECRET.encode(), 'invalid_zip'),
                    (b'<broken' + SECRET.encode(), 'unexpected_xml'),
                    (b'{' + SECRET.encode(), 'unexpected_format'),
                    (SECRET.encode(), 'unexpected_format'),
                    (b'{' + b'a' * 65536, 'unexpected_format'),
                    (b'[' * 3000 + b']' * 2999, 'unexpected_format')]
        for payload, kind in fixtures:
            with self.subTest(classification=kind):
                with self.assertRaises(DartResponseError) as caught:
                    _validate_zip_response(payload)
                self.assertEqual(caught.exception.classification, kind)
                self.assertEqual(str(caught.exception), f'dart_binary_failed stage=fetch_binary classification={kind}')
                self.assertNotIn(SECRET, str(caught.exception))

    def test_xml_encoding_failures_have_safe_exception_and_real_loguru_output(self):
        logger.remove()  # Test-process sinks only; no production logger is imported.
        self.addCleanup(lambda: logger.add(sys.stderr))
        for encoding in [SECRET, 'utf-32']:
            payload = f'<?xml version="1.0" encoding="{encoding}"?><result/>'.encode()
            stream = io.StringIO()
            sink = logger.add(stream, level='ERROR', filter=lambda r: not r['extra'].get('safe_trace_only'))
            try:
                try:
                    _validate_zip_response(payload)
                except DartResponseError as exc:
                    self.assertEqual(exc.classification, 'unexpected_xml')
                    self.assertTrue(exc.__suppress_context__)
                    self.assertIsNone(exc.__context__)
                    self.assertIsNone(exc.__cause__)
                    rendered = ''.join(traceback.format_exception(exc))
                    self.assertNotIn(SECRET, str(exc))
                    self.assertNotIn(SECRET, rendered)
                    logger.error(str(exc))
                    safe_trace = io.StringIO()
                    trace_sink = logger.add(safe_trace, level='ERROR', diagnose=False, backtrace=False,
                                            filter=lambda r: r['extra'].get('safe_trace_only', False))
                    try:
                        # Only the controlled safe sink receives this traceback.
                        logger.bind(safe_trace_only=True).opt(exception=exc).error('dart_binary_failure')
                    finally:
                        logger.remove(trace_sink)
                    self.assertNotIn(SECRET, safe_trace.getvalue())
                else:
                    self.fail('Malformed XML must fail')
            finally:
                logger.remove(sink)
            self.assertIn('classification=unexpected_xml', stream.getvalue())
            self.assertNotIn(SECRET, stream.getvalue())

    def test_forged_eocd_is_rejected_but_valid_empty_zip_still_passes(self):
        forged = struct.pack('<4s4H2LH', b'PK\x05\x06', 0, 0, 0, 0, 1, 0, 0)
        self.assertEqual(len(forged), 22)
        try:
            self.assertTrue(zipfile.is_zipfile(io.BytesIO(forged)))
        except ValueError:
            pass  # Python 3.14 can reject this EOCD in is_zipfile already.
        with self.assertRaises(zipfile.BadZipFile):
            zipfile.ZipFile(io.BytesIO(forged))
        with self.assertRaises(DartResponseError) as caught:
            _validate_zip_response(forged)
        self.assertEqual(caught.exception.classification, 'invalid_zip')
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w'):
            pass
        self.assertIsInstance(_validate_zip_response(out.getvalue()), bytes)

    async def test_http_and_transport_failures_are_sanitized_without_retry(self):
        request = httpx.Request('GET', 'https://example.invalid/' + SECRET)
        exceptions = [(httpx.HTTPStatusError(SECRET, request=request,
                       response=httpx.Response(403, request=request)), 'http_status'),
                      (httpx.ConnectError(SECRET, request=request), 'transport_error')]
        for exception, kind in exceptions:
            with self.subTest(kind=kind):
                client = SimpleNamespace(get=AsyncMock(side_effect=exception))
                with patch('worker.dart.fetcher.asyncio.sleep', new=AsyncMock()):
                    with self.assertRaises(DartResponseError) as caught:
                        await _get_bytes(client, 'offline-url', {'offline': 'placeholder'})
                client.get.assert_awaited_once()
                self.assertEqual(caught.exception.classification, kind)
                self.assertTrue(caught.exception.__suppress_context__)
                self.assertIsNone(caught.exception.__context__)
                self.assertNotIn(SECRET, str(caught.exception))

    async def test_non_zip_response_does_not_become_empty_success(self):
        response = SimpleNamespace(content=b'{"status":"013"}', raise_for_status=Mock())
        client = SimpleNamespace(get=AsyncMock(return_value=response))
        with patch('worker.dart.fetcher.asyncio.sleep', new=AsyncMock()):
            with self.assertRaises(DartResponseError):
                await _get_bytes(client, 'offline-url', {})
        client.get.assert_awaited_once()

    async def test_real_dart_run_stops_before_downstream_business_writes(self):
        source = Path(__file__).parents[1] / 'scrapers' / 'dart_scraper.py'
        tree = ast.parse(source.read_text())
        node = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'run')
        client = Mock()
        env = {'_supabase_client': lambda: client,
               'os': SimpleNamespace(environ={'DART_API_KEY': 'offline-placeholder'}),
               'logger': Mock(), 'resolve_corp_codes': AsyncMock(side_effect=DartResponseError('json_error_envelope')),
               'refresh_company_details': AsyncMock(), 'collect_disclosures': AsyncMock(),
               'collect_financials': AsyncMock()}
        future = ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0)
        exec(compile(ast.fix_missing_locations(ast.Module(body=[future, node], type_ignores=[])), str(source), 'exec'), env)
        with self.assertRaises(DartResponseError):
            await env['run'](ids=['offline-id'])
        client.table.assert_not_called()
        for name in ['refresh_company_details', 'collect_disclosures', 'collect_financials']:
            env[name].assert_not_awaited()

    async def test_real_corp_code_resolution_does_not_update_after_binary_failure(self):
        source = Path(__file__).parents[1] / 'scrapers' / 'dart_scraper.py'
        tree = ast.parse(source.read_text())
        node = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'resolve_corp_codes')
        client = Mock()
        query = client.table.return_value
        query.select.return_value.in_.return_value.is_.return_value.execute.return_value.data = [{'id': 'offline-id'}]
        env = {'logger': Mock(), 'fetch_corp_code_zip': AsyncMock(side_effect=DartResponseError('xml_error_envelope')),
               'parse_corp_codes': Mock()}
        future = ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0)
        exec(compile(ast.fix_missing_locations(ast.Module(body=[future, node], type_ignores=[])), str(source), 'exec'), env)
        with self.assertRaises(DartResponseError):
            await env['resolve_corp_codes'](client, 'offline-placeholder', ['offline-id'])
        env['parse_corp_codes'].assert_not_called()
        query.update.assert_not_called()


class BriefingDiagnosticTests(unittest.TestCase):
    def test_default_loguru_output_contains_classification_without_error_text(self):
        env, _ = runtime(StoredBriefings())
        stream = io.StringIO()
        sink = logger.add(stream, level='WARNING')
        try:
            logger.warning(env['_failure_diagnostic']('detail_page', 'cs', ValueError(SECRET)))
        finally:
            logger.remove(sink)
        self.assertIn('briefing_failure stage=detail_page audience=cs kind=ValueError', stream.getvalue())
        self.assertNotIn(SECRET, stream.getvalue())

    def test_partial_detail_failure_retains_old_revision_and_error_exit(self):
        db = StoredBriefings()
        previous = copy.deepcopy(db.rows)

        async def detail(result, *_):
            if result['audience'] != 'staff':
                raise ValueError(SECRET)
            return []

        env, tracker = cli.cli_runtime(db, detail)
        self.assertEqual(cli.BriefingCliTests.invoke(self, env), 1)
        for audience in ['executive', 'cs']:
            self.assertEqual(db.rows[audience], previous[audience])
        self.assertEqual(len(db.publications), 1)
        self.assertEqual(db.jobs[-1]['status'], 'error')
        self.assertEqual(db.jobs[-1]['rows_done'], 1)
        self.assertNotIn(SECRET, db.jobs[-1]['error_msg'])
        self.assertIn('kind=ValueError', db.jobs[-1]['error_msg'])
        env['enqueue_for_subscribers'].assert_not_called()
        tracker.finish.assert_not_awaited()
        messages = [call.args[0] for level in ['info', 'warning', 'error']
                    for call in getattr(env['logger'], level).call_args_list]
        self.assertIn('briefing_failure stage=details audience=executive kind=ValueError', messages)
        self.assertNotIn(SECRET, repr(messages))

    def test_unknown_metadata_and_exception_names_cannot_escape_allowlist(self):
        env, _ = runtime(StoredBriefings())
        exception = type(SECRET, (Exception,), {})(SECRET)
        self.assertEqual(env['_failure_diagnostic'](SECRET, SECRET, exception),
                         'briefing_failure stage=worker audience=unknown kind=OtherError')

    def test_cli_does_not_log_an_unknown_exception_class_name(self):
        env, _ = cli.cli_runtime(StoredBriefings())
        env['_supabase'] = Mock(side_effect=type(SECRET, (Exception,), {})(SECRET))
        self.assertEqual(cli.BriefingCliTests.invoke(self, env), 1)
        call = env['logger'].error.call_args
        rendered = call.args[0].format(**call.kwargs)
        self.assertIn('OtherError', rendered)
        self.assertNotIn(SECRET, rendered)

    def test_summary_failure_sanitizes_tracker_error_after_existing_retry(self):
        db = StoredBriefings()
        generate = AsyncMock(side_effect=RuntimeError(SECRET))
        env, tracker = cli.cli_runtime(db, generate=generate)
        self.assertEqual(cli.BriefingCliTests.invoke(self, env, '--audience', 'staff'), 1)
        self.assertEqual(generate.await_count, 2)  # Existing summary retry, never increased.
        tracker.error.assert_awaited_once_with('briefing_failure stage=summary audience=staff kind=RuntimeError')
        self.assertEqual(db.publications, [])

    def test_rejected_publication_retains_previous_revision_and_sanitizes_error(self):
        db = StoredBriefings(failure='reject')
        previous = copy.deepcopy(db.rows)
        env, tracker = cli.cli_runtime(db)
        self.assertEqual(cli.BriefingCliTests.invoke(self, env), 1)
        self.assertEqual(db.rows, previous)
        tracker.error.assert_awaited_once()
        text = tracker.error.await_args.args[0]
        self.assertIn('stage=publication', text)
        self.assertNotIn('offline publication rejected', text)
        env['enqueue_for_subscribers'].assert_not_called()


if __name__ == '__main__':
    unittest.main()
