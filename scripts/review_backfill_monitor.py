"""
리뷰 backfill 외부 모니터
- 1시간마다 자동 진행 상황 텔레그램 발송
- 텔레그램 키워드 메시지로 온디맨드 조회 가능
  예: "backfill", "진행상황", "상태", "리뷰" 등

실행: python3 scripts/review_backfill_monitor.py [backfill_pid]
"""
import os
import re
import sys
import time
import pathlib
import threading
from datetime import datetime, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from dotenv import load_dotenv
load_dotenv(pathlib.Path(__file__).parent.parent / ".env")

import httpx
import pytz
from supabase import create_client
from worker.tasks.notify import send

KST       = pytz.timezone("Asia/Seoul")
LOG_FILE  = pathlib.Path(__file__).parent.parent / "logs" / "review_backfill_20260526.log"
MARKER    = pathlib.Path.home() / ".uttu_backfill_started"
INTERVAL  = 3600  # 자동 알림 주기 (1시간)
POLL_SEC  = 15    # getUpdates 폴링 간격

TRIGGER_KEYWORDS = ["backfill", "진행", "상황", "상태", "리뷰", "review", "얼마나", "현재", "progress"]

PROGRESS_RE = re.compile(
    r"\[(\d+)/(\d+) \([\d.]+%\)\] 품번 (\S+) \| 리뷰 ([\d,]+)/([\d,]+) \(([\d.]+)%\) \| 페이지 (\d+)/(\d+)"
)


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────

def _fmt(td: timedelta) -> str:
    total = int(td.total_seconds())
    h, r = divmod(total, 3600)
    m = r // 60
    return f"{h}시간 {m}분"

def _is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False

def _db_review_count() -> int:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    client = create_client(os.environ["SUPABASE_URL"], service_key)
    return client.table("reviews").select("id", count="exact").execute().count or 0

def _latest_progress() -> dict | None:
    if not LOG_FILE.exists():
        return None
    text = LOG_FILE.read_text(errors="replace")
    matches = PROGRESS_RE.findall(text)
    if not matches:
        return None
    prod_idx, prod_total, musinsa_no, rev_now, rev_total, rev_pct, page_now, page_total = matches[-1]
    return {
        "prod_idx":   int(prod_idx),
        "prod_total": int(prod_total),
        "musinsa_no": musinsa_no,
        "rev_now":    int(rev_now.replace(",", "")),
        "rev_total":  int(rev_total.replace(",", "")),
        "rev_pct":    float(rev_pct),
        "page_now":   int(page_now),
        "page_total": int(page_total),
    }

def _backfill_started_at() -> datetime | None:
    if not MARKER.exists():
        return None
    try:
        return datetime.fromisoformat(MARKER.read_text().strip())
    except ValueError:
        return None

def _build_message() -> str:
    p = _latest_progress()
    started_at = _backfill_started_at()
    now = datetime.now(KST)

    prod_idx      = p["prod_idx"]   if p else 0
    prod_total    = p["prod_total"] if p else 9274
    prod_pct      = prod_idx / prod_total * 100 if prod_total else 0
    prod_remain   = prod_total - prod_idx
    musinsa_no    = p["musinsa_no"] if p else "-"
    cur_rev_now   = p["rev_now"]    if p else 0
    cur_rev_total = p["rev_total"]  if p else 0
    cur_rev_pct   = p["rev_pct"]    if p else 0
    page_now      = p["page_now"]   if p else 0
    page_total    = p["page_total"] if p else 0

    total_reviews = _db_review_count()

    elapsed = now - started_at if started_at else timedelta(0)
    if started_at and prod_idx > 0:
        rate_per_prod = elapsed.total_seconds() / prod_idx
        remaining     = timedelta(seconds=rate_per_prod * prod_remain)
        finish_at     = now + remaining
        rem_str       = _fmt(remaining)
        finish_str    = finish_at.strftime("%m/%d %H:%M")
        avg_min       = int(rate_per_prod / 60)
    else:
        rem_str = finish_str = "계산 중"
        avg_min = 0

    pages_remain = page_total - page_now
    cur_rem_str = _fmt(timedelta(seconds=pages_remain * 4)) if pages_remain > 0 else "계산 중"

    return (
        f"[UTTU] 리뷰 backfill — 진행 현황\n"
        f"━━━━━━━━━━━━━━\n"
        f"[ 전체 진행 ]\n"
        f"상품: {prod_idx:,} / {prod_total:,}개 ({prod_pct:.1f}%)\n"
        f"남은 상품: {prod_remain:,}개\n"
        f"DB 리뷰: {total_reviews:,}건\n"
        f"\n"
        f"[ 현재 상품 ]\n"
        f"품번: {musinsa_no}\n"
        f"리뷰: {cur_rev_now:,} / {cur_rev_total:,}건 ({cur_rev_pct:.1f}%)\n"
        f"페이지: {page_now:,} / {page_total:,}\n"
        f"이 상품 잔여: 약 {cur_rem_str}\n"
        f"\n"
        f"[ 시간 ]\n"
        f"시작: {started_at.strftime('%Y-%m-%d %H:%M') if started_at else '-'}\n"
        f"경과: {_fmt(elapsed)}\n"
        f"잔여: {rem_str} (예상)\n"
        f"완료 예정: {finish_str}\n"
        f"\n"
        f"[ 속도 ]\n"
        f"평균 {avg_min}분/상품 | 10페이지/40초"
    )


# ── 텔레그램 polling ───────────────────────────────────────────────────────────

def _reply(chat_id: str, text: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    try:
        httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text},
            timeout=10,
        )
    except Exception as e:
        print(f"[monitor] reply failed: {e}")

def _poll_loop() -> None:
    token  = os.environ.get("TELEGRAM_BOT_TOKEN")
    offset = 0
    print("[monitor] 텔레그램 polling 시작")

    while True:
        try:
            resp = httpx.get(
                f"https://api.telegram.org/bot{token}/getUpdates",
                params={"offset": offset, "timeout": 10, "allowed_updates": ["message"]},
                timeout=15,
            )
            updates = resp.json().get("result", [])
            for upd in updates:
                offset = upd["update_id"] + 1
                msg = upd.get("message", {})
                user_text = (msg.get("text") or "").strip()
                chat_id   = str(msg.get("chat", {}).get("id", ""))
                if not user_text or not chat_id:
                    continue
                if any(kw in user_text.lower() for kw in TRIGGER_KEYWORDS):
                    print(f"[monitor] 온디맨드 요청: '{user_text}'")
                    _reply(chat_id, _build_message())
        except Exception as e:
            print(f"[monitor] poll error: {e}")

        time.sleep(POLL_SEC)


# ── 메인 ──────────────────────────────────────────────────────────────────────

def main() -> None:
    pid = int(sys.argv[1]) if len(sys.argv) > 1 else 3991
    print(f"[monitor] backfill PID={pid} 감시 시작")
    print(f"[monitor] 자동 알림: 1시간마다 / 온디맨드: 키워드 메시지")

    t = threading.Thread(target=_poll_loop, daemon=True)
    t.start()

    send(_build_message())
    last_sent = time.time()

    while True:
        time.sleep(30)

        if not _is_alive(pid):
            send(f"[UTTU] 리뷰 backfill 완료 (PID {pid} 종료)\n\n" + _build_message())
            print(f"[monitor] PID {pid} 종료 감지. 모니터 종료.")
            break

        if time.time() - last_sent >= INTERVAL:
            send(_build_message())
            last_sent = time.time()


if __name__ == "__main__":
    main()
