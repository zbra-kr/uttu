"""
수집 진행상황 모니터링 + 텔레그램 알림
- 각 스크래퍼 완료 시 즉시 알림
- 1시간마다 전체 현황 요약
"""
import os, sys, time, subprocess
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")
from worker.notifications.channels.telegram import send_telegram

CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]
DATE = datetime.now().strftime("%Y%m%d")
LOG_DIR = Path(__file__).parent.parent / "logs"

def tg(title, body=None):
    send_telegram(CHAT_ID, title, body, None)
    print(f"[TG] {title}")

def log_done(name):
    p = LOG_DIR / f"{name}_{DATE}.log"
    if not p.exists():
        return False
    content = p.read_text()
    return "=== done:" in content.lower() or "=== all done" in content.lower()

def tail_stat(name, keyword):
    p = LOG_DIR / f"{name}_{DATE}.log"
    if not p.exists():
        return "로그없음"
    lines = [l for l in p.read_text().splitlines() if keyword in l]
    return lines[-1].split(" - ")[-1] if lines else "진행중"

# 초기 알림
tg("🚀 UTTU 수집 시작 (5/26)", "랭킹·브랜드랭킹·이벤트·DART·Full 동시 시작")

notified = set()
last_hourly = time.time()
start_time = time.time()

SCRAPERS = [
    ("ranking",       "ranking_combo_done"),
    ("brand_ranking", "brand_ranking_combo_done"),
    ("event",         "job_tracker_finish"),
    ("dart",          "job_tracker_finish"),
    ("full_collection", "ALL DONE"),
]

while True:
    now = time.time()

    # 완료 감지 → 즉시 알림
    for name, kw in SCRAPERS:
        if name in notified:
            continue
        if log_done(name):
            elapsed = int((now - start_time) / 60)
            tg(f"✅ {name} 완료", f"경과 {elapsed}분")
            notified.add(name)

            # 랭킹+브랜드랭킹 둘 다 완료 → 이상탐지 실행
            if {"ranking", "brand_ranking"} <= notified and "detect" not in notified:
                tg("🔍 이상탐지 시작")
                ret = subprocess.run(
                    ["worker/.venv/bin/python3", "-m", "worker.detectors.runner"],
                    capture_output=True, text=True, cwd=str(Path(__file__).parent.parent)
                )
                saved = next((l for l in ret.stdout.splitlines() if "anomalies_saved" in l), "")
                tg("✅ 이상탐지 완료", saved.split(" - ")[-1] if saved else ret.stdout[-200:])
                notified.add("detect")

            # full_collection 완료 → 리뷰 시작
            if "full_collection" in notified and "review" not in notified:
                tg("📝 리뷰 수집 시작 (25/26년도 ~6,600개)")
                subprocess.Popen(
                    ["worker/.venv/bin/python3", "-m", "worker.scrapers.musinsa_review"],
                    cwd=str(Path(__file__).parent.parent),
                    stdout=open(LOG_DIR / f"reviews_{DATE}.log", "w"),
                    stderr=subprocess.STDOUT
                )
                notified.add("review_started")

    # 리뷰 완료 감지
    if "review_started" in notified and "review" not in notified and log_done("reviews"):
        elapsed = int((now - start_time) / 60)
        tg(f"✅ 리뷰 수집 완료", f"경과 {elapsed}분")
        notified.add("review")

    # 1시간마다 현황 요약
    if now - last_hourly >= 3600:
        done = [n for n in ["ranking","brand_ranking","event","dart","full_collection","detect","review"] if n in notified]
        pending = [n for n in ["ranking","brand_ranking","event","dart","full_collection","detect","review"] if n not in notified]
        elapsed = int((now - start_time) / 60)
        body = f"경과 {elapsed}분\n✅ 완료: {', '.join(done) or '없음'}\n⏳ 진행중: {', '.join(pending) or '없음'}"
        tg("📊 수집 현황 (1시간 요약)", body)
        last_hourly = now

    # 전부 완료
    all_done = all(n in notified for n in ["ranking","brand_ranking","event","dart","full_collection","detect","review"])
    if all_done:
        elapsed = int((now - start_time) / 60)
        tg("🎉 전체 수집 완료", f"총 {elapsed}분 소요")
        break

    time.sleep(30)
