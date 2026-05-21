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

from worker.detectors.base import save_anomalies, supabase_client
from worker.detectors.ranking_detector import detect_promo_discount, detect_ranking
from worker.detectors.review_detector import detect_review


def run(target_date: date) -> None:
    client = supabase_client()
    logger.info(f"detect_start date={target_date}")

    all_anomalies = []

    # 상품기획 / 영업기획
    all_anomalies.extend(detect_ranking(client, target_date))
    all_anomalies.extend(detect_promo_discount(client, target_date))

    # CS
    all_anomalies.extend(detect_review(client, target_date))

    saved = save_anomalies(client, all_anomalies, target_date)
    logger.info(f"detect_complete date={target_date} total={len(all_anomalies)} saved={saved}")


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
