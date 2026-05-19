#!/bin/bash
# 무신사 매거진 기사 + 상품 연결 수집
# cron 등록: 정호철 직접 등록
# 권장 cron: 30 2 * * * /Users/macmini/projects/uttu/scripts/run_magazine.sh
set -euo pipefail

LOG_DIR="/Users/macmini/projects/uttu/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/magazine_$(date +%Y%m%d).log"

echo "=== start: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
cd /Users/macmini/projects/uttu
source .env 2>/dev/null || true

worker/.venv/bin/python3 -m worker.scrapers.musinsa_magazine >> "$LOG" 2>&1

echo "=== done: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG"
