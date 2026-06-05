#!/bin/bash
# 투자정보 수집 워커 폴링 — pending 잡 최대 3건 처리
# cron 권장: */5 * * * * /Users/macmini/projects/uttu/scripts/run_funding_poll.sh
set -euo pipefail
PROJECT_DIR="/Users/macmini/projects/uttu"
LOG_DIR="${PROJECT_DIR}/logs"
mkdir -p "$LOG_DIR"
LOG="${LOG_DIR}/funding_poll_$(date +%Y%m%d).log"
echo "=== start: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
cd "$PROJECT_DIR"
"${PROJECT_DIR}/worker/.venv/bin/python3" -m worker.main --mode funding-poll --limit 3 >> "$LOG" 2>&1
echo "=== done: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
