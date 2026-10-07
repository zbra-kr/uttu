"""Reconcile a publication copy without modifying persisted source evidence."""
from copy import deepcopy

from worker.funding.merge import _dates_within, _same_fiscal_year
from worker.funding.persistence import PersistenceFailure


def publication_rounds(history, company_id):
    rows = deepcopy(history)
    authoritative = [row for row in rows if row.get('source_type', '').startswith('dart_')
                     and (row.get('confidence') or 0) >= 1.0]
    news = [row for row in rows if row.get('source_type', '').startswith('news')]
    matched = set()
    for index, observation in enumerate(news):
        for disclosure in authoritative:
            date_ok = (_same_fiscal_year(observation.get('announced_date'), disclosure.get('announced_date'))
                       if disclosure['source_type'] == 'dart_audit' else
                       _dates_within(observation.get('announced_date'), disclosure.get('announced_date'), 45))
            amount, confirmed = observation.get('amount_krw'), disclosure.get('amount_krw')
            if date_ok and amount and confirmed and confirmed > 0:
                if abs(amount - confirmed) / confirmed > 0.10:
                    raise PersistenceFailure('funding_history_source_conflict')
                matched.add(index)
                disclosure.setdefault('supporting_evidence', []).append(deepcopy(observation))
                disclosure['investors'] = sorted(set(disclosure.get('investors') or [])
                                                 | set(observation.get('investors') or []))
    # Reconciliation may enrich this copy only. Historical rows stay immutable.
    kept = [row for row in rows if row not in news]
    kept.extend(row for index, row in enumerate(news) if index not in matched)
    return sorted(kept, key=lambda row: row.get('announced_date') or '', reverse=True)
