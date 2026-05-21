"""
무신사 상품 상세 스크래퍼 (httpx 1단계)
URL: https://www.musinsa.com/products/{musinsa_no}
파싱: window.__MSS__.product.state JSON
대상: products.detail_fetched_at IS NULL (stub 상태) 또는 오래된 상품
부산물: companies 테이블에 법인 정보 upsert (businessNumber 기반)
평균 소요: ~1~2초/상품
"""

import json
import os
import re
from datetime import datetime
from typing import Any

import httpx
import pytz
from dotenv import load_dotenv
from loguru import logger
from supabase import Client, create_client

from worker.scrapers.base import BaseScraper, BotBlockedError  # noqa: F401

load_dotenv()

PRODUCT_URL = "https://www.musinsa.com/products/{musinsa_no}"
_STATE_RE = re.compile(
    r"window\.__MSS__\.product\.state\s*=\s*(\{.*?\});\s*\n", re.DOTALL
)
KST = pytz.timezone("Asia/Seoul")


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


class ProductScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client

    # ── API 호출 ──────────────────────────────────────────────────────────────

    async def _fetch_product_html(self, musinsa_no: str) -> str | None:
        async def _call() -> str:
            async with httpx.AsyncClient(timeout=30, headers=self.PAGE_HEADERS) as http:
                resp = await http.get(PRODUCT_URL.format(musinsa_no=musinsa_no))
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return resp.text

        await self._sleep()
        try:
            return await self._with_retry(_call, label=f"product/{musinsa_no}")
        except Exception as e:
            logger.warning("product_fetch_failed", musinsa_no=musinsa_no, error=str(e))
            return None

    # ── 파싱 ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_state(html: str) -> dict[str, Any] | None:
        m = _STATE_RE.search(html)
        if not m:
            return None
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _extract_company(state: dict[str, Any]) -> dict[str, Any] | None:
        """state.company → companies 테이블 행. None이면 스킵."""
        co = state.get("company") or {}
        biz_no = co.get("businessNumber")
        corp_name = co.get("name")
        if not corp_name:
            return None
        return {
            "corp_name": corp_name,
            "business_number": biz_no or None,
            "ceo_name": co.get("ceoName"),
            "address": co.get("address"),
            "phone": co.get("phoneNumber"),
            "email": co.get("email"),
            "mail_order_no": co.get("mailOrderReportNumber"),
        }

    @staticmethod
    def _parse_product(state: dict[str, Any]) -> dict[str, Any]:
        cat = state.get("category", {})
        review = state.get("goodsReview", {})
        sex_code = state.get("sexCode", 0)
        gender = {2: "M", 4: "F", 6: "U"}.get(sex_code, "U")

        materials = {}
        seasons_list: list[str] = []
        for mat in state.get("goodsMaterial", {}).get("materials", []):
            if mat["name"] == "계절":
                seasons_list = [i["name"] for i in mat.get("items", []) if i.get("isSelected")]
            else:
                selected = next((i["name"] for i in mat.get("items", []) if i.get("isSelected")), None)
                if selected:
                    materials[mat["name"]] = selected

        return {
            "name": state.get("goodsNm", ""),
            "name_eng": state.get("goodsNmEng") or None,
            "style_no": state.get("styleNo") or None,
            "thumbnail_url": state.get("thumbnailImageUrl") or None,
            "category_code": cat.get("categoryDepth1Code", "000"),
            "category_d2_code": cat.get("categoryDepth2Code") or None,
            "category_d2_name": cat.get("categoryDepth2Name") or None,
            "category_d3_code": cat.get("categoryDepth3Code") or None,
            "category_d3_name": cat.get("categoryDepth3Name") or None,
            "category_path": state.get("baseCategoryFullPath") or None,
            "gender": gender,
            "season_year": state.get("seasonYear") or None,
            "season_code": str(state.get("season")) if state.get("season") else None,
            "fit": materials.get("핏"),
            "texture": materials.get("촉감"),
            "elasticity": materials.get("신축성"),
            "transparency": materials.get("비침"),
            "thickness": materials.get("두께"),
            "item_seasons": seasons_list,
            "is_musinsa_monopoly": bool(state.get("isMusinsaMonopoly", False)),
            "is_online_monopoly": bool(state.get("isOnlineMonopoly", False)),
            "is_first": bool(state.get("isFirst", False)),
            "is_clearance": bool(state.get("isClearance", False)),
            "is_outlet": bool(state.get("isOutlet", False)),
            "is_limited_quantity": bool(state.get("isLimitedQuantity", False)),
            "is_drop": bool(state.get("isDrop", False)),
            "is_adult": bool(state.get("isAdult", False)),
            "is_parallel_import": bool(state.get("isParallelImport", False)),
            "is_free_return": bool(state.get("isFreeReturn", False)),
            "labels": [lb["code"] for lb in state.get("labels", [])],
            "review_count": review.get("totalCount", 0),
            "satisfaction_score": review.get("satisfactionScore") or None,
            "ranking_best_records": state.get("rankingRecord", {}).get("rankingRecordsTop", []),
            "detail_fetched_at": datetime.now(KST).isoformat(),
        }

    # ── DB 헬퍼 ──────────────────────────────────────────────────────────────

    def _upsert_company(self, company_data: dict[str, Any]) -> str | None:
        """companies upsert. 반환값: company_id."""
        biz_no = company_data.get("business_number")
        on_conflict = "business_number" if biz_no else "corp_name"
        result = self.client.table("companies").upsert(
            company_data, on_conflict=on_conflict
        ).execute()
        rows = result.data or []
        return rows[0]["id"] if rows else None

    def _link_brand_to_company(self, brand_slug: str, company_id: str) -> None:
        self.client.table("brands").update({"company_id": company_id}).eq("slug", brand_slug).execute()

    def _get_brand_id(self, brand_slug: str) -> str | None:
        result = (
            self.client.table("brands")
            .select("id")
            .eq("slug", brand_slug)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0]["id"] if rows else None

    # ── 수집 루프 ────────────────────────────────────────────────────────────

    async def run(self, limit: int = 50, own_only: bool = False) -> int:
        """
        detail_fetched_at IS NULL인 stub 상품부터 수집.
        limit: 1회 실행당 최대 수집 수.
        own_only: True면 is_own=True 상품만 수집 (자사 상품 우선 처리용).
        """
        # PostgREST 1,000행 캡 우회: 1,000개씩 페이지네이션
        targets: list[dict] = []
        offset = 0
        while len(targets) < limit:
            batch_size = min(1000, limit - len(targets))
            base_query = (
                self.client.table("products")
                .select("id, musinsa_no")
                .is_("detail_fetched_at", "null")
            )
            if own_only:
                base_query = base_query.eq("is_own", True)
            rows = base_query.range(offset, offset + batch_size - 1).execute().data or []
            targets.extend(rows)
            if len(rows) < batch_size:
                break
            offset += batch_size
        logger.info("product_detail_start", targets=len(targets))

        success = 0
        for row in targets:
            mno = row["musinsa_no"]
            product_id = row["id"]

            html = await self._fetch_product_html(mno)
            if not html:
                continue

            state = self._parse_state(html)
            if not state:
                logger.warning("product_state_not_found", musinsa_no=mno)
                continue

            # companies 처리
            company_data = self._extract_company(state)
            company_id: str | None = None
            if company_data:
                company_id = self._upsert_company(company_data)

            # brand 연결
            brand_val = state.get("brand")
            brand_info = state.get("brandInfo") or {}
            brand_slug = (
                (brand_val if isinstance(brand_val, str) else None)
                or (brand_info.get("brandCode") if isinstance(brand_info, dict) else None)
            )
            brand_id: str | None = None
            if brand_slug:
                brand_id = self._get_brand_id(brand_slug)
                if brand_id and company_id:
                    self._link_brand_to_company(brand_slug, company_id)

            # products 업데이트
            product_data = self._parse_product(state)
            if brand_id:
                product_data["brand_id"] = brand_id
            self.client.table("products").update(product_data).eq("id", product_id).execute()

            success += 1
            logger.debug("product_detail_done", musinsa_no=mno, company=company_data and company_data.get("corp_name"))

        logger.info("product_detail_run_done", success=success, total=len(targets))
        return success


async def main(limit: int = 50, own_only: bool = False) -> None:
    client = _supabase_client()
    scraper = ProductScraper(client)
    await scraper.run(limit=limit, own_only=own_only)


if __name__ == "__main__":
    import asyncio
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--own-only", action="store_true", help="자사 상품(is_own=True)만 수집")
    args = parser.parse_args()
    asyncio.run(main(limit=args.limit, own_only=args.own_only))
