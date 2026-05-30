#!/bin/bash
# 외부 패션 뉴스 수집 — Anthropic web_search_20250305 × 9 쿼리
# cron 권장: 30 5 * * * /Users/macmini/projects/uttu/scripts/run_news.sh
set -euo pipefail
LOG_DIR="/Users/macmini/projects/uttu/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/news_$(date +%Y%m%d).log"
echo "=== start: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
cd /Users/macmini/projects/uttu
source .env 2>/dev/null || true
worker/.venv/bin/python3 -m worker.agent.news_collector "$@" >> "$LOG" 2>&1
echo "=== done: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
