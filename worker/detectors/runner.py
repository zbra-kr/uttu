"""
이상탐지 실행 엔트리포인트.

usage:
  python -m worker.detectors.runner [--date YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
from datetime import date

from dotenv import load_dotenv
load_dotenv()

from loguru import logger

from worker.detectors.base import Anomaly, save_anomalies, supabase_client
from worker.detectors.bookmark_detector import detect_bookmark_changes
from worker.detectors.brand_ranking_detector import detect_brand_ranking
from worker.detectors.ranking_detector import detect_promo_anomalies, detect_promo_discount, detect_ranking
from worker.detectors.review_detector import detect_review
from worker.notifications.enqueue import enqueue_for_subscribers

_ANOMALY_LABELS: dict[str, str] = {
    # 상품 랭킹
    "rank_spike":            "순위 급등",
    "rank_drop_own":         "자사 순위 하락",
    "new_entrant_top10":     "TOP10 신규 진입",
    "sold_out":              "품절",
    "price_drop":            "가격 인하",
    "price_rise":            "가격 인상",
    "rank_return_own":       "자사 순위 복귀",
    "rank_exit_own":         "자사 TOP 이탈",
    "rank_multi_drop_own":   "자사 다중 순위 하락",
    # 프로모션
    "promo_heavy_discount":  "프로모션 대폭 할인",
    "promo_item_count_drop": "프로모션 상품 급감",
    "promo_own_exit":        "자사 프로모션 이탈",
    # 브랜드 랭킹
    "brand_rank_drop_own":         "자사 브랜드 순위 하락",
    "brand_rank_spike_competitor": "경쟁 브랜드 순위 급등",
    "brand_new_entrant_top10":     "브랜드 TOP10 신규 진입",
    "brand_exit_top50_own":        "자사 브랜드 TOP50 이탈",
    "brand_rank_gender_diverge":   "브랜드 성별 순위 편차",
    # 리뷰
    "review_rating_drop":    "자사 리뷰 평점 하락",
    "review_negative_surge": "자사 부정 리뷰 급증",
    "review_count_surge":    "리뷰 수 급증",
    "review_no_activity":    "리뷰 활동 없음",
    "review_helpful_surge":  "도움됨 급증",
}


def _build_notification(a: Anomaly, detection_date: date) -> tuple[str, str, str]:
    """(title, body, link) 반환."""
    label = _ANOMALY_LABELS.get(a.anomaly_type, a.anomaly_type)
    entity = a.entity_name or ""
    title = f"{label} — {entity}".rstrip(" —") if entity else label
    body = a.description or ""
    if a.entity_type == "product" and a.entity_id:
        link = f"/product?id={a.entity_id}"
    else:
        link = f"/anomaly?date={detection_date.isoformat()}"
    return title, body, link


def _enqueue_anomalies(anomalies: list[Anomaly], detection_date: date) -> None:
    high = [a for a in anomalies if a.severity == "high"]
    med  = [a for a in anomalies if a.severity == "medium"]

    for a in high:
        title, body, link = _build_notification(a, detection_date)
        try:
            enqueue_for_subscribers("anomaly_high", title, body, link,
                                    payload={"anomaly_type": a.anomaly_type, "entity_id": a.entity_id})
        except Exception as e:
            logger.warning("enqueue_anomaly_error", severity="high", anomaly_type=a.anomaly_type, error=str(e))

    for a in med:
        title, body, link = _build_notification(a, detection_date)
        try:
            enqueue_for_subscribers("anomaly_med", title, body, link,
                                    payload={"anomaly_type": a.anomaly_type, "entity_id": a.entity_id})
        except Exception as e:
            logger.warning("enqueue_anomaly_error", severity="medium", anomaly_type=a.anomaly_type, error=str(e))


def run(target_date: date) -> None:
    client = supabase_client()
    logger.info(f"detect_start date={target_date}")

    all_anomalies = []

    # 상품기획 — 상품 랭킹
    all_anomalies.extend(detect_ranking(client, target_date))

    # 상품기획 — 브랜드 랭킹
    all_anomalies.extend(detect_brand_ranking(client, target_date))

    # 상품기획 — 프로모션
    all_anomalies.extend(detect_promo_discount(client, target_date))
    all_anomalies.extend(detect_promo_anomalies(client, target_date))

    # CS — 리뷰
    all_anomalies.extend(detect_review(client, target_date))

    saved = save_anomalies(client, all_anomalies, target_date)
    logger.info(f"detect_complete date={target_date} total={len(all_anomalies)} saved={saved}")

    _enqueue_anomalies(all_anomalies, target_date)
    logger.info(f"enqueue_done date={target_date} high={sum(1 for a in all_anomalies if a.severity=='high')} med={sum(1 for a in all_anomalies if a.severity=='medium')}")

    # 북마크 기반 랭킹 변동 알림
    try:
        bm_count = detect_bookmark_changes(client=client, today=target_date)
        logger.info(f"bookmark_detect_done date={target_date} enqueued={bm_count}")
    except Exception as e:
        logger.warning(f"bookmark_detect_error date={target_date} error={e}")


def main() -> None:
    parser = argparse.ArgumentParser(description="이상탐지 실행")
    parser.add_argument("--date", default=None, help="탐지 기준일 (YYYY-MM-DD, 기본값: 오늘)")
    args = parser.parse_args()

    if args.date:
        target = date.fromisoformat(args.date)
    else:
        from datetime import timezone, timedelta
        target = date.today()

    run(target)


if __name__ == "__main__":
    main()
