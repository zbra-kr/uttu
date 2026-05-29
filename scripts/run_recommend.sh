#!/bin/bash
# 무신사 추천판 수집
# cron 권장: 0 3 * * * /Users/macmini/projects/uttu/scripts/run_recommend.sh
set -euo pipefail
LOG_DIR="/Users/macmini/projects/uttu/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/recommend_$(date +%Y%m%d).log"
echo "=== start: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
cd /Users/macmini/projects/uttu
source .env 2>/dev/null || true
worker/.venv/bin/python3 -m worker.scrapers.musinsa_recommend >> "$LOG" 2>&1
echo "=== done: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
