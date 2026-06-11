"""
일간 요약 알림 — 이상탐지 완료 후 호출.
구독자(daily_summary, enabled=true)에게 user_notifications 1건 INSERT.
발송은 dispatcher가 처리.

usage:
  python -m worker.tasks.daily_summary [--date YYYY-MM-DD]
"""
from __future__ import annotations

import argparse
import os
from datetime import date, datetime

import pytz
from dotenv import load_dotenv
from loguru import logger

from supabase import Client, create_client

load_dotenv()

KST = pytz.timezone("Asia/Seoul")


def _client() -> Client:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], key)


def _fmt_date(d: date) -> str:
    return d.strftime("%Y.%m.%d")


def build_summary(client: Client, target_date: date) -> tuple[str, str, str]:
    """(title, body, link) 반환."""
    date_str = target_date.isoformat()

    # ── 1. 이상탐지 집계 ─────────────────────────────────────────────────────
    anom_rows = (
        client.table("anomalies")
        .select("severity, anomaly_type, entity_name, entity_type")
        .eq("detection_date", date_str)
        .execute()
        .data or []
    )
    high_anoms = [a for a in anom_rows if a["severity"] == "high"]
    med_anoms  = [a for a in anom_rows if a["severity"] == "medium"]

    # ── 2. 자사 상품 랭킹 상위 5개 (전체·A·1~102위, 중복 제거) ──────────────
    own_ranks = (
        client.table("ranking_snapshots")
        .select("product_name, brand_name, rank_position, category_code, gender_filter")
        .eq("snapshot_date", date_str)
        .eq("category_code", "000")   # 전체 카테고리
        .eq("gender_filter", "A")     # 전체 성별
        .lte("rank_position", 50)
        .order("rank_position", desc=False)
        .limit(100)
        .execute()
        .data or []
    )
    # is_own 필터는 ranking_snapshots에 없으므로 brands 조인 대신
    # own products를 별도 조회해 product_name으로 매칭
    own_products = (
        client.table("products")
        .select("name")
        .eq("is_own", True)
        .execute()
        .data or []
    )
    own_names = {p["name"] for p in own_products}
    own_in_ranking = [r for r in own_ranks if r["product_name"] in own_names][:5]

    # ── 3. 새 DART 공시 ───────────────────────────────────────────────────────
    dart_count = (
        client.table("dart_disclosures")
        .select("id", count="exact")
        .eq("rcept_dt", date_str)
        .execute()
        .count or 0
    )

    # ── 본문 구성 ─────────────────────────────────────────────────────────────
    lines: list[str] = []

    # 이상탐지 요약
    total_anom = len(anom_rows)
    if total_anom:
        lines.append(f"이상탐지 {total_anom}건 (HIGH {len(high_anoms)} · MED {len(med_anoms)})")
        for a in high_anoms[:3]:
            name = a.get("entity_name") or ""
            lines.append(f"  ▸ [HIGH] {a['anomaly_type']} {('— ' + name) if name else ''}")
    else:
        lines.append("이상탐지: 특이 사항 없음")

    # 자사 랭킹
    if own_in_ranking:
        rank_strs = [f"{r['product_name']} #{r['rank_position']}" for r in own_in_ranking]
        lines.append("자사 전체 TOP50: " + " · ".join(rank_strs))

    # DART
    if dart_count:
        lines.append(f"신규 공시 {dart_count}건")

    body = "\n".join(lines) if lines else "오늘 주목할 변화가 없습니다."
    title = f"UTTU 일간 요약 — {_fmt_date(target_date)}"
    link  = f"/anomaly?date={date_str}"

    return title, body, link


def run(target_date: date) -> int:
    """일간 요약 생성 후 구독자에게 enqueue. 발송 건수 반환."""
    from worker.notifications.enqueue import enqueue_for_subscribers

    client = _client()
    logger.info(f"daily_summary_start date={target_date}")

    title, body, link = build_summary(client, target_date)
    logger.info(f"daily_summary_built title={title!r}")

    count = enqueue_for_subscribers(
        "daily_summary",
        title=title,
        body=body,
        link=link,
        payload={"date": target_date.isoformat()},
        client=client,
    )
    logger.info(f"daily_summary_enqueued date={target_date} recipients={count}")
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="일간 요약 알림 발송")
    parser.add_argument("--date", default=None, help="기준일 (YYYY-MM-DD, 기본값: 오늘 KST)")
    args = parser.parse_args()

    if args.date:
        target = date.fromisoformat(args.date)
    else:
        target = datetime.now(KST).date()

    run(target)


if __name__ == "__main__":
    main()
