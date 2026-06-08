"""
review_probe 완료 감시 → Telegram 결과 리포트 전송.
사용: python -m worker.tools.probe_watcher <로그파일> <품번>
"""
from __future__ import annotations

import re
import sys
import time
from datetime import datetime
from pathlib import Path

import pytz
from dotenv import load_dotenv

load_dotenv()

KST = pytz.timezone("Asia/Seoul")
POLL_SEC = 10
DONE_MARKER = "완료:"          # collect_all 마지막 줄
START_MARKER = "강제수집 시작" # 시작 시각 파싱용
API_TOTAL_MARKER = "API total="
AFTER_MARKER = "수집 후 그룹 reviews"
WRITTEN_MARKER = "이번 수집 신규 삽입"


def _send_telegram(text: str) -> None:
    import os, httpx
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("[watcher] TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID 미설정 — 알림 스킵")
        return
    try:
        r = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True},
            timeout=10,
        )
        print(f"[watcher] Telegram 전송: status={r.status_code}")
    except Exception as e:
        print(f"[watcher] Telegram 실패: {e}")


def _parse_log(log: str, musinsa_no: str) -> str:
    started_at = "?"
    api_total   = "?"
    real_pages  = "?"
    after_cnt   = "?"
    written     = "?"
    finished_at = "?"

    for line in log.splitlines():
        # 시작 시각
        if START_MARKER in line:
            m = re.search(r"시작: (\d{2}:\d{2}:\d{2})", line)
            if m:
                started_at = m.group(1)

        # API total / 실제페이지
        if API_TOTAL_MARKER in line and "실제페이지" in line:
            m = re.search(r"API total=([\d,]+)", line)
            if m:
                api_total = m.group(1)
            m = re.search(r"실제페이지=(\d+)", line)
            if m:
                real_pages = m.group(1)

        # 수집 후 그룹 reviews
        if AFTER_MARKER in line:
            m = re.search(r"reviews\s*=\s*([\d,]+)", line)
            if m:
                after_cnt = m.group(1)

        # 이번 수집 교정/삽입
        if WRITTEN_MARKER in line:
            m = re.search(r"=\s*([\d,]+)", line)
            if m:
                written = m.group(1)

        # 완료 시각
        if DONE_MARKER in line:
            m = re.search(r"완료:\s*(\d{2}:\d{2}:\d{2})", line)
            if m:
                finished_at = m.group(1)

    # 소요시간 계산
    elapsed = "?"
    try:
        fmt = "%H:%M:%S"
        s = datetime.strptime(started_at, fmt)
        e = datetime.strptime(finished_at, fmt)
        diff = (e - s).seconds
        h, r = divmod(diff, 3600)
        m_ = r // 60
        elapsed = f"{h}시간 {m_}분" if h else f"{m_}분"
    except Exception:
        pass

    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    return (
        f"<b>[UTTU] 리뷰 프로브 완료</b>  {now}\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"\n"
        f"품번: <code>{musinsa_no}</code>\n"
        f"API 총 리뷰: {api_total}건 ({real_pages}페이지)\n"
        f"\n"
        f"교정/삽입 건수: <b>{written}건</b>\n"
        f"수집 후 그룹 DB: {after_cnt}건\n"
        f"\n"
        f"시작: {started_at}  완료: {finished_at}  소요: {elapsed}"
    )


def watch(log_path: Path, musinsa_no: str) -> None:
    print(f"[watcher] 감시 시작: {log_path}  품번={musinsa_no}")
    while True:
        if log_path.exists():
            text = log_path.read_text(errors="replace")
            if DONE_MARKER in text:
                print("[watcher] 완료 감지 — Telegram 전송")
                msg = _parse_log(text, musinsa_no)
                print(msg)
                _send_telegram(msg)
                return
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    log_file   = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/probe_fix_1848166.log")
    product_no = sys.argv[2] if len(sys.argv) > 2 else "1848166"
    watch(log_file, product_no)
