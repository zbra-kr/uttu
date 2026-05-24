#!/bin/bash
# DART 공시 + 재무제표 수집
#   2026-05까지 : 매일 실행 (회사 매핑 집중 기간)
#   2026-06부터 : 일요일만 실행
#
# cron 등록 (매일 06:00, 스크립트 내부에서 월별 조건 처리):
#   0 6 * * * /Users/macmini/projects/uttu/scripts/run_dart.sh
#
# 사용법:
#   ./scripts/run_dart.sh              # 전체 companies
#   ./scripts/run_dart.sh bcave        # B.CAVE만
set -euo pipefail

# ── 월별 실행 주기 조건 ──────────────────────────────────────────────
YYYYMM=$(date +%Y%m)
DOW=$(date +%u)   # 1=월 … 7=일

if [[ "$YYYYMM" > "202605" ]] && [[ "$DOW" != "7" ]]; then
  echo "=== skip: $(date '+%Y-%m-%d') 6월 이후 일요일 아님 — 실행 안 함 ==="
  exit 0
fi

TARGET="${1:-all}"
LOG_DIR="/Users/macmini/projects/uttu/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/dart_$(date +%Y%m%d).log"

echo "=== start: $(date '+%Y-%m-%d %H:%M:%S KST') target=$TARGET ===" | tee -a "$LOG"
cd /Users/macmini/projects/uttu
source .env 2>/dev/null || true

worker/.venv/bin/python3 -m worker.scrapers.dart_scraper \
  --target "$TARGET" \
  --disc-years 10 \
  --fin-years 3 \
  >> "$LOG" 2>&1

echo "=== done: $(date '+%Y-%m-%d %H:%M:%S KST') ===" | tee -a "$LOG"
