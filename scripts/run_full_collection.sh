#!/bin/bash
# 전체 수집 파이프라인 (순차 실행)
# 실행 순서:
#   1. 상품 상세 — 경쟁사 (랭킹TOP50+프로모션+스냅2+매거진2)
#   2. 브랜드 상세 — 전체 미수집 브랜드
#   3. 스냅 신규 수집 → skip-detail 정책 갱신
#   4. 매거진 신규 수집 → skip-detail 정책 갱신
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$ROOT/worker/.venv/bin/python3"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
DATE="$(date +%Y%m%d)"

log() { echo "=== $1: $(date '+%Y-%m-%d %H:%M:%S') ===" | tee -a "$LOG_DIR/full_collection_$DATE.log"; }

# ── 1. 상품 상세 — 경쟁사 ──────────────────────────────────────────────────
log "START product_detail"
"$PYTHON" -m worker.scrapers.musinsa_product --limit 6000 \
  2>&1 | tee -a "$LOG_DIR/product_detail_$DATE.log"
log "DONE  product_detail"

# ── 2. 브랜드 상세 ────────────────────────────────────────────────────────
log "START brand_detail"
"$PYTHON" -m worker.scrapers.musinsa_brand --limit 5000 \
  2>&1 | tee -a "$LOG_DIR/brand_detail_$DATE.log"
log "DONE  brand_detail"

# ── 3. 스냅 신규 수집 + skip-detail 정책 갱신 ───────────────────────────
log "START snap"
"$PYTHON" -m worker.scrapers.musinsa_snap \
  2>&1 | tee -a "$LOG_DIR/snap_$DATE.log"
log "DONE  snap — applying skip-detail policy"
"$PYTHON" -m worker.tasks.apply_skip_detail_policy \
  2>&1 | tee -a "$LOG_DIR/skip_detail_$DATE.log"
log "DONE  skip-detail (post-snap)"

# ── 4. 매거진 신규 수집 + skip-detail 정책 갱신 ─────────────────────────
log "START magazine"
"$PYTHON" -m worker.scrapers.musinsa_magazine \
  2>&1 | tee -a "$LOG_DIR/magazine_$DATE.log"
log "DONE  magazine — applying skip-detail policy"
"$PYTHON" -m worker.tasks.apply_skip_detail_policy \
  2>&1 | tee -a "$LOG_DIR/skip_detail_$DATE.log"
log "DONE  skip-detail (post-magazine)"

log "ALL DONE"
