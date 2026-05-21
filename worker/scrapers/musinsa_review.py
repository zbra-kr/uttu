"""
무신사 자사 브랜드 상품 리뷰 스크래퍼
API: api.musinsa.com/api2/review/v1/view/list (인증 불필요)
대상: products.is_own = True 상품 전체
증분: reviews 테이블의 MAX(review_date) 이후 신규 리뷰만 수집
     첫 실행 시 전체 수집 (10~30시간 예상)
금지: userNickName, userId, encryptedUserId — 개인정보 절대 저장 금지
pageSize 최대 20 (50+ → HTTP 400)
"""

import os
from datetime import date
from typing import Any

import httpx
import pytz
from dotenv import load_dotenv
from loguru import logger
from supabase import Client, create_client

from worker.scrapers.base import BaseScraper, BotBlockedError  # noqa: F401

load_dotenv()

REVIEW_URL = "https://api.musinsa.com/api2/review/v1/view/list"
CDN_BASE = "https://image.msscdn.net"
PAGE_SIZE = 20
KST = pytz.timezone("Asia/Seoul")


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


class ReviewScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client

    # ── API 호출 ──────────────────────────────────────────────────────────────

    async def _fetch_page(self, musinsa_no: str, page: int) -> dict[str, Any] | None:
        async def _call() -> dict[str, Any]:
            async with httpx.AsyncClient(timeout=30) as http:
                resp = await http.get(
                    REVIEW_URL,
                    params={"goodsNo": musinsa_no, "page": page, "pageSize": PAGE_SIZE},
                    headers={
                        **self.DEFAULT_HEADERS,
                        "Referer": f"https://www.musinsa.com/products/{musinsa_no}",
                    },
                )
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return resp.json()

        await self._sleep()
        try:
            return await self._with_retry(_call, label=f"review/{musinsa_no}/page{page}")
        except Exception as e:
            logger.warning("review_fetch_failed", musinsa_no=musinsa_no, page=page, error=str(e))
            return None

    # ── 파싱 ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_review(item: dict[str, Any], product_id: str) -> dict[str, Any]:
        images = item.get("images") or []
        image_urls = [
            (CDN_BASE + img["imageUrl"]) if img.get("imageUrl", "").startswith("/") else img["imageUrl"]
            for img in images
            if img.get("imageUrl")
        ]
        # createDate: "2026-05-01T17:10:58.000+09:00" → DATE
        create_date_str = item.get("createDate", "")
        review_date = create_date_str[:10] if create_date_str else None

        return {
            "product_id": product_id,
            "musinsa_review_id": str(item["no"]),
            "rating": int(item.get("grade") or 0),
            "review_text": item.get("content") or "",
            "review_date": review_date,
            "helpful_count": item.get("likeCount") or 0,
            "has_image": len(image_urls) > 0,
            "image_urls": image_urls,
        }

    # ── DB 헬퍼 ──────────────────────────────────────────────────────────────

    def _get_own_products(self) -> list[dict[str, str]]:
        """is_own=True 상품 전체 (id, musinsa_no)."""
        all_rows: list[dict] = []
        offset = 0
        while True:
            result = (
                self.client.table("products")
                .select("id, musinsa_no")
                .eq("is_own", True)
                .range(offset, offset + 999)
                .execute()
            )
            rows = result.data or []
            all_rows.extend(rows)
            if len(rows) < 1000:
                break
            offset += 1000
        return all_rows

    def _get_last_review_date(self, product_id: str) -> date | None:
        """해당 상품의 가장 최근 리뷰 날짜. 없으면 None (= 첫 수집)."""
        result = (
            self.client.table("reviews")
            .select("review_date")
            .eq("product_id", product_id)
            .order("review_date", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if not rows or not rows[0].get("review_date"):
            return None
        return date.fromisoformat(rows[0]["review_date"])

    def _upsert_reviews(self, rows: list[dict[str, Any]]) -> int:
        """upsert 후 실제 삽입된 행 수 반환 (중복은 ignore_duplicates=True로 스킵)."""
        inserted = 0
        for i in range(0, len(rows), 500):
            result = self.client.table("reviews").upsert(
                rows[i : i + 500],
                on_conflict="musinsa_review_id",
                ignore_duplicates=True,
            ).execute()
            inserted += len(result.data or [])
        return inserted

    # ── 수집 루프 ────────────────────────────────────────────────────────────

    async def run_product(self, product_id: str, musinsa_no: str) -> int:
        """
        단일 상품 리뷰 수집.
        - 첫 실행: 전체 페이지 수집
        - 이후: last_review_date 이후 신규 리뷰만 수집 (당일 포함 중단)
        반환값: 실제 새로 삽입된 리뷰 수
        """
        last_date = self._get_last_review_date(product_id)
        page = 1
        total_inserted = 0
        stop_early = False

        while not stop_early:
            resp = await self._fetch_page(musinsa_no, page)
            if not resp:
                break

            data = resp.get("data") or {}
            items = data.get("list") or []
            pagination = data.get("page") or {}
            total_pages = pagination.get("totalPages", 1)

            if not items:
                break

            rows_to_insert: list[dict] = []
            for item in items:
                create_date_str = item.get("createDate", "")
                review_date = date.fromisoformat(create_date_str[:10]) if create_date_str else None

                # 증분: last_date 이하(당일 포함) 리뷰는 이미 수집했으므로 중단
                # 당일 리뷰는 ignore_duplicates=True로 중복 스킵되지만, 안전하게 포함
                if last_date and review_date and review_date < last_date:
                    stop_early = True
                    break

                rows_to_insert.append(self._parse_review(item, product_id))

            if rows_to_insert:
                total_inserted += self._upsert_reviews(rows_to_insert)

            if page >= total_pages:
                break
            page += 1

        if total_inserted > 0:
            logger.debug(
                "review_product_done",
                musinsa_no=musinsa_no,
                new_reviews=total_inserted,
                pages=page,
                incremental=last_date is not None,
            )
        return total_inserted

    async def run(self, limit: int | None = None) -> int:
        """
        자사 상품 전체 리뷰 수집.
        limit: 테스트용 상품 수 제한 (None = 전체).
        """
        products = self._get_own_products()
        if limit:
            products = products[:limit]

        logger.info("review_run_start", total_products=len(products))

        grand_total = 0
        for idx, row in enumerate(products, 1):
            product_id = row["id"]
            musinsa_no = row["musinsa_no"]
            upserted = await self.run_product(product_id, musinsa_no)
            grand_total += upserted

            if idx % 100 == 0:
                logger.info(
                    "review_run_progress",
                    done=idx,
                    total=len(products),
                    reviews_so_far=grand_total,
                )

        logger.info("review_run_done", total_products=len(products), total_reviews=grand_total)
        return grand_total


async def main(limit: int | None = None) -> None:
    client = _supabase_client()
    scraper = ReviewScraper(client)
    await scraper.run(limit=limit)


if __name__ == "__main__":
    import asyncio
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="테스트용 상품 수 제한")
    args = parser.parse_args()
    asyncio.run(main(limit=args.limit))
