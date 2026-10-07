"""Collection reporting; settled attempts retain the existing dependency policy.

Importing this module never loads credentials, sends messages, or starts jobs.
"""
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


_DONE_MARKERS = {
    "ranking": ["=== done:"],
    "brand_ranking": ["=== done:"],
    "event": ["=== done:"],
    "dart": ["=== done:", "=== skip:"],
    "full_collection": ["all done"],
    "reviews": ["review_smart_done", "job_tracker_finish"],
    "detect": ["bookmark_detect_done"],
    "news": ["news_collection_done"],
    "briefing": ["briefing_run_done"],
}
SCRAPERS = ["ranking", "brand_ranking", "event", "dart", "full_collection", "reviews"]
ALL_STEPS = [*SCRAPERS, "detect", "news", "briefing"]


def completion_message(line, markers):
    """Match the exact event in bare/default Loguru text or shell marker lines."""
    message = line.strip().lower()
    # Strip only recognized log envelopes, never arbitrary quoted/error text.
    message = re.sub(
        r"^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)?\s+\|\s+\w+\s+\|"
        r"\s+[\w.]+:[\w<>]+:\d+\s+-\s+", "", message)
    message = re.sub(r"^\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+\|\s+\w+\s+\|\s+", "", message)
    token = message.split(maxsplit=1)
    for marker in markers:
        if marker == "all done":
            if re.match(r"^===\s+all done(?::|\s+===)", message):
                return message
        elif marker.startswith("==="):
            if message.startswith(marker + " "):
                return message
        elif token and token[0] == marker:
            return message
    return None


def log_outcome(name, root, date_token):
    """Observe existing daily completion markers, without claiming process health."""
    path = root / "logs" / f"{name}_{date_token}.log"
    if not path.exists():
        return None
    content = path.read_text(errors="replace")
    if name == "reviews" and "Collection skipped:" in content:
        return "skipped"
    markers = _DONE_MARKERS.get(name, ["=== done:"])
    matching = [message for line in content.splitlines()
                if (message := completion_message(line, markers)) is not None]
    if not matching:
        return None
    # DART's failed skip was already settled; retain that gate, report its failure.
    if name == "dart" and "=== skip: failed" in matching[-1]:
        return "failed"
    return "completed"


def outcome_summary(outcomes):
    groups = [("completed", "완료 기록"), ("failed", "실패"),
              ("timed_out", "시간 초과"), ("blocked", "시작 불가/미실행"),
              ("unknown", "모니터 중단, 수집기 상태 미확인"),
              ("skipped", "별도 수집/복구 작업으로 생략")]
    lines = [f"{label}: {', '.join(name for name in ALL_STEPS if outcomes.get(name) == state) or '없음'}"
             for state, label in groups]
    pending = [name for name in ALL_STEPS if name not in outcomes]
    lines.append(f"진행/미확인: {', '.join(pending) or '없음'}")
    return "\n".join(lines)


def run_step(name, root, notify, runner):
    modules = {"detect": "worker.detectors.runner", "news": "worker.agent.news_collector",
               "briefing": "worker.agent.briefing_writer"}
    labels = {"detect": "이상탐지", "news": "외부 뉴스 수집", "briefing": "브리핑 생성"}
    label = labels[name]
    notify(f"▶ {label} 시작")
    options = {"capture_output": True, "text": True, "cwd": str(root)}
    if name in {"news", "briefing"}:
        options["timeout"] = 1800 if name == "news" else 7200
    try:
        result = runner(["worker/.venv/bin/python3", "-m", modules[name]], **options)
        output = (result.stdout or "") + (result.stderr or "")
        saved = next((line for line in output.splitlines() if "anomalies_saved" in line), "")
        failed = result.returncode != 0 or (name == "detect" and
                  "count=0" in saved and "total=0" not in output)
        if failed:
            notify(f"🚨 {label} 실패", output[-400:])
            return "failed"
        notify(f"✅ {label} 완료")
        return "completed"
    except subprocess.TimeoutExpired:
        notify(f"🚨 {label} 시간 초과")
        return "timed_out"
    except OSError as exc:
        notify(f"🚨 {label} 시작 불가", type(exc).__name__)
        return "blocked"
    except Exception as exc:
        notify(f"🚨 {label} 실행 실패", type(exc).__name__)
        return "failed"


def run_monitor(root, date_token, notify, clock=time.time, sleeper=time.sleep,
                runner=subprocess.run, observe=log_outcome):
    """Outcomes affect reporting/exit; settled membership still controls scheduling."""
    root = Path(root)
    settled, attempted, outcomes = set(), set(), {}
    start = last_hourly = clock()

    def settle(name, state):
        settled.add(name)
        outcomes[name] = state

    def execute(name):
        attempted.add(name)
        return run_step(name, root, notify, runner)

    def finish(interrupted=False):
        if interrupted:
            for name in ALL_STEPS:
                if name not in settled:
                    # Independent collectors are not owned/stopped by this monitor.
                    # An interrupted downstream attempt may also still be running.
                    outcomes[name] = "unknown" if name in SCRAPERS or name in attempted else "blocked"
        success = not interrupted and all(outcomes.get(name) == "completed" for name in ALL_STEPS)
        title = "✅ 전체 수집·브리핑 완료 기록" if success else "⚠ 수집·브리핑 종료 — 실패/미완료 포함"
        notify(title, outcome_summary(outcomes))
        return 130 if interrupted else 0 if success else 1

    notify("🚀 UTTU 수집 시작", "랭킹·브랜드랭킹·이벤트·DART·Full·리뷰 동시 시작")
    try:
        while True:
            now = clock()
            for name in SCRAPERS:
                if name in settled:
                    continue
                state = observe(name, root, date_token)
                if state is not None:
                    settle(name, state)
                    if state == "skipped":
                        notify("⏭️ 정기 리뷰 수집 생략", "다른 리뷰 수집/복구 작업 실행 중. 완료 여부는 해당 작업에서 확인합니다.")
                    else:
                        notify(f"{name} 완료 기록" if state == "completed" else f"{name} 실패 기록")

                # Preserve the ranking/brand settled gate and single detection attempt.
                if {"ranking", "brand_ranking"} <= settled and "detect" not in settled:
                    state = observe("detect", root, date_token)
                    settle("detect", state if state is not None else execute("detect"))

            # Preserve the explicit full-collection timeout/force-pass policy.
            if "full_collection" not in settled and now - start >= 6 * 3600:
                notify("⏰ full_collection 시간 초과 (6h) — 기존 정책에 따라 후속 진행")
                settle("full_collection", "timed_out")

            if {"detect", "full_collection"} <= settled and "news" not in settled:
                state = observe("news", root, date_token)
                settle("news", state if state is not None else execute("news"))
                # News remains optional: failure/timeout still proceeds to briefing.
                state = observe("briefing", root, date_token)
                settle("briefing", state if state is not None else execute("briefing"))

            if now - last_hourly >= 3600:
                notify("📊 수집 현황 (1시간 요약)", outcome_summary(outcomes))
                last_hourly = now
            if all(name in settled for name in ALL_STEPS):
                return finish()
            sleeper(30)
    except KeyboardInterrupt:
        return finish(interrupted=True)
    except Exception as exc:
        notify("🚨 모니터 중단", type(exc).__name__)
        finish(interrupted=True)
        return 1


def main():
    root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(root))
    from dotenv import load_dotenv

    from worker.notifications.channels.telegram import send_telegram

    load_dotenv(root / ".env")
    chat_id = os.environ["TELEGRAM_CHAT_ID"]

    def notify(title, body=None):
        send_telegram(chat_id, title, body, None)
        print(f"[TG] {title}")
        if body:
            print(body)

    return run_monitor(root, datetime.now().strftime("%Y%m%d"), notify)


if __name__ == "__main__":
    sys.exit(main())
