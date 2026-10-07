"""Offline strict adapters and source-failure gate; no atomic publication proof."""
import asyncio
import copy
import importlib
import sys
import types
from datetime import timezone

import pytest


class NoSocketLoop(asyncio.SelectorEventLoop):
    def __init__(self):
        super().__init__(selector=types.SimpleNamespace(select=lambda _: [], close=lambda: None,
                                                       get_map=lambda: {}))

    def _make_self_pipe(self):
        pass

    def _close_self_pipe(self):
        pass

    def _write_to_self(self):
        pass


def run(coro):
    loop = NoSocketLoop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@pytest.fixture
def h(monkeypatch):
    def blocked(*_args, **_kwargs):
        raise AssertionError('Real client/model forbidden')

    def stub(name, **values):
        m = types.ModuleType(name)
        m.__dict__.update(values)
        monkeypatch.setitem(sys.modules, name, m)
        return m

    for name in list(sys.modules):
        if name.startswith('worker.funding.') or name == 'worker.agent.funding_extractor':
            monkeypatch.delitem(sys.modules, name)
    stub('dotenv', load_dotenv=lambda: None)
    stub('loguru', logger=types.SimpleNamespace(**{k: lambda *_a, **_kw: None
                                                  for k in ('info', 'debug', 'warning', 'error')}))
    stub('httpx', Client=blocked, AsyncClient=blocked, HTTPError=RuntimeError)
    stub('supabase', Client=object, create_client=blocked)
    stub('pytz', timezone=lambda _: timezone.utc)
    stub('worker.dart.fetcher', BASE='https://fixture.invalid', RATE_LIMIT_SEC=0)
    stub('dart_fss', set_api_key=lambda _: None, get_corp_list=blocked)
    class NoDataReceived(ValueError):
        pass
    stub('dart_fss.errors', NoDataReceived=NoDataReceived)
    stub('worker.agent.claude_client', FUNDING_EXTRACT_MODEL='fixture', extract_json=blocked)
    effects = []
    stub('worker.notifications.enqueue', enqueue_notification=lambda **kw: effects.append(kw))
    async def brief(*_args):
        effects.append('brief')
        return 'fixture brief'
    stub('worker.funding.brief_writer', generate_brief=brief)
    mods = {k: importlib.import_module('worker.funding.' + k)
            for k in ('dart_source', 'audit_source', 'news_source', 'orchestrator', 'outcomes')}
    mods['extractor'] = importlib.import_module('worker.agent.funding_extractor')
    async def inline(fn, *args, **kwargs):
        return fn(*args, **kwargs)
    monkeypatch.setattr(asyncio, 'to_thread', inline)
    return types.SimpleNamespace(**mods, effects=effects)


@pytest.mark.parametrize('group', [{}, {'list': None}, {'list': {}}, {'list': [None]}])
def test_nested_dart_group_rejected(h, group):
    with pytest.raises(h.outcomes.DiscoveryFailure):
        h.dart_source._parse_estkrs([group])


@pytest.mark.parametrize('status', ['010', '020', None, 0, 'bad'])
def test_dart_error_status_not_empty(h, status):
    class Client:
        async def get(self, *_args, **_kwargs):
            return types.SimpleNamespace(raise_for_status=lambda: None,
                                         json=lambda: {'status': status})
    with pytest.raises(h.outcomes.DiscoveryFailure):
        run(h.dart_source._get_json(Client(), 'estkRs.json', {}))


def test_dart_documented_no_data(h):
    class Client:
        async def get(self, *_args, **_kwargs):
            return types.SimpleNamespace(raise_for_status=lambda: None,
                                         json=lambda: {'status': '013'})
    assert run(h.dart_source._get_json(Client(), 'estkRs.json', {})) == {}
    assert h.dart_source._parse_estkrs([{'title': 'fixture', 'list': []}]) == []


@pytest.mark.parametrize('first', [None, 'exception'])
def test_alternate_url_retained(h, monkeypatch, first):
    calls = []
    def fetch(url):
        calls.append(url)
        if len(calls) == 1:
            if first == 'exception':
                raise RuntimeError('HTTP fixture failure')
            return None
        return 'verified article ' * 20
    monkeypatch.setattr(h.news_source, '_fetch_article_body_single', fetch)
    body = h.news_source._fetch_article_body({'link': 'https://n.news.naver.com/a',
                                             'originallink': 'https://fixture.invalid/b'})
    assert body == 'verified article ' * 20
    assert calls == ['https://n.news.naver.com/a', 'https://fixture.invalid/b']


def test_all_article_urls_failed_is_not_empty(h, monkeypatch):
    monkeypatch.setattr(h.news_source, '_fetch_article_body_single', lambda _: None)
    with pytest.raises(h.outcomes.DiscoveryFailure):
        h.news_source._fetch_article_body({'originallink': 'https://fixture.invalid/a'})


@pytest.mark.parametrize('payload', [None, {}, {'rounds': None}, {'rounds': [None]}])
def test_nlp_malformed_not_empty(h, payload):
    with pytest.raises(h.outcomes.DiscoveryFailure):
        h.extractor._parse_result(payload)


def test_nlp_explicit_empty_and_positive(h):
    assert h.extractor._parse_result({'rounds': []}) == []
    positive = {'company': 'Fixture', 'investors': ['investor'], 'amount_krw': 100}
    assert h.extractor._parse_result({'rounds': [positive]}) == [positive]


@pytest.mark.parametrize('mode', ['search', 'parser', 'section', 'year', 'empty'])
def test_audit_nested_classification(h, monkeypatch, mode):
    report = types.SimpleNamespace(report_nm='감사보고서 (2025.12)' if mode != 'year' else '감사보고서')
    def search(**_kwargs):
        if mode == 'search':
            raise RuntimeError('fixture')
        return [report]
    corp = types.SimpleNamespace(corp_code='fixture', search_filings=search)
    monkeypatch.setenv('DART_API_KEY', 'fixture-not-credential')
    monkeypatch.setattr(sys.modules['dart_fss'], 'get_corp_list', lambda: [corp])
    def parse(*_args):
        if mode == 'parser':
            raise RuntimeError('fixture')
        return None, mode != 'section'
    monkeypatch.setattr(h.audit_source, '_parse_report_sce', parse)
    if mode == 'empty':
        assert h.audit_source.fetch_audit_rounds('fixture') == []
    else:
        with pytest.raises(h.outcomes.DiscoveryFailure):
            h.audit_source.fetch_audit_rounds('fixture')


@pytest.mark.parametrize('payload', [None, {}, {'items': None}, {'items': [None]}])
def test_naver_nested_classification(h, monkeypatch, payload):
    class Client:
        def __init__(self, **_kw):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *_a):
            pass
        def get(self, *_a, **_kw):
            return types.SimpleNamespace(raise_for_status=lambda: None, json=lambda: payload)
    monkeypatch.setattr(sys.modules['httpx'], 'Client', Client)
    with pytest.raises(h.outcomes.DiscoveryFailure):
        h.news_source._naver_search('fixture', 'fixture', 'query')


def test_news_success_keeps_list_contract(h, monkeypatch):
    monkeypatch.setenv('NAVER_CLIENT_ID', 'fixture')
    monkeypatch.setenv('NAVER_CLIENT_SECRET', 'fixture')
    monkeypatch.setattr(h.news_source, '_build_queries', lambda *_a, **_kw: ['fixture'])
    monkeypatch.setattr(h.news_source, '_naver_search', lambda *_a: [])
    monkeypatch.setattr(h.news_source.time, 'sleep', lambda *_a: None)
    result = run(h.news_source.fetch_news_rounds('Fixture', 'Fixture'))
    assert result == [] and isinstance(result, list)


@pytest.mark.parametrize('receipt', [None, {}, [None]])
def test_brand_missing_receipt_rejected(h, monkeypatch, receipt):
    monkeypatch.setenv('SUPABASE_URL', 'https://fixture.invalid')
    monkeypatch.setenv('SUPABASE_SERVICE_KEY', 'fixture-not-credential')
    class Query:
        def from_(self, *_a):
            return self
        select = eq = limit = from_
        def execute(self):
            return types.SimpleNamespace(data=receipt)
    monkeypatch.setattr(sys.modules['supabase'], 'create_client', lambda *_a: Query())
    with pytest.raises(h.outcomes.DiscoveryFailure):
        h.news_source._fetch_brand_names('c1')


class DB:
    def __init__(self):
        self.tables = {
            'companies': [dict(id=c, corp_name='Fixture', corp_code='fixture',
                               funding_brief_md='retained brief', funding_brief_at='prior',
                               funding_last_collected_at='prior') for c in ('c1', 'c2')],
            'funding_rounds': [dict(id='old-'+c, company_id=c, source_type='news',
                                   source_ref='old-url', amount_krw=900) for c in ('c1', 'c2')],
            'funding_collection_jobs': [dict(id=j, company_id=c, status='pending', requested_by='user')
                                        for j, c in (('j1', 'c1'), ('j2', 'c2'))],
        }
        self.calls, self.lookup_failure, self.queue_failure, self.failed_ack = [], False, False, False

    def table(self, name):
        assert name in self.tables
        return Query(self, name)


class Query:
    def __init__(self, db, name):
        self.db, self.name, self.op, self.payload = db, name, 'select', None
        self.filters, self.maximum, self.is_single = [], None, False
        self.bounds, self.options = None, {}
    def select(self, *_a, **_kw):
        return self
    def eq(self, key, value):
        self.filters.append((key, value))
        return self
    def single(self):
        self.is_single = True
        return self
    def order(self, *_a):
        return self
    def limit(self, value):
        self.maximum = value
        return self
    def range(self, lower, upper):
        self.bounds = lower, upper
        return self
    def update(self, value):
        self.op, self.payload = 'update', value
        return self
    def delete(self):
        self.op = 'delete'
        return self
    def upsert(self, value, **_kw):
        self.op, self.payload = 'upsert', value
        self.options = _kw
        return self
    def execute(self):
        selected = [r for r in self.db.tables[self.name]
                    if all(r.get(k) == v for k, v in self.filters)]
        self.db.calls.append((self.name, self.op, copy.deepcopy(self.payload)))
        if self.db.lookup_failure and self.name == 'companies' and self.op == 'select' and self.filters == [('id', 'c1')]:
            raise RuntimeError('fixture company lookup failed')
        if self.db.queue_failure and self.name == 'funding_collection_jobs' and self.op == 'select':
            raise RuntimeError('fixture queue failed')
        if self.op == 'update':
            if self.name == 'funding_collection_jobs' and self.payload.get('status') == 'failed' and self.db.failed_ack:
                return types.SimpleNamespace(data=[])
            for r in selected:
                r.update(copy.deepcopy(self.payload))
        elif self.op == 'delete':
            self.db.tables[self.name] = [r for r in self.db.tables[self.name] if r not in selected]
        elif self.op == 'upsert':
            selected = []
            for incoming in self.payload:
                key = tuple(incoming.get(k) for k in ('company_id', 'source_type', 'source_ref'))
                previous = next((row for row in self.db.tables[self.name] if
                                 key == tuple(row.get(k) for k in ('company_id', 'source_type', 'source_ref'))), None)
                if previous and self.options.get('ignore_duplicates'):
                    continue
                if previous:
                    previous.update(copy.deepcopy(incoming))
                    selected.append(copy.deepcopy(previous))
                else:
                    row = dict(copy.deepcopy(incoming), id='fixture-'+str(len(self.db.tables[self.name])))
                    self.db.tables[self.name].append(row)
                    selected.append(copy.deepcopy(row))
        if self.maximum is not None:
            selected = selected[:self.maximum]
        if self.bounds is not None:
            selected = selected[self.bounds[0]:self.bounds[1] + 1]
        data = copy.deepcopy(selected)
        if self.is_single:
            assert len(data) == 1
            data = data[0]
        return types.SimpleNamespace(data=data)


def setup_collection(h, monkeypatch, failed_source=None):
    db = DB()
    monkeypatch.setattr(h.orchestrator, '_supabase', lambda: db)
    candidate = dict(source_type='news', source_ref='https://fixture/new', amount_krw=200,
                     announced_date='2026-06-01', round_type='series-A', investors=['investor'], confidence=0.8)
    async def empty(*_a, **_kw):
        return []
    async def news(*_a, **_kw):
        return [copy.deepcopy(candidate)]
    async def failed(*_a, **_kw):
        raise h.outcomes.DiscoveryFailure('fixture_source_failure')
    def failed_sync(*_a):
        raise h.outcomes.DiscoveryFailure('fixture_source_failure')
    monkeypatch.setattr(h.orchestrator, 'fetch_dart_rounds', failed if failed_source == 'dart' else empty)
    monkeypatch.setattr(h.orchestrator, 'fetch_audit_rounds', failed_sync if failed_source == 'audit' else lambda *_a: [])
    monkeypatch.setattr(h.orchestrator, 'fetch_news_rounds', failed if failed_source == 'news' else news)
    monkeypatch.setattr(h.orchestrator, 'fetch_datago_rounds', failed if failed_source == 'datago' else empty)
    return db


@pytest.mark.parametrize('source', ['dart', 'audit', 'news', 'datago'])
def test_failure_gate_preserves_rows_brief_freshness_no_notification(h, monkeypatch, source):
    db = setup_collection(h, monkeypatch, source)
    before = copy.deepcopy((db.tables['companies'], db.tables['funding_rounds']))
    monkeypatch.setattr(h.orchestrator, 'merge_rounds', lambda *_a: pytest.fail('Merge after failure'))
    result = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert result['error'] == 'funding_source_discovery_failed' and result['errors']
    assert (db.tables['companies'], db.tables['funding_rounds']) == before
    assert db.tables['funding_collection_jobs'][0]['status'] == 'failed'
    assert db.tables['funding_collection_jobs'][0]['error'] == result['error']
    assert db.tables['funding_collection_jobs'][1]['status'] == 'pending'
    assert h.effects == []


def test_positive_collection_retains_production_success_behavior(h, monkeypatch):
    db = setup_collection(h, monkeypatch)
    second = copy.deepcopy((db.tables['companies'][1], db.tables['funding_rounds'][1]))
    result = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert 'error' not in result and result['rounds_found'] == 1
    assert result['by_source'] == {'news': 1} and result['brief_preview'] == 'fixture brief'
    assert db.tables['companies'][0]['funding_brief_md'] == 'fixture brief'
    assert db.tables['companies'][0]['funding_last_collected_at'] != 'prior'
    assert db.tables['funding_collection_jobs'][0]['status'] == 'done'
    assert db.tables['funding_collection_jobs'][0]['rounds_found'] == 1
    assert any(r['source_ref'] == 'https://fixture/new' for r in db.tables['funding_rounds'])
    assert any(r['id'] == 'old-c1' for r in db.tables['funding_rounds'] if 'id' in r)
    assert (db.tables['companies'][1], next(r for r in db.tables['funding_rounds'] if r['company_id'] == 'c2')) == second
    assert h.effects[0] == 'brief' and h.effects[1]['event_type'] == 'funding_collection_done'


def test_failed_terminal_ack_is_reported_without_claiming_persisted(h, monkeypatch):
    db = setup_collection(h, monkeypatch, 'news')
    db.failed_ack = True
    result = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert result['job_error'] == 'failed_status_ack_unverified'
    assert db.tables['funding_collection_jobs'][0]['status'] == 'running'
    assert h.effects == []


def test_source_failure_dry_run_writes_nothing(h, monkeypatch):
    db = setup_collection(h, monkeypatch, 'news')
    before = copy.deepcopy(db.tables)
    result = run(h.orchestrator.run_job('c1', dry_run=True, job_id='j1'))
    assert result['error'] and db.tables == before and h.effects == []
    assert all(op == 'select' for _, op, _ in db.calls)


@pytest.mark.parametrize('lookup', [False, True])
def test_failed_first_job_does_not_starve_later_limit_one(h, monkeypatch, lookup):
    db = setup_collection(h, monkeypatch, None if lookup else 'news')
    db.lookup_failure = lookup
    first = run(h.orchestrator.poll_pending(1))
    assert first == dict(ok=False, processed=1, failed=1)
    assert db.tables['funding_collection_jobs'][0]['status'] == 'failed'
    if not lookup:
        async def empty(*_a, **_kw):
            return []
        monkeypatch.setattr(h.orchestrator, 'fetch_news_rounds', empty)
    second = run(h.orchestrator.poll_pending(1))
    assert second == dict(ok=True, processed=1, failed=0)
    assert db.tables['funding_collection_jobs'][1]['status'] == 'done'


def test_cli_poll_and_queue_error_truthful(h, monkeypatch):
    db = setup_collection(h, monkeypatch, 'news')
    cli = importlib.import_module('worker.main')
    assert run(cli._run_funding('c1', False)) == 1
    assert run(cli._run_funding_poll(1)) == 1
    db.queue_failure = True
    assert run(h.orchestrator.poll_pending(1))['error'] == 'funding_queue_read_failed'
    assert run(cli._run_funding_poll(1)) == 1
    db.queue_failure = False
    db.tables['funding_collection_jobs'] = []
    assert run(cli._run_funding_poll(1)) == 0


def test_positive_cli_and_poll(h, monkeypatch):
    setup_collection(h, monkeypatch)
    cli = importlib.import_module('worker.main')
    assert run(cli._run_funding('c1', False)) == 0
    assert run(cli._run_funding_poll(2)) == 0


def test_missing_queue_receipt_is_failure_not_healthy_empty(h, monkeypatch):
    setup_collection(h, monkeypatch)
    monkeypatch.setattr(h.orchestrator, '_supabase', lambda: types.SimpleNamespace(
        table=lambda *_a: types.SimpleNamespace(select=lambda *_a: query)))
    query = types.SimpleNamespace(eq=lambda *_a: query, order=lambda *_a: query,
                                  limit=lambda *_a: query, execute=lambda: types.SimpleNamespace(data=None))
    assert run(h.orchestrator.poll_pending(1)) == dict(ok=False, processed=0, failed=0,
                                                      error='funding_queue_read_failed')


@pytest.mark.parametrize('document', [None, '', '   ', {}, b'<table/>', '<table></table>',
                                     '<html>Access denied</html>', '<table>자본변동표</table>',
                                     '<table>자본금 기초 1,000'])
def test_actual_audit_missing_or_malformed_html_fails(h, document):
    report = types.SimpleNamespace(rcept_no='fixture', pages=[types.SimpleNamespace(
        title='자본변동표', html=document)])
    with pytest.raises(h.outcomes.DiscoveryFailure):
        h.audit_source._parse_report_sce(report, 2025, 'fixture')


@pytest.mark.parametrize('pages', [None, [], {}])
def test_actual_audit_missing_pages_or_title_fails(h, pages):
    with pytest.raises(h.outcomes.DiscoveryFailure):
        h.audit_source._parse_report_sce(types.SimpleNamespace(pages=pages), 2025, 'fixture')


def test_actual_audit_valid_no_financing_and_positive_documents(h):
    def report(text):
        return types.SimpleNamespace(rcept_no='20260101000001', pages=[types.SimpleNamespace(
            title='자본변동표', html='<table><tr><td>'+text+'</td></tr></table>')])
    assert h.audit_source._parse_report_sce(report('자본변동표 기초 자본금 1,000 기말 1,000'),
                                           2025, 'fixture') == (None, True)
    round_, found = h.audit_source._parse_report_sce(
        report('자본변동표 자본금 기초 유상증자 1,000'), 2025, 'fixture')
    assert found and round_['amount_krw'] == 1000 and round_['source_type'] == 'dart_audit'


@pytest.mark.parametrize('error', ['no-data', 'auth', 'network', 'parse', 'lookalike'])
def test_audit_only_documented_search_no_data_is_empty(h, monkeypatch, error):
    known = sys.modules['dart_fss.errors'].NoDataReceived
    class Lookalike(ValueError):
        pass
    errors = {'no-data': known('fixture 013'), 'auth': ValueError('fixture 010'),
              'network': RuntimeError('fixture network'), 'parse': TypeError('fixture parse'),
              'lookalike': Lookalike('No data received')}
    def search(**_kw):
        raise errors[error]
    monkeypatch.setenv('DART_API_KEY', 'fixture')
    monkeypatch.setattr(sys.modules['dart_fss'], 'get_corp_list', lambda: [types.SimpleNamespace(
        corp_code='fixture', search_filings=search)])
    if error == 'no-data':
        assert h.audit_source.fetch_audit_rounds('fixture') == []
    else:
        with pytest.raises(h.outcomes.DiscoveryFailure, match='audit_search_failed'):
            h.audit_source.fetch_audit_rounds('fixture')


def test_no_data_during_document_loading_is_failure_not_empty(h, monkeypatch):
    monkeypatch.setenv('DART_API_KEY', 'fixture')
    report = types.SimpleNamespace(report_nm='감사보고서 (2025.12)')
    monkeypatch.setattr(sys.modules['dart_fss'], 'get_corp_list', lambda: [types.SimpleNamespace(
        corp_code='fixture', search_filings=lambda **_kw: [report])])
    def parse(*_a):
        raise sys.modules['dart_fss.errors'].NoDataReceived('fixture document missing')
    monkeypatch.setattr(h.audit_source, '_parse_report_sce', parse)
    with pytest.raises(h.outcomes.DiscoveryFailure, match='audit_parser_failed'):
        h.audit_source.fetch_audit_rounds('fixture')


def actual_news_fixture(h, monkeypatch, body_policy='alternate', count=1):
    attempts = []
    monkeypatch.setenv('NAVER_CLIENT_ID', 'fixture')
    monkeypatch.setenv('NAVER_CLIENT_SECRET', 'fixture')
    monkeypatch.setattr(h.news_source.time, 'sleep', lambda *_a: None)
    class Client:
        def __init__(self, **_kw):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *_a):
            pass
        def get(self, url, **_kw):
            if 'openapi.naver.com' in url:
                items = [dict(title='Fixture 투자 유치', description='Fixture 투자 유치 API description',
                              link=f'https://n.news.naver.com/{i}', originallink=f'https://fixture.invalid/{i}')
                         for i in range(count)]
                return types.SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'items': items})
            attempts.append(url)
            if body_policy == 'http' or ('naver.com' in url and body_policy == 'alternate'):
                raise RuntimeError('fixture HTTP failure')
            text = 'short' if body_policy == 'short' else '<p>'+'Fixture 투자 유치 '*25+'</p>'
            return types.SimpleNamespace(raise_for_status=lambda: None, text=text)
    monkeypatch.setattr(sys.modules['httpx'], 'Client', Client)
    monkeypatch.setattr(h.extractor, 'extract_json', lambda *_a: {'rounds': [dict(
        company='Fixture', round_type='series-A', amount_krw=200, investors=['investor'],
        announced_date='2026-06-01', confidence=0.8)]})
    return attempts


def test_nonempty_actual_news_end_to_end_url_fallback_and_nlp(h, monkeypatch):
    attempts = actual_news_fixture(h, monkeypatch)
    rounds = run(h.news_source.fetch_news_rounds('Fixture', 'Fixture'))
    assert len(rounds) == 1 and rounds[0]['source_ref'] == 'https://fixture.invalid/0'
    assert rounds[0]['amount_krw'] == 200 and rounds[0]['investors'] == ['investor']
    assert attempts == ['https://n.news.naver.com/0', 'https://fixture.invalid/0']


@pytest.mark.parametrize('policy', ['http', 'short'])
def test_actual_news_body_failure_does_not_use_rich_description(h, monkeypatch, policy):
    actual_news_fixture(h, monkeypatch, policy)
    with pytest.raises(h.outcomes.DiscoveryFailure, match='article_body_unavailable'):
        run(h.news_source.fetch_news_rounds('Fixture', 'Fixture'))


def test_actual_news_later_description_is_declared_bounded_policy(h, monkeypatch):
    attempts = actual_news_fixture(h, monkeypatch, 'good', count=6)
    rounds = run(h.news_source.fetch_news_rounds('Fixture', 'Fixture'))
    assert len(rounds) == 6 and len(attempts) == 5
    assert rounds[5]['raw']['article_excerpt'] == 'Fixture 투자 유치 API description'


def test_actual_news_success_and_failure_reach_real_gate(h, monkeypatch):
    db = setup_collection(h, monkeypatch)
    db.tables['brands'] = []
    db.from_ = db.table
    monkeypatch.setenv('SUPABASE_URL', 'https://fixture.invalid')
    monkeypatch.setenv('SUPABASE_SERVICE_KEY', 'fixture')
    monkeypatch.setattr(sys.modules['supabase'], 'create_client', lambda *_a: db)
    monkeypatch.setattr(h.orchestrator, 'fetch_news_rounds', h.news_source.fetch_news_rounds)
    actual_news_fixture(h, monkeypatch)
    success = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert success['rounds_found'] == 1 and not success.get('error')
    assert db.tables['funding_collection_jobs'][0]['status'] == 'done'
    before = copy.deepcopy((db.tables['companies'], db.tables['funding_rounds']))
    h.effects.clear()
    actual_news_fixture(h, monkeypatch, 'short')
    failed = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert failed['error'] == 'funding_source_discovery_failed'
    assert (db.tables['companies'], db.tables['funding_rounds']) == before and not h.effects


def test_actual_audit_missing_html_reaches_gate_and_preserves_publication(h, monkeypatch):
    db = setup_collection(h, monkeypatch)
    before = copy.deepcopy((db.tables['companies'], db.tables['funding_rounds']))
    report = types.SimpleNamespace(report_nm='감사보고서 (2025.12)', rcept_no='fixture',
                                   pages=[types.SimpleNamespace(title='자본변동표', html=None)])
    monkeypatch.setenv('DART_API_KEY', 'fixture')
    monkeypatch.setattr(sys.modules['dart_fss'], 'get_corp_list', lambda: [types.SimpleNamespace(
        corp_code='fixture', search_filings=lambda **_kw: [report])])
    monkeypatch.setattr(h.orchestrator, 'fetch_audit_rounds', h.audit_source.fetch_audit_rounds)
    result = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert result['error'] == 'funding_source_discovery_failed'
    assert (db.tables['companies'], db.tables['funding_rounds']) == before and not h.effects


class SDKPage:
    """Synthetic shape of SDK title/html properties; not a saved DART document."""
    def __init__(self, title, document):
        self.title, self._document = title, document
    @property
    def html(self):
        return self._document


@pytest.mark.parametrize('title,labels', [
    ('자 본 변 동 표 (별도)', '자 본 금 기 초 유 상 증 자 1,000'),
    ('자본변동표 / Statement of Changes in Equity', '자본금 기말 유상증자 1,000'),
    ('자&nbsp;본&nbsp;변&nbsp;동&nbsp;표', '자&nbsp;본&nbsp;금 기&nbsp;초 유&nbsp;상&nbsp;증&nbsp;자 1,000'),
])
def test_synthetic_sdk_spacing_layout_and_unrelated_untitled_page(h, title, labels):
    # Table/div/presentation layouts and spaced labels are synthetic examples.
    document = '<div><table><tbody><tr><td>'+labels+'</td></tr></tbody></table></div>'
    report = types.SimpleNamespace(rcept_no='fixture', pages=[SDKPage(None, None),
                                    SDKPage('사업의 내용', None), SDKPage(title, document)])
    round_, found = h.audit_source._parse_report_sce(report, 2025, 'fixture')
    assert found and round_['amount_krw'] == 1000


def test_untitled_only_report_is_unverified_section_not_no_financing(h):
    report = types.SimpleNamespace(pages=[SDKPage(None, None)])
    assert h.audit_source._parse_report_sce(report, 2025, 'fixture') == (None, False)


def test_synthetic_spaced_valid_negative_statement(h):
    report = types.SimpleNamespace(pages=[SDKPage('자 본 변 동 표',
        '<table><tr><td>기 초 자 본 금 1,000 기 말 1,000</td></tr></table>')])
    assert h.audit_source._parse_report_sce(report, 2025, 'fixture') == (None, True)


@pytest.mark.parametrize('stage', ['later-query', 'later-extraction'])
def test_actual_news_later_failure_after_earlier_valid_discovery_reaches_gate(h, monkeypatch, stage):
    db = setup_collection(h, monkeypatch)
    db.tables['brands'] = []
    db.from_ = db.table
    monkeypatch.setenv('SUPABASE_URL', 'https://fixture.invalid')
    monkeypatch.setenv('SUPABASE_SERVICE_KEY', 'fixture')
    monkeypatch.setattr(sys.modules['supabase'], 'create_client', lambda *_a: db)
    monkeypatch.setattr(h.orchestrator, 'fetch_news_rounds', h.news_source.fetch_news_rounds)
    actual_news_fixture(h, monkeypatch, 'good', count=2)
    before = copy.deepcopy((db.tables['companies'], db.tables['funding_rounds']))
    searches, extractions = [], []
    if stage == 'later-query':
        original = h.news_source._naver_search
        def search(*args):
            searches.append(args[-1])
            if len(searches) == 2:
                raise h.outcomes.DiscoveryFailure('fixture_later_query_failed')
            return original(*args)
        monkeypatch.setattr(h.news_source, '_naver_search', search)
    else:
        original = h.extractor.extract_json
        def extract(*args):
            extractions.append(args[0])
            if len(extractions) == 2:
                raise RuntimeError('fixture_later_extraction_failed')
            return original(*args)
        monkeypatch.setattr(h.extractor, 'extract_json', extract)
    result = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert result['error'] == 'funding_source_discovery_failed'
    assert len(searches if stage == 'later-query' else extractions) == 2
    assert (db.tables['companies'], db.tables['funding_rounds']) == before and not h.effects
