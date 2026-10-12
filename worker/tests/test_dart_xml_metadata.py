"""Synthetic binary XML diagnostics; no requests, credentials or SDK loading."""
import io
import traceback
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from loguru import logger

from worker.dart import fetcher

PRIVATE = 'synthetic-secret-key-url-response-header'


@pytest.mark.parametrize('status,expected', [
    ('010', '010'), ('011', '011'), ('020', '020'), ('800', '800'), ('900', '900'),
    ('999', 'unknown'), ('10', 'unknown'), (' 010 ', 'unknown'),
    ('０１０', 'unknown'), ('010\n'+PRIVATE, 'unknown'),
    (PRIVATE, 'unknown'), ('010&lt;script&gt;'+PRIVATE, 'unknown'),
])
@pytest.mark.asyncio
async def test_real_binary_path_retains_only_allowlisted_metadata(status, expected):
    response = httpx.Response(200, content=(
        f'<result><status>{status}</status><message>{PRIVATE}</message></result>').encode(),
        headers={'content-type': f'Application/XML; charset={PRIVATE}', 'x-private': PRIVATE},
        request=httpx.Request('GET', 'https://example.invalid/'+PRIVATE))
    client = SimpleNamespace(get=AsyncMock(return_value=response))
    stream = io.StringIO()
    sink = logger.add(stream, diagnose=False, backtrace=False)
    try:
        with patch.object(fetcher.asyncio, 'sleep', new=AsyncMock()) as sleep:
            with pytest.raises(fetcher.DartResponseError) as caught:
                await fetcher._get_bytes(client, 'https://example.invalid/'+PRIVATE,
                                         {'crtfc_key': PRIVATE})
        exc = caught.value
        assert str(exc) == ('dart_binary_failed stage=fetch_binary classification=xml_error_envelope'
                            f' provider_status={expected} http_status=200 content_type=xml')
        assert exc.provider_status == expected
        assert exc.http_status == 200
        assert exc.content_type == 'xml'
        assert exc.__context__ is None and exc.__cause__ is None
        assert PRIVATE not in repr(vars(exc))
        assert PRIVATE not in ''.join(traceback.format_exception(exc))
        logger.opt(exception=exc).error(str(exc))
        assert PRIVATE not in stream.getvalue()
        client.get.assert_awaited_once()
        sleep.assert_awaited_once_with(fetcher.RATE_LIMIT_SEC)
    finally:
        logger.remove(sink)


@pytest.mark.parametrize('media,expected', [('text/xml', 'xml'), ('application/json', 'json'),
    ('application/zip', 'zip'), ('application/octet-stream', 'octet-stream'),
    ('text/html', 'html'), (PRIVATE, 'unknown'), ('application/xml'+PRIVATE, 'unknown')])
@pytest.mark.asyncio
async def test_content_type_normalization(media, expected):
    response = httpx.Response(202, content=b'<result><status>020</status></result>',
                              headers={'content-type': media}, request=httpx.Request('GET', 'https://example.invalid/'))
    with patch.object(fetcher.asyncio, 'sleep', new=AsyncMock()):
        with pytest.raises(fetcher.DartResponseError) as caught:
            await fetcher._get_bytes(SimpleNamespace(get=AsyncMock(return_value=response)), 'offline', {})
    assert caught.value.content_type == expected
    assert caught.value.http_status == 202


@pytest.mark.parametrize('payload', [b'<broken', b'<result><status>010',
    f'<?xml version="1.0" encoding="{PRIVATE}"?><result/>'.encode()])
def test_parse_failures_stay_generic_and_private(payload):
    with pytest.raises(fetcher.DartResponseError) as caught:
        fetcher._validate_zip_response(payload, http_status=200, content_type='xml')
    assert caught.value.classification == 'unexpected_xml'
    assert PRIVATE not in str(caught.value)
    assert PRIVATE not in ''.join(traceback.format_exception(caught.value))


def test_exception_boundary_rejects_arbitrary_metadata():
    exc = fetcher.DartResponseError(PRIVATE, provider_status=PRIVATE,
                                    http_status=PRIVATE, content_type=PRIVATE)
    assert str(exc) == ('dart_binary_failed stage=fetch_binary classification=unexpected_format'
                        ' provider_status=unknown http_status=unknown content_type=unknown')
    assert PRIVATE not in repr(vars(exc))


@pytest.mark.parametrize('body,classification', [
    ('<status>020</status><status>010</status>', 'xml_error_envelope'),
    ('<status>010</status><status>020</status>', 'xml_error_envelope'),
    ('<status>020</status><status>020</status>', 'xml_error_envelope'),
    ('<status>020<status>010</status></status>', 'xml_error_envelope'),
    ('<wrap><status>010</status></wrap>', 'unexpected_xml'),
    ('<status>020</status><wrap><status>010</status></wrap>', 'xml_error_envelope'),
    ('<status xmlns="urn:fixture">010</status>', 'unexpected_xml'),
    ('<status>020</status><status xmlns="urn:fixture">010</status>', 'xml_error_envelope'),
    ('<status/>', 'unexpected_xml'),
    ('<status private="synthetic-secret-key-url-response-header">020</status>', 'xml_error_envelope'),
    ('<status>010&lt;script&gt;synthetic-secret-key-url-response-header</status>', 'xml_error_envelope'),
])
def test_ambiguous_xml_never_exposes_definite_provider_code(body, classification):
    with pytest.raises(fetcher.DartResponseError) as caught:
        fetcher._validate_zip_response(f'<result>{body}</result>'.encode(),
                                       http_status=200, content_type='xml')
    assert caught.value.classification == classification
    assert caught.value.provider_status == 'unknown'
    assert PRIVATE not in str(caught.value)
    assert PRIVATE not in repr(vars(caught.value))


def test_namespaced_root_is_unknown_without_new_classification():
    with pytest.raises(fetcher.DartResponseError) as caught:
        fetcher._validate_zip_response(b'<result xmlns="urn:fixture"><status>010</status></result>',
                                       http_status=200, content_type='xml')
    assert caught.value.classification == 'unexpected_xml'
    assert caught.value.provider_status == 'unknown'


@pytest.mark.parametrize('diagnose,backtrace', [(False, False), (True, True)])
def test_fixed_message_logging_safe_for_diagnostic_sink_settings(diagnose, backtrace):
    # Current caller uses str(e), without opt(exception=...). Diagnostic tracebacks
    # with diagnose=True are outside the guarantee: they can print caller locals.
    stream = io.StringIO()
    sink = logger.add(stream, diagnose=diagnose, backtrace=backtrace)
    try:
        try:
            fetcher._validate_zip_response(
                f'<result><status>020</status><message>{PRIVATE}</message></result>'.encode(),
                http_status=200, content_type='xml')
        except fetcher.DartResponseError as exc:
            logger.error(str(exc))
        assert PRIVATE not in stream.getvalue()
        assert 'provider_status=020' in stream.getvalue()
    finally:
        logger.remove(sink)
