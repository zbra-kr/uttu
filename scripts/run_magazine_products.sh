#!/bin/bash
# 매거진 연결 상품 상세 우선 수집
# magazine_article_products에 등록된 상품 중 detail_fetched_at IS NULL인 stub을 우선 처리
# cron 등록: 정호철 직접 등록
# 권장 cron: 0 3 * * * /Users/macmini/projects/uttu/scripts/run_magazine_products.sh
set -euo pipefail

LOG_DIR="/Users/macmini/projects/uttu/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/magazine_products_$(date +%Y%m%d).log"

echo "=== start: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
cd /Users/macmini/projects/uttu
source .env 2>/dev/null || true

worker/.venv/bin/python3 -m worker.scrapers.musinsa_product --magazine-only --limit 200 >> "$LOG" 2>&1

echo "=== done: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
