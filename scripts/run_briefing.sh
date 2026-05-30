#!/bin/bash
# 데일리 브리핑 생성 — executive / staff / cs 3종 병렬 생성
# cron 권장: 0 6 * * * /Users/macmini/projects/uttu/scripts/run_briefing.sh
#   (뉴스 수집 run_news.sh 05:30 완료 후 실행)
set -euo pipefail
LOG_DIR="/Users/macmini/projects/uttu/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/briefing_$(date +%Y%m%d).log"
echo "=== start: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
cd /Users/macmini/projects/uttu
source .env 2>/dev/null || true
worker/.venv/bin/python3 -m worker.agent.briefing_writer "$@" >> "$LOG" 2>&1
echo "=== done: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
