"""
투자유치 라운드 dedup·merge·교차검증 정책

08-funding.md §6 규칙:
  - 동일 (company_id, source_type, source_ref) → unique 제약으로 자동 차단
  - 같은 라운드가 뉴스+공시 양쪽에 있으면 공시(confidence=1.00) 우선, 뉴스는 보조 유지
  - amount_krw 단위: 항상 원 (이미 정규화된 것으로 가정)
  - announced_date 없으면 null 허용. 정렬: announced_date desc nulls last
교차검증 (이번 라운드 추가):
  - news 라운드를 공시(dart_*/confidence=1.0)와 대조 → 매칭/충돌/유지 처리
  - 공시 라운드는 절대 삭제·강등 금지 (투자자 병합만 허용)
"""
from __future__ import annotations

from datetime import date as _date

from loguru import logger

# ── 교차검증 헬퍼 ────────────────────────────────────────────────────────────────

def _same_fiscal_year(d1: str | None, d2: str | None) -> bool:
    """두 날짜가 같은 연도인지 (dart_audit 연 단위 매칭용)."""
    if not d1 or not d2:
        return False
    return d1[:4] == d2[:4]


def _dates_within(d1: str | None, d2: str | None, days: int = 45) -> bool:
    """두 날짜가 N일 이내인지."""
    if not d1 or not d2:
        return False
    try:
        dt1 = _date.fromisoformat(d1)
        dt2 = _date.fromisoformat(d2)
        return abs((dt1 - dt2).days) <= days
    except (ValueError, TypeError):
        return False


def _cross_validate(merged: list[dict], company_id: str) -> list[dict]:
    """
    news 라운드를 공시(confidence=1.0) 라운드와 교차검증.

    매칭 규칙 (같은 company_id 내):
      - 금액 일치: |news.amount - auth.amount| / auth.amount ≤ 0.10
      - 시점 일치: ±45일, dart_audit은 같은 사업연도면 일치

    처리:
      - 매칭 → 공시 라운드에 news.investors 병합, news 라운드 폐기
      - 충돌 (같은 시점 공시 금액 >10% 차이) → news 라운드 폐기 (로그)
      - 대응 공시 없음 → news 라운드 유지 (미검증)

    ⚠️ 공시 라운드(confidence=1.0)는 삭제·강등 금지.
    """
    authoritative = [r for r in merged if (r.get("confidence") or 0) >= 1.0]
    news_rounds   = [r for r in merged if r.get("source_type", "").startswith("news")]
    others        = [r for r in merged if r not in authoritative and r not in news_rounds]

    if not authoritative or not news_rounds:
        return merged

    stats = {"merged": 0, "conflict": 0, "kept": 0}
    kept_news: list[dict] = []

    for nr in news_rounds:
        n_amount = nr.get("amount_krw")
        n_date   = nr.get("announced_date")
        matched  = False
        conflict = False

        for ar in authoritative:
            a_amount = ar.get("amount_krw")
            a_date   = ar.get("announced_date")
            a_source = ar.get("source_type", "")

            # 시점 일치 확인
            is_audit = a_source == "dart_audit"
            date_ok = (
                _same_fiscal_year(n_date, a_date) if is_audit
                else _dates_within(n_date, a_date, 45)
            )
            if not date_ok:
                continue

            # 금액 일치 확인
            if n_amount and a_amount and a_amount > 0:
                ratio = abs(n_amount - a_amount) / a_amount
                if ratio <= 0.10:
                    # 매칭: investors 병합
                    existing = set(ar.get("investors") or [])
                    new_inv  = [i for i in (nr.get("investors") or []) if i and i not in existing]
                    if new_inv:
                        ar["investors"] = list(existing) + new_inv
                    matched = True
                    stats["merged"] += 1
                    logger.info(
                        "cross_match",
                        news_ref=nr.get("source_ref", "")[:60],
                        auth_ref=ar.get("source_ref", "")[:40],
                        amount_news=n_amount,
                        amount_auth=a_amount,
                        company_id=company_id,
                    )
                    break
                else:
                    # 같은 시점인데 금액 >10% 차이 → 충돌
                    conflict = True
                    stats["conflict"] += 1
                    logger.info(
                        "cross_conflict_drop",
                        news_ref=nr.get("source_ref", "")[:60],
                        auth_ref=ar.get("source_ref", "")[:40],
                        ratio=round(ratio, 3),
                        company_id=company_id,
                    )
                    break
            elif n_amount is None or a_amount is None:
                # 금액 불명 상태에서 시점만 일치 → 충돌로 보지 않고 유지
                pass

        if not matched and not conflict:
            kept_news.append(nr)
            stats["kept"] += 1

    logger.info(
        "cross_validate_done",
        merged_to_auth=stats["merged"],
        conflict_dropped=stats["conflict"],
        news_only_kept=stats["kept"],
        company_id=company_id,
    )

    return authoritative + others + kept_news


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

    # ── 저신뢰도 뉴스 라운드 필터 (Round8 정책 유지) ───────────────────────
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

    # ── 공시 교차검증 ─────────────────────────────────────────────────────
    # news 라운드를 공시(dart_*/dart_audit)와 대조 → 매칭/충돌/유지
    # 공시 라운드는 삭제·강등 금지
    merged = _cross_validate(merged, company_id)

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
