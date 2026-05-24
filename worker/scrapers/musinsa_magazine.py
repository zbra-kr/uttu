"""
무신사 매거진 스크래퍼 — 기사 + 상품 연결 수집
API: content.musinsa.com/api2/content/musinsa-content/v1/contents
인증: 불필요
수집 주기: 매일 증분 (displayStartDateFrom=어제 날짜)
상품 연결: relatedGoodsList[] → products 스텁 삽입 후 magazine_article_products 연결
누적 기사: ~120,754건 (2026-05-20 기준), 신규 ~20건/일
"""

import os
from datetime import date, datetime, timedelta
from typing import Any

import httpx
import pytz
from dotenv import load_dotenv
from loguru import logger
from supabase import Client, create_client

from worker.scrapers.base import BaseScraper, BotBlockedError  # noqa: F401

load_dotenv()

MAGAZINE_LIST_URL = "https://content.musinsa.com/api2/content/musinsa-content/v1/contents"
PAGE_SIZE = 50
MAX_PAGES = 200  # 최대 10,000건 — 초기 전체 수집 시 더 높여야 함
KST = pytz.timezone("Asia/Seoul")


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


def _kst_today() -> date:
    return datetime.now(KST).date()


class MagazineScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client

    # ── API 호출 ──────────────────────────────────────────────────────────────

    async def _fetch_page(
        self, page: int, date_from: str | None = None
    ) -> list[dict[str, Any]]:
        """매거진 기사 목록 한 페이지 조회."""

        async def _call() -> list[dict[str, Any]]:
            params: dict[str, Any] = {"page": page, "size": PAGE_SIZE}
            if date_from:
                params["displayStartDateFrom"] = date_from
            async with httpx.AsyncClient(timeout=30, headers=self.DEFAULT_HEADERS) as http:
                resp = await http.get(MAGAZINE_LIST_URL, params=params)
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return resp.json().get("data", {}).get("list", [])

        await self._sleep()
        return await self._with_retry(_call, label=f"magazine/page/{page}")

    # ── DB 헬퍼 ──────────────────────────────────────────────────────────────

    def _latest_published_at(self) -> date | None:
        """DB에 저장된 가장 최신 기사 날짜 조회."""
        result = (
            self.client.table("magazine_articles")
            .select("published_at")
            .order("published_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return None
        val = rows[0]["published_at"]
        if isinstance(val, str):
            return datetime.fromisoformat(val.replace("Z", "+00:00")).date()
        return val

    def _existing_article_ids(self, article_ids: list[str]) -> set[str]:
        if not article_ids:
            return set()
        result = (
            self.client.table("magazine_articles")
            .select("article_id")
            .in_("article_id", article_ids)
            .execute()
        )
        return {row["article_id"] for row in (result.data or [])}

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
    def _parse_article(item: dict[str, Any]) -> dict[str, Any]:
        return {
            "article_id": str(item["id"]),
            "cms_index": item.get("cmsIndex"),
            "title": item.get("title") or "",
            "category": item.get("contentsType1DepthLabel"),
            "brand_names": item.get("brandNameList") or [],
            "view_count": item.get("viewCount") or 0,
            "comment_count": item.get("commentCount") or 0,
            "published_at": item.get("displayStartDate"),
        }

    # ── 수집 루프 ────────────────────────────────────────────────────────────

    async def run(self, days_back: int = 2) -> None:
        """
        증분 수집.
        days_back: 며칠 전부터 조회할지 (기본 2일 전 — 어제 기사도 확실히 포함).
        DB가 비어 있으면 date_from 없이 전체 수집 (MAX_PAGES 범위 내).
        """
        latest = self._latest_published_at()
        if latest:
            from_date = latest - timedelta(days=days_back)
            date_from = from_date.strftime("%Y-%m-%d")
            logger.info("magazine_incremental", from_date=date_from)
        else:
            date_from = None
            logger.info("magazine_full_scan", note="DB empty, collecting all within MAX_PAGES")

        total_articles = 0
        total_products = 0

        for page in range(1, MAX_PAGES + 1):
            items = await self._fetch_page(page, date_from)
            if not items:
                logger.info("magazine_empty_page", page=page)
                break

            article_ids = [str(item["id"]) for item in items]
            existing = self._existing_article_ids(article_ids)
            new_items = [item for item in items if str(item["id"]) not in existing]

            if not new_items:
                logger.info("magazine_reached_existing", page=page)
                break

            # 1) 신규 상품 스텁 삽입
            all_nos: list[str] = [
                no
                for item in new_items
                for no in (item.get("relatedGoodsList") or [])
                if no
            ]
            unique_nos = list(dict.fromkeys(all_nos))
            id_map: dict[str, str] = {}
            if unique_nos:
                id_map = self._product_id_map(unique_nos)
                missing = [no for no in unique_nos if no not in id_map]
                if missing:
                    self._insert_stub_products(missing)
                    id_map = self._product_id_map(unique_nos)

            # 2) magazine_articles upsert
            article_rows = [self._parse_article(item) for item in new_items]
            self.client.table("magazine_articles").upsert(
                article_rows,
                on_conflict="article_id",
                ignore_duplicates=True,
            ).execute()

            # 3) magazine_article_products 삽입
            ap_rows: list[dict[str, Any]] = []
            for item in new_items:
                aid = str(item["id"])
                for mno in item.get("relatedGoodsList") or []:
                    mno = str(mno)
                    pid = id_map.get(mno)
                    if not pid:
                        continue
                    ap_rows.append(
                        {
                            "article_id": aid,
                            "product_id": pid,
                            "musinsa_no": mno,
                        }
                    )

            if ap_rows:
                self.client.table("magazine_article_products").upsert(
                    ap_rows,
                    on_conflict="article_id,musinsa_no",
                    ignore_duplicates=True,
                ).execute()

            total_articles += len(new_items)
            total_products += len(ap_rows)
            logger.info(
                "magazine_page_done",
                page=page,
                new_articles=len(new_items),
                new_products=len(ap_rows),
                cumulative_articles=total_articles,
            )

            if len(new_items) < len(items):
                break

        logger.info(
            "magazine_run_done",
            total_articles=total_articles,
            total_products=total_products,
        )


async def main() -> None:
    from worker.utils.job_tracker import JobTracker
    client = _supabase_client()
    scraper = MagazineScraper(client)
    tracker = JobTracker(client, script="musinsa_magazine", label="매거진 수집")
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
