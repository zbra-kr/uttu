"""Offline query/formatter regression; no DB, API or model execution."""
import ast
import copy
import json
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest
from postgrest import SyncPostgrestClient

from worker.agent import _briefing_queries as queries
from worker.detectors.rank_observation import LEGACY_RANK_RULES, urgent_notification_eligible

DAY = date(2026, 10, 10)


def split_terms(expression):
    depth = 0
    start = 0
    terms = []
    for i, char in enumerate(expression):
        depth += (char == '(') - (char == ')')
        if char == ',' and depth == 0:
            terms.append(expression[start:i])
            start = i + 1
    return terms + [expression[start:]]


def evaluate(expression, row):
    """Evaluate emitted PostgREST subset with SQL UNKNOWN (None)."""
    if expression.startswith(('and(', 'or(')):
        conjunction = expression.startswith('and(')
        children = [evaluate(x, row) for x in split_terms(expression[4 if conjunction else 3:-1])]
        if conjunction:
            return False if False in children else None if None in children else True
        return True if True in children else None if None in children else False
    field, operation = expression.split('.', 1)
    value = ((row.get('meta') or {}).get('policy_version')
             if field == 'meta->>policy_version' else row.get(field))
    if operation == 'is.null':
        return value is None
    if operation == 'not.is.null':
        return value is not None
    if value is None:
        return None
    if operation.startswith('not.in.'):
        return value not in operation[8:-1].split(',')
    if operation.startswith('neq.'):
        return value != operation[4:]
    raise AssertionError(expression)


class Database:
    def __init__(self, rows, fail=False):
        self.rows = rows
        self.fail = fail
        self.calls = []

    def table(self, table):
        assert table == 'anomalies'
        query = Query(self)
        self.calls.append(query)
        return query


class Query:
    def __init__(self, db):
        self.db = db
        self.filters = []
        self.expression = None
        self.cap = None

    def select(self, columns):
        self.columns = columns
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def or_(self, expression):
        self.expression = expression
        return self

    def order(self, field):
        self.sort = field
        return self

    def limit(self, cap):
        self.cap = cap
        return self

    def execute(self):
        if self.db.fail:
            raise RuntimeError('synthetic query failure')
        rows = [r for r in self.db.rows if all(r.get(k) == v for k, v in self.filters)]
        if self.expression:
            rows = [r for r in rows if evaluate('or(' + self.expression + ')', r) is True]
        rows = sorted(rows, key=lambda r: r[self.sort])[:self.cap]
        return SimpleNamespace(data=copy.deepcopy(rows))


def row(rule='sold_out', meta=None, severity='high', index=0, **extra):
    return dict(id=f'signal-{index}', anomaly_type=rule, meta=meta,
                severity=severity, detected_at=index, detection_date='2026-10-09',
                entity_name='own-brand', description=f'evidence-{index}', **extra)


def formatter():
    source = Path(queries.__file__).with_name('briefing_writer.py')
    names = {'_j', '_header', '_format_executive_message', '_format_staff_message',
             '_format_cs_message', 'format_user_message'}
    nodes = [n for n in ast.parse(source.read_text()).body
             if isinstance(n, ast.FunctionDef) and n.name in names]
    env = {'json': json, 'date': date}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), env)
    return env['format_user_message']


@pytest.mark.parametrize('rule', sorted(LEGACY_RANK_RULES) + ['unknown_rule', 'sold_out', 'price_drop', 'review_spike', None])
@pytest.mark.parametrize('meta', [None, {}, {'policy_version': None},
                                  {'policy_version': 'legacy-rank-noise-v1'},
                                  {'policy_version': 'future-v2'}, {'policy_version': ''}])
def test_filter_truth_table_matches_existing_policy(rule, meta):
    item = row(rule, meta)
    expected = urgent_notification_eligible(SimpleNamespace(anomaly_type=rule, meta=meta or {}))
    assert bool(queries.fetch_anomalies(Database([item]), DAY, 'high')) == expected


def test_both_prompt_paths_recover_signal_after_twenty_legacy_rows():
    rows = [row('rank_spike', {}, index=i) for i in range(20)]
    rows += [row(index=20), row('rank_drop_own', {'policy_version': 'legacy-rank-noise-v1'}, 'medium', 21),
             row('price_drop', {}, 'medium', 22)]
    db = Database(rows)
    combined = queries.fetch_anomalies_combined(db, DAY)
    own = queries.fetch_anomalies_own_high(db, DAY, ['own-brand'])
    assert [r['id'] for r in combined['high']] == ['signal-20']
    assert [r['id'] for r in combined['medium']] == ['signal-22']
    assert own == combined['high']
    assert len(db.calls) == 3
    assert all(q.cap == 20 for q in db.calls)
    for audience, key, payload in [('staff', 'anomalies_all', combined),
                                   ('executive', 'anomalies_high_own', own)]:
        message = formatter()(audience, {'date': DAY, 'weekday': '토요일', key: payload})
        assert 'sold_out' in message
        assert '/anomaly?id=signal-20' in message
        assert 'rank_spike' not in message
        assert 'rank_drop_own' not in message


def test_date_severity_brand_and_fallback_contract():
    other = row(index=2)
    other['entity_name'] = 'competitor'
    wrong_date = row(index=3)
    wrong_date['detection_date'] = '2026-10-08'
    db = Database([row(index=1), other, wrong_date, row(severity='medium', index=4)])
    assert [r['id'] for r in queries.fetch_anomalies_own_high(db, DAY, ['own-brand'])] == ['signal-1']
    assert len(queries.fetch_anomalies_own_high(db, DAY, [])) == 2
    assert len(queries.fetch_anomalies_own_high(db, DAY, ['unmatched'])) == 2
    assert queries.fetch_anomalies(db, date(2026, 10, 9), 'high')[0]['id'] == 'signal-3'
    assert len(queries.fetch_anomalies_combined(db, DAY)['medium']) == 1


def test_limit_empty_and_error_contract():
    assert len(queries.fetch_anomalies(Database([row(index=i) for i in range(25)]), DAY, 'high')) == 20
    assert queries.fetch_anomalies_combined(Database([], fail=True), DAY) == {'high': [], 'medium': []}
    assert queries.fetch_anomalies_own_high(Database([], fail=True), DAY, ['own']) == []
    assert queries.fetch_anomalies(Database([]), DAY, 'high') == []


def test_missing_meta_and_meta_brand_match():
    missing = row('rank_spike', index=1)
    del missing['meta']
    unknown = row('unknown_rule', index=2)
    del unknown['meta']
    unknown['entity_name'] = 'competitor'
    own = row(meta={'brand_slug': 'own-brand'}, index=3)
    own['entity_name'] = 'product name'
    db = Database([missing, unknown, own])
    assert [r['id'] for r in queries.fetch_anomalies(db, DAY, 'high')] == ['signal-2', 'signal-3']
    assert [r['id'] for r in queries.fetch_anomalies_own_high(db, DAY, ['own-brand'])] == ['signal-3']


def test_real_sdk_serializes_one_bounded_query_without_execution():
    client = SyncPostgrestClient('https://offline.invalid')
    try:
        request = (client.table('anomalies').select('id').eq('detection_date', '2026-10-09')
                   .eq('severity', 'high').or_(queries._BRIEFING_ANOMALY_FILTER)
                   .order('detected_at').limit(20))
        assert request.request.params['or'] == '(' + queries._BRIEFING_ANOMALY_FILTER + ')'
        assert request.request.params['limit'] == '20'
        assert request.request.params['detection_date'] == 'eq.2026-10-09'
    finally:
        client.aclose()
