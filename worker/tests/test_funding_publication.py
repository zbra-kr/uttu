"""Exact prompt regressions with source/model/database boundaries stubbed."""
import ast
import copy
import json
from datetime import date
from pathlib import Path

from worker.tests.test_funding_adapter_slice import h as h
from worker.tests.test_funding_adapter_slice import run
from worker.tests.test_funding_persistence import StorageDB, StorageQuery
from worker.tests.test_funding_persistence import storage as storage


def prompt_builder():
    source = Path(__file__).parents[1] / 'funding/brief_writer.py'
    tree = ast.parse(source.read_text())
    tree.body = [node for node in tree.body if not isinstance(node, (ast.Import, ast.ImportFrom))]
    namespace = {'json': json, 'date': date}
    exec(compile(tree, str(source), 'exec'), namespace)
    return namespace['_build_prompt']


def collect(h, monkeypatch, db, news_amount, with_dart, prompts):
    async def news(**kwargs):
        return [dict(source_type='news', source_ref='fixture:news', source_url='https://fixture/news',
                     amount_krw=news_amount, confidence=0.8, announced_date='2024-03-10',
                     investors=['news investor'], note='retained source note')]
    async def dart(*args):
        return [dict(source_type='dart_piic', source_ref='fixture:dart', confidence=1.0,
                     amount_krw=1_000_000_000, announced_date='2024-03-01',
                     investors=['disclosure investor'])] if with_dart else []
    async def brief(name, rounds):
        prompts.append(prompt_builder()(name, rounds))
        return 'stub model output'
    monkeypatch.setattr(h.orchestrator, '_supabase', lambda: db)
    monkeypatch.setattr(h.orchestrator, 'fetch_news_rounds', news)
    monkeypatch.setattr(h.orchestrator, 'fetch_dart_rounds', dart)
    monkeypatch.setattr(h.orchestrator, 'generate_brief', brief)
    db.tables['companies'][0]['corp_code'] = 'fixture'
    return run(h.orchestrator.run_job('c1', job_id='j1'))


def test_one_batch_and_two_runs_publish_identical_reconciled_prompt(h, storage, monkeypatch):
    one, two = StorageDB(), StorageDB()
    for db in (one, two):
        db.tables['funding_rounds'] = []
    prompts = []
    outcome = collect(h, monkeypatch, one, 1_000_000_000, True, prompts)
    assert not outcome.get('error')
    assert outcome['rounds_found'] == outcome['observations_confirmed'] == 2
    assert outcome['publication_rounds'] == 1
    assert outcome['by_source'] == {'news': 1, 'dart_piic': 1}
    assert one.tables['funding_collection_jobs'][0]['rounds_found'] == 2
    assert '출처 기록 2건 확인 (라운드 수 아님)' in h.effects[-1]['body']
    together = prompts[-1]
    assert not collect(h, monkeypatch, two, 1_000_000_000, False, prompts).get('error')
    prior_news = copy.deepcopy(two.tables['funding_rounds'][0])
    assert not collect(h, monkeypatch, two, 1_000_000_000, True, prompts).get('error')
    assert prompts[-1] == together
    assert '투자유치 이력 (1건)' in together and together.count('### 라운드') == 1
    assert 'https://fixture/news' in together and 'retained source note' in together
    assert '별도 라운드 아님' in together and 'news investor' in together
    assert prior_news in two.tables['funding_rounds']
    assert len(one.tables['funding_rounds']) == len(two.tables['funding_rounds']) == 2


def test_prior_conflicting_news_then_dart_stops_before_model_publication_and_notification(h, storage, monkeypatch):
    storage.tables['funding_rounds'] = []
    prompts = []
    assert not collect(h, monkeypatch, storage, 9_000_000_000, False, prompts).get('error')
    before = copy.deepcopy(storage.tables['companies'][0])
    evidence = copy.deepcopy(storage.tables['funding_rounds'][0])
    h.effects.clear()
    prompts.clear()
    result = collect(h, monkeypatch, storage, 9_000_000_000, True, prompts)
    assert result['error'] == 'funding_history_source_conflict'
    assert storage.tables['companies'][0] == before and not prompts and not h.effects
    assert storage.tables['funding_collection_jobs'][0]['status'] == 'failed'
    assert evidence in storage.tables['funding_rounds']
    assert any(row['source_ref'] == 'fixture:dart' for row in storage.tables['funding_rounds'])


def test_short_nonterminal_server_pages_are_read_until_empty(h, storage, monkeypatch):
    rows = [dict(id=f'row-{i:03}', company_id='c1', source_type='news', source_ref=f'ref:{i}',
                 amount_krw=1, confidence=0.8) for i in range(80)]
    storage.tables['funding_rounds'] = copy.deepcopy(rows)
    original = StorageQuery.execute
    def capped(query):
        result = original(query)
        if query.name == 'funding_rounds' and query.op == 'select':
            result.data = result.data[:50]
        return result
    monkeypatch.setattr(StorageQuery, 'execute', capped)
    async def empty(**kwargs):
        return []
    monkeypatch.setattr(h.orchestrator, 'fetch_news_rounds', empty)
    seen = []
    async def brief(name, rounds):
        seen.extend(rounds)
        return 'all rows fixture'
    monkeypatch.setattr(h.orchestrator, 'generate_brief', brief)
    result = run(h.orchestrator.run_job('c1', job_id='j1'))
    assert not result.get('error') and result['history_rounds'] == 80
    assert len(seen) == 80 and all(row in seen for row in rows)
    assert storage.history_ranges == [(0, 99), (50, 149), (80, 179)]
