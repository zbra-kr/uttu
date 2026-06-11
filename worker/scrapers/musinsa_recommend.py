"""
무신사 추천판 스크래퍼 — Playwright 브라우저 인터셉트 방식
API: api.musinsa.com/api2/hm/web/v9/pans/recommend?storeCode=musinsa&gf={A|M|F}
테이블: recommend_modules + recommend_items
수집 방식: CAROUSEL 모듈이 lazy-load로 동적 삽입되므로 httpx 불가 → Playwright 인터셉트
수집 주기: 매일 03:00, 성별 3회 (A/M/F)
"""

import asyncio
import os
from datetime import datetime
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytz
from dotenv import load_dotenv
from loguru import logger
from playwright.async_api import Response, async_playwright

from supabase import Client, create_client
from worker.scrapers.base import BaseScraper

load_dotenv()

RECOMMEND_PAGE_URL = "https://www.musinsa.com/main/musinsa/recommend"
RECOMMEND_API_URL  = "https://api.musinsa.com/api2/hm/web/v9/pans/recommend"
GENDERS            = ["A", "M", "F"]
KST                = pytz.timezone("Asia/Seoul")

SCROLL_STEPS   = 15    # 페이지 하단까지 커버하기 위한 스크롤 횟수
SCROLL_PX      = 700   # 회당 스크롤 픽셀
SCROLL_WAIT_MS = 1_400 # 스크롤 후 lazy-load 대기 (ms)


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


def _kst_today() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


class RecommendScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client

    # ── Playwright 인터셉트 ────────────────────────────────────────────────────

    async def _fetch_gender_modules(self, gender: str) -> list[dict[str, Any]]:
        """Playwright로 추천판 로드 후 lazy-load API 응답 전체 인터셉트."""
        seen_keys: set[str] = set()
        modules_by_pos: dict[int, dict[str, Any]] = {}

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                extra_http_headers={
                    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
                    "Referer": "https://www.musinsa.com/",
                },
            )
            page = await context.new_page()

            async def on_response(response: Response) -> None:
                if RECOMMEND_API_URL not in response.url:
                    return
                # lazy-load CAROUSEL 응답만 처리 (size= 없는 초기 BANNER/QUICKMENU 제외)
                if "size=" not in response.url:
                    return
                if response.status != 200:
                    return
                try:
                    qs = parse_qs(urlparse(response.url).query)
                    page_pos = int(qs.get("index", ["0"])[0])

                    body = await response.json()
                    for m in body.get("data", {}).get("modules", []):
                        if not m.get("type", "").startswith("CAROUSEL"):
                            continue
                        key = m.get("id", "")
                        if not key or key in seen_keys:
                            continue
                        seen_keys.add(key)
                        # 같은 index에 여러 모듈 올 경우 순서 보정
                        while page_pos in modules_by_pos:
                            page_pos += 1
                        modules_by_pos[page_pos] = m
                except Exception as exc:
                    logger.warning(f"recommend_parse_fail url={response.url} err={exc}")

            page.on("response", on_response)

            try:
                await page.goto(
                    f"{RECOMMEND_PAGE_URL}?gf={gender}",
                    wait_until="domcontentloaded",
                    timeout=30_000,
                )
            except Exception as exc:
                logger.warning(f"recommend_goto_warn gender={gender} err={exc}")

            # 스크롤 다운으로 lazy-load 전부 트리거
            for step in range(SCROLL_STEPS):
                await page.evaluate(f"window.scrollBy(0, {SCROLL_PX})")
                await asyncio.sleep(SCROLL_WAIT_MS / 1_000)
                logger.debug(f"scroll gender={gender} step={step + 1}/{SCROLL_STEPS}")

            await asyncio.sleep(2)
            await browser.close()

        ordered = [m for _, m in sorted(modules_by_pos.items())]
        logger.info(f"recommend_fetched gender={gender} modules={len(ordered)}")
        return ordered

    # ── DB 헬퍼 ──────────────────────────────────────────────────────────────

    def _product_id_map(self, musinsa_nos: list[str]) -> dict[str, str]:
        id_map: dict[str, str] = {}
        for i in range(0, len(musinsa_nos), 1_000):
            chunk = musinsa_nos[i : i + 1_000]
            rows = self.client.table("products").select("id, musinsa_no").in_("musinsa_no", chunk).execute().data or []
            for row in rows:
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

    # ── 파싱 ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_module(
        module: dict[str, Any],
        position: int,
        gender_filter: str,
        snapshot_date: str,
    ) -> dict[str, Any]:
        raw_title = module.get("title") or ""
        title = raw_title if isinstance(raw_title, str) else (raw_title.get("text") or raw_title.get("title", {}).get("text", ""))

        tabs = module.get("tabs1Depth") or []
        brand_tabs = [
            (t.get("name") if isinstance(t, dict) else t)
            for t in tabs
            if t
        ]

        return {
            "snapshot_date": snapshot_date,
            "gender_filter": gender_filter,
            "module_key": module["id"],
            "module_type": module.get("type", ""),
            "title": title or None,
            "position": position,
            "brand_tabs": [b for b in brand_tabs if b],
            "items_count": len(module.get("items", [])),
        }

    @staticmethod
    def _parse_item(
        item: dict[str, Any],
        module_db_id: str,
        product_id: str | None,
        position: int,
        snapshot_date: str,
        gender_filter: str,
    ) -> dict[str, Any]:
        mno  = str(item["id"])
        info = item.get("info", {})

        # 이벤트 로그에서 원가·리뷰 추출 (여러 경로 시도)
        def _amp(src: dict) -> dict:
            return src.get("eventLog", {}).get("amplitude", {}).get("payload", {})
        def _ga4(src: dict) -> dict:
            return src.get("eventLog", {}).get("ga4", {}).get("payload", {})

        amp = _amp(item.get("onClick", {}))
        ga4 = _ga4(item.get("onClick", {}))
        imp_amp = item.get("impressionEventLog", {}).get("amplitude", {}).get("payload", {})

        final_price   = info.get("finalPrice")
        discount_rate = info.get("discountRatio") or 0

        list_price = (
            ga4.get("original_price")
            or amp.get("original_price")
            or imp_amp.get("original_price")
        )
        # 원가 필드 없으면 역산
        if not list_price and final_price and discount_rate:
            list_price = round(final_price / (1 - discount_rate / 100))

        def _int(v: Any) -> int | None:
            try:
                return int(v) if v is not None else None
            except (ValueError, TypeError):
                return None

        review_count = _int(amp.get("reviewCount") or imp_amp.get("reviewCount"))
        review_score = _int(amp.get("reviewScore") or imp_amp.get("reviewScore"))

        return {
            "module_id":     module_db_id,
            "snapshot_date": snapshot_date,
            "gender_filter": gender_filter,
            "musinsa_no":    mno,
            "product_id":    product_id,
            "brand_name":    info.get("brandName") or amp.get("brand_name") or "",
            "product_name":  info.get("productName") or amp.get("product_name") or "",
            "list_price":    _int(list_price),
            "final_price":   _int(final_price),
            "discount_rate": _int(discount_rate) if discount_rate else None,
            "review_count":  review_count or 0,
            "review_score":  review_score,
            "is_sold_out":   bool(info.get("isSoldOut", False)),
            "position":      position,
        }

    # ── 수집 루프 ────────────────────────────────────────────────────────────

    async def run(self) -> int:
        snapshot_date  = _kst_today()
        total_modules  = 0
        total_items    = 0

        for gender in GENDERS:
            modules = await self._fetch_gender_modules(gender)
            if not modules:
                logger.warning(f"recommend_no_modules gender={gender} — 봇 차단 또는 빈 응답")
                continue

            # 전체 상품번호 수집 → products stub 확보
            all_nos    = [str(item["id"]) for m in modules for item in m.get("items", [])]
            unique_nos = list(dict.fromkeys(all_nos))
            id_map: dict[str, str] = {}
            if unique_nos:
                id_map   = self._product_id_map(unique_nos)
                missing  = [no for no in unique_nos if no not in id_map]
                if missing:
                    self._insert_stub_products(missing)
                    id_map = self._product_id_map(unique_nos)

            for pos, module in enumerate(modules):
                module_row = self._parse_module(module, pos, gender, snapshot_date)

                res = self.client.table("recommend_modules").upsert(
                    module_row,
                    on_conflict="snapshot_date,gender_filter,module_key",
                ).execute()
                module_db_id = res.data[0]["id"]

                items = module.get("items", [])
                if not items:
                    continue

                item_rows = [
                    self._parse_item(
                        item,
                        module_db_id,
                        id_map.get(str(item["id"])),
                        position=idx,
                        snapshot_date=snapshot_date,
                        gender_filter=gender,
                    )
                    for idx, item in enumerate(items)
                ]

                for i in range(0, len(item_rows), 500):
                    self.client.table("recommend_items").upsert(
                        item_rows[i : i + 500],
                        on_conflict="module_id,musinsa_no",
                    ).execute()

                total_items += len(item_rows)
                logger.info(
                    f"recommend_module_done gender={gender} pos={pos} "
                    f"title={str(module_row.get('title') or '')[:35]} items={len(item_rows)}"
                )

            total_modules += len(modules)
            await self._sleep()

        logger.info(f"recommend_done total_modules={total_modules} total_items={total_items}")
        return total_items


async def main() -> None:
    from worker.utils.job_tracker import JobTracker
    client  = _supabase_client()
    scraper = RecommendScraper(client)
    tracker = JobTracker(client, script="musinsa_recommend", label="추천판")
    await tracker.start()
    try:
        rows = await scraper.run()
        await tracker.finish(rows_done=rows)
    except Exception as e:
        await tracker.error(str(e))
        raise


if __name__ == "__main__":
    asyncio.run(main())
