"""Persistence boundaries against an independent, deterministic PostgREST double."""
import copy
from types import SimpleNamespace

import pytest

from worker.tests.test_funding_adapter_slice import DB, Query, run, setup_collection
from worker.tests.test_funding_adapter_slice import h as h


class StorageDB(DB):
    def __init__(self):
        super().__init__()
        self.upsert_count = 0
        self.fail_chunk = None
        self.round_receipt = 'normal'
        self.done_receipt = 'normal'
        self.serial = 0
        self.history_receipt = 'normal'
        self.company_receipt = 'normal'
        self.running_receipt = 'normal'
        self.history_ranges = []

    def table(self, name):
        return StorageQuery(self, name)


class StorageQuery(Query):
    def __init__(self, db, name):
        super().__init__(db, name)
        self.options = {}
        self.bounds = None

    def upsert(self, value, **options):
        super().upsert(value, **options)
        self.options = options
        return self

    def range(self, lower, upper):
        self.bounds = lower, upper
        return self

    def execute(self):
        if self.op == 'upsert':
            self.db.upsert_count += 1
            self.db.calls.append((self.name, self.op, copy.deepcopy(self.payload)))
            if self.db.fail_chunk == self.db.upsert_count:
                raise RuntimeError('deterministic chunk failure')
            if self.db.round_receipt == 'silent_no_write':
                return SimpleNamespace(data=copy.deepcopy(self.payload))
            written = []
            for incoming in self.payload:
                key = tuple(incoming.get(k) for k in ('company_id', 'source_type', 'source_ref'))
                existing = next((r for r in self.db.tables[self.name]
                                 if key == tuple(r.get(k) for k in
                                                 ('company_id', 'source_type', 'source_ref'))), None)
                if existing and self.options.get('ignore_duplicates'):
                    continue
                if existing:
                    existing.update(copy.deepcopy(incoming))
                    written.append(copy.deepcopy(existing))
                else:
                    self.db.serial += 1
                    stored = dict(copy.deepcopy(incoming), id=f'new-{self.db.serial}')
                    self.db.tables[self.name].append(stored)
                    written.append(copy.deepcopy(stored))
            receipt = written
            if self.db.round_receipt == 'missing':
                receipt = None
            elif self.db.round_receipt == 'malformed':
                receipt = {}
            elif self.db.round_receipt == 'foreign':
                receipt = [dict(row, company_id='c2') for row in written]
            elif self.db.round_receipt == 'duplicate':
                receipt = written + written
            return SimpleNamespace(data=receipt)
        result = super().execute()
        if self.name == 'funding_rounds' and self.op == 'select':
            self.db.history_ranges.append(self.bounds)
            if self.db.history_receipt == 'missing':
                result.data = None
            elif self.db.history_receipt == 'foreign':
                result.data = [dict(result.data[0], company_id='c2')]
        if self.name == 'companies' and self.op == 'update':
            if self.db.company_receipt == 'missing':
                result.data = None
            elif self.db.company_receipt == 'wrong_brief':
                result.data[0]['funding_brief_md'] = 'unrelated publication'
            elif self.db.company_receipt == 'wrong_id':
                result.data[0]['id'] = 'c2'
            elif self.db.company_receipt == 'wrong_time':
                result.data[0]['funding_last_collected_at'] = '2000-01-01T00:00:00+00:00'
            elif self.db.company_receipt == 'normalized_time':
                for field in ('funding_brief_at', 'funding_last_collected_at'):
                    result.data[0][field] = result.data[0][field].replace('+00:00', 'Z')
        if self.name == 'funding_collection_jobs' and self.op == 'update' and \
                self.payload.get('status') == 'running' and self.db.running_receipt == 'missing':
            result.data = []
        if self.name == 'funding_collection_jobs' and self.op == 'update' and \
                self.payload.get('status') == 'done' and self.db.done_receipt == 'missing':
            result.data = []
        elif self.name == 'funding_collection_jobs' and self.op == 'update' and \
                self.payload.get('status') == 'done' and self.db.done_receipt == 'wrong_count':
            result.data[0]['rounds_found'] = 999
        return result


@pytest.fixture
def storage(h, monkeypatch):
    setup_collection(h, monkeypatch)
    db = StorageDB()
    monkeypatch.setattr(h.orchestrator, '_supabase', lambda: db)
    return db


def test_success_retains_preexisting_historical_row(h, storage):
    old = copy.deepcopy(storage.tables['funding_rounds'][0])
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert not outcome.get('error')
    assert old in storage.tables['funding_rounds']


def test_confirmed_empty_discovery_cannot_erase_history(h, storage, monkeypatch):
    async def empty(*args, **kwargs):
        return []
    monkeypatch.setattr(h.orchestrator, 'fetch_news_rounds', empty)
    old = copy.deepcopy(storage.tables['funding_rounds'])
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert not outcome.get('error')
    assert storage.tables['funding_rounds'] == old


def test_later_chunk_failure_does_not_publish_success_or_freshness(h, storage, monkeypatch):
    async def many(*args, **kwargs):
        return [dict(source_type='news', source_ref=f'fixture:{i}', amount_krw=i,
                     confidence=0.8) for i in range(101)]
    monkeypatch.setattr(h.orchestrator, 'fetch_news_rounds', many)
    storage.fail_chunk = 2
    old_company = copy.deepcopy(storage.tables['companies'][0])
    old_history = copy.deepcopy(storage.tables['funding_rounds'][0])
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert outcome.get('error')
    assert old_history in storage.tables['funding_rounds']
    assert storage.tables['companies'][0] == old_company
    assert storage.tables['funding_collection_jobs'][0]['status'] != 'done'
    assert not any(isinstance(effect, dict) for effect in h.effects)


def test_missing_round_write_receipt_is_not_assumed_success(h, storage):
    storage.round_receipt = 'missing'
    company = copy.deepcopy(storage.tables['companies'][0])
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert outcome.get('error')
    assert storage.tables['companies'][0] == company
    assert storage.tables['funding_collection_jobs'][0]['status'] != 'done'


def test_unverified_done_receipt_cannot_trigger_completion_notification(h, storage):
    storage.done_receipt = 'missing'
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert outcome.get('error')
    assert not any(isinstance(effect, dict) for effect in h.effects)


def test_wrong_terminal_count_receipt_is_not_success(h, storage):
    storage.done_receipt = 'wrong_count'
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert outcome['error'] == 'funding_done_ack_unverified'
    assert not any(isinstance(effect, dict) for effect in h.effects)


def test_positive_dry_run_never_updates_job(h, storage):
    before = copy.deepcopy(storage.tables)
    outcome = run(h.orchestrator.run_job('c1', dry_run=True, job_id='j1'))
    assert not outcome.get('error')
    assert storage.tables == before


def test_retry_after_partial_chunk_failure_keeps_first_chunk_and_never_duplicates(h, storage, monkeypatch):
    async def many(*args, **kwargs):
        return [dict(source_type='news', source_ref=f'fixture:{i}', amount_krw=i,
                     confidence=0.8) for i in range(101)]
    monkeypatch.setattr(h.orchestrator, 'fetch_news_rounds', many)
    storage.fail_chunk = 2
    failed = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert failed.get('error')
    assert len([row for row in storage.tables['funding_rounds'] if row['company_id'] == 'c1']) == 101
    storage.fail_chunk = None
    retried = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert not retried.get('error') and retried['rounds_found'] == 101
    assert retried['rounds_inserted'] == 1
    rows = [row for row in storage.tables['funding_rounds'] if row['company_id'] == 'c1']
    assert len(rows) == 102 and len({row['source_ref'] for row in rows}) == 102
    assert storage.tables['funding_collection_jobs'][0]['error'] is None


def test_ambiguous_committed_insert_is_safe_to_retry_with_empty_duplicate_receipt(h, storage):
    storage.round_receipt = 'missing'
    failed = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert failed['error'] == 'funding_rounds_ack_unverified'
    before = copy.deepcopy(storage.tables['funding_rounds'])
    storage.round_receipt = 'normal'
    retried = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert not retried.get('error') and retried['rounds_inserted'] == 0
    assert storage.tables['funding_rounds'] == before


def test_same_source_identity_never_overwrites_or_reclassifies_legacy_payload(h, storage, monkeypatch):
    original = storage.tables['funding_rounds'][0]
    original.update(confidence=0.2, investors=['historical'], raw={'retained': True},
                    announced_date='2025-01-01', source_url='historical-url')
    before = copy.deepcopy(original)
    async def rediscovered(*args, **kwargs):
        return [dict(source_type='news', source_ref='old-url', amount_krw=1,
                     confidence=0.8, investors=[], raw=None)]
    seen = []
    async def brief(name, history):
        seen.extend(copy.deepcopy(history))
        return 'historical brief'
    monkeypatch.setattr(h.orchestrator, 'fetch_news_rounds', rediscovered)
    monkeypatch.setattr(h.orchestrator, 'generate_brief', brief)
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert not outcome.get('error') and outcome['rounds_inserted'] == 0
    assert original == before and seen == [before]


@pytest.mark.parametrize('identity', [None, '', '   '])
def test_missing_retry_identity_rejects_whole_candidate_before_any_round_write(h, storage, monkeypatch, identity):
    async def discovered(*args, **kwargs):
        return [dict(source_type='news', source_ref='valid-ref', confidence=0.8),
                dict(source_type='news', source_ref=identity, confidence=0.8)]
    monkeypatch.setattr(h.orchestrator, 'fetch_news_rounds', discovered)
    before = copy.deepcopy((storage.tables['companies'], storage.tables['funding_rounds']))
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert outcome['error'] == 'funding_source_identity_invalid'
    assert outcome['round_writes_may_have_committed'] is False
    assert (storage.tables['companies'], storage.tables['funding_rounds']) == before
    assert storage.upsert_count == 0


@pytest.mark.parametrize('receipt', ['malformed', 'foreign', 'duplicate', 'silent_no_write'])
def test_invalid_round_receipt_or_unconfirmed_presence_stops_publication(h, storage, receipt):
    storage.round_receipt = receipt
    company = copy.deepcopy(storage.tables['companies'][0])
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert outcome.get('error') and outcome['publication_stage'] == 'rounds'
    assert storage.tables['companies'][0] == company
    assert storage.tables['funding_collection_jobs'][0]['status'] == 'failed'
    assert not h.effects


@pytest.mark.parametrize('receipt', ['missing', 'foreign'])
def test_unverified_history_read_never_publishes_partial_brief(h, storage, receipt):
    storage.history_receipt = receipt
    company = copy.deepcopy(storage.tables['companies'][0])
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert outcome['error'] == 'funding_history_ack_unverified'
    assert storage.tables['companies'][0] == company and not h.effects


def test_full_history_brief_pages_past_postgrest_default_limit_and_keeps_null_refs(h, storage, monkeypatch):
    legacy = [dict(id=f'legacy-{i:04}', company_id='c1', source_type='news',
                   source_ref=None, amount_krw=None, confidence=0.2) for i in range(1001)]
    storage.tables['funding_rounds'].extend(copy.deepcopy(legacy))
    seen = []
    async def brief(name, history):
        seen.extend(copy.deepcopy(history))
        return 'complete history fixture'
    monkeypatch.setattr(h.orchestrator, 'generate_brief', brief)
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert not outcome.get('error') and outcome['history_rounds'] == 1003
    assert all(row in seen for row in legacy)
    assert len(storage.history_ranges) == 11
    assert storage.history_ranges[-1] == (1000, 1099)


@pytest.mark.parametrize('receipt', ['missing', 'wrong_brief', 'wrong_id', 'wrong_time'])
def test_ambiguous_company_publication_is_reported_without_done_or_notification(h, storage, receipt):
    storage.company_receipt = receipt
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert outcome['error'] == 'funding_company_ack_unverified'
    assert outcome['publication_stage'] == 'company_publication'
    assert storage.tables['funding_collection_jobs'][0]['status'] == 'failed'
    assert not any(isinstance(effect, dict) for effect in h.effects)
    # The request may have committed; do not invent client-side rollback proof.
    assert storage.tables['companies'][0]['funding_brief_md'] == 'fixture brief'


def test_equivalent_postgres_timestamp_representation_is_verified(h, storage):
    storage.company_receipt = 'normalized_time'
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert not outcome.get('error')


def test_unverified_running_status_stops_before_source_or_model_calls(h, storage):
    storage.running_receipt = 'missing'
    before = copy.deepcopy(storage.tables['funding_rounds'])
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert outcome['error'] == 'funding_job_start_ack_unverified'
    assert storage.upsert_count == 0 and storage.tables['funding_rounds'] == before
    assert not h.effects


@pytest.mark.parametrize('failure', ['generation', 'empty'])
def test_brief_failure_keeps_prior_brief_and_freshness_after_additive_storage(h, storage, monkeypatch, failure):
    async def invalid_brief(*args):
        if failure == 'generation':
            raise RuntimeError('fixture generation failed')
        return ''
    monkeypatch.setattr(h.orchestrator, 'generate_brief', invalid_brief)
    before = copy.deepcopy(storage.tables['companies'][0])
    outcome = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert outcome.get('error') and storage.tables['companies'][0] == before
    assert storage.tables['funding_collection_jobs'][0]['status'] == 'failed'


def test_current_brief_prompt_accepts_legacy_null_confidence_without_model_calls():
    import ast
    import json
    from datetime import date
    from pathlib import Path
    source = Path(__file__).parents[1] / 'funding/brief_writer.py'
    tree = ast.parse(source.read_text())
    tree.body = [node for node in tree.body if not isinstance(node, (ast.Import, ast.ImportFrom))]
    namespace = {'json': json, 'date': date}
    exec(compile(tree, str(source), 'exec'), namespace)
    prompt = namespace['_build_prompt']('fixture', [dict(amount_krw=900, confidence=None,
                                                        source_type='news')])
    assert '900원' in prompt


def test_native_postgrest_builder_requests_ignore_conflicts_with_returned_rows():
    from postgrest.base_request_builder import pre_upsert
    from postgrest.types import ReturnMethod
    _, params, headers, _ = pre_upsert(
        [dict(company_id='fixture', source_type='news', source_ref='fixture:1')],
        count=None, returning=ReturnMethod.representation,
        ignore_duplicates=True, on_conflict='company_id,source_type,source_ref',
    )
    assert 'resolution=ignore-duplicates' in headers['Prefer']
    assert 'return=representation' in headers['Prefer']
    assert params['on_conflict'] == 'company_id,source_type,source_ref'
