"""Real audit functions with synthetic reports; no dart-fss import or requests."""
import ast
import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from loguru import logger

PRIVATE = 'synthetic-private-key-url-body-error'
SOURCE = Path(__file__).parents[1] / 'dart/fss_client.py'


def load(source, dart):
    tree = ast.parse(source)
    tree.body = [node for node in tree.body if not (
        isinstance(node, ast.Import) and any(a.name == 'dart_fss' for a in node.names))]
    env = {'dart': dart}
    exec(compile(tree, str(SOURCE), 'exec'), env)
    return env


class FailingReport:
    report_nm = '감사보고서 (2024.12)'
    rcept_no = PRIVATE

    def __init__(self, error):
        self.error = error

    @property
    def pages(self):
        raise self.error


def report(name='감사보고서 (2024.12)', pages=None):
    return SimpleNamespace(report_nm=name, rcept_no=PRIVATE, pages=pages or [])


def sdk(reports, search_error=None, corp='00123456'):
    search = Mock(side_effect=search_error, return_value=reports)
    dart = SimpleNamespace(set_api_key=Mock(), get_corp_list=Mock(return_value=[
        SimpleNamespace(corp_code=corp, search_filings=search)]))
    return dart, search


@pytest.mark.parametrize('error,kind', [
    (UnicodeDecodeError('utf8', b'x', 0, 1, PRIVATE), 'encoding_error'),
    (KeyError(PRIVATE), 'missing_field'), (TypeError(PRIVATE), 'invalid_type'),
    (ValueError(PRIVATE), 'invalid_value'), (AttributeError(PRIVATE), 'missing_attribute'),
    (OSError(PRIVATE), 'io_error'), (type(PRIVATE, (Exception,), {})(PRIVATE), 'unknown_error'),
])
def test_exception_classification_and_safe_default_and_extra_logs(error, kind):
    dart, search = sdk([FailingReport(error)])
    env = load(SOURCE.read_text(), dart)
    for diagnose in [False, True]:
        stream = io.StringIO()
        sink = logger.add(stream, format='{message} {extra}', level='DEBUG',
                          diagnose=diagnose, backtrace=diagnose)
        try:
            assert env['fetch_audit_financials'](PRIVATE, '00123456') == []
            text = stream.getvalue()
            assert f'classification={kind}' in text
            assert 'corp_code=00123456 year=2024 stage=report_parse' in text
            assert 'reports=1 attempted=1 ok=0 empty=0 parse_error=1 year_skip=0' in text
            assert PRIVATE not in text
        finally:
            logger.remove(sink)
    assert search.call_count == 2  # One per invocation, no retries.


def test_results_and_sdk_calls_match_baseline_for_mixed_reports():
    reports = [report(pages=[SimpleNamespace(title='손익계산서 '+PRIVATE,
                                            html=f'<p>매출액 1,234 2,345 {PRIVATE}</p>')]),
               report(), FailingReport(ValueError(PRIVATE)),
               report('감사보고서 '+PRIVATE), report('연결감사보고서 (2024.12)')]
    baseline = (Path(__file__).parent / 'fixtures/audit_fss_baseline.txt').read_text()
    old_dart, old_search = sdk(reports)
    expected = load(baseline, old_dart)['fetch_audit_financials'](PRIVATE, '00123456')
    new_dart, new_search = sdk(reports)
    stream = io.StringIO()
    sink = logger.add(stream, format='{message} {extra}', level='DEBUG', diagnose=True, backtrace=True)
    try:
        result = load(SOURCE.read_text(), new_dart)['fetch_audit_financials'](PRIVATE, '00123456')
        assert result == expected == [{'fiscal_year': 2024, 'data_source': 'audit_report_html', 'revenue': 1234}]
        assert new_search.call_args_list == old_search.call_args_list
        assert new_dart.set_api_key.call_args_list == old_dart.set_api_key.call_args_list
        assert new_dart.get_corp_list.call_count == old_dart.get_corp_list.call_count == 1
        assert 'reports=4 attempted=3 ok=1 empty=1 parse_error=1 year_skip=1 search_error=0 corp_missing=0' in stream.getvalue()
        assert PRIVATE not in stream.getvalue()
    finally:
        logger.remove(sink)


def test_search_failure_and_missing_corp_summaries_remain_empty_and_safe():
    for missing in [False, True]:
        dart, search = sdk([], search_error=RuntimeError(PRIVATE), corp=PRIVATE if missing else '00123456')
        stream = io.StringIO()
        sink = logger.add(stream, format='{message} {extra}', level='DEBUG')
        try:
            env = load(SOURCE.read_text(), dart)
            assert env['fetch_audit_financials'](PRIVATE, '00123456') == []
            assert ('search_error=0 corp_missing=1' if missing else 'search_error=1 corp_missing=0') in stream.getvalue()
            assert PRIVATE not in stream.getvalue()
            assert search.call_count == (0 if missing else 1)
            assert env['_safe_audit_context'](PRIVATE, True) == 'corp_code=unknown year=unknown'
        finally:
            logger.remove(sink)


@pytest.mark.parametrize('page', [SimpleNamespace(title=None, html=None),
                                  SimpleNamespace(title=123, html=PRIVATE),
                                  SimpleNamespace(title='손익계산서', html={'secret': PRIVATE})])
def test_real_page_shape_errors_and_empty_preserve_results(page):
    dart, _ = sdk([report(pages=[page])])
    stream = io.StringIO()
    sink = logger.add(stream, format='{message} {extra}', level='DEBUG')
    try:
        assert load(SOURCE.read_text(), dart)['fetch_audit_financials'](PRIVATE, '00123456') == []
        assert PRIVATE not in stream.getvalue()
        assert ('empty=1' if page.title is None else 'classification=invalid_type') in stream.getvalue()
    finally:
        logger.remove(sink)


class HostileCorp(str):
    def __format__(self, spec):
        raise AssertionError('Untrusted format must not execute')

    def __str__(self):
        raise AssertionError('Untrusted str must not execute')


class HostileError(Exception):
    @property
    def __class__(self):
        raise RuntimeError('Untrusted class accessor must not execute')


def test_str_subclass_cannot_inject_private_control_text():
    class InjectingCorp(str):
        def __format__(self, spec):
            return PRIVATE + '\nforged-log'

    for corp in [HostileCorp('00123456'), InjectingCorp('00123456')]:
        dart, search = sdk([FailingReport(ValueError(PRIVATE))], corp=corp)
        stream = io.StringIO()
        sink = logger.add(stream, format='{message} {extra}', level='DEBUG', diagnose=True, backtrace=True)
        try:
            env = load(SOURCE.read_text(), dart)
            assert env['fetch_audit_financials'](PRIVATE, corp) == []
            assert 'corp_code=unknown' in stream.getvalue()
            assert PRIVATE not in stream.getvalue()
            assert 'forged-log' not in stream.getvalue()
            search.assert_called_once()
        finally:
            logger.remove(sink)


def test_hostile_exception_class_accessor_preserves_continue_and_calls():
    reports = [FailingReport(HostileError(PRIVATE)), report()]
    baseline = (Path(__file__).parent / 'fixtures/audit_fss_baseline.txt').read_text()
    old_dart, old_search = sdk(reports)
    expected = load(baseline, old_dart)['fetch_audit_financials'](PRIVATE, '00123456')
    dart, search = sdk(reports)
    stream = io.StringIO()
    sink = logger.add(stream, format='{message} {extra}', level='DEBUG', diagnose=True, backtrace=True)
    try:
        env = load(SOURCE.read_text(), dart)
        assert env['fetch_audit_financials'](PRIVATE, '00123456') == expected == []
        assert search.call_args_list == old_search.call_args_list
        assert 'classification=unknown_error' in stream.getvalue()
        assert 'attempted=2 ok=0 empty=1 parse_error=1' in stream.getvalue()
        assert PRIVATE not in stream.getvalue()
    finally:
        logger.remove(sink)


def test_baseline_fixture_is_available_without_git_history():
    # The differential test above reads only this explicit source fixture.
    baseline = Path(__file__).parent / 'fixtures/audit_fss_baseline.txt'
    assert baseline.is_file()
    assert 'def fetch_audit_financials(' in baseline.read_text()


@pytest.mark.parametrize('base,expected_kind', [(Exception, 'unknown_error'), (ValueError, 'invalid_value')])
def test_metaclass_mro_descriptor_is_bypassed_and_reports_continue(base, expected_kind):
    accesses = []

    class BrokenLineage:
        def __iter__(self):
            accesses.append('iter')
            raise RuntimeError(PRIVATE)

    class HostileMeta(type):
        @property
        def __mro__(cls):
            accesses.append('descriptor')
            return BrokenLineage()

    class HostileMroError(base, metaclass=HostileMeta):
        pass

    reports = [FailingReport(HostileMroError(PRIVATE)), report()]
    baseline = (Path(__file__).parent / 'fixtures/audit_fss_baseline.txt').read_text()
    old_dart, old_search = sdk(reports)
    expected = load(baseline, old_dart)['fetch_audit_financials'](PRIVATE, '00123456')
    dart, search = sdk(reports)
    stream = io.StringIO()
    sink = logger.add(stream, format='{message} {extra}', level='DEBUG', diagnose=True, backtrace=True)
    try:
        result = load(SOURCE.read_text(), dart)['fetch_audit_financials'](PRIVATE, '00123456')
        assert result == expected == []
        assert search.call_args_list == old_search.call_args_list
        assert accesses == []
        assert f'classification={expected_kind}' in stream.getvalue()
        assert 'reports=2 attempted=2 ok=0 empty=1 parse_error=1' in stream.getvalue()
        assert stream.getvalue().count('dart_fss_summary') == 1
        assert PRIVATE not in stream.getvalue()
    finally:
        logger.remove(sink)
