"""
고참여 스냅 → 상품 순위 급등 탐지.

로직:
  - 최근 7일 수집된 스냅 중 engagement_score 상위 스냅의 연결 상품
  - 스냅 수집일 기준 전후 ranking_snapshots 비교
  - 순위 상승 폭이 임계값 이상이면 anomaly 생성

engagement_score = view×1 + like×5 + comment×10 + goods_click×3

이상 유형:
  snap_rank_boost      — 고참여 스냅 등장 후 순위 급등
  snap_rank_new_entry  — 고참여 스냅 등장 후 랭킹 신규 진입
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from loguru import logger
from supabase import Client

from worker.detectors.base import Anomaly

MODULE = "snap"

RANK_CATEGORY = "000"
RANK_GENDER   = "A"
RANK_STORE    = "musinsa"

SNAP_LOOKBACK_DAYS = 7
BEFORE_WINDOW_DAYS = 3
AFTER_WINDOW_DAYS  = 3
RANK_UNCHARTED     = 9999

ENGAGEMENT_MIN = 200   # view×1 + like×5 + comment×10 + click×3 최소값

HIGH_DELTA = 50;  HIGH_TOP = 30
MED_DELTA  = 20;  MED_TOP  = 100
LOW_DELTA  = 10;  LOW_TOP  = 200


def _eng(snap: dict) -> int:
    return (
        (snap.get("view_count")        or 0) * 1
        + (snap.get("like_count")      or 0) * 5
        + (snap.get("comment_count")   or 0) * 10
        + (snap.get("goods_click_count") or 0) * 3
    )


def _load_snap_products(client: Client, since: date) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("snap_products")
            .select(
                "musinsa_no, product_id, "
                "products(name, is_own), "
                "snaps!inner(id, snap_id, view_count, like_count, "
                "comment_count, goods_click_count, collected_at)"
            )
            .gte("snaps.collected_at", since.isoformat())
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    result = []
    for r in rows:
        snap = r.get("snaps") or {}
        p    = r.get("products") or {}
        col  = snap.get("collected_at", "")
        if not col:
            continue
        eng = _eng(snap)
        if eng < ENGAGEMENT_MIN:
            continue
        result.append({
            "snap_id":           snap.get("snap_id"),
            "snap_uuid":         snap.get("id"),
            "collected_at":      date.fromisoformat(str(col)[:10]),
            "engagement":        eng,
            "view_count":        snap.get("view_count", 0),
            "like_count":        snap.get("like_count", 0),
            "goods_click_count": snap.get("goods_click_count", 0),
            "musinsa_no":        r["musinsa_no"],
            "product_id":        r["product_id"],
            "product_name":      p.get("name", ""),
            "is_own":            p.get("is_own", False),
        })
    return result


def _load_ranking_window(
    client: Client,
    musinsa_nos: list[str],
    date_from: date,
    date_to: date,
) -> dict[str, dict[date, int]]:
    if not musinsa_nos:
        return {}
    ranks: dict[str, dict[date, int]] = defaultdict(dict)
    for i in range(0, len(musinsa_nos), 500):
        chunk = musinsa_nos[i : i + 500]
        offset = 0
        while True:
            batch = (
                client.table("ranking_snapshots")
                .select("musinsa_no, snapshot_date, rank_position")
                .in_("musinsa_no", chunk)
                .gte("snapshot_date", date_from.isoformat())
                .lte("snapshot_date", date_to.isoformat())
                .eq("category_code", RANK_CATEGORY)
                .eq("gender_filter",  RANK_GENDER)
                .eq("store_code",     RANK_STORE)
                .range(offset, offset + 999)
                .execute()
                .data or []
            )
            for row in batch:
                d = date.fromisoformat(row["snapshot_date"])
                ranks[row["musinsa_no"]][d] = row["rank_position"]
            if len(batch) < 1000:
                break
            offset += 1000
    return ranks


def detect_snap_boost(client: Client, today: date) -> list[Anomaly]:
    since = today - timedelta(days=SNAP_LOOKBACK_DAYS)

    snaps = _load_snap_products(client, since)
    if not snaps:
        logger.info("snap_boost: no high-engagement snaps in window")
        return []

    date_from   = since - timedelta(days=BEFORE_WINDOW_DAYS)
    date_to     = today
    musinsa_nos = list({s["musinsa_no"] for s in snaps})
    ranks       = _load_ranking_window(client, musinsa_nos, date_from, date_to)

    logger.info(
        f"snap_boost: snaps={len(snaps)} products={len(musinsa_nos)} "
        f"rank_window={date_from}~{date_to}"
    )

    anomalies: list[Anomaly] = []
    seen: set[tuple[str, str]] = set()

    for s in snaps:
        key = (s["musinsa_no"], str(s["snap_uuid"]))
        if key in seen:
            continue
        seen.add(key)

        mno    = s["musinsa_no"]
        col_dt = s["collected_at"]
        snap   = ranks.get(mno, {})

        before_rank = RANK_UNCHARTED
        for offset in range(1, BEFORE_WINDOW_DAYS + 1):
            d = col_dt - timedelta(days=offset)
            if d in snap:
                before_rank = snap[d]
                break

        after_rank: int | None = None
        for offset in range(1, AFTER_WINDOW_DAYS + 1):
            d = col_dt + timedelta(days=offset)
            if d in snap:
                r = snap[d]
                if after_rank is None or r < after_rank:
                    after_rank = r

        if after_rank is None:
            continue

        delta = before_rank - after_rank

        if   delta >= HIGH_DELTA and after_rank <= HIGH_TOP:
            severity = "high"
        elif delta >= MED_DELTA  and after_rank <= MED_TOP:
            severity = "medium"
        elif delta >= LOW_DELTA  and after_rank <= LOW_TOP:
            severity = "low"
        else:
            continue

        is_new_entry = before_rank >= RANK_UNCHARTED
        anomaly_type = "snap_rank_new_entry" if is_new_entry else "snap_rank_boost"

        if is_new_entry:
            desc = (
                f"스냅 등장(참여도 {s['engagement']:,}) 후 랭킹 외 → {after_rank}위 신규 진입 "
                f"· 조회 {s['view_count']:,} 좋아요 {s['like_count']:,}"
            )
        else:
            desc = (
                f"스냅 등장(참여도 {s['engagement']:,}) 후 {before_rank}위 → {after_rank}위 "
                f"({delta}위 상승) · 조회 {s['view_count']:,} 좋아요 {s['like_count']:,}"
            )

        anomalies.append(Anomaly(
            module       = MODULE,
            severity     = severity,
            anomaly_type = anomaly_type,
            entity_type  = "product",
            entity_id    = s["product_id"],
            entity_name  = s["product_name"] or mno,
            description  = desc,
            meta         = {
                "snap_id":           s["snap_id"],
                "snap_uuid":         str(s["snap_uuid"]),
                "collected_at":      col_dt.isoformat(),
                "engagement":        s["engagement"],
                "view_count":        s["view_count"],
                "like_count":        s["like_count"],
                "goods_click_count": s["goods_click_count"],
                "musinsa_no":        mno,
                "rank_before":       None if is_new_entry else before_rank,
                "rank_after":        after_rank,
                "rank_delta":        None if is_new_entry else delta,
                "is_own":            s["is_own"],
            },
        ))

    logger.info(f"snap_boost: detected={len(anomalies)}")
    return anomalies
