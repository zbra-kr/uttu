"""
수집 진행상황 모니터링 + 텔레그램 알림
- 각 스크래퍼 완료 시 즉시 알림
- 1시간마다 전체 현황 요약
- 이상탐지·외부뉴스·브리핑: 의존성 기반 자동 실행
  ranking+brand_ranking → detect
  detect+full_collection+reviews → news_collector → briefing_writer
"""
import os, sys, re, time, subprocess
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")
from worker.notifications.channels.telegram import send_telegram

CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]
DATE = datetime.now().strftime("%Y%m%d")
LOG_DIR = Path(__file__).parent.parent / "logs"
ROOT = Path(__file__).parent.parent

def tg(title, body=None):
    send_telegram(CHAT_ID, title, body, None)
    print(f"[TG] {title}")

# 태스크별 완료 마커 (여러 개면 하나라도 있으면 완료)
_DONE_MARKERS = {
    "ranking":         ["=== done:"],
    "brand_ranking":   ["=== done:"],
    "event":           ["=== done:"],
    "dart":            ["=== done:", "=== skip:"],   # skip도 완료로 처리
    "full_collection": ["all done"],
    "reviews":         ["review_smart_done", "job_tracker_finish"],
    "detect":          ["bookmark_detect_done"],
    "news":            ["news_collection_done"],
    "briefing":        ["briefing_run_done"],
}

def log_done(name):
    p = LOG_DIR / f"{name}_{DATE}.log"
    if not p.exists():
        return False
    content = p.read_text(errors="replace").lower()
    for marker in _DONE_MARKERS.get(name, ["=== done:"]):
        if marker.lower() in content:
            return True
    return False

def tail_stat(name, keyword):
    p = LOG_DIR / f"{name}_{DATE}.log"
    if not p.exists():
        return "로그없음"
    lines = [l for l in p.read_text().splitlines() if keyword in l]
    return lines[-1].split(" - ")[-1] if lines else "진행중"

# 초기 알림
tg("🚀 UTTU 수집 시작", "랭킹·브랜드랭킹·이벤트·DART·Full·리뷰 동시 시작")

notified = set()
last_hourly = time.time()
start_time = time.time()

SCRAPERS = [
    ("ranking",         "ranking_combo_done"),
    ("brand_ranking",   "brand_ranking_combo_done"),
    ("event",           "job_tracker_finish"),
    ("dart",            "job_tracker_finish"),
    ("full_collection", "ALL DONE"),
    ("reviews",         "job_tracker_finish"),
]

ALL_STEPS = [
    "ranking", "brand_ranking", "event", "dart",
    "full_collection", "reviews",
    "detect", "news", "briefing",
]

while True:
    now = time.time()

    # ── 완료 감지 → 즉시 알림 ──────────────────────────────────────────────────
    for name, kw in SCRAPERS:
        if name in notified:
            continue
        if log_done(name):
            elapsed = int((now - start_time) / 60)
            tg(f"✅ {name} 완료", f"경과 {elapsed}분")
            notified.add(name)

            # 랭킹+브랜드랭킹 둘 다 완료 → 이상탐지 실행
            if {"ranking", "brand_ranking"} <= notified and "detect" not in notified:
                if log_done("detect"):
                    notified.add("detect")  # 이미 완료 (수동 실행 등)
                else:
                    tg("🔍 이상탐지 시작")
                    ret = subprocess.run(
                        ["worker/.venv/bin/python3", "-m", "worker.detectors.runner"],
                        capture_output=True, text=True, cwd=str(ROOT)
                    )
                    output = ret.stdout + ret.stderr
                    saved_line = next((l for l in output.splitlines() if "anomalies_saved" in l), "")
                    failed = ret.returncode != 0 or ("count=0" in saved_line and "total=0" not in output)
                    if failed:
                        tg("🚨 이상탐지 실패", output[-300:])
                    else:
                        tg("✅ 이상탐지 완료", saved_line.split(" - ")[-1] if saved_line else "")
                    notified.add("detect")

    # ── detect + full_collection + reviews 완료 → 뉴스·브리핑 순차 실행 ────────
    if {"detect", "full_collection", "reviews"} <= notified and "news" not in notified:

        # [a] 외부 뉴스 수집
        if log_done("news"):
            notified.add("news")  # 이미 완료 (수동 실행 등)
        else:
            tg("📰 외부 뉴스 수집 시작")
            try:
                ret = subprocess.run(
                    ["worker/.venv/bin/python3", "-m", "worker.agent.news_collector"],
                    capture_output=True, text=True, cwd=str(ROOT),
                    timeout=1800,
                )
                output = ret.stdout + ret.stderr
                if ret.returncode != 0:
                    tg("🚨 외부 뉴스 수집 실패", output[-400:])
                else:
                    m = re.search(r"total_inserted=(\d+)", output)
                    n_news = m.group(1) if m else "?"
                    tg(f"✅ 외부 뉴스 수집 완료 ({n_news}건)")
            except subprocess.TimeoutExpired:
                tg("🚨 외부 뉴스 수집 타임아웃 (30분 초과)")
            notified.add("news")  # 실패해도 브리핑 진행

        # [b] 브리핑 생성
        if log_done("briefing"):
            notified.add("briefing")  # 이미 완료 (수동 실행 등)
        else:
            tg("✍️ 브리핑 생성 시작")
            try:
                ret = subprocess.run(
                    ["worker/.venv/bin/python3", "-m", "worker.agent.briefing_writer"],
                    capture_output=True, text=True, cwd=str(ROOT),
                    timeout=7200,
                )
                output = ret.stdout + ret.stderr
                if ret.returncode != 0:
                    tg("🚨 브리핑 생성 실패", output[-400:])
                else:
                    m = re.search(r"success=(\d+)", output)
                    n_br = m.group(1) if m else "?"
                    tg(f"✅ 브리핑 생성 완료 ({n_br}/3 audience)")
            except subprocess.TimeoutExpired:
                tg("🚨 브리핑 생성 타임아웃 (2시간 초과)")
            notified.add("briefing")

    # ── 1시간마다 현황 요약 ────────────────────────────────────────────────────
    if now - last_hourly >= 3600:
        done    = [n for n in ALL_STEPS if n in notified]
        pending = [n for n in ALL_STEPS if n not in notified]
        elapsed = int((now - start_time) / 60)
        body = (
            f"경과 {elapsed}분\n"
            f"✅ 완료: {', '.join(done) or '없음'}\n"
            f"⏳ 진행중: {', '.join(pending) or '없음'}"
        )
        tg("📊 수집 현황 (1시간 요약)", body)
        last_hourly = now

    # ── 전부 완료 ──────────────────────────────────────────────────────────────
    all_done = all(n in notified for n in ALL_STEPS)
    if all_done:
        elapsed = int((now - start_time) / 60)
        tg("🎉 전체 수집·브리핑 완료", f"총 {elapsed}분 소요")
        break

    time.sleep(30)
