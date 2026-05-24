"""
무신사 프로모션(세일탭) 스크래퍼
API: api.musinsa.com/api2/hm/web/v3/pans/sale/modules?storeCode=musinsa
테이블: promotions (모듈 헤더) + promotion_items (개별 상품)
수집 주기: 매일 02:00
"""

import os
from datetime import datetime, timedelta
from typing import Any

import httpx
import pytz
from dotenv import load_dotenv
from loguru import logger
from supabase import Client, create_client

from worker.scrapers.base import BaseScraper, BotBlockedError  # noqa: F401

load_dotenv()

PROMOTIONS_URL = "https://api.musinsa.com/api2/hm/web/v3/pans/sale/modules"
KST = pytz.timezone("Asia/Seoul")


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


def _kst_today() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


def _classify_type(module_id: str) -> str:
    if "ONEROW" in module_id:
        return "limited_offer"
    if "TWOROW" in module_id:
        return "daily_sale"
    if "BRAND" in module_id:
        return "brand_week"
    return "general"


def _ms_to_iso(ms: int | None) -> str | None:
    if ms is None:
        return None
    return datetime.utcfromtimestamp(ms / 1000).strftime("%Y-%m-%dT%H:%M:%S+00:00")


class EventScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client

    # ── API 호출 ──────────────────────────────────────────────────────────────

    async def _fetch_modules(self) -> list[dict[str, Any]]:

        async def _call() -> list[dict[str, Any]]:
            async with httpx.AsyncClient(timeout=30, headers=self.DEFAULT_HEADERS) as http:
                resp = await http.get(PROMOTIONS_URL, params={"storeCode": "musinsa"})
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return resp.json().get("data", {}).get("modules", [])

        await self._sleep()
        return await self._with_retry(_call, label="promotions")

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

    def _insert_stub_products(self, musinsa_nos: list[str]) -> None:
        if not musinsa_nos:
            return
        stubs = [{"musinsa_no": no, "name": "(stub)", "is_own": False} for no in musinsa_nos]
        for i in range(0, len(stubs), 500):
            self.client.table("products").upsert(
                stubs[i : i + 500],
                on_conflict="musinsa_no",
                ignore_duplicates=True,
            ).execute()

    def _get_today_promotion_id(self, musinsa_event_id: str, snapshot_date: str) -> str | None:
        rows = (
            self.client.table("promotions")
            .select("id")
            .eq("musinsa_event_id", musinsa_event_id)
            .eq("snapshot_date", snapshot_date)
            .limit(1)
            .execute()
            .data or []
        )
        return rows[0]["id"] if rows else None

    # ── 파싱 ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_promotion(module: dict[str, Any], snapshot_date: str) -> dict[str, Any]:
        title_block = module.get("title", {})
        return {
            "musinsa_event_id": module["id"],
            "title": title_block.get("title", {}).get("text", ""),
            "promotion_type": _classify_type(module["id"]),
            "items_count": len(module.get("items", [])),
            "end_at": _ms_to_iso(title_block.get("targetDate")),
            "snapshot_date": snapshot_date,
        }

    @staticmethod
    def _parse_item(
        item: dict[str, Any],
        promotion_id: str,
        product_id: str | None,
        rank_in_module: int,
        snapshot_date: str,
    ) -> dict[str, Any]:
        mno = str(item["id"])
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
        limited = info.get("limitedOffer") or {}
        return {
            "promotion_id": promotion_id,
            "product_id": product_id,
            "musinsa_no": mno,
            "musinsa_brand_slug": ga4.get("brand_id") or amp.get("brand_id"),
            "musinsa_brand_name": info.get("brandName"),
            "product_name": amp.get("product_name") or info.get("productName"),
            "rank_in_module": rank_in_module,
            "item_store_code": ga4.get("spc_code") or amp.get("spc_code"),
            "final_price": info.get("finalPrice"),
            "list_price": ga4.get("original_price"),
            "discount_rate": info.get("discountRatio"),
            "is_sold_out": (limited.get("status", {}).get("type") == "SOLD_OUT") if limited else bool(info.get("isSoldOut", False)),
            "review_count": int(amp["reviewCount"]) if amp.get("reviewCount") else None,
            "review_score": int(amp["reviewScore"]) if amp.get("reviewScore") else None,
            "limited_total": limited.get("totalCount"),
            "limited_remaining": limited.get("remainingCount"),
            "limited_status": limited.get("status", {}).get("type") if limited else None,
            "snapshot_date": snapshot_date,
        }

    # ── 수집 루프 ────────────────────────────────────────────────────────────

    async def run(self) -> None:
        snapshot_date = _kst_today()
        yesterday = (datetime.now(KST).date() - timedelta(days=1)).isoformat()
        modules = await self._fetch_modules()
        logger.info(f"promotions_fetched modules={len(modules)}")

        # 모든 모듈의 상품번호 수집 → stub 삽입
        all_nos = [str(item["id"]) for m in modules for item in m.get("items", [])]
        unique_nos = list(dict.fromkeys(all_nos))
        id_map: dict[str, str] = {}
        if unique_nos:
            id_map = self._product_id_map(unique_nos)
            missing = [no for no in unique_nos if no not in id_map]
            if missing:
                self._insert_stub_products(missing)
                id_map = self._product_id_map(unique_nos)

        collected_event_ids: list[str] = []
        total_items = 0

        for module in modules:
            musinsa_event_id = module["id"]
            collected_event_ids.append(musinsa_event_id)
            promo_data = self._parse_promotion(module, snapshot_date)

            # 오늘 날짜 행 존재 여부 확인
            existing = (
                self.client.table("promotions")
                .select("id")
                .eq("musinsa_event_id", musinsa_event_id)
                .eq("snapshot_date", snapshot_date)
                .limit(1)
                .execute()
                .data or []
            )

            if existing:
                # 오늘 이미 수집됨 → update
                promotion_id = existing[0]["id"]
                update_data = {k: v for k, v in promo_data.items()
                               if k not in ("musinsa_event_id", "snapshot_date")}
                self.client.table("promotions").update(update_data).eq("id", promotion_id).execute()
            else:
                # 새 날짜 → 기존 활성 행 종료 처리 후 신규 insert
                self.client.table("promotions").update({"ended_at": yesterday}) \
                    .eq("musinsa_event_id", musinsa_event_id) \
                    .is_("ended_at", "null") \
                    .execute()
                result = self.client.table("promotions").insert(promo_data).execute()
                promotion_id = result.data[0]["id"]

            items = module.get("items", [])
            if not items:
                continue

            item_rows = [
                self._parse_item(
                    item,
                    promotion_id,
                    id_map.get(str(item["id"])),
                    rank_in_module=idx,
                    snapshot_date=snapshot_date,
                )
                for idx, item in enumerate(items)
            ]

            for i in range(0, len(item_rows), 500):
                self.client.table("promotion_items").upsert(
                    item_rows[i : i + 500],
                    on_conflict="promotion_id,musinsa_no,snapshot_date",
                ).execute()

            total_items += len(item_rows)
            logger.info(f"promotion_module_done event_id={musinsa_event_id} items={len(item_rows)}")

        # 오늘 API에 없던 활성 프로모션 종료 처리
        active_rows = (
            self.client.table("promotions")
            .select("id, musinsa_event_id")
            .is_("ended_at", "null")
            .lt("snapshot_date", snapshot_date)
            .execute()
            .data or []
        )
        collected_set = set(collected_event_ids)
        to_end = [r["id"] for r in active_rows if r["musinsa_event_id"] not in collected_set]
        if to_end:
            for i in range(0, len(to_end), 200):
                self.client.table("promotions").update({"ended_at": snapshot_date}) \
                    .in_("id", to_end[i : i + 200]) \
                    .execute()
            logger.info(f"promotions_ended count={len(to_end)}")

        logger.info(f"promotions_run_done total_modules={len(modules)} total_items={total_items}")


async def main() -> None:
    from worker.utils.job_tracker import JobTracker
    client = _supabase_client()
    scraper = EventScraper(client)
    tracker = JobTracker(client, script="musinsa_event", label="프로모션")
    await tracker.start()
    try:
        await scraper.run()
        await tracker.finish(rows_done=0)
    except Exception as e:
        await tracker.error(str(e))
        raise


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
