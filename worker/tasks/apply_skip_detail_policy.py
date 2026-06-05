"""
수집 대상 정책을 products.labels 에 반영 (배치 덮어쓰기).

stub 상품(detail_fetched_at IS NULL)은 musinsa 공식 라벨이 없으므로
labels 배열을 [] 또는 ['skip-detail'] 로 직접 덮어씀 → 개별 array_remove/append 불필요.

포함 조건 (labels = []):
  - is_own = true
  - 랭킹 TOP50 (rank_position <= 50, 최근 7일)
  - 프로모션 상품 (당일)
  - 스냅 당일 상품
  - 매거진 당일 상품

나머지 미수집 stub → labels = ['skip-detail']
"""

import os
from datetime import date, timedelta
from loguru import logger
from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

BATCH = 500
RANKING_LOOKBACK_DAYS = 7
DAILY_LOOKBACK_DAYS = 1


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


def _get_safe_ids(client: Client) -> set[str]:
    """수집 대상 product UUID 집합 반환."""
    safe: set[str] = set()
    since_ranking = (date.today() - timedelta(days=RANKING_LOOKBACK_DAYS)).isoformat()
    since_daily = (date.today() - timedelta(days=DAILY_LOOKBACK_DAYS)).isoformat()

    # 1. 자사 상품
    rows = (
        client.table("products")
        .select("id")
        .eq("is_own", True)
        .is_("detail_fetched_at", "null")
        .execute().data or []
    )
    for r in rows:
        safe.add(r["id"])
    logger.info("safe_own", count=len(safe))

    # 2. 랭킹 TOP50 — 최근 7일
    offset = 0
    while True:
        rows = (
            client.table("ranking_snapshots")
            .select("product_id")
            .lte("rank_position", 50)
            .gte("snapshot_date", since_ranking)
            .range(offset, offset + 999)
            .execute().data or []
        )
        for r in rows:
            safe.add(r["product_id"])
        if len(rows) < 1000:
            break
        offset += 1000
    logger.info("safe_after_ranking", count=len(safe))

    # 3. 프로모션 — 당일
    rows = (
        client.table("promotion_items")
        .select("product_id")
        .gte("snapshot_date", since_daily)
        .execute().data or []
    )
    for r in rows:
        if r.get("product_id"):
            safe.add(r["product_id"])
    logger.info("safe_after_promo", count=len(safe))

    # 4. 스냅 — 당일
    snap_rows = (
        client.table("snaps")
        .select("snap_id")
        .gte("collected_at", since_daily)
        .execute().data or []
    )
    snap_ids = [r["snap_id"] for r in snap_rows]
    for i in range(0, len(snap_ids), 200):
        chunk = snap_ids[i:i+200]
        rows = client.table("snap_products").select("product_id").in_("snap_id", chunk).execute().data or []
        for r in rows:
            if r.get("product_id"):
                safe.add(r["product_id"])
    logger.info("safe_after_snap", count=len(safe))

    # 5. 매거진 — 당일
    mag_rows = (
        client.table("magazine_articles")
        .select("article_id")
        .gte("published_at", since_daily)
        .execute().data or []
    )
    article_ids = [str(r["article_id"]) for r in mag_rows]
    for i in range(0, len(article_ids), 200):
        chunk = article_ids[i:i+200]
        rows = client.table("magazine_article_products").select("product_id").in_("article_id", chunk).execute().data or []
        for r in rows:
            if r.get("product_id"):
                safe.add(r["product_id"])
    logger.info("safe_after_magazine", count=len(safe))

    logger.info("safe_ids_collected", count=len(safe))
    return safe


def _batch_set_labels(client: Client, ids: list[str], labels: list[str]) -> None:
    for i in range(0, len(ids), BATCH):
        chunk = ids[i : i + BATCH]
        client.table("products").update({"labels": labels}).in_("id", chunk).execute()


def run() -> None:
    client = _supabase_client()
    safe_ids = _get_safe_ids(client)

    # 전체 미수집 stub 조회
    all_stubs: list[dict] = []
    offset = 0
    while True:
        rows = (
            client.table("products")
            .select("id, is_own")
            .is_("detail_fetched_at", "null")
            .range(offset, offset + 999)
            .execute().data or []
        )
        all_stubs.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000

    logger.info("total_stubs", count=len(all_stubs))

    to_revive  = [r["id"] for r in all_stubs if r["id"] in safe_ids]
    to_exclude = [r["id"] for r in all_stubs if r["id"] not in safe_ids and not r.get("is_own")]

    _batch_set_labels(client, to_revive, [])
    _batch_set_labels(client, to_exclude, ["skip-detail"])

    logger.info("skip_detail_policy_applied", revived=len(to_revive), excluded=len(to_exclude))


if __name__ == "__main__":
    run()
