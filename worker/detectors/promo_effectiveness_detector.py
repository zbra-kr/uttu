"""
프로모션 실행 → 상품 순위 급등 / 리뷰 급증 탐지.

로직:
  - 최근 14일 promotion_items의 상품을 대상으로
  - 프로모션 snapshot_date 기준 전후 ranking_snapshots 비교
  - 순위 상승 또는 리뷰 수 급증이 임계값 이상이면 anomaly 생성

이상 유형:
  promo_rank_boost    — 프로모션 후 순위 급등
  promo_review_surge  — 프로모션 후 리뷰 수 급증
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from loguru import logger
from supabase import Client

from worker.detectors.base import Anomaly

MODULE = "promotion"

RANK_CATEGORY = "000"
RANK_GENDER   = "A"
RANK_STORE    = "musinsa"

PROMO_LOOKBACK_DAYS = 14
BEFORE_WINDOW_DAYS  = 3
AFTER_WINDOW_DAYS   = 5
RANK_UNCHARTED      = 9999

HIGH_DELTA = 50;  HIGH_TOP = 30
MED_DELTA  = 20;  MED_TOP  = 100
LOW_DELTA  = 10;  LOW_TOP  = 200

REVIEW_SURGE_RATIO  = 1.5   # 프로모션 후 리뷰 수가 before 대비 1.5배 이상
REVIEW_SURGE_MIN    = 10    # 절대 증가 최소값


def _load_promo_items(client: Client, since: date) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("promotion_items")
            .select(
                "musinsa_no, product_id, product_name, musinsa_brand_slug, "
                "discount_rate, snapshot_date, "
                "promotions!inner(id, title, promotion_type)"
            )
            .gte("snapshot_date", since.isoformat())
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
        promo = r.get("promotions") or {}
        result.append({
            "musinsa_no":      r["musinsa_no"],
            "product_id":      r["product_id"],
            "product_name":    r["product_name"] or "",
            "brand_slug":      r["musinsa_brand_slug"] or "",
            "discount_rate":   float(r["discount_rate"] or 0),
            "snapshot_date":   date.fromisoformat(r["snapshot_date"]),
            "promo_id":        promo.get("id"),
            "promo_title":     promo.get("title", ""),
            "promo_type":      promo.get("promotion_type", ""),
        })
    return result


def _load_ranking_window(
    client: Client,
    musinsa_nos: list[str],
    date_from: date,
    date_to: date,
) -> dict[str, dict[date, tuple[int, int]]]:
    """musinsa_no → { snapshot_date → (rank_position, review_count) }"""
    if not musinsa_nos:
        return {}
    data: dict[str, dict[date, tuple[int, int]]] = defaultdict(dict)
    for i in range(0, len(musinsa_nos), 500):
        chunk = musinsa_nos[i : i + 500]
        offset = 0
        while True:
            batch = (
                client.table("ranking_snapshots")
                .select("musinsa_no, snapshot_date, rank_position, review_count")
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
                data[row["musinsa_no"]][d] = (
                    row["rank_position"],
                    row.get("review_count") or 0,
                )
            if len(batch) < 1000:
                break
            offset += 1000
    return data


def detect_promo_effectiveness(client: Client, today: date) -> list[Anomaly]:
    since = today - timedelta(days=PROMO_LOOKBACK_DAYS)

    items = _load_promo_items(client, since)
    if not items:
        logger.info("promo_effectiveness: no promo items in window")
        return []

    date_from   = since - timedelta(days=BEFORE_WINDOW_DAYS)
    date_to     = today
    musinsa_nos = list({i["musinsa_no"] for i in items if i["musinsa_no"]})
    ranks       = _load_ranking_window(client, musinsa_nos, date_from, date_to)

    logger.info(
        f"promo_effectiveness: items={len(items)} products={len(musinsa_nos)} "
        f"window={date_from}~{date_to}"
    )

    anomalies: list[Anomaly] = []
    seen: set[tuple[str, str]] = set()

    for item in items:
        mno     = item["musinsa_no"]
        promo_d = item["snapshot_date"]
        key     = (mno, str(item["promo_id"]))
        if key in seen or not mno:
            continue
        seen.add(key)

        snap = ranks.get(mno, {})

        # before: 프로모션 전 최대 BEFORE_WINDOW_DAYS일 중 가장 최근
        before_rank    = RANK_UNCHARTED
        before_reviews = 0
        for offset in range(1, BEFORE_WINDOW_DAYS + 1):
            d = promo_d - timedelta(days=offset)
            if d in snap:
                before_rank, before_reviews = snap[d]
                break

        # after: 프로모션 후 최대 AFTER_WINDOW_DAYS일 중 가장 좋은 순위
        after_rank:    int | None = None
        after_reviews: int        = 0
        for offset in range(1, AFTER_WINDOW_DAYS + 1):
            d = promo_d + timedelta(days=offset)
            if d in snap:
                r, rev = snap[d]
                if after_rank is None or r < after_rank:
                    after_rank    = r
                    after_reviews = rev

        if after_rank is None:
            continue

        rank_delta   = before_rank - after_rank
        review_delta = after_reviews - before_reviews
        review_ratio = (after_reviews / before_reviews) if before_reviews > 0 else 0

        # ── 순위 급등 탐지 ─────────────────────────────────────────────
        if rank_delta >= LOW_DELTA and after_rank <= LOW_TOP:
            if   rank_delta >= HIGH_DELTA and after_rank <= HIGH_TOP:
                severity = "high"
            elif rank_delta >= MED_DELTA  and after_rank <= MED_TOP:
                severity = "medium"
            else:
                severity = "low"

            is_new_entry = before_rank >= RANK_UNCHARTED
            if is_new_entry:
                desc = (
                    f"프로모션 '{item['promo_title']}' ({item['discount_rate']:.0f}% 할인) 후 "
                    f"랭킹 외 → {after_rank}위 신규 진입"
                )
            else:
                desc = (
                    f"프로모션 '{item['promo_title']}' ({item['discount_rate']:.0f}% 할인) 후 "
                    f"{before_rank}위 → {after_rank}위 ({rank_delta}위 상승)"
                )

            anomalies.append(Anomaly(
                module       = MODULE,
                severity     = severity,
                anomaly_type = "promo_rank_boost",
                entity_type  = "product",
                entity_id    = item["product_id"],
                entity_name  = item["product_name"] or mno,
                description  = desc,
                meta         = {
                    "promo_id":      str(item["promo_id"]),
                    "promo_title":   item["promo_title"],
                    "promo_type":    item["promo_type"],
                    "discount_rate": item["discount_rate"],
                    "promo_date":    promo_d.isoformat(),
                    "musinsa_no":    mno,
                    "brand_slug":    item["brand_slug"],
                    "rank_before":   None if is_new_entry else before_rank,
                    "rank_after":    after_rank,
                    "rank_delta":    None if is_new_entry else rank_delta,
                },
            ))

        # ── 리뷰 급증 탐지 ─────────────────────────────────────────────
        if (
            review_delta >= REVIEW_SURGE_MIN
            and review_ratio >= REVIEW_SURGE_RATIO
            and before_reviews > 0
        ):
            severity = "high" if review_ratio >= 3.0 else "medium" if review_ratio >= 2.0 else "low"
            desc = (
                f"프로모션 '{item['promo_title']}' 후 리뷰 {before_reviews}건 → {after_reviews}건 "
                f"(+{review_delta}건, {review_ratio:.1f}배 증가)"
            )
            anomalies.append(Anomaly(
                module       = MODULE,
                severity     = severity,
                anomaly_type = "promo_review_surge",
                entity_type  = "product",
                entity_id    = item["product_id"],
                entity_name  = item["product_name"] or mno,
                description  = desc,
                meta         = {
                    "promo_id":        str(item["promo_id"]),
                    "promo_title":     item["promo_title"],
                    "promo_type":      item["promo_type"],
                    "discount_rate":   item["discount_rate"],
                    "promo_date":      promo_d.isoformat(),
                    "musinsa_no":      mno,
                    "brand_slug":      item["brand_slug"],
                    "reviews_before":  before_reviews,
                    "reviews_after":   after_reviews,
                    "review_delta":    review_delta,
                    "review_ratio":    round(review_ratio, 2),
                },
            ))

    logger.info(f"promo_effectiveness: detected={len(anomalies)}")
    return anomalies
