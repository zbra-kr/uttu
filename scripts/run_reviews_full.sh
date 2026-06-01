#!/bin/bash
# 자사 리뷰 전수조사
#   1단계: color_group 미수집 상품 처리
#   2단계: 전체 그룹·단독 상품 전수 스캔 (force-full)
#
# [실행]
#   ./scripts/run_reviews_full.sh

set -euo pipefail
LOG_DIR="/Users/macmini/projects/uttu/logs"
mkdir -p "$LOG_DIR"
DATE="$(date +%Y%m%d)"
PYTHON="/Users/macmini/projects/uttu/worker/.venv/bin/python3"

cd /Users/macmini/projects/uttu

echo "=== START color_group: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG_DIR/color_group_${DATE}.log"
"$PYTHON" -m worker.scrapers.musinsa_color_group >> "$LOG_DIR/color_group_${DATE}.log" 2>&1
echo "=== DONE color_group: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG_DIR/color_group_${DATE}.log"

echo "=== START reviews_full: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG_DIR/reviews_backfill_${DATE}.log"
"$PYTHON" -m worker.scrapers.musinsa_review --force-full >> "$LOG_DIR/reviews_backfill_${DATE}.log" 2>&1
echo "=== done: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG_DIR/reviews_backfill_${DATE}.log"
