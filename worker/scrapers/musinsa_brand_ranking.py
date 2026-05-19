"""
무신사 브랜드 랭킹 스크래퍼
API: client.musinsa.com/api/home/web/v5/pans/ranking/sections/1054
응답: 200개 RANKING_BRAND 모듈 (브랜드 1개 = 1모듈)
조합: 13 × 3 × 7 = 273 (CATEGORY_CODES × GENDER_FILTERS × AGE_BANDS)
부산물: brands 테이블에 slug+name+logo_url upsert
"""

import os
from datetime import datetime
from typing import Any

import httpx
import pytz
from dotenv import load_dotenv
from loguru import logger
from supabase import Client, create_client

from worker.scrapers.base import BaseScraper, BotBlockedError  # noqa: F401

load_dotenv()

BRAND_RANKING_URL = "https://client.musinsa.com/api/home/web/v5/pans/ranking/sections/1054"

CATEGORY_CODES = ["000", "001", "002", "003", "004", "017", "026", "100", "101", "102", "103", "104", "106"]
GENDER_FILTERS = ["A", "M", "F"]
AGE_BANDS = ["AGE_BAND_ALL", "AGE_BAND_MINOR", "AGE_BAND_20", "AGE_BAND_25", "AGE_BAND_30", "AGE_BAND_35", "AGE_BAND_40"]

KST = pytz.timezone("Asia/Seoul")


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


def _kst_today() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


class BrandRankingScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client

    # ── API 호출 ──────────────────────────────────────────────────────────────

    async def _fetch_brand_ranking(
        self, category: str, gf: str, age_band: str
    ) -> list[dict[str, Any]]:

        async def _call() -> list[dict[str, Any]]:
            async with httpx.AsyncClient(timeout=30, headers=self.DEFAULT_HEADERS) as http:
                resp = await http.get(
                    BRAND_RANKING_URL,
                    params={
                        "storeCode": "musinsa",
                        "categoryCode": category,
                        "contentsId": "",
                        "period": "DAILY",
                        "gf": gf,
                        "ageBand": age_band,
                    },
                )
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                modules = resp.json().get("data", {}).get("modules", [])
                return [m for m in modules if m.get("type") == "RANKING_BRAND"]

        await self._sleep()
        return await self._with_retry(_call, label=f"brand_ranking/{category}/{gf}/{age_band}")

    # ── DB 헬퍼 ──────────────────────────────────────────────────────────────

    def _upsert_brands(self, brand_slugs: list[tuple[str, str, str | None]]) -> None:
        """(slug, name, logo_url) 목록 → brands 테이블 upsert (기본 정보만)."""
        rows = [
            {"slug": slug, "name": name, "logo_url": logo_url}
            for slug, name, logo_url in brand_slugs
        ]
        for i in range(0, len(rows), 500):
            self.client.table("brands").upsert(
                rows[i : i + 500],
                on_conflict="slug",
                ignore_duplicates=True,
            ).execute()

    def _brand_id_map(self, slugs: list[str]) -> dict[str, str]:
        id_map: dict[str, str] = {}
        for i in range(0, len(slugs), 1000):
            chunk = slugs[i : i + 1000]
            result = (
                self.client.table("brands")
                .select("id, slug")
                .in_("slug", chunk)
                .execute()
            )
            for row in result.data or []:
                id_map[row["slug"]] = row["id"]
        return id_map

    # ── 파싱 ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_module(module: dict[str, Any]) -> dict[str, Any] | None:
        """RANKING_BRAND 모듈 → (slug, name, logo_url, rank)."""
        t = module.get("title", {})
        rank_str = t.get("rank")
        if rank_str is None:
            return None
        oc = t.get("onClick", {})
        slug = (
            oc.get("eventLog", {})
            .get("ga4", {})
            .get("payload", {})
            .get("brand_id")
        )
        if not slug:
            # URL에서 추출: https://www.musinsa.com/brand/{slug}
            url = oc.get("url", "")
            slug = url.rstrip("/").split("/")[-1] if "/brand/" in url else None
        if not slug:
            return None
        return {
            "slug": slug,
            "brand_name": t.get("title", {}).get("text", ""),
            "brand_image_url": t.get("imageUrl"),
            "rank_position": int(rank_str),
        }

    # ── 수집 루프 ────────────────────────────────────────────────────────────

    async def run_combo(self, category: str, gf: str, age_band: str) -> int:
        snapshot_date = _kst_today()
        modules = await self._fetch_brand_ranking(category, gf, age_band)
        if not modules:
            return 0

        parsed = [self._parse_module(m) for m in modules]
        parsed = [p for p in parsed if p]

        # brands 테이블에 slug+name+logo upsert (최초 등록용)
        brand_info = [(p["slug"], p["brand_name"], p["brand_image_url"]) for p in parsed]
        self._upsert_brands(brand_info)

        slugs = [p["slug"] for p in parsed]
        brand_id_map = self._brand_id_map(slugs)

        rows = [
            {
                "brand_id": brand_id_map.get(p["slug"]),
                "musinsa_brand_slug": p["slug"],
                "brand_name": p["brand_name"],
                "brand_image_url": p["brand_image_url"],
                "snapshot_date": snapshot_date,
                "category_code": category,
                "gender_filter": gf,
                "age_filter": age_band,
                "rank_position": p["rank_position"],
            }
            for p in parsed
        ]

        if rows:
            for i in range(0, len(rows), 500):
                self.client.table("brand_ranking_snapshots").upsert(
                    rows[i : i + 500],
                    on_conflict="musinsa_brand_slug,snapshot_date,category_code,gender_filter,age_filter",
                ).execute()

        logger.info(
            "brand_ranking_combo_done",
            category=category,
            gf=gf,
            age_band=age_band,
            rows=len(rows),
        )
        return len(rows)

    async def run(self, category_codes: list[str] | None = None) -> None:
        cats = category_codes or CATEGORY_CODES
        total = 0
        for cat in cats:
            for gf in GENDER_FILTERS:
                for age in AGE_BANDS:
                    total += await self.run_combo(cat, gf, age)
        logger.info("brand_ranking_run_done", total_rows=total)


async def main() -> None:
    client = _supabase_client()
    scraper = BrandRankingScraper(client)
    await scraper.run()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
