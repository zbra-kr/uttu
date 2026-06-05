#!/usr/bin/env python3
"""
수집 진행상황 상세 Telegram 알림.

파싱 소스:
  - 상품 상세: logs/product_detail_YYYYMMDD.log
  - 리뷰: logs/.progress_session.json 에 저장된 출력 파일 경로
  - 공통: collection_jobs (started_at, status)
  - 리뷰 예상총량: products 테이블 sum(review_count) where is_own=True
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import httpx
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

ROOT = Path(__file__).parent.parent
LOG_DIR = ROOT / "logs"
KST = timezone(timedelta(hours=9))


# ── 텔레그램 ──────────────────────────────────────────────────────────────────

def send_telegram(text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 없음", file=sys.stderr)
        return False
    try:
        resp = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
        return resp.status_code < 400
    except Exception as e:
        print(f"telegram_error: {e}", file=sys.stderr)
        return False


# ── 시간 포맷 ─────────────────────────────────────────────────────────────────

def _fmt_elapsed(start: datetime, end: datetime | None = None) -> str:
    end = end or datetime.now(KST)
    secs = int((end - start).total_seconds())
    h, rem = divmod(secs, 3600)
    m = rem // 60
    return f"{h}시간 {m:02d}분" if h else f"{m}분"


def _fmt_eta(start: datetime, done: int, total: int) -> str:
    if done <= 0 or total <= 0:
        return "계산 중"
    elapsed = (datetime.now(KST) - start).total_seconds()
    rate = elapsed / done  # 초/건
    remaining_secs = rate * (total - done)
    eta = datetime.now(KST) + timedelta(seconds=remaining_secs)
    return eta.strftime("%H:%M")


def _bar(done: int, total: int, width: int = 10) -> str:
    if total <= 0:
        return "░" * width
    pct = min(1.0, done / total)
    filled = round(width * pct)
    return "█" * filled + "░" * (width - filled)


# ── 상품 상세 파싱 ────────────────────────────────────────────────────────────

def parse_product_log(session: dict) -> dict:
    """
    product_detail_YYYYMMDD.log 파싱 → {start, done, total, status}
    로그 파일은 여러 실행이 append되므로 마지막 '=== START' 마커 이후만 카운트.
    """
    date_str = datetime.now(KST).strftime("%Y%m%d")
    log_path = LOG_DIR / f"product_detail_{date_str}.log"

    total = session.get("product_target", 0)
    start_str = session.get("product_start", "")

    result: dict = {"start": None, "done": 0, "total": total, "status": "pending"}

    # 세션 파일의 시작 시각 우선 사용
    if start_str:
        try:
            result["start"] = datetime.fromisoformat(start_str).replace(tzinfo=KST)
        except ValueError:
            pass

    if not log_path.exists():
        return result

    text = log_path.read_text(errors="replace")

    # 마지막 '=== START product_detail:' 마커 이후 텍스트만 사용
    marker = "=== START product_detail:"
    last_idx = text.rfind(marker)
    session_text = text[last_idx:] if last_idx >= 0 else text

    # 시작 시각 — 마커 라인에서 직접 파싱 (세션 파일이 없을 때 fallback)
    if result["start"] is None:
        m = re.search(r"=== START product_detail:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", session_text)
        if m:
            try:
                result["start"] = datetime.fromisoformat(m.group(1)).replace(tzinfo=KST)
            except ValueError:
                pass

    # 완료 수 — 현재 세션 내 product_detail_done 출현 횟수
    result["done"] = session_text.count("product_detail_done")

    # 완료 여부
    if "=== DONE product_detail" in session_text:
        result["status"] = "done"
    elif result["done"] > 0:
        result["status"] = "running"

    return result


# ── 리뷰 파싱 ─────────────────────────────────────────────────────────────────

def parse_review_output(output_path: str) -> dict:
    """review 출력 파일 파싱 → {start, total_groups, total_standalones, done_groups, done_standalones, reviews}"""
    result = {
        "start": None,
        "total_groups": 0,
        "total_standalones": 0,
        "done_groups": 0,
        "done_standalones": 0,
        "reviews": 0,
        "status": "pending",
    }
    path = Path(output_path)
    if not path.exists():
        return result

    text = path.read_text(errors="replace")
    lines = text.splitlines()

    # 시작 시각
    ts_re = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")
    for line in lines:
        m = ts_re.search(line)
        if m:
            try:
                result["start"] = datetime.fromisoformat(m.group(1)).replace(tzinfo=KST)
            except ValueError:
                pass
            break

    # 총 그룹·단독 수 — review_smart_start groups=X standalones=Y
    for line in lines:
        m = re.search(r"review_smart_start groups=(\d+) standalones=(\d+)", line)
        if m:
            result["total_groups"] = int(m.group(1))
            result["total_standalones"] = int(m.group(2))
            break

    # 현재 그룹 진행 — [그룹X/Y] 마지막 출현
    grp_lines = [l for l in lines if re.search(r"\[그룹\d+/\d+\]", l)]
    if grp_lines:
        m = re.search(r"\[그룹(\d+)/(\d+)\]", grp_lines[-1])
        if m:
            result["done_groups"] = int(m.group(1))

    # standalone 진행 — review_smart_standalone_progress X/Y
    sa_lines = [l for l in lines if "review_smart_standalone_progress" in l]
    if sa_lines:
        m = re.search(r"review_smart_standalone_progress (\d+)/(\d+)", sa_lines[-1])
        if m:
            result["done_standalones"] = int(m.group(1))

    # 수집된 리뷰 수 — reviews=N 마지막 출현
    rev_lines = [l for l in lines if "reviews=" in l]
    if rev_lines:
        m = re.search(r"reviews=(\d[\d,]*)", rev_lines[-1])
        if m:
            result["reviews"] = int(m.group(1).replace(",", ""))

    # 완료 여부
    if "review_smart_done" in text or "job_tracker_finish" in text:
        result["status"] = "done"
    elif result["total_groups"] > 0:
        result["status"] = "running"

    return result


# ── 메인 ──────────────────────────────────────────────────────────────────────

def main() -> None:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    client = create_client(os.environ["SUPABASE_URL"], service_key)

    # 세션 파일 로드
    session_file = LOG_DIR / ".progress_session.json"
    session: dict = {}
    if session_file.exists():
        try:
            session = json.loads(session_file.read_text())
        except Exception:
            pass
    review_output_path = session.get("review_output", "")

    # 리뷰 예상 총 리뷰 수 (is_own 상품 review_count 합계)
    try:
        rows = client.table("products").select("review_count").eq("is_own", True).execute().data
        total_reviews_expected = sum((r.get("review_count") or 0) for r in rows)
    except Exception:
        total_reviews_expected = 0

    # 파싱
    pd = parse_product_log(session)
    rv = parse_review_output(review_output_path) if review_output_path else {}

    now = datetime.now(KST)

    lines: list[str] = [
        f"<b>📊 UTTU 수집 진행현황</b>",
        f"<i>{now.strftime('%m/%d %H:%M')} KST</i>",
        "",
    ]

    # ── 상품 상세 ─────────────────────────────────────────────────
    pd_start = pd.get("start")
    pd_done  = pd.get("done", 0)
    pd_total = pd.get("total", 0)
    pd_status = pd.get("status", "pending")
    pd_pct   = int(pd_done / pd_total * 100) if pd_total > 0 else 0

    icon = "✅" if pd_status == "done" else ("🟡" if pd_status == "running" else "⏳")
    lines.append(f"{icon} <b>상품 상세 수집</b>")

    if pd_start:
        lines.append(f"  시작: {pd_start.strftime('%H:%M')}")
        lines.append(f"  경과: {_fmt_elapsed(pd_start)}")
        if pd_status == "running" and pd_total > 0:
            lines.append(f"  예상완료: {_fmt_eta(pd_start, pd_done, pd_total)}")

    if pd_total > 0:
        lines.append(f"  진행: {_bar(pd_done, pd_total)} {pd_pct}%")
        lines.append(f"  수량: {pd_done:,} / {pd_total:,}건")
    elif pd_done > 0:
        lines.append(f"  수집: {pd_done:,}건")

    lines.append("")

    # ── 리뷰 수집 ─────────────────────────────────────────────────
    rv_start     = rv.get("start")
    rv_tot_grp   = rv.get("total_groups", 0)
    rv_tot_sa    = rv.get("total_standalones", 0)
    rv_done_grp  = rv.get("done_groups", 0)
    rv_done_sa   = rv.get("done_standalones", 0)
    rv_reviews   = rv.get("reviews", 0)
    rv_status    = rv.get("status", "pending")

    rv_total_items = rv_tot_grp + rv_tot_sa
    rv_done_items  = rv_done_grp + rv_done_sa
    rv_item_pct    = int(rv_done_items / rv_total_items * 100) if rv_total_items > 0 else 0
    rv_grp_pct     = int(rv_done_grp / rv_tot_grp * 100) if rv_tot_grp > 0 else 0
    rv_rev_pct     = int(rv_reviews / total_reviews_expected * 100) if total_reviews_expected > 0 else 0

    icon = "✅" if rv_status == "done" else ("🟡" if rv_status == "running" else "⏳")
    lines.append(f"{icon} <b>리뷰 수집 (smart)</b>")

    if rv_start:
        lines.append(f"  시작: {rv_start.strftime('%H:%M')}")
        lines.append(f"  경과: {_fmt_elapsed(rv_start)}")
        if rv_status == "running" and rv_total_items > 0:
            lines.append(f"  예상완료: {_fmt_eta(rv_start, rv_done_items, rv_total_items)}")

    if rv_tot_grp > 0:
        lines.append(f"  품번그룹: {_bar(rv_done_grp, rv_tot_grp)} {rv_grp_pct}%")
        lines.append(f"          {rv_done_grp:,} / {rv_tot_grp:,}그룹")

    if rv_tot_sa > 0:
        lines.append(f"  단독상품: {_bar(rv_done_sa, rv_tot_sa)} {int(rv_done_sa/rv_tot_sa*100) if rv_tot_sa else 0}%")
        lines.append(f"          {rv_done_sa:,} / {rv_tot_sa:,}건")

    if total_reviews_expected > 0:
        lines.append(f"  리뷰수량: {_bar(rv_reviews, total_reviews_expected)} {rv_rev_pct}%")
        lines.append(f"          {rv_reviews:,} / {total_reviews_expected:,}건")
    elif rv_reviews > 0:
        lines.append(f"  수집리뷰: {rv_reviews:,}건")

    text = "\n".join(lines)
    print(text)
    ok = send_telegram(text)
    print("전송 완료" if ok else "전송 실패", file=sys.stderr)

    # 두 작업 모두 완료 시 exit 1 → 루프 종료
    if pd_status == "done" and rv_status == "done":
        sys.exit(1)


if __name__ == "__main__":
    main()
