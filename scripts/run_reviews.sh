#!/bin/bash
# 자사 브랜드 리뷰 수집
# 첫 실행: 전체 수집 (10~30시간 예상 — 백그라운드 실행 권장)
# 이후: 마지막 수집일 이후 신규 리뷰만 증분 수집
# cron: 0 4 * * *  (매일 04:00 — 상품 상세 수집 후)
#
# 테스트: ./scripts/run_reviews.sh --limit 10
cd "$(dirname "$0")/.."
source worker/.venv/bin/activate
python -m worker.scrapers.musinsa_review "$@"
