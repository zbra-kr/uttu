"""
CS 이상탐지 — reviews 테이블 기반.

탐지 항목:
  review_rating_drop   — 자사 상품 별점 급락 (최근 7일 평균 < 전체 평균 - 0.3)
  review_negative_surge — 최근 7일 1~2점 리뷰 비율 ≥ 30%
  review_count_surge   — 오늘 리뷰 수 > 30일 일평균 × 3
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from loguru import logger
from supabase import Client

from worker.detectors.base import Anomaly

MODULE = "cs"

RATING_DROP_THRESHOLD  = 0.3  # 전체 평균 대비 하락 폭
NEGATIVE_RATE_THRESHOLD = 0.30 # 1~2점 비율
SURGE_MULTIPLIER        = 3.0  # 30일 일평균 × 배수


def _load_own_product_ids(client: Client) -> list[str]:
    ids: list[str] = []
    offset = 0
    while True:
        batch = (
            client.table("products")
            .select("id")
            .eq("is_own", True)
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        ids.extend(r["id"] for r in batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return ids


def _load_reviews_for_products(
    client: Client, product_ids: list[str], since: date
) -> dict[str, list[dict]]:
    """product_id → [{rating, review_date}] 매핑."""
    result: dict[str, list[dict]] = defaultdict(list)
    for i in range(0, len(product_ids), 200):
        chunk = product_ids[i:i + 200]
        offset = 0
        while True:
            batch = (
                client.table("reviews")
                .select("product_id, rating, review_date")
                .in_("product_id", chunk)
                .gte("review_date", since.isoformat())
                .range(offset, offset + 999)
                .execute()
                .data or []
            )
            for r in batch:
                result[r["product_id"]].append(r)
            if len(batch) < 1000:
                break
            offset += 1000
    return result


def _load_product_names(client: Client, product_ids: list[str]) -> dict[str, str]:
    names: dict[str, str] = {}
    for i in range(0, len(product_ids), 200):
        chunk = product_ids[i:i + 200]
        rows = (
            client.table("products")
            .select("id, name")
            .in_("id", chunk)
            .execute()
            .data or []
        )
        for r in rows:
            names[r["id"]] = r.get("name") or "—"
    return names


def detect_review(client: Client, target_date: date) -> list[Anomaly]:
    own_ids = _load_own_product_ids(client)
    if not own_ids:
        logger.warning("review_detector_no_own_products")
        return []

    since_30 = target_date - timedelta(days=30)
    reviews_map = _load_reviews_for_products(client, own_ids, since_30)
    name_map = _load_product_names(client, own_ids)

    anomalies: list[Anomaly] = []

    for pid in own_ids:
        reviews = reviews_map.get(pid, [])
        if not reviews:
            continue

        name = name_map.get(pid, "—")
        ratings_all = [r["rating"] for r in reviews if r["rating"] is not None]
        if not ratings_all:
            continue

        avg_all = sum(ratings_all) / len(ratings_all)

        # 최근 7일 리뷰만
        cutoff_7d = target_date - timedelta(days=7)
        reviews_7d = [r for r in reviews if r["review_date"] and r["review_date"] >= cutoff_7d.isoformat()]
        ratings_7d = [r["rating"] for r in reviews_7d if r["rating"] is not None]

        if ratings_7d:
            avg_7d = sum(ratings_7d) / len(ratings_7d)

            # review_rating_drop
            if avg_7d < avg_all - RATING_DROP_THRESHOLD:
                drop = avg_all - avg_7d
                anomalies.append(Anomaly(
                    module=MODULE, severity="high", anomaly_type="review_rating_drop",
                    entity_type="product", entity_id=pid, entity_name=name,
                    description=(
                        f"[자사] {name} — 최근 7일 평균별점 {avg_7d:.2f} "
                        f"(전체 {avg_all:.2f}, -{drop:.2f}p 하락)"
                    ),
                    meta={
                        "avg_7d": round(avg_7d, 2),
                        "avg_all": round(avg_all, 2),
                        "drop": round(drop, 2),
                        "review_count_7d": len(ratings_7d),
                        "review_count_all": len(ratings_all),
                    },
                ))

            # review_negative_surge
            negative_count = sum(1 for r in ratings_7d if r <= 2)
            neg_rate = negative_count / len(ratings_7d)
            if neg_rate >= NEGATIVE_RATE_THRESHOLD:
                anomalies.append(Anomaly(
                    module=MODULE, severity="high", anomaly_type="review_negative_surge",
                    entity_type="product", entity_id=pid, entity_name=name,
                    description=(
                        f"[자사] {name} — 최근 7일 1~2점 비율 {neg_rate*100:.0f}% "
                        f"({negative_count}/{len(ratings_7d)}건)"
                    ),
                    meta={
                        "negative_rate": round(neg_rate, 3),
                        "negative_count": negative_count,
                        "review_count_7d": len(ratings_7d),
                    },
                ))

        # review_count_surge — 오늘 리뷰 수 vs 30일 일평균
        reviews_today = [r for r in reviews if r["review_date"] == target_date.isoformat()]
        count_today = len(reviews_today)

        # 30일치 날짜별 카운트 (오늘 제외)
        count_by_date: dict[str, int] = defaultdict(int)
        for r in reviews:
            if r["review_date"] and r["review_date"] != target_date.isoformat():
                count_by_date[r["review_date"]] += 1
        daily_avg_30 = sum(count_by_date.values()) / 30.0 if count_by_date else 0

        if daily_avg_30 > 0 and count_today > daily_avg_30 * SURGE_MULTIPLIER:
            severity = "high" if count_today > daily_avg_30 * 5 else "medium"
            anomalies.append(Anomaly(
                module=MODULE, severity=severity, anomaly_type="review_count_surge",
                entity_type="product", entity_id=pid, entity_name=name,
                description=(
                    f"[자사] {name} — 오늘 리뷰 {count_today}건 "
                    f"(30일 일평균 {daily_avg_30:.1f}건의 {count_today/daily_avg_30:.1f}배)"
                ),
                meta={
                    "count_today": count_today,
                    "daily_avg_30": round(daily_avg_30, 1),
                    "multiplier": round(count_today / daily_avg_30, 1),
                },
            ))

    logger.info(f"review_detector_done date={target_date} anomalies={len(anomalies)}")
    return anomalies
