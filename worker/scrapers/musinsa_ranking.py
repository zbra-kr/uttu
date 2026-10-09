"""
무신사 상품 랭킹 스크래퍼
API: client.musinsa.com/api/home/web/v5/pans/ranking/sections/199
조합: 13 × 3 × 7 = 273 (CATEGORY_CODES × GENDER_FILTERS × AGE_BANDS)
수집 주기: 매일 01:00 (period=DAILY → 최근 1일 기준)
"""

import asyncio
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
        self._reset_accounting()

    def _reset_accounting(self) -> None:
        # Counts acknowledged submissions, not distinct persisted rows. An execute
        # exception may occur after a server commit, so its batch remains unknown.
        self.rows_acknowledged = 0
        self.rows_outcome_unknown = 0
        self.cohorts_attempted = 0
        self.cohorts_completed = 0
        self.source_empty_cohorts = 0
        self.ranked_empty_cohorts = 0
        self.unresolved_mapping_rows = 0
        self.unresolved_mapping_cohorts = 0

    def _accounting_summary(self) -> dict[str, Any]:
        return {
            "rows_acknowledged": self.rows_acknowledged,
            "rows_outcome_unknown": self.rows_outcome_unknown,
            "count_basis": "successful_upsert_submission_acknowledgements_not_unique_rows",
            "cohorts_attempted": self.cohorts_attempted,
            "cohorts_completed": self.cohorts_completed,
            "source_empty_cohorts": self.source_empty_cohorts,
            "ranked_empty_cohorts": self.ranked_empty_cohorts,
            "unresolved_mapping_rows": self.unresolved_mapping_rows,
            "unresolved_mapping_cohorts": self.unresolved_mapping_cohorts,
        }

    def _accounting_text(self, outcome: str, cohort_target: int) -> str:
        # Default Loguru/launcher sinks render {message}, not keyword extras.
        fields = {"outcome": outcome, "cohort_target": cohort_target,
                  **self._accounting_summary()}
        return " ".join(f"{key}={value}" for key, value in fields.items())

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
        """단일 조합: 성공 응답을 받은 제출 행 수 (고유 저장 행 수 아님)."""
        snapshot_date = _kst_today()
        items = await self._fetch_ranking(category, gf, age_band)
        if not items:
            self.source_empty_cohorts += 1
            return 0

        # rank 없는 아이템(광고/추천 상품) 제외
        items = [item for item in items if item.get("image", {}).get("rank") is not None]
        if not items:
            self.ranked_empty_cohorts += 1
            return 0
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
        unresolved = sum(str(item["id"]) not in id_map for item in items)
        if unresolved:
            self.unresolved_mapping_rows += unresolved
            self.unresolved_mapping_cohorts += 1
        self._patch_missing_thumbnails(thumb_map)

        rows = [
            self._parse_item(item, id_map[str(item["id"])], snapshot_date, category, gf, age_band)
            for item in items
            if str(item["id"]) in id_map
        ]

        if rows:
            for i in range(0, len(rows), 500):
                chunk = rows[i : i + 500]
                try:
                    self.client.table("ranking_snapshots").upsert(
                        chunk,
                        on_conflict="product_id,snapshot_date,store_code,category_code,gender_filter,age_filter",
                    ).execute()
                except (Exception, asyncio.CancelledError):
                    self.rows_outcome_unknown += len(chunk)
                    raise
                self.rows_acknowledged += len(chunk)

            # ── 브랜드 upsert + brand_id 백필 ───────────────────────────────
            # 1단계: rows에서 slug → name 맵 빌드
            brand_slugs: dict[str, str] = {}
            for row in rows:
                slug = row.get("brand_slug") or ""
                if slug:
                    brand_slugs.setdefault(slug, row.get("brand_name") or "")

            # 2단계: brands upsert → brand_id_map 획득
            brand_id_map: dict[str, str] = {}
            own_brand_ids: set[str] = set()
            if brand_slugs:
                payloads = [{"slug": s, "name": n} for s, n in brand_slugs.items()]
                for i in range(0, len(payloads), 500):
                    self.client.table("brands").upsert(
                        payloads[i : i + 500],
                        on_conflict="slug",
                        ignore_duplicates=True,
                    ).execute()
                res = self.client.table("brands").select("id, slug, is_own").in_("slug", list(brand_slugs)).execute()
                brand_id_map = {r["slug"]: r["id"] for r in res.data or []}
                own_brand_ids = {r["id"] for r in res.data or [] if r.get("is_own")}

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
                        patch = {"brand_id": bid}
                        if bid in own_brand_ids:
                            patch["is_own"] = True
                        self.client.table("products").update(patch).eq("id", pid).execute()

        logger.info(
            "ranking_combo_done",
            category=category,
            gf=gf,
            age_band=age_band,
            rows=len(rows),
            rows_acknowledged=len(rows),
            count_basis="successful_upsert_submission_acknowledgements_not_unique_rows",
        )
        return len(rows)

    async def run(self, category_codes: list[str] | None = None) -> int:
        """전체 조합; 성공 응답 제출 행 수 반환. 부분 실패는 재raise."""
        cats = category_codes or CATEGORY_CODES
        self._reset_accounting()
        cohort_target = len(cats) * len(GENDER_FILTERS) * len(AGE_BANDS)
        outcome = "error"
        try:
            for cat in cats:
                for gf in GENDER_FILTERS:
                    for age in AGE_BANDS:
                        self.cohorts_attempted += 1
                        await self.run_combo(cat, gf, age)
                        self.cohorts_completed += 1
            outcome = "done"
            logger.info(f"ranking_run_done {self._accounting_text(outcome, cohort_target)}",
                        total_rows=self.rows_acknowledged,
                        cohort_target=cohort_target,
                        **self._accounting_summary())
            return self.rows_acknowledged
        except asyncio.CancelledError:
            outcome = "cancelled"
            raise
        finally:
            # One warning per run, including interrupted runs; no cohort alert spam.
            if (self.source_empty_cohorts or self.ranked_empty_cohorts
                    or self.unresolved_mapping_rows or self.rows_outcome_unknown
                    or outcome != "done"):
                logger.warning(
                    f"ranking_run_incomplete_observations {self._accounting_text(outcome, cohort_target)}",
                    outcome=outcome, cohort_target=cohort_target,
                    **self._accounting_summary())


async def main() -> None:
    from worker.utils.job_tracker import JobTracker
    client = _supabase_client()
    scraper = RankingScraper(client)
    # rows_done uses row submissions; 273 is a cohort count, not a row target.
    tracker = JobTracker(client, script="musinsa_ranking", label="상품 랭킹")
    await tracker.start()
    try:
        total = await scraper.run()
        await tracker.finish(rows_done=total)
    except asyncio.CancelledError as cancellation:
        # Existing tracker methods perform synchronous best-effort writes. Never
        # claim finalization succeeded or replace the original cancellation.
        try:
            await tracker.progress(rows_done=scraper.rows_acknowledged)
            await tracker.error("ranking collection cancelled; rows_done is acknowledged submissions")
        finally:
            raise cancellation
    except Exception as e:
        # Preserve acknowledged batches even if a later batch or enrichment fails.
        await tracker.progress(rows_done=scraper.rows_acknowledged)
        await tracker.error(str(e))
        raise


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
