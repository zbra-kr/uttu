"""
무신사 스냅 스크래퍼 — CODISHOP_SNAP + MUSINSA_SNAP 수집
API: content.musinsa.com/api2/content/snap/v1/snaps
인증: 불필요 (쿠키 없이 200 반환)
수집 주기: 매일 증분 (snap_id UNIQUE으로 중복 자동 스킵)
상품 연결: goods[].goodsNo → products 스텁 삽입 후 snap_products 연결
"""

import os
from typing import Any

import httpx
from dotenv import load_dotenv
from loguru import logger
from supabase import Client, create_client

from worker.scrapers.base import BaseScraper, BotBlockedError  # noqa: F401

load_dotenv()

SNAP_LIST_URL = "https://content.musinsa.com/api2/content/snap/v1/snaps"
CONTENT_TYPES = ["CODISHOP_SNAP", "MUSINSA_SNAP"]
PAGE_SIZE = 40
MAX_PAGES = 100  # 최대 4,000건/타입 — 초기 수집 시 충분한 범위


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


class SnapScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client

    # ── API 호출 ──────────────────────────────────────────────────────────────

    async def _fetch_page(self, content_type: str, page: int) -> list[dict[str, Any]]:
        """스냅 목록 한 페이지 조회."""

        async def _call() -> list[dict[str, Any]]:
            async with httpx.AsyncClient(timeout=30, headers=self.DEFAULT_HEADERS) as http:
                resp = await http.get(
                    SNAP_LIST_URL,
                    params={
                        "page": page,
                        "pageSize": PAGE_SIZE,
                        "sort": "LATEST",
                        "contentTypes": content_type,
                    },
                )
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return resp.json().get("data", {}).get("list", [])

        await self._sleep()
        return await self._with_retry(_call, label=f"snaps/{content_type}/page/{page}")

    # ── DB 헬퍼 ──────────────────────────────────────────────────────────────

    def _existing_snap_ids(self, snap_ids: list[str]) -> set[str]:
        if not snap_ids:
            return set()
        result = (
            self.client.table("snaps")
            .select("snap_id")
            .in_("snap_id", snap_ids)
            .execute()
        )
        return {row["snap_id"] for row in (result.data or [])}

    def _product_id_map(self, musinsa_nos: list[str]) -> dict[str, str]:
        """musinsa_no → product UUID 배치 조회 (1,000행 상한 준수)."""
        id_map: dict[str, str] = {}
        for i in range(0, len(musinsa_nos), 1000):
            chunk = musinsa_nos[i : i + 1000]
            result = (
                self.client.table("products")
                .select("id, musinsa_no")
                .in_("musinsa_no", chunk)
                .execute()
            )
            for row in result.data or []:
                id_map[row["musinsa_no"]] = row["id"]
        return id_map

    def _insert_stub_products(self, musinsa_nos: list[str]) -> None:
        """products에 없는 번호를 스텁으로 삽입 — run_product.sh가 상세 채움."""
        if not musinsa_nos:
            return
        stubs = [{"musinsa_no": no, "name": "(stub)", "is_own": False} for no in musinsa_nos]
        for i in range(0, len(stubs), 500):
            self.client.table("products").upsert(
                stubs[i : i + 500],
                on_conflict="musinsa_no",
                ignore_duplicates=True,
            ).execute()
        logger.info("stub_products_inserted", count=len(musinsa_nos))

    # ── 파싱 ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_snap(item: dict[str, Any]) -> dict[str, Any]:
        agg = item.get("aggregations") or {}
        model = item.get("model") or {}
        return {
            "snap_id": str(item["id"]),
            "content_type": item.get("contentType", ""),
            "format_type": item.get("formatType", "POST"),
            "published_at": item.get("createdAt"),
            "like_count": agg.get("likeCount", 0) or 0,
            "view_count": agg.get("viewCount", 0) or 0,
            "comment_count": agg.get("commentCount", 0) or 0,
            "goods_click_count": agg.get("goodsClickCount", 0) or 0,
            "model_gender": model.get("gender"),
            "model_height": model.get("height"),
            "model_weight": model.get("weight"),
        }

    # ── 수집 루프 ────────────────────────────────────────────────────────────

    async def _run_content_type(self, content_type: str) -> int:
        """한 contentType 증분 수집. 수집된 스냅 수 반환."""
        logger.info("snap_type_start", content_type=content_type)
        total = 0

        for page in range(1, MAX_PAGES + 1):
            items = await self._fetch_page(content_type, page)
            if not items:
                logger.info("snap_empty_page", content_type=content_type, page=page)
                break

            snap_ids = [str(item["id"]) for item in items]
            existing = self._existing_snap_ids(snap_ids)
            new_items = [item for item in items if str(item["id"]) not in existing]

            if not new_items:
                logger.info("snap_reached_existing", content_type=content_type, page=page)
                break

            # 1) 신규 상품 스텁 삽입
            all_nos: list[str] = [
                str(g["goodsNo"])
                for item in new_items
                for g in (item.get("goods") or [])
                if g.get("goodsNo")
            ]
            unique_nos = list(dict.fromkeys(all_nos))
            id_map: dict[str, str] = {}
            if unique_nos:
                id_map = self._product_id_map(unique_nos)
                missing = [no for no in unique_nos if no not in id_map]
                if missing:
                    self._insert_stub_products(missing)
                    id_map = self._product_id_map(unique_nos)

            # 2) snaps upsert
            snap_rows = [self._parse_snap(item) for item in new_items]
            self.client.table("snaps").upsert(
                snap_rows, on_conflict="snap_id", ignore_duplicates=True
            ).execute()

            # 3) snap_products 삽입
            sp_rows: list[dict[str, Any]] = []
            for item in new_items:
                sid = str(item["id"])
                for g in item.get("goods") or []:
                    mno = str(g["goodsNo"]) if g.get("goodsNo") else None
                    if not mno:
                        continue
                    pid = id_map.get(mno)
                    if not pid:
                        continue
                    sp_rows.append(
                        {
                            "snap_id": sid,
                            "product_id": pid,
                            "musinsa_no": mno,
                            "goods_platform": g.get("goodsPlatform", "MUSINSA"),
                        }
                    )

            if sp_rows:
                self.client.table("snap_products").upsert(
                    sp_rows,
                    on_conflict="snap_id,musinsa_no",
                    ignore_duplicates=True,
                ).execute()

            total += len(new_items)
            logger.info(
                "snap_page_done",
                content_type=content_type,
                page=page,
                new=len(new_items),
                sp=len(sp_rows),
                cumulative=total,
            )

            # 페이지 일부만 신규 → 다음 페이지부터 전부 기존
            if len(new_items) < len(items):
                break

        logger.info("snap_type_done", content_type=content_type, total=total)
        return total

    async def run(self) -> None:
        grand_total = 0
        for ct in CONTENT_TYPES:
            grand_total += await self._run_content_type(ct)
        logger.info("snap_run_done", total_snaps=grand_total)


async def main() -> None:
    client = _supabase_client()
    scraper = SnapScraper(client)
    await scraper.run()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
