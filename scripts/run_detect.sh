#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/detect_$(date +%Y%m%d_%H%M%S).log"

cd "$PROJECT_DIR"

echo "[detect] 시작 $(date '+%Y-%m-%d %H:%M:%S')" | tee "$LOG_FILE"

"$PROJECT_DIR/worker/.venv/bin/python3" -m worker.detectors.runner "$@" 2>&1 | tee -a "$LOG_FILE"

echo "[detect] 완료 $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$LOG_FILE"

# 이상탐지 완료 후 일간 요약 알림 발송
echo "[daily_summary] 시작 $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$LOG_FILE"
"$PROJECT_DIR/worker/.venv/bin/python3" -m worker.tasks.daily_summary "$@" 2>&1 | tee -a "$LOG_FILE"
echo "[daily_summary] 완료 $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$LOG_FILE"
