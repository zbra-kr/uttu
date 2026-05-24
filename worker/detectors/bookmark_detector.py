"""
북마크 기반 랭킹 변동 알림 — user_bookmarks(brand/product) 기준.

처리 흐름:
  1. user_bookmarks에서 entity_type IN ('brand','product') 조회
  2. 사용자별 구독 체크 (rank_change_bookmarked / teams)
  3. 각 (user_id, entity) 페어 — 어제 vs 오늘 랭킹 비교
  4. 조건 만족 + 중복 없으면 → enqueue_notification

MVP 감지 룰:
  brand   — category=000, age=AGE_BAND_ALL, 성별 조합 중 |Δ| ≥ 10인 최대 1건
  product — TOP100 신규 진입 / 전면 이탈
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

import pytz
from loguru import logger

from supabase import Client
from worker.detectors.base import supabase_client
from worker.notifications.enqueue import enqueue_notification

MODULE = "bookmark_detector"
KST = pytz.timezone("Asia/Seoul")

BRAND_DELTA_THRESHOLD = 10   # 브랜드 순위 변동 알림 임계 (|Δ| ≥ 10)
TOP100_THRESHOLD      = 100  # 상품 TOP100 기준


# ── 유틸 ─────────────────────────────────────────────────────────────────────

def _today_kst_start_iso() -> str:
    """오늘 KST 00:00:00 를 UTC ISO 문자열로 반환 (created_at 범위 필터용)."""
    now_kst = datetime.now(KST)
    today_start_kst = now_kst.replace(hour=0, minute=0, second=0, microsecond=0)
    return today_start_kst.astimezone(timezone.utc).isoformat()


def _is_subscribed(client: Client, user_id: str) -> bool:
    """rank_change_bookmarked / teams 채널 구독 여부 확인."""
    rows = (
        client.table("user_notification_subscriptions")
        .select("enabled")
        .eq("user_id", user_id)
        .eq("event_type", "rank_change_bookmarked")
        .eq("channel", "teams")
        .eq("enabled", True)
        .limit(1)
        .execute()
        .data or []
    )
    return len(rows) > 0


def _already_notified(client: Client, user_id: str, entity_id: str, today_start: str) -> bool:
    """오늘 같은 entity_id로 rank_change_bookmarked 알림이 이미 INSERT됐는지 확인."""
    existing = (
        client.table("user_notifications")
        .select("id, payload")
        .eq("user_id", user_id)
        .eq("event_type", "rank_change_bookmarked")
        .gte("created_at", today_start)
        .execute()
        .data or []
    )
    return any(
        (n.get("payload") or {}).get("entity_id") == entity_id
        for n in existing
    )


# ── 북마크 로드 ──────────────────────────────────────────────────────────────

def _load_bookmarks(client: Client) -> list[dict[str, Any]]:
    """user_bookmarks에서 brand/product 타입만 전체 조회."""
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client.table("user_bookmarks")
            .select("id, user_id, entity_type, entity_id, label")
            .in_("entity_type", ["brand", "product"])
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


# ── Brand 감지 ────────────────────────────────────────────────────────────────

GENDER_KO: dict[str, str] = {"A": "전체", "M": "남성", "F": "여성"}


def _load_brand_rank_by_date(
    client: Client, brand_id: str, target_date: date
) -> list[dict[str, Any]]:
    """brand_id 기준 category=000 / age=AGE_BAND_ALL 조합의 순위 행 반환."""
    return (
        client.table("brand_ranking_snapshots")
        .select("gender_filter, rank_position, brand_name")
        .eq("brand_id", brand_id)
        .eq("snapshot_date", target_date.isoformat())
        .eq("category_code", "000")
        .eq("age_filter", "AGE_BAND_ALL")
        .execute()
        .data or []
    )


def _check_brand(
    client: Client,
    brand_id: str,
    label: str | None,
    today: date,
    yesterday: date,
) -> tuple[str, str, str] | None:
    """
    어제·오늘 brand_ranking_snapshots 비교 → 가장 큰 변동 1건 반환.
    |Δ| < BRAND_DELTA_THRESHOLD 이거나 데이터 부족이면 None.
    """
    today_rows = _load_brand_rank_by_date(client, brand_id, today)
    prev_rows  = _load_brand_rank_by_date(client, brand_id, yesterday)
    if not today_rows or not prev_rows:
        return None

    today_map = {r["gender_filter"]: r for r in today_rows}
    prev_map  = {r["gender_filter"]: r["rank_position"] for r in prev_rows}
    brand_name = today_rows[0].get("brand_name") or label or brand_id
    display = label or brand_name

    # 가장 큰 절대 변동 조합 탐색
    best: tuple[int, str, int, int] | None = None  # (abs_delta, gender, rank_prev, rank_today)
    for gender, t in today_map.items():
        rank_prev = prev_map.get(gender)
        if rank_prev is None:
            continue
        rank_today = t["rank_position"]
        abs_delta = abs(rank_today - rank_prev)
        if abs_delta >= BRAND_DELTA_THRESHOLD:
            if best is None or abs_delta > best[0]:
                best = (abs_delta, gender, rank_prev, rank_today)

    if best is None:
        return None

    abs_delta, gender, rank_prev, rank_today = best
    gender_ko = GENDER_KO.get(gender, gender)
    arrow = "▲" if rank_today < rank_prev else "▼"

    title = f"{display} — 무신사 브랜드 순위 변동"
    body  = f"{gender_ko} #{rank_prev} → #{rank_today} ({arrow}{abs_delta})"
    link  = f"/brand?id={brand_id}"
    return title, body, link


# ── Product 감지 ─────────────────────────────────────────────────────────────

AGE_KO: dict[str, str] = {
    "AGE_BAND_ALL": "", "AGE_BAND_MINOR": "20미만",
    "AGE_BAND_20": "20~25", "AGE_BAND_25": "25~30",
    "AGE_BAND_30": "30~35", "AGE_BAND_35": "35~40", "AGE_BAND_40": "40+",
}
CATEGORY_KO: dict[str, str] = {
    "000": "", "001": "상의", "002": "아우터", "003": "바지",
    "004": "원피스/스커트", "017": "신발", "026": "가방",
    "100": "스포츠", "101": "골프", "102": "아웃도어",
    "103": "신발", "104": "스포츠웨어", "106": "언더웨어",
}


def _combo_label(gender: str, age: str, category: str) -> str:
    parts = [
        GENDER_KO.get(gender, gender),
        AGE_KO.get(age, age),
        CATEGORY_KO.get(category, ""),
    ]
    return " ".join(p for p in parts if p).strip()


def _load_product_top100(
    client: Client, product_id: str, target_date: date
) -> list[dict[str, Any]]:
    """product_id 기준 rank ≤ 100 인 행만 로드 (rank_position ASC)."""
    return (
        client.table("ranking_snapshots")
        .select("gender_filter, age_filter, category_code, rank_position, product_name")
        .eq("product_id", product_id)
        .eq("snapshot_date", target_date.isoformat())
        .lte("rank_position", TOP100_THRESHOLD)
        .order("rank_position", ascending=True)
        .limit(50)
        .execute()
        .data or []
    )


def _check_product(
    client: Client,
    product_id: str,
    label: str | None,
    today: date,
    yesterday: date,
) -> tuple[str, str, str] | None:
    """
    TOP100 신규 진입 / 전면 이탈 감지.
    단순 순위 등락 (어제·오늘 모두 TOP100) 은 MVP에서 알림 제외.
    """
    today_rows = _load_product_top100(client, product_id, today)
    prev_rows  = _load_product_top100(client, product_id, yesterday)

    in_today = len(today_rows) > 0
    in_prev  = len(prev_rows) > 0

    if in_today == in_prev:
        return None  # 상태 변화 없음

    # 상품명 resolve
    source_rows = today_rows if today_rows else prev_rows
    product_name = source_rows[0].get("product_name") if source_rows else None
    display = label or product_name or product_id
    link = f"/product?id={product_id}"

    if in_today and not in_prev:
        # TOP100 신규 진입 — 가장 높은 순위 조합 1건
        best = today_rows[0]  # rank_position ASC → 가장 좋은 순위
        rank  = best["rank_position"]
        combo = _combo_label(best["gender_filter"], best["age_filter"], best["category_code"])
        title = f"{display} — TOP100 진입"
        body  = f"{combo} {rank}위로 진입".strip() if combo else f"{rank}위로 진입"
        return title, body, link

    # TOP100 전면 이탈 — 어제 가장 높은 순위 조합을 body에
    best_prev = prev_rows[0]
    rank_prev = best_prev["rank_position"]
    combo_prev = _combo_label(
        best_prev["gender_filter"], best_prev["age_filter"], best_prev["category_code"]
    )
    title = f"{display} — TOP100 이탈"
    body  = f"어제 {combo_prev} {rank_prev}위 → 오늘 TOP100 밖".strip()
    return title, body, link


# ── 메인 진입점 ───────────────────────────────────────────────────────────────

def detect_bookmark_changes(
    client: Client | None = None,
    today: date | None = None,
    yesterday: date | None = None,
) -> int:
    """
    북마크된 brand/product 랭킹 변동 감지 후 알림 INSERT.
    Returns: 실제 INSERT된 알림 수.
    """
    if client is None:
        client = supabase_client()
    if today is None:
        today = datetime.now(KST).date()
    if yesterday is None:
        yesterday = today - timedelta(days=1)

    today_start = _today_kst_start_iso()

    bookmarks = _load_bookmarks(client)
    if not bookmarks:
        logger.info("bookmark_detector_no_bookmarks")
        return 0

    logger.info(
        f"bookmark_detector_start bookmarks={len(bookmarks)} "
        f"today={today} yesterday={yesterday}"
    )

    sub_cache: dict[str, bool] = {}  # user_id → subscribed 캐시
    enqueued = 0

    for bm in bookmarks:
        user_id     = bm["user_id"]
        entity_type = bm["entity_type"]
        entity_id   = bm["entity_id"]
        label       = bm.get("label")

        # 구독 체크 (사용자당 1회)
        if user_id not in sub_cache:
            sub_cache[user_id] = _is_subscribed(client, user_id)
        if not sub_cache[user_id]:
            continue

        # 중복 체크
        if _already_notified(client, user_id, entity_id, today_start):
            logger.debug(
                f"bookmark_detector_skip_dup user={user_id} "
                f"entity_type={entity_type} entity_id={entity_id}"
            )
            continue

        # 변동 감지
        result: tuple[str, str, str] | None = None
        try:
            if entity_type == "brand":
                result = _check_brand(client, entity_id, label, today, yesterday)
            elif entity_type == "product":
                result = _check_product(client, entity_id, label, today, yesterday)
        except Exception as exc:
            logger.warning(
                f"bookmark_detector_check_error "
                f"entity_type={entity_type} entity_id={entity_id} error={exc}"
            )
            continue

        if result is None:
            continue

        title, body, link = result
        try:
            enqueue_notification(
                user_id=user_id,
                event_type="rank_change_bookmarked",
                title=title,
                body=body,
                link=link,
                payload={"entity_id": entity_id, "entity_type": entity_type},
                client=client,
            )
            enqueued += 1
            logger.info(
                f"bookmark_detector_enqueued "
                f"user={user_id} entity_type={entity_type} entity_id={entity_id} "
                f"title={title!r}"
            )
        except Exception as exc:
            logger.warning(
                f"bookmark_detector_enqueue_error "
                f"user={user_id} entity_id={entity_id} error={exc}"
            )

    logger.info(f"bookmark_detector_done enqueued={enqueued} total_bookmarks={len(bookmarks)}")
    return enqueued


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    detect_bookmark_changes()
