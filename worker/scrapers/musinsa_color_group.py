"""
색상 그룹 ID 수집 스크래퍼 (1회성 + 주기적 갱신)

무신사: 동일 스타일 다른 색상 variants가 하나의 리뷰 풀을 공유.
goods-detail.musinsa.com/api2/goods/{goodsNo}/curation/other-color 로
그룹 내 모든 goodsNo 와 curationId(=color_group_id) 확인.

동작:
  - is_own=True 상품 중 review_count > 0 이고 color_group_id IS NULL 인 상품 처리
  - API 응답에 OTHER_COLOR 탭 있으면 → 그룹 내 모든 상품에 color_group_id 일괄 세팅
  - 그룹 없으면 (단독 상품) → color_group_id = 0 (처리 완료 마커)
  - 재시작 안전: color_group_id IS NOT NULL 인 상품은 자동 스킵
  - 완료 후: reviews.color_group_id 일괄 업데이트 SQL 자동 실행

사용:
  python -m worker.scrapers.musinsa_color_group
  python -m worker.scrapers.musinsa_color_group --limit 50   # 테스트
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx
from dotenv import load_dotenv
from loguru import logger
from supabase import Client, create_client

from worker.scrapers.base import BaseScraper, BotBlockedError  # noqa: F401

load_dotenv()

COLOR_GROUP_URL = "https://goods-detail.musinsa.com/api2/goods/{goods_no}/curation/other-color"
STANDALONE_SENTINEL = 0  # 그룹 없는 단독 상품 마커 (처리 완료 표시)


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


class ColorGroupScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client

    async def _fetch_color_group(self, musinsa_no: str) -> dict[str, Any] | None:
        async def _call() -> dict[str, Any]:
            url = COLOR_GROUP_URL.format(goods_no=musinsa_no)
            async with httpx.AsyncClient(timeout=20) as http:
                resp = await http.get(
                    url,
                    headers={
                        **self.DEFAULT_HEADERS,
                        "Referer": f"https://www.musinsa.com/products/{musinsa_no}",
                    },
                )
                if resp.status_code == 404:
                    return {}
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return resp.json()

        await self._sleep()
        try:
            return await self._with_retry(_call, label=f"color_group/{musinsa_no}")
        except Exception as e:
            logger.warning("color_group_fetch_failed", musinsa_no=musinsa_no, error=str(e))
            return None

    def _get_pending_products(self, limit: int | None = None) -> list[dict]:
        """color_group_id IS NULL 이고 review_count > 0 인 is_own 상품 목록."""
        products: list[dict] = []
        offset = 0
        while True:
            q = (
                self.client.table("products")
                .select("id, musinsa_no, name")
                .eq("is_own", True)
                .gt("review_count", 0)
                .is_("color_group_id", "null")
                .order("review_count", desc=True)
                .range(offset, offset + 999)
            )
            batch = q.execute().data or []
            products.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        if limit:
            return products[:limit]
        return products

    def _set_color_group_bulk(self, musinsa_nos: list[str], color_group_id: int) -> None:
        """goodsNo 목록 전체에 color_group_id 세팅. musinsa_no 기준."""
        for i in range(0, len(musinsa_nos), 200):
            chunk = musinsa_nos[i:i + 200]
            self.client.table("products").update(
                {"color_group_id": color_group_id}
            ).in_("musinsa_no", chunk).execute()

    def _migrate_reviews_color_group(self) -> int:
        """products.color_group_id → reviews.color_group_id 일괄 업데이트."""
        from collections import defaultdict

        total_groups = 0
        offset = 0
        by_group: dict[int, list[str]] = defaultdict(list)

        # color_group_id가 세팅된 모든 (musinsa_no, color_group_id) 수집
        while True:
            rows = (
                self.client.table("products")
                .select("musinsa_no, color_group_id")
                .not_.is_("color_group_id", "null")
                .neq("color_group_id", 0)
                .range(offset, offset + 999)
                .execute()
                .data or []
            )
            for r in rows:
                by_group[r["color_group_id"]].append(r["musinsa_no"])
            if len(rows) < 1000:
                break
            offset += 1000

        # color_group_id별로 reviews 업데이트
        for cgid, nos in by_group.items():
            for i in range(0, len(nos), 200):
                chunk = nos[i:i + 200]
                self.client.table("reviews").update(
                    {"color_group_id": cgid}
                ).in_("goods_no", chunk).is_("color_group_id", "null").execute()
            total_groups += 1

        logger.info(f"reviews_color_group_migrated groups={total_groups}")
        return total_groups

    async def run(self, limit: int | None = None) -> None:
        from datetime import datetime, timedelta
        import pytz
        from worker.tasks.schedule_notify import send_progress as _notify, send_done as _notify_done

        KST = pytz.timezone("Asia/Seoul")
        NOTIFY_INTERVAL_SEC = 30 * 60

        products = self._get_pending_products(limit=limit)
        total = len(products)
        logger.info(f"color_group_start total={total}")

        started_at = datetime.now(KST)
        last_notify_at = started_at

        _notify("color_group", 0, total)

        processed = 0
        group_found = 0
        standalone = 0

        for idx, product in enumerate(products, 1):
            musinsa_no = product["musinsa_no"]
            name = product.get("name", "")

            # 이미 처리됐으면 스킵
            check = (
                self.client.table("products")
                .select("color_group_id")
                .eq("musinsa_no", musinsa_no)
                .single()
                .execute()
            )
            if check.data and check.data.get("color_group_id") is not None:
                logger.debug("skip_already_set", musinsa_no=musinsa_no)
                continue

            data = await self._fetch_color_group(musinsa_no)
            if data is None:
                logger.warning("color_group_skip_error", musinsa_no=musinsa_no)
                continue

            # OTHER_COLOR 탭 찾기
            tabs = (data.get("data") or {}).get("curationTabs") or []
            other_color_tab = next(
                (t for t in tabs if t.get("curationType") == "OTHER_COLOR"), None
            )

            if other_color_tab:
                curation_id = other_color_tab["curationId"]
                goods_list = other_color_tab.get("curationGoodsList") or []
                group_nos = [str(g["goodsNo"]) for g in goods_list]
                if musinsa_no not in group_nos:
                    group_nos.append(musinsa_no)

                self._set_color_group_bulk(group_nos, curation_id)
                group_found += 1
                logger.info(
                    f"[{idx}/{total}] 그룹 발견 curation_id={curation_id} "
                    f"size={len(group_nos)} {name}"
                )
            else:
                self.client.table("products").update(
                    {"color_group_id": STANDALONE_SENTINEL}
                ).eq("musinsa_no", musinsa_no).execute()
                standalone += 1
                logger.debug(f"[{idx}/{total}] 단독상품 {musinsa_no} {name}")

            processed += 1
            if processed % 100 == 0:
                logger.info(f"progress {processed}/{total} group={group_found} standalone={standalone}")

            now = datetime.now(KST)
            if (now - last_notify_at).total_seconds() >= NOTIFY_INTERVAL_SEC:
                last_notify_at = now
                elapsed = now - started_at
                if idx > 0:
                    rate = elapsed.total_seconds() / idx
                    remaining = timedelta(seconds=rate * (total - idx))
                    rh, rrem = divmod(int(remaining.total_seconds()), 3600)
                    rm = rrem // 60
                    rem_str = f"{rh}시간 {rm}분" if rh else f"{rm}분"
                else:
                    rem_str = "계산 중"
                eh, erem = divmod(int(elapsed.total_seconds()), 3600)
                em = erem // 60
                elapsed_str = f"{eh}시간 {em}분" if eh else f"{em}분"
                _notify("color_group", processed, total, elapsed_str, rem_str)

        elapsed_total = datetime.now(KST) - started_at
        eh, erem = divmod(int(elapsed_total.total_seconds()), 3600)
        em = erem // 60
        elapsed_str = f"{eh}시간 {em}분" if eh else f"{em}분"

        logger.info(
            f"color_group_done processed={processed} group_found={group_found} standalone={standalone}"
        )

        # reviews.color_group_id 자동 마이그레이션
        logger.info("reviews_color_group_migration_start")
        migrated = self._migrate_reviews_color_group()
        logger.info(f"reviews_color_group_migration_done groups={migrated}")
        _notify_done("color_group", f"처리 {processed:,}개 · 그룹 {group_found:,} · 단독 {standalone:,} · 소요 {elapsed_str}")


async def main() -> None:
    import sys
    limit = None
    if "--limit" in sys.argv:
        idx = sys.argv.index("--limit")
        limit = int(sys.argv[idx + 1])

    client = _supabase_client()
    scraper = ColorGroupScraper(client)
    await scraper.run(limit=limit)


if __name__ == "__main__":
    asyncio.run(main())
