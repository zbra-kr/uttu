"""
자사 브랜드 상품 전수 수집 스크래퍼
API: api.musinsa.com/api2/dp/v1/plp/goods?brand={slug}&caller=FLAGSHIP&page={n}&pageSize=100
대상: 커버낫(+우먼/키즈/뷰티) / 와키윌리 / 리(+키즈) — 총 ~9,271개
수집 주기: 매일 00:30 (랭킹 수집 전)
products.is_own = True 로 upsert — run_product.sh가 상세 채움
"""

import os
from typing import Any

import httpx
import pytz
from dotenv import load_dotenv
from loguru import logger

from supabase import Client, create_client
from worker.scrapers.base import BaseScraper, BotBlockedError  # noqa: F401

load_dotenv()

GOODS_URL = "https://api.musinsa.com/api2/dp/v1/plp/goods"
KST = pytz.timezone("Asia/Seoul")

# 자사 브랜드 슬러그 → ERP BRANDCD 매핑
OWN_BRANDS: list[dict[str, str]] = [
    {"slug": "covernat",       "erp_brand_code": "CO"},
    {"slug": "covernatwoman",  "erp_brand_code": "CO"},
    {"slug": "covernatkids",   "erp_brand_code": "CO"},
    {"slug": "covernatbeauty", "erp_brand_code": "CO"},
    {"slug": "wackywilly",     "erp_brand_code": "WA"},
    {"slug": "lee",            "erp_brand_code": "LE"},
    {"slug": "leekids",        "erp_brand_code": "LE"},
]


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


class OwnProductScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client

    # ── API 호출 ──────────────────────────────────────────────────────────────

    async def _fetch_page(self, slug: str, page: int) -> dict[str, Any] | None:
        params = {
            "brand": slug,
            "caller": "FLAGSHIP",
            "page": page,
            "pageSize": 100,
        }

        async def _call() -> dict[str, Any]:
            async with httpx.AsyncClient(timeout=30, headers=self.DEFAULT_HEADERS) as http:
                resp = await http.get(GOODS_URL, params=params)
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return resp.json()

        await self._sleep()
        try:
            return await self._with_retry(_call, label=f"own_products/{slug}/page{page}")
        except Exception as e:
            logger.warning("own_products_fetch_failed", slug=slug, page=page, error=str(e))
            return None

    # ── DB 헬퍼 ──────────────────────────────────────────────────────────────

    def _get_brand_id(self, slug: str) -> str | None:
        result = (
            self.client.table("brands")
            .select("id")
            .eq("slug", slug)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0]["id"] if rows else None

    def _ensure_brand(self, slug: str, brand_name: str) -> str | None:
        """brands 테이블에 없으면 최소 정보로 insert 후 id 반환."""
        self.client.table("brands").upsert(
            {"slug": slug, "name": brand_name, "is_own": True},
            on_conflict="slug",
            ignore_duplicates=False,
        ).execute()
        return self._get_brand_id(slug)

    def _mark_brand_own(self, slug: str, erp_brand_code: str) -> None:
        self.client.table("brands").update(
            {"is_own": True, "erp_brand_code": erp_brand_code}
        ).eq("slug", slug).execute()

    # ── 수집 루프 ────────────────────────────────────────────────────────────

    async def run_brand(self, slug: str, erp_brand_code: str) -> int:
        """단일 브랜드 전체 페이지 수집. upsert된 상품 수 반환."""
        page = 1
        total_upserted = 0
        brand_id: str | None = None
        brand_name: str = slug

        while True:
            resp = await self._fetch_page(slug, page)
            if not resp:
                break

            data = resp.get("data") or {}
            items: list[dict[str, Any]] = data.get("list") or []
            pagination = data.get("pagination") or {}

            if not items:
                break

            # 첫 페이지에서 brand 정보 확보
            if page == 1:
                if items:
                    brand_name = items[0].get("brandName", slug)
                brand_id = self._ensure_brand(slug, brand_name)
                self._mark_brand_own(slug, erp_brand_code)
                logger.info(
                    "own_products_brand_start",
                    slug=slug,
                    erp=erp_brand_code,
                    total=pagination.get("totalCount"),
                    pages=pagination.get("totalPages"),
                )

            rows = [
                {
                    "musinsa_no": str(item["goodsNo"]),
                    "name": item.get("goodsName", "(stub)"),
                    "thumbnail_url": item.get("thumbnail"),
                    "is_own": True,
                    "brand_id": brand_id,
                }
                for item in items
                if item.get("goodsNo") and not item.get("isAd", False)
            ]

            if rows:
                for i in range(0, len(rows), 500):
                    self.client.table("products").upsert(
                        rows[i : i + 500],
                        on_conflict="musinsa_no",
                        ignore_duplicates=False,
                    ).execute()
                total_upserted += len(rows)

            logger.debug(
                "own_products_page_done",
                slug=slug,
                page=page,
                items=len(rows),
                has_next=pagination.get("hasNext"),
            )

            if not pagination.get("hasNext"):
                break
            page += 1

        logger.info("own_products_brand_done", slug=slug, total_upserted=total_upserted)
        return total_upserted

    async def run(self) -> int:
        """모든 자사 브랜드 전수 수집."""
        grand_total = 0
        for brand in OWN_BRANDS:
            grand_total += await self.run_brand(brand["slug"], brand["erp_brand_code"])
        logger.info("own_products_run_done", grand_total=grand_total)
        return grand_total


async def main() -> None:
    client = _supabase_client()
    scraper = OwnProductScraper(client)
    await scraper.run()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
