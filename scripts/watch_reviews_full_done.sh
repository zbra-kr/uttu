#!/bin/bash
# force-full 전수조사 완료 감지 → run_daily.sh reviews 라인 복구 + 텔레그램 알림
# 백그라운드 실행용: nohup ./scripts/watch_reviews_full_done.sh &

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/logs"

# 오늘 날짜 기준 로그 파일 (날짜가 바뀌어도 처음 설정된 파일을 계속 감시)
LOG_FILE="$LOG_DIR/reviews_backfill_$(date +%Y%m%d).log"

echo "[watcher] force-full 완료 대기 중... log=$LOG_FILE"

# review_backfill_done 마커 대기
while true; do
    # 오늘 로그가 없으면 내일 날짜로 전환
    if [ ! -f "$LOG_FILE" ]; then
        LOG_FILE="$LOG_DIR/reviews_backfill_$(date +%Y%m%d).log"
    fi

    if [ -f "$LOG_FILE" ] && grep -q "review_backfill_done" "$LOG_FILE" 2>/dev/null; then
        break
    fi
    sleep 60
done

echo "[watcher] force-full 완료 감지됨 — run_daily.sh 복구 중..."

DAILY="$ROOT/scripts/run_daily.sh"

# 주석 마커 제거하여 원래 라인 복구
sed -i '' \
    -e 's|^# SKIP_REVIEWS_SMART.*||' \
    -e 's|^# bash "\$ROOT/scripts/run_reviews.sh" --smart|bash "$ROOT/scripts/run_reviews.sh" --smart|' \
    "$DAILY"

echo "[watcher] run_daily.sh 복구 완료"

# 텔레그램 알림
source "$ROOT/.env" 2>/dev/null || true
"$ROOT/worker/.venv/bin/python3" - <<'PYEOF'
import os, sys
sys.path.insert(0, os.environ.get('ROOT', '/Users/macmini/projects/uttu'))
from worker.notifications.channels.telegram import send_telegram
chat_id = os.environ['TELEGRAM_CHAT_ID']
send_telegram(
    chat_id,
    "✅ 리뷰 전수조사 완료",
    "run_daily.sh 스마트 수집 라인 자동 복구됨\n내일 02:00부터 정상 실행됩니다.",
    None
)
print("[watcher] 텔레그램 알림 전송 완료")
PYEOF
