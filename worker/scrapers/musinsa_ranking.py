"""
무신사 상품 랭킹 스크래퍼
API: client.musinsa.com/api/home/web/v5/pans/ranking/sections/199
조합: 13 × 3 × 7 = 273 (CATEGORY_CODES × GENDER_FILTERS × AGE_BANDS)
수집 주기: 매일 01:00 (period=DAILY → 최근 1일 기준)
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

RANKING_URL = "https://client.musinsa.com/api/home/web/v5/pans/ranking/sections/199"

CATEGORY_CODES = ["000", "001", "002", "003", "004", "017", "026", "100", "101", "102", "103", "104", "106"]
GENDER_FILTERS = ["A", "M", "F"]
AGE_BANDS = ["AGE_BAND_ALL", "AGE_BAND_MINOR", "AGE_BAND_20", "AGE_BAND_25", "AGE_BAND_30", "AGE_BAND_35", "AGE_BAND_40"]

KST = pytz.timezone("Asia/Seoul")


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


def _kst_today() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


class RankingScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client

    # ── API 호출 ──────────────────────────────────────────────────────────────

    async def _fetch_ranking(self, category: str, gf: str, age_band: str) -> list[dict[str, Any]]:

        async def _call() -> list[dict[str, Any]]:
            async with httpx.AsyncClient(timeout=30, headers=self.DEFAULT_HEADERS) as http:
                resp = await http.get(
                    RANKING_URL,
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
                return [
                    item
                    for m in modules
                    if m.get("type") == "MULTICOLUMN"
                    for item in m.get("items", [])
                ]

        await self._sleep()
        return await self._with_retry(_call, label=f"ranking/{category}/{gf}/{age_band}")

    # ── DB 헬퍼 ──────────────────────────────────────────────────────────────

    def _product_id_map(self, musinsa_nos: list[str]) -> dict[str, str]:
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

    def _insert_stub_products(self, musinsa_nos: list[str], thumb_map: dict[str, str] | None = None) -> None:
        if not musinsa_nos:
            return
        stubs = [
            {"musinsa_no": no, "name": "(stub)", "is_own": False,
             **({"thumbnail_url": thumb_map[no]} if thumb_map and no in thumb_map else {})}
            for no in musinsa_nos
        ]
        for i in range(0, len(stubs), 500):
            self.client.table("products").upsert(
                stubs[i : i + 500],
                on_conflict="musinsa_no",
                ignore_duplicates=True,
            ).execute()

    def _patch_missing_thumbnails(self, thumb_map: dict[str, str]) -> None:
        """기존 상품 중 thumbnail_url 없는 것만 업데이트."""
        if not thumb_map:
            return
        result = (
            self.client.table("products")
            .select("id, musinsa_no")
            .in_("musinsa_no", list(thumb_map.keys()))
            .is_("thumbnail_url", "null")
            .execute()
        )
        for row in result.data or []:
            url = thumb_map.get(row["musinsa_no"])
            if url:
                self.client.table("products").update({"thumbnail_url": url}).eq("id", row["id"]).execute()

    # ── 파싱 ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_item(
        item: dict[str, Any],
        product_id: str,
        snapshot_date: str,
        category: str,
        gf: str,
        age_band: str,
    ) -> dict[str, Any]:
        mno = str(item["id"])
        rank = item.get("image", {}).get("rank")
        info = item.get("info", {})
        amp = (
            item.get("image", {})
            .get("onClickLike", {})
            .get("eventLog", {})
            .get("amplitude", {})
            .get("payload", {})
        )
        ga4 = (
            item.get("image", {})
            .get("onClickLike", {})
            .get("eventLog", {})
            .get("ga4", {})
            .get("payload", {})
        )
        return {
            "product_id": product_id,
            "snapshot_date": snapshot_date,
            "store_code": "musinsa",
            "category_code": category,
            "gender_filter": gf,
            "age_filter": age_band,
            "rank_position": int(rank) if rank is not None else 0,
            "musinsa_no": mno,
            "product_name": amp.get("product_name") or info.get("productName"),
            "brand_slug": amp.get("brand_id"),
            "brand_name": amp.get("brand_name") or info.get("brandName"),
            "list_price": ga4.get("original_price") or amp.get("original_price"),
            "final_price": info.get("finalPrice"),
            "discount_rate": info.get("discountRatio"),
            "is_sold_out": bool(info.get("isSoldOut", False)),
            "review_count": amp.get("reviewCount"),
            "review_score": amp.get("reviewScore"),
        }

    # ── 수집 루프 ────────────────────────────────────────────────────────────

    async def run_combo(self, category: str, gf: str, age_band: str) -> int:
        """단일 조합 수집. upsert된 행 수 반환."""
        snapshot_date = _kst_today()
        items = await self._fetch_ranking(category, gf, age_band)
        if not items:
            return 0

        # rank 없는 아이템(광고/추천 상품) 제외
        items = [item for item in items if item.get("image", {}).get("rank") is not None]
        musinsa_nos = [str(item["id"]) for item in items]
        thumb_map = {
            str(item["id"]): item["image"]["url"]
            for item in items
            if item.get("image", {}).get("url")
        }
        id_map = self._product_id_map(musinsa_nos)
        missing = [no for no in musinsa_nos if no not in id_map]
        if missing:
            self._insert_stub_products(missing, thumb_map=thumb_map)
            id_map = self._product_id_map(musinsa_nos)
        self._patch_missing_thumbnails(thumb_map)

        rows = [
            self._parse_item(item, id_map[str(item["id"])], snapshot_date, category, gf, age_band)
            for item in items
            if str(item["id"]) in id_map
        ]

        if rows:
            for i in range(0, len(rows), 500):
                self.client.table("ranking_snapshots").upsert(
                    rows[i : i + 500],
                    on_conflict="product_id,snapshot_date,store_code,category_code,gender_filter,age_filter",
                ).execute()

            # ── 브랜드 upsert + brand_id 백필 ───────────────────────────────
            # 1단계: rows에서 slug → name 맵 빌드
            brand_slugs: dict[str, str] = {}
            for row in rows:
                slug = row.get("brand_slug") or ""
                if slug:
                    brand_slugs.setdefault(slug, row.get("brand_name") or "")

            # 2단계: brands upsert → brand_id_map 획득
            brand_id_map: dict[str, str] = {}
            if brand_slugs:
                payloads = [{"slug": s, "name": n} for s, n in brand_slugs.items()]
                for i in range(0, len(payloads), 500):
                    self.client.table("brands").upsert(
                        payloads[i : i + 500],
                        on_conflict="slug",
                        ignore_duplicates=True,
                    ).execute()
                res = self.client.table("brands").select("id, slug").in_("slug", list(brand_slugs)).execute()
                brand_id_map = {r["slug"]: r["id"] for r in res.data or []}

            # 3단계: brand_id NULL인 상품만 업데이트
            if brand_id_map:
                res = (
                    self.client.table("products")
                    .select("id, musinsa_no")
                    .in_("musinsa_no", list(id_map.keys()))
                    .is_("brand_id", "null")
                    .execute()
                )
                mno_to_id = {r["musinsa_no"]: r["id"] for r in res.data or []}
                for row in rows:
                    pid = mno_to_id.get(row["musinsa_no"])
                    bid = brand_id_map.get(row.get("brand_slug") or "")
                    if pid and bid:
                        self.client.table("products").update({"brand_id": bid}).eq("id", pid).execute()

        logger.info(
            "ranking_combo_done",
            category=category,
            gf=gf,
            age_band=age_band,
            rows=len(rows),
        )
        return len(rows)

    async def run(self, category_codes: list[str] | None = None) -> None:
        """전체 조합 수집. category_codes 지정 시 해당 카테고리만."""
        cats = category_codes or CATEGORY_CODES
        total = 0
        for cat in cats:
            for gf in GENDER_FILTERS:
                for age in AGE_BANDS:
                    total += await self.run_combo(cat, gf, age)
        logger.info("ranking_run_done", total_rows=total)


async def main() -> None:
    client = _supabase_client()
    scraper = RankingScraper(client)
    await scraper.run()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
