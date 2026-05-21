#!/bin/bash
# 2시간마다 수집 현황 알림 전송
# 사용: bash scripts/run_notify_loop.sh &
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$ROOT/worker/.venv/bin/python3"

while true; do
  "$PYTHON" -m worker.tasks.notify_status 2>/dev/null || true
  sleep 7200
done
