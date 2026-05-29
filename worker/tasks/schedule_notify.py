"""
통합 수집 진행 현황 알림.

모든 스크래퍼가 이 모듈을 통해 Telegram에 통합 포맷으로 상황을 보고한다.
로그 파일 존재 + 완료 마커로 각 태스크 상태를 자동 판단.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytz

KST = pytz.timezone("Asia/Seoul")
LOG_DIR = Path(__file__).parent.parent.parent / "logs"

TASKS: list[dict] = [
    {
        "key": "ranking",
        "label": "랭킹/브랜드랭킹/이벤트/DART",
        "logs": ["ranking_{date}.log", "event_{date}.log"],
        "done_marker": "=== done:",
    },
    {
        "key": "smart_daily",
        "label": "smart 리뷰 (1차 · 일별)",
        "logs": ["reviews_{date}.log"],
        "done_marker": "job_tracker_finish",
    },
    {
        "key": "refresh_own",
        "label": "자사 상품 재수집",
        "logs": ["product_refresh_own_{date}.log"],
        "done_marker": "=== done:",
    },
    {
        "key": "full_collection",
        "label": "경쟁사 상품상세",
        "logs": ["full_collection_{date}.log"],
        "done_marker": "ALL DONE",
    },
    {
        "key": "color_group",
        "label": "color_group 수집",
        "logs": ["color_group_{date}.log"],
        "done_marker": "reviews_color_group_migration_done",
    },
    {
        "key": "smart_chain",
        "label": "smart 리뷰 (2차 · 체인)",
        "logs": ["reviews_smart_{date}.log"],
        "done_marker": "job_tracker_finish",
    },
    {
        "key": "backfill",
        "label": "리뷰 전체수집 (backfill)",
        "logs": ["reviews_backfill_{date}.log"],
        "done_marker": "review_backfill_done",
    },
]

_KEY_TO_TASK = {t["key"]: t for t in TASKS}


def _check_status(task: dict, date: str) -> str:
    """'done' | 'running' | 'pending'"""
    found_any = False
    for log_name in task["logs"]:
        p = LOG_DIR / log_name.format(date=date)
        if p.exists():
            found_any = True
            try:
                if task["done_marker"] in p.read_text(errors="replace"):
                    return "done"
            except OSError:
                pass
    return "running" if found_any else "pending"


def send_progress(
    task_key: str,
    idx: int,
    total: int,
    elapsed_str: str = "",
    rem_str: str = "",
) -> None:
    """현재 태스크 진행률 + 전체 스케줄 상태 테이블을 Telegram으로 전송."""
    from worker.tasks.notify import send

    now = datetime.now(KST)
    date = now.strftime("%Y%m%d")

    lines: list[str] = [
        f"[UTTU] 수집 진행 현황  {now.strftime('%H:%M')}",
        "━━━━━━━━━━━━━━━━━━",
        "",
    ]

    for task in TASKS:
        key = task["key"]
        label = task["label"]

        if key == task_key:
            pct = idx / total * 100 if total else 0
            lines.append(f"▶ {label}")
            detail = f"   {idx:,}/{total:,} ({pct:.1f}%)"
            if elapsed_str and rem_str:
                detail += f"  |  경과 {elapsed_str} / 잔여 {rem_str}"
            elif elapsed_str:
                detail += f"  |  경과 {elapsed_str}"
            lines.append(detail)
        else:
            st = _check_status(task, date)
            if st == "done":
                lines.append(f"✅ {label}")
            elif st == "running":
                lines.append(f"▶ {label}  (진행 중)")
            else:
                # backfill은 특수 케이스 — 해당 날짜 로그 없으면 숨김
                if key == "backfill":
                    continue
                lines.append(f"⏳ {label}")

    send("\n".join(lines))


def send_done(task_key: str, summary: str = "") -> None:
    """태스크 완료 알림 (진행률 100% + 요약)."""
    task = _KEY_TO_TASK.get(task_key, {})
    label = task.get("label", task_key)

    from worker.tasks.notify import send

    now = datetime.now(KST)
    date = now.strftime("%Y%m%d")

    lines: list[str] = [
        f"[UTTU] 수집 진행 현황  {now.strftime('%H:%M')}",
        "━━━━━━━━━━━━━━━━━━",
        "",
    ]

    for task in TASKS:
        key = task["key"]
        lbl = task["label"]

        if key == task_key:
            lines.append(f"✅ {lbl}  완료")
            if summary:
                lines.append(f"   {summary}")
        else:
            st = _check_status(task, date)
            if st == "done":
                lines.append(f"✅ {lbl}")
            elif st == "running":
                lines.append(f"▶ {lbl}  (진행 중)")
            else:
                if key == "backfill":
                    continue
                lines.append(f"⏳ {lbl}")

    send("\n".join(lines))
