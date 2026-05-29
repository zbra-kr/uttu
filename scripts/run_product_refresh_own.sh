#!/bin/bash
# 자사 상품(is_own=True) 전체 상세 강제 재수집
# - detail_fetched_at 무시, review_count 최신화 포함
# - 대상: 9,277개 / 예상 소요: ~10시간
#
# [실행]
#   ./scripts/run_product_refresh_own.sh

set -euo pipefail
LOG_DIR="/Users/macmini/projects/uttu/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/product_refresh_own_$(date +%Y%m%d).log"
echo "=== start: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
cd /Users/macmini/projects/uttu
source worker/.venv/bin/activate
python -m worker.scrapers.musinsa_product --refresh-own >> "$LOG" 2>&1
echo "=== done: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
