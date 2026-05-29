#!/bin/bash
# 자사 브랜드 리뷰 수집
#
# [smart - 일별 권장 ★]
#   cron: 0 4 * * *  (매일 04:00)
#   ./scripts/run_reviews.sh --smart
#   전체 is_own 상품 대상 (ranking 활성 여부 무관)
#   신규 리뷰만 증분 수집 — 신규 없는 상품은 1회 API 호출 후 즉시 skip
#   review_checked_at 오래된 순 우선 처리
#
# [backfill - 1회성 전체 수집]
#   ./scripts/run_reviews.sh --backfill
#   모든 자사 상품 전체 리뷰 수집 (수십 시간 소요, 백그라운드 권장)
#   재시작 안전: 이미 처리된 상품 자동 스킵 (~/.uttu_backfill_started 마커 기반)
#
# [daily - 구형 증분 수집]
#   ranking_snapshots 최근 30일 활성 상품만 (--smart 권장으로 대체)
#
# [테스트]
#   ./scripts/run_reviews.sh --smart --limit 10
#   ./scripts/run_reviews.sh --backfill --limit 5
cd "$(dirname "$0")/.."
source worker/.venv/bin/activate
python -m worker.scrapers.musinsa_review "$@"
