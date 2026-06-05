#!/bin/bash
# 리뷰 재가동 오케스트레이터
# - run_daily.sh (21907/21909) 종료
# - 리뷰 smart 재가동 (600/1331 이어서)
# - 완료 시 watch_force_smart (21081) 즉시 해제
# - collection_monitor (21937) news/briefing 처리 후 자연 종료 대기
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$ROOT/worker/.venv/bin/python3"
LOG_DIR="$ROOT/logs"
WATCHER_LOG="$LOG_DIR/reviews_smart_5day_20260605.log"
MONITOR_LOG="$LOG_DIR/reviews_20260606.log"
ORC_LOG="$LOG_DIR/orchestrator_$(date +%Y%m%d_%H%M%S).log"

exec > >(tee -a "$ORC_LOG") 2>&1

cd "$ROOT"
source .env 2>/dev/null || true

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── 1. run_daily.sh 종료 (21937 collection_monitor는 orphan으로 생존) ─────
log "▶ run_daily.sh 종료 (PID 21909, 21907)"
kill 21909 2>/dev/null && log "  21909 종료" || log "  21909 이미 없음"
sleep 1
kill 21907 2>/dev/null && log "  21907 종료" || log "  21907 이미 없음"
sleep 2

if kill -0 21937 2>/dev/null; then
    log "  ✅ 21937 (collection_monitor) 생존 확인"
else
    log "  ⚠ 21937 소멸 — 뉴스/브리핑 직접 처리로 전환"
    MONITOR_DEAD=1
fi
MONITOR_DEAD=${MONITOR_DEAD:-0}

# ── 2. 리뷰 재가동 ────────────────────────────────────────────────────────
log "▶ 리뷰 스마트 수집 재가동 (daily_cutoff=23h → 기처리 600개 자동 스킵)"
"$PYTHON" -m worker.scrapers.musinsa_review --smart \
  2>&1 | tee -a "$WATCHER_LOG" | tee -a "$MONITOR_LOG"

log "▶ 리뷰 수집 완료"

# ── 3. 21081 (watch_force_smart) 즉시 해제 ───────────────────────────────
log "▶ watch_force_smart (21081) 즉시 해제"
if kill -0 21081 2>/dev/null; then
    SLEEP_PID=$(pgrep -P 21081 2>/dev/null | head -1 || true)
    if [ -n "$SLEEP_PID" ]; then
        kill "$SLEEP_PID" 2>/dev/null && log "  sleep child ($SLEEP_PID) 종료 → 즉시 재확인" || true
    else
        log "  sleep child 없음 (루프 전환 중)"
    fi
    # 21081이 마커를 처리하고 종료할 시간 (최대 10초)
    for i in $(seq 1 10); do
        sleep 1
        if ! kill -0 21081 2>/dev/null; then
            log "  ✅ 21081 자연 종료 (${i}초)"
            break
        fi
    done
    if kill -0 21081 2>/dev/null; then
        log "  ℹ 21081 아직 실행 중 (복구 작업 진행 중)"
    fi
else
    log "  21081 이미 없음"
fi

# ── 4. collection_monitor가 없는 경우 직접 뉴스/브리핑 처리 ─────────────
if [ "$MONITOR_DEAD" = "1" ]; then
    log "▶ [직접] 뉴스 수집 시작"
    DATE="$(date +%Y%m%d)"
    "$PYTHON" -m worker.agent.news_collector \
      2>&1 | tee -a "$LOG_DIR/news_${DATE}.log" || log "  ⚠ 뉴스 수집 실패"
    log "▶ [직접] 브리핑 생성 시작"
    "$PYTHON" -m worker.agent.briefing_writer \
      2>&1 | tee -a "$LOG_DIR/briefing_${DATE}.log" || log "  ⚠ 브리핑 생성 실패"
    log "✅ 직접 처리 완료"
    exit 0
fi

# ── 5. collection_monitor news/briefing 처리 후 자연 종료 대기 ────────────
log "▶ collection_monitor (21937) news/briefing 처리 대기 (타임아웃 2h)"
TIMEOUT=7200
ELAPSED=0
while kill -0 21937 2>/dev/null; do
    sleep 30
    ELAPSED=$((ELAPSED + 30))
    if [ $((ELAPSED % 300)) -eq 0 ]; then
        log "  대기 중... (${ELAPSED}초)"
    fi
    if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
        log "  ⚠ 타임아웃 — collection_monitor 강제 종료"
        kill 21937 2>/dev/null || true
        break
    fi
done

if ! kill -0 21937 2>/dev/null; then
    log "  ✅ collection_monitor 종료 확인"
fi

log "✅ 오케스트레이터 완료"
