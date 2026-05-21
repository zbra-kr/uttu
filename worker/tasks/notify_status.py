"""
현재 수집 상태를 조회해 Teams + Telegram으로 전송.
"""

import os
from datetime import datetime
import pytz
from dotenv import load_dotenv
from supabase import Client, create_client
from worker.tasks.notify import send

load_dotenv()

KST = pytz.timezone("Asia/Seoul")


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


def run() -> None:
    client = _supabase_client()
    now = datetime.now(KST).strftime("%m/%d %H:%M")

    # 상품 상세
    res = client.table("products").select("id", count="exact").execute()
    total = res.count or 0

    done = (client.table("products").select("id", count="exact")
            .not_.is_("detail_fetched_at", "null").execute().count or 0)
    pending = (client.table("products").select("id", count="exact")
               .is_("detail_fetched_at", "null")
               .filter("labels", "not.cs", "{skip-detail}").execute().count or 0)
    excluded = (client.table("products").select("id", count="exact")
                .filter("labels", "cs", "{skip-detail}").execute().count or 0)

    # 브랜드 상세
    brand_total = (client.table("brands").select("id", count="exact").execute().count or 0)
    brand_done  = (client.table("brands").select("id", count="exact")
                   .not_.is_("detail_fetched_at", "null").execute().count or 0)
    brand_pct   = round(brand_done / brand_total * 100) if brand_total else 0

    # 랭킹 스냅샷
    snap_dates = (client.table("ranking_snapshots").select("snapshot_date")
                  .order("snapshot_date", desc=True).limit(1).execute().data or [])
    latest_snap = snap_dates[0]["snapshot_date"] if snap_dates else "—"

    # 법인 (companies)
    company_count = (client.table("companies").select("id", count="exact").execute().count or 0)

    # 리뷰
    review_count = (client.table("reviews").select("id", count="exact").execute().count or 0)

    product_pct = round(done / (done + pending) * 100) if (done + pending) > 0 else 100

    lines = [
        f"[UTTU] 수집 현황 ({now} KST)",
        "",
        f"📦 상품 상세",
        f"  완료 {done:,} / 대기 {pending:,} / 제외 {excluded:,}  ({product_pct}%)",
        f"  └ 법인(companies) {company_count:,}개 등록",
        f"",
        f"🏷 브랜드 상세",
        f"  완료 {brand_done:,} / 전체 {brand_total:,}  ({brand_pct}%)",
        f"",
        f"📊 랭킹 스냅샷 최근일: {latest_snap}",
        f"⭐ 리뷰: {review_count:,}개",
    ]

    send("\n".join(lines))


if __name__ == "__main__":
    run()
