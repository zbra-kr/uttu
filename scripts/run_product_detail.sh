#!/bin/bash
# 상품 상세 수집 (별도 cron)
# cron: 0 6 * * * /Users/macmini/projects/uttu/scripts/run_product_detail.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$ROOT/worker/.venv/bin/python3"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
DATE="$(date +%Y%m%d)"

echo "=== START product_detail: $(date '+%Y-%m-%d %H:%M:%S') ===" | tee -a "$LOG_DIR/product_detail_$DATE.log"
cd "$ROOT"
source .env 2>/dev/null || true

"$PYTHON" -m worker.scrapers.musinsa_product --limit 99999 \
  2>&1 | tee -a "$LOG_DIR/product_detail_$DATE.log"

echo "=== DONE product_detail: $(date '+%Y-%m-%d %H:%M:%S') ===" | tee -a "$LOG_DIR/product_detail_$DATE.log"
