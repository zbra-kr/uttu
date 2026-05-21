"""
수집 대상 정책을 products.labels 에 반영 (배치 덮어쓰기).

stub 상품(detail_fetched_at IS NULL)은 musinsa 공식 라벨이 없으므로
labels 배열을 [] 또는 ['skip-detail'] 로 직접 덮어씀 → 개별 array_remove/append 불필요.

포함 조건 (labels = []):
  - is_own = true
  - 랭킹 TOP50 (rank_position <= 50, 어느 조합이든)
  - 프로모션 상품
  - 최근 스냅 2건 상품
  - 최근 매거진 2건 상품

나머지 미수집 stub → labels = ['skip-detail']
"""

import os
from loguru import logger
from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

BATCH = 500


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


def _get_safe_ids(client: Client) -> set[str]:
    """수집 대상 product UUID 집합 반환."""
    safe: set[str] = set()

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

    # 2. 랭킹 TOP50 — 페이지네이션
    offset = 0
    while True:
        rows = (
            client.table("ranking_snapshots")
            .select("product_id")
            .lte("rank_position", 50)
            .range(offset, offset + 999)
            .execute().data or []
        )
        for r in rows:
            safe.add(r["product_id"])
        if len(rows) < 1000:
            break
        offset += 1000

    # 3. 프로모션
    rows = client.table("promotion_items").select("product_id").execute().data or []
    for r in rows:
        safe.add(r["product_id"])

    # 4. 최근 스냅 2건
    snap_rows = (
        client.table("snaps")
        .select("snap_id")
        .order("published_at", desc=True)
        .limit(2)
        .execute().data or []
    )
    snap_ids = [r["snap_id"] for r in snap_rows]
    if snap_ids:
        rows = client.table("snap_products").select("product_id").in_("snap_id", snap_ids).execute().data or []
        for r in rows:
            safe.add(r["product_id"])

    # 5. 최근 매거진 2건
    mag_rows = (
        client.table("magazine_articles")
        .select("article_id")
        .order("published_at", desc=True)
        .limit(2)
        .execute().data or []
    )
    article_ids = [r["article_id"] for r in mag_rows]
    if article_ids:
        rows = client.table("magazine_article_products").select("product_id").in_("article_id", article_ids).execute().data or []
        for r in rows:
            safe.add(r["product_id"])

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

    # REVIVE: labels = []
    _batch_set_labels(client, to_revive, [])
    # EXCLUDE: labels = ['skip-detail']
    _batch_set_labels(client, to_exclude, ["skip-detail"])

    logger.info("skip_detail_policy_applied", revived=len(to_revive), excluded=len(to_exclude))


if __name__ == "__main__":
    run()
