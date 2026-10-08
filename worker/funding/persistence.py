"""Additive funding persistence with explicit acknowledgment boundaries.

Existing source identities are immutable here. Corrections/versioning require a
separate policy. Individual requests are not a transaction across publication.
"""
from dataclasses import dataclass
from datetime import datetime, timezone


class PersistenceFailure(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


@dataclass
class PersistedRounds:
    history: list[dict]
    inserted: int
    confirmed: int


def _rows(response, code):
    rows = getattr(response, 'data', None)
    if getattr(response, 'error', None) is not None or not isinstance(rows, list) or \
            any(not isinstance(row, dict) for row in rows):
        raise PersistenceFailure(code)
    return rows


def _identity(row, company_id):
    if not isinstance(row, dict):
        raise PersistenceFailure('funding_source_identity_invalid')
    source_type, source_ref = row.get('source_type'), row.get('source_ref')
    if row.get('company_id') != company_id or not all(
        isinstance(value, str) and value.strip() for value in (source_type, source_ref)
    ):
        raise PersistenceFailure('funding_source_identity_invalid')
    return source_type, source_ref


def load_history(db, company_id):
    """Read every page without re-merging or filtering historical observations."""
    history, seen_ids = [], set()
    offset, page_size = 0, 100
    for _ in range(10000):
        response = (db.table('funding_rounds').select('*').eq('company_id', company_id)
                    .order('id').range(offset, offset + page_size - 1).execute())
        rows = _rows(response, 'funding_history_ack_unverified')
        if len(rows) > page_size:
            raise PersistenceFailure('funding_history_ack_unverified')
        for row in rows:
            row_id = row.get('id')
            if row.get('company_id') != company_id or not isinstance(row_id, str) or \
                    not row_id or row_id in seen_ids:
                raise PersistenceFailure('funding_history_ack_unverified')
            seen_ids.add(row_id)
        history.extend(rows)
        if not rows:
            return sorted(history, key=lambda row: row.get('announced_date') or '', reverse=True)
        offset += len(rows)
    raise PersistenceFailure('funding_history_page_limit')


def persist_rounds(db, company_id, rounds):
    """Insert new stable identities only; require receipts and final presence.

Already persisted identities win unchanged, including richer or corrected prior
records. Retrying acknowledged or ambiguous inserts does not replace those rows.
New chunks may remain after later failure; callers must not claim full success.
"""
    expected = [_identity(row, company_id) for row in rounds]
    if len(set(expected)) != len(expected):
        raise PersistenceFailure('funding_source_identity_duplicate')
    inserted = 0
    for start in range(0, len(rounds), 100):
        chunk = rounds[start:start + 100]
        response = (db.table('funding_rounds').upsert(
            chunk, on_conflict='company_id,source_type,source_ref', ignore_duplicates=True
        ).execute())
        acknowledged = _rows(response, 'funding_rounds_ack_unverified')
        try:
            keys = [_identity(row, company_id) for row in acknowledged]
        except PersistenceFailure:
            raise PersistenceFailure('funding_rounds_ack_unverified') from None
        if len(keys) != len(set(keys)) or not set(keys) <= set(expected[start:start + 100]):
            raise PersistenceFailure('funding_rounds_ack_unverified')
        inserted += len(acknowledged)
    history = load_history(db, company_id)
    # Legacy null source_ref rows remain readable/preserved; never invent retry keys.
    present = {(row.get('source_type'), row.get('source_ref')) for row in history}
    if not set(expected) <= present:
        raise PersistenceFailure('funding_rounds_presence_unverified')
    return PersistedRounds(history, inserted, len(expected))


def publish_company(db, company_id, brief):
    """Publish brief and freshness in one company-row update, then verify receipt."""
    if not isinstance(brief, str) or not brief.strip():
        raise PersistenceFailure('funding_brief_invalid')
    now = datetime.now(timezone.utc).isoformat()
    values = {'funding_brief_md': brief, 'funding_brief_at': now,
              'funding_last_collected_at': now}
    response = db.table('companies').update(values).eq('id', company_id).execute()
    rows = _rows(response, 'funding_company_ack_unverified')
    if len(rows) != 1 or rows[0].get('id') != company_id or rows[0].get('funding_brief_md') != brief:
        raise PersistenceFailure('funding_company_ack_unverified')
    for key in ('funding_brief_at', 'funding_last_collected_at'):
        actual = rows[0].get(key)
        try:
            acknowledged = datetime.fromisoformat(actual)
        except (TypeError, ValueError):
            raise PersistenceFailure('funding_company_ack_unverified') from None
        if acknowledged.tzinfo is None or acknowledged != datetime.fromisoformat(now):
            raise PersistenceFailure('funding_company_ack_unverified')
