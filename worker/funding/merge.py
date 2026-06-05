"""
투자유치 라운드 dedup·merge 정책

08-funding.md §6 규칙:
  - 동일 (company_id, source_type, source_ref) → unique 제약으로 자동 차단
  - 같은 라운드가 뉴스+공시 양쪽에 있으면 공시(confidence=1.00) 우선, 뉴스는 보조 유지
  - amount_krw 단위: 항상 원 (이미 정규화된 것으로 가정)
  - announced_date 없으면 null 허용. 정렬: announced_date desc nulls last
"""
from __future__ import annotations

from loguru import logger


def merge_rounds(rounds: list[dict], company_id: str) -> list[dict]:
    """
    여러 소스에서 수집된 라운드 리스트를 dedup·정규화해 DB upsert 준비 상태로 반환.

    Parameters
    ----------
    rounds     : 각 소스에서 반환된 round dict 리스트 (source_type, source_ref 포함)
    company_id : Supabase companies.id (UUID)

    Returns
    -------
    list of dicts — funding_rounds upsert에 사용할 형태
      (company_id 포함, announced_date desc nulls last 정렬)
    """
    if not rounds:
        return []

    # company_id 주입 + 기본값 처리
    enriched: list[dict] = []
    for r in rounds:
        row = dict(r)
        row["company_id"] = company_id

        # source_ref 없으면 upsert key를 만들 수 없으므로 None으로 명시
        if not row.get("source_ref"):
            row["source_ref"] = None

        # amount_krw 정규화: 이미 정수여야 하지만 혹시 float 전달 시 변환
        if row.get("amount_krw") is not None:
            try:
                row["amount_krw"] = int(row["amount_krw"])
            except (ValueError, TypeError):
                row["amount_krw"] = None

        # confidence 범위 클리핑
        conf = row.get("confidence")
        if conf is not None:
            row["confidence"] = max(0.0, min(1.0, float(conf)))

        # investors: 리스트여야 함
        if not isinstance(row.get("investors"), list):
            row["investors"] = []

        enriched.append(row)

    # source_ref가 있는 항목 중 동일 (source_type, source_ref) 중복 제거
    # (DB unique 제약이 최종 방어막이지만, 미리 걸러서 로그를 깔끔하게)
    seen: dict[tuple, dict] = {}
    no_ref: list[dict] = []

    for row in enriched:
        source_type = row.get("source_type", "")
        source_ref = row.get("source_ref")

        if source_ref is None:
            no_ref.append(row)
            continue

        key = (source_type, source_ref)
        if key not in seen:
            seen[key] = row
        else:
            # 같은 (source_type, source_ref) 중 confidence 높은 것 유지
            existing_conf = seen[key].get("confidence", 0) or 0
            new_conf = row.get("confidence", 0) or 0
            if new_conf > existing_conf:
                seen[key] = row
            logger.debug(
                "merge_dedup",
                source_type=source_type,
                source_ref=source_ref,
                kept_conf=seen[key].get("confidence"),
            )

    merged = list(seen.values()) + no_ref

    # ── 저신뢰도 뉴스 라운드 필터 ────────────────────────────────────────
    # source_type이 'news'로 시작하고 confidence < 0.5인 라운드를 제거.
    # DART 라운드(confidence=1.0) 및 confidence가 None인 라운드는 유지.
    before_filter = len(merged)
    merged = [
        r for r in merged
        if not (
            r.get("source_type", "").startswith("news")
            and r.get("confidence") is not None
            and r.get("confidence") < 0.5
        )
    ]
    dropped = before_filter - len(merged)
    if dropped > 0:
        logger.info(
            "merge_low_confidence_dropped",
            dropped=dropped,
            company_id=company_id,
        )

    # 정렬: announced_date desc nulls last
    def _sort_key(r: dict):
        d = r.get("announced_date")
        # None → 과거로 정렬 (nulls last)
        return d or "0000-00-00"

    merged.sort(key=_sort_key, reverse=True)

    # 통계 로그
    by_source: dict[str, int] = {}
    for r in merged:
        st = r.get("source_type", "unknown")
        by_source[st] = by_source.get(st, 0) + 1

    logger.info(
        "merge_done",
        total=len(merged),
        by_source=by_source,
        company_id=company_id,
    )
    return merged
