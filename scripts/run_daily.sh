#!/bin/bash
# 매일 02:00 자동 수집 파이프라인
# cron: 0 2 * * * /Users/macmini/projects/uttu/scripts/run_daily.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$ROOT/worker/.venv/bin/python3"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
DATE="$(date +%Y%m%d)"

cd "$ROOT"
source .env 2>/dev/null || true

# ── 1단계: 랭킹·브랜드랭킹·이벤트·DART·추천판 동시 시작 ──────────────────
bash "$ROOT/scripts/run_ranking.sh"       > "$LOG_DIR/ranking_${DATE}.log"       2>&1 &
bash "$ROOT/scripts/run_brand_ranking.sh" > "$LOG_DIR/brand_ranking_${DATE}.log" 2>&1 &
bash "$ROOT/scripts/run_event.sh"         > "$LOG_DIR/event_${DATE}.log"         2>&1 &
bash "$ROOT/scripts/run_dart.sh"          > "$LOG_DIR/dart_${DATE}.log"          2>&1 &
bash "$ROOT/scripts/run_recommend.sh"     > "$LOG_DIR/recommend_${DATE}.log"     2>&1 &

# ── 2단계: Full collection (상품·브랜드·스냅·매거진) ─────────────────────
bash "$ROOT/scripts/run_full_collection.sh" > "$LOG_DIR/full_collection_${DATE}.log" 2>&1 &

# ── 2.5단계: 리뷰 스마트 수집 (전체 자사 상품, 증분) ────────────────────

bash "$ROOT/scripts/run_reviews.sh" --smart  > "$LOG_DIR/reviews_${DATE}.log"        2>&1 &

# ── 3단계: 모니터 (완료 감지 + 이상탐지 + 리뷰 + 텔레그램) ──────────────
"$PYTHON" -u "$ROOT/scripts/collection_monitor.py" >> "$LOG_DIR/monitor_${DATE}.log" 2>&1
