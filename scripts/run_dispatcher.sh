#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/dispatcher_$(date +%Y%m%d_%H%M%S).log"

cd "$PROJECT_DIR"

echo "[dispatcher] 시작 $(date '+%Y-%m-%d %H:%M:%S')" | tee "$LOG_FILE"

"$PROJECT_DIR/worker/.venv/bin/python3" -m worker.notifications.dispatcher 2>&1 | tee -a "$LOG_FILE"

echo "[dispatcher] 완료 $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$LOG_FILE"
