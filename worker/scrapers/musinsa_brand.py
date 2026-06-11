"""
무신사 브랜드 상세 스크래퍼
URL: https://www.musinsa.com/brand/{slug}
파싱: HTML 내 __NEXT_DATA__.props.pageProps.meta JSON
대상: brands.detail_fetched_at IS NULL
수집 필드: name_eng, nation_code, nation_name, since_year, introduction,
           logo_url, white_logo_url, service_type, flagship_type, is_used
평균 소요: ~1초/브랜드
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

BRAND_URL = "https://www.musinsa.com/brand/{slug}"
_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
    re.DOTALL,
)
KST = pytz.timezone("Asia/Seoul")


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


class BrandScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client

    # ── API 호출 ──────────────────────────────────────────────────────────────

    async def _fetch_brand_html(self, slug: str) -> str | None:
        async def _call() -> str:
            async with httpx.AsyncClient(timeout=30, headers=self.PAGE_HEADERS) as http:
                resp = await http.get(BRAND_URL.format(slug=slug))
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return resp.text

        await self._sleep()
        try:
            return await self._with_retry(_call, label=f"brand/{slug}")
        except Exception as e:
            logger.warning("brand_fetch_failed", slug=slug, error=str(e))
            return None

    # ── 파싱 ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_brand(html: str, slug: str) -> dict[str, Any] | None:
        m = _NEXT_DATA_RE.search(html)
        if not m:
            logger.warning("brand_next_data_not_found", slug=slug)
            return None

        try:
            page_props = json.loads(m.group(1)).get("props", {}).get("pageProps", {})
        except json.JSONDecodeError:
            logger.warning("brand_json_parse_failed", slug=slug)
            return None

        if page_props.get("isBrandNotFound"):
            logger.warning("brand_not_found", slug=slug)
            return None

        meta = page_props.get("meta", {})
        if not meta:
            logger.warning("brand_meta_empty", slug=slug)
            return None

        return {
            "name":           meta.get("brandName") or None,
            "name_eng":       meta.get("brandNameEng") or None,
            "logo_url":       meta.get("logoImageUrl") or None,
            "white_logo_url": meta.get("whiteLogoImageUrl") or None,
            "nation_code":    meta.get("brandNation") or None,
            "nation_name":    meta.get("brandNationName") or None,
            "since_year":     meta.get("since") or None,
            "introduction":   meta.get("introduction") or None,
            "service_type":   meta.get("serviceType") or None,
            "flagship_type":  meta.get("flagshipType") or None,
            "is_used":        bool(meta.get("isUsed", False)),
            "detail_fetched_at": datetime.now(KST).isoformat(),
        }

    # ── 수집 루프 ────────────────────────────────────────────────────────────

    async def run(self, limit: int = 100, own_only: bool = False) -> int:
        """
        detail_fetched_at IS NULL인 브랜드부터 수집.
        limit: 1회 실행당 최대 수집 수.
        own_only: True면 is_own=True 브랜드만 수집.
        """
        targets: list[dict] = []
        offset = 0
        while len(targets) < limit:
            batch_size = min(1000, limit - len(targets))
            q = (
                self.client.table("brands")
                .select("id, slug, name")
                .is_("detail_fetched_at", "null")
            )
            if own_only:
                q = q.eq("is_own", True)
            rows = q.range(offset, offset + batch_size - 1).execute().data or []
            targets.extend(rows)
            if len(rows) < batch_size:
                break
            offset += batch_size
        logger.info("brand_detail_start", targets=len(targets))

        success = 0
        not_found = 0
        for row in targets:
            slug = row["slug"]
            brand_id = row["id"]

            html = await self._fetch_brand_html(slug)
            if not html:
                continue

            brand_data = self._parse_brand(html, slug)
            if not brand_data:
                # 브랜드 페이지 없음 → detail_fetched_at만 기록해서 재시도 방지
                self.client.table("brands").update(
                    {"detail_fetched_at": datetime.now(KST).isoformat()}
                ).eq("id", brand_id).execute()
                not_found += 1
                continue

            self.client.table("brands").update(brand_data).eq("id", brand_id).execute()
            success += 1
            logger.debug("brand_detail_done", slug=slug, nation=brand_data.get("nation_name"))

        logger.info("brand_detail_run_done", success=success, not_found=not_found, total=len(targets))
        return success


async def main(limit: int = 100, own_only: bool = False) -> None:
    client = _supabase_client()
    scraper = BrandScraper(client)
    await scraper.run(limit=limit, own_only=own_only)


if __name__ == "__main__":
    import argparse
    import asyncio

    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--own-only", action="store_true", help="자사 브랜드만 수집")
    args = parser.parse_args()
    asyncio.run(main(limit=args.limit, own_only=args.own_only))
