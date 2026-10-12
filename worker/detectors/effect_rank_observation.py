"""Observed DAILY ranks only; absence never proves an out-of-chart position."""
from worker.detectors.rank_observation import valid_rank


def add_observation(data, rejected, product, day, value):
    """Keep identical duplicates; reject conflicting/invalid product-day observations.

    Callers query one store/category/gender/age cohort. The schema and collector
    define ranking_snapshots as DAILY, with no separate period column. Conflicts
    can still occur because schema uniqueness uses product_id, not musinsa_no.
    """
    key = (product, day)
    rank = value[0] if isinstance(value, tuple) else value
    observations = data[product]
    if key in rejected:
        return
    if not valid_rank(rank) or (day in observations and observations[day] != value):
        rejected.add(key)
        observations.pop(day, None)
        return
    observations[day] = value


class IncompleteRankReadError(RuntimeError):
    """A ranking query did not establish a complete result; abort detection."""


def checked_rank_page(response, offset, previous_total, page_size=1000):
    """Validate a requested range against its exact total before using any rows.

    PostgREST APIResponse exposes data/count, not raw status or range headers.
    With select(count='exact'), the SDK extracts count from Content-Range;
    execute() raises on non-success HTTP responses. Missing count is not proof
    of completion. A short page is final only if it reaches the exact total.
    """
    rows = getattr(response, 'data', None)
    total = getattr(response, 'count', None)
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise IncompleteRankReadError('ranking page must contain a list of rows')
    if type(total) is not int or total < 0:
        raise IncompleteRankReadError('ranking page requires an exact nonnegative count')
    if previous_total is not None and total != previous_total:
        raise IncompleteRankReadError('ranking total changed during pagination')
    expected = min(page_size, total - offset)
    if expected < 0 or len(rows) != expected:
        raise IncompleteRankReadError(
            f'incomplete ranking range: offset={offset}, expected={expected}, received={len(rows)}'
        )
    return rows, total, offset + len(rows) == total
