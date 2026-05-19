#!/bin/bash
# 무신사 스냅 수집 — CODISHOP_SNAP + MUSINSA_SNAP
# cron 등록: 정호철 직접 등록
# 권장 cron: 0 2 * * * /Users/macmini/projects/uttu/scripts/run_snap.sh
set -euo pipefail

LOG_DIR="/Users/macmini/projects/uttu/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/snap_$(date +%Y%m%d).log"

echo "=== start: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
cd /Users/macmini/projects/uttu
source .env 2>/dev/null || true

worker/.venv/bin/python3 -m worker.scrapers.musinsa_snap >> "$LOG" 2>&1

echo "=== done: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
