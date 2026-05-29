"""
브랜드 랭킹 이상탐지 — brand_ranking_snapshots 기반.

탐지 항목:
  brand_rank_drop_own          — 자사 브랜드 순위 하락 (전일 대비 -5위↓)
  brand_rank_spike_competitor  — 경쟁 브랜드 순위 급등 (+10위↑ & TOP30)
  brand_new_entrant_top10      — 경쟁 브랜드 TOP10 신규 진입 (어제 TOP20 밖)
  brand_exit_top50_own         — 자사 브랜드 TOP50 이탈
  brand_rank_gender_diverge    — 자사 브랜드 남/여 순위 편차 ≥20위

기준 조합: category_code='000' (전체), age_filter='AGE_BAND_ALL'
"""

from __future__ import annotations

from datetime import date, timedelta

from loguru import logger
from supabase import Client

from worker.detectors.base import Anomaly

MODULE = "brand_planning"

BRAND_DROP_DELTA         = 5    # 자사 브랜드 순위 하락 임계
BRAND_SPIKE_DELTA        = 10   # 경쟁 브랜드 순위 상승 임계
BRAND_SPIKE_TOP          = 30   # 경쟁 브랜드 급등 감지 TOP N
BRAND_NEW_ENTRANT_TOP    = 10   # 신규 진입 기준 순위
BRAND_NEW_ENTRANT_PREV_OUT = 20 # 신규 진입 전일 기준 순위 밖
BRAND_EXIT_TOP           = 50   # 이탈 감지 순위 기준
BRAND_GENDER_DIVERGE     = 20   # 성별 순위 편차 임계


def _load_slug_to_uuid(client: Client) -> dict[str, str]:
    """brands.slug → brands.id (UUID) 매핑."""
    rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("brands")
            .select("id, slug")
            .not_.is_("slug", "null")
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return {r["slug"]: r["id"] for r in rows if r.get("slug") and r.get("id")}


def _load_own_brand_slugs(client: Client) -> set[str]:
    """brands.is_own = True 인 슬러그 집합 반환."""
    rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("brands")
            .select("slug")
            .eq("is_own", True)
            .not_.is_("slug", "null")
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return {r["slug"] for r in rows if r.get("slug")}


def _load_brand_ranking(
    client: Client, target_date: date, gender: str = "A"
) -> dict[str, int]:
    """
    (category='000', gender, age='AGE_BAND_ALL') 기준
    musinsa_brand_slug → rank_position 매핑.
    """
    rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("brand_ranking_snapshots")
            .select("musinsa_brand_slug, rank_position, brand_name")
            .eq("snapshot_date", target_date.isoformat())
            .eq("category_code", "000")
            .eq("gender_filter", gender)
            .eq("age_filter", "AGE_BAND_ALL")
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    return {r["musinsa_brand_slug"]: r["rank_position"] for r in rows}


def _load_brand_ranking_with_name(
    client: Client, target_date: date, gender: str = "A"
) -> dict[str, dict]:
    """
    musinsa_brand_slug → {rank, brand_name} 매핑.
    """
    rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("brand_ranking_snapshots")
            .select("musinsa_brand_slug, rank_position, brand_name")
            .eq("snapshot_date", target_date.isoformat())
            .eq("category_code", "000")
            .eq("gender_filter", gender)
            .eq("age_filter", "AGE_BAND_ALL")
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    return {
        r["musinsa_brand_slug"]: {
            "rank": r["rank_position"],
            "brand_name": r.get("brand_name") or r["musinsa_brand_slug"],
        }
        for r in rows
    }


def detect_brand_ranking(client: Client, target_date: date) -> list[Anomaly]:
    yesterday = target_date - timedelta(days=1)
    own_slugs  = _load_own_brand_slugs(client)
    slug_to_id = _load_slug_to_uuid(client)

    today_map  = _load_brand_ranking_with_name(client, target_date, "A")
    prev_map   = _load_brand_ranking(client, yesterday, "A")

    if not today_map:
        logger.warning("brand_ranking_detector_no_data", date=target_date.isoformat())
        return []

    anomalies: list[Anomaly] = []
    drop_own_slugs: list[str] = []  # rank_multi_drop_own 후보 추적용

    for slug, today in today_map.items():
        rank_today = today["rank"]
        rank_prev  = prev_map.get(slug)
        name       = today["brand_name"]
        is_own     = slug in own_slugs

        # brand_rank_drop_own — 자사 브랜드 순위 하락
        if is_own and rank_prev is not None and (rank_today - rank_prev) >= BRAND_DROP_DELTA:
            delta = rank_today - rank_prev
            severity = "high"
            anomalies.append(Anomaly(
                module=MODULE, severity=severity, anomaly_type="brand_rank_drop_own",
                entity_type="brand", entity_id=slug_to_id.get(slug), entity_name=name,
                description=f"[자사] {name} — 브랜드 순위 {rank_prev}위 → {rank_today}위 ({delta}계단 하락)",
                meta={"rank_today": rank_today, "rank_prev": rank_prev, "delta": delta},
            ))

        # brand_rank_spike_competitor — 경쟁 브랜드 순위 급등
        if (
            not is_own
            and rank_prev is not None
            and rank_today <= BRAND_SPIKE_TOP
            and (rank_prev - rank_today) >= BRAND_SPIKE_DELTA
        ):
            delta = rank_prev - rank_today
            anomalies.append(Anomaly(
                module=MODULE, severity="medium", anomaly_type="brand_rank_spike_competitor",
                entity_type="brand", entity_id=slug_to_id.get(slug), entity_name=name,
                description=f"[경쟁] {name} — 브랜드 순위 {rank_prev}위 → {rank_today}위 ({delta}계단 급등)",
                meta={"rank_today": rank_today, "rank_prev": rank_prev, "delta": delta},
            ))

        # brand_new_entrant_top10 — 경쟁 브랜드 TOP10 신규 진입
        if (
            not is_own
            and rank_today <= BRAND_NEW_ENTRANT_TOP
            and (rank_prev is None or rank_prev > BRAND_NEW_ENTRANT_PREV_OUT)
        ):
            prev_str = f"{rank_prev}위" if rank_prev else "미진입"
            anomalies.append(Anomaly(
                module=MODULE, severity="medium", anomaly_type="brand_new_entrant_top10",
                entity_type="brand", entity_id=slug_to_id.get(slug), entity_name=name,
                description=f"[경쟁] {name} — 브랜드 TOP10 신규 진입 (어제: {prev_str} → 오늘: {rank_today}위)",
                meta={"rank_today": rank_today, "rank_prev": rank_prev},
            ))

        # brand_exit_top50_own — 자사 브랜드 TOP50 이탈
        if (
            is_own
            and rank_prev is not None
            and rank_prev <= BRAND_EXIT_TOP
            and rank_today > BRAND_EXIT_TOP
        ):
            anomalies.append(Anomaly(
                module=MODULE, severity="high", anomaly_type="brand_exit_top50_own",
                entity_type="brand", entity_id=slug_to_id.get(slug), entity_name=name,
                description=f"[자사] {name} — 브랜드 TOP50 이탈 ({rank_prev}위 → {rank_today}위)",
                meta={"rank_today": rank_today, "rank_prev": rank_prev},
            ))

    # 어제 랭킹에 있었지만 오늘 없는 자사 브랜드 → brand_exit_top50_own 보완
    for slug, rank_prev in prev_map.items():
        if slug not in today_map and slug in own_slugs and rank_prev <= BRAND_EXIT_TOP:
            anomalies.append(Anomaly(
                module=MODULE, severity="high", anomaly_type="brand_exit_top50_own",
                entity_type="brand", entity_id=slug_to_id.get(slug), entity_name=slug,
                description=f"[자사] {slug} — 브랜드 랭킹에서 완전 이탈 (어제 {rank_prev}위)",
                meta={"rank_today": None, "rank_prev": rank_prev},
            ))

    # brand_rank_gender_diverge — 자사 브랜드 성별 순위 편차
    male_map   = _load_brand_ranking(client, target_date, "M")
    female_map = _load_brand_ranking(client, target_date, "F")

    for slug in own_slugs:
        rank_m = male_map.get(slug)
        rank_f = female_map.get(slug)
        if rank_m is None or rank_f is None:
            continue
        if rank_m > BRAND_EXIT_TOP and rank_f > BRAND_EXIT_TOP:
            continue
        diverge = abs(rank_m - rank_f)
        if diverge >= BRAND_GENDER_DIVERGE:
            name = today_map.get(slug, {}).get("brand_name") or slug
            weak_gender = "남성" if rank_m > rank_f else "여성"
            anomalies.append(Anomaly(
                module=MODULE, severity="high", anomaly_type="brand_rank_gender_diverge",
                entity_type="brand", entity_id=slug_to_id.get(slug), entity_name=name,
                description=(
                    f"[자사] {name} — 성별 순위 편차 {diverge}위 "
                    f"(남성 {rank_m}위 / 여성 {rank_f}위, {weak_gender} 약세)"
                ),
                meta={"rank_male": rank_m, "rank_female": rank_f, "diverge": diverge},
            ))

    logger.info(f"brand_ranking_detector_done date={target_date} anomalies={len(anomalies)}")
    return anomalies
