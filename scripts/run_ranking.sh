#!/bin/bash
# 무신사 상품 랭킹 수집 — 273조합
# cron 권장: 0 1 * * * /Users/macmini/projects/uttu/scripts/run_ranking.sh
set -euo pipefail
LOG_DIR="/Users/macmini/projects/uttu/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/ranking_$(date +%Y%m%d).log"
echo "=== start: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
cd /Users/macmini/projects/uttu
source .env 2>/dev/null || true
worker/.venv/bin/python3 -m worker.scrapers.musinsa_ranking >> "$LOG" 2>&1
echo "=== done: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
