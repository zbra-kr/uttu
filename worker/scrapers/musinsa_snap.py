"""
무신사 스냅 스크래퍼
수집 대상:
  [스냅 랭킹]  7 스타일 × 50개/일 = 350개/일
    스타일: ALL | CASUAL | STREET | MINIMAL | GIRLISH | ROMANTIC | CHIC
    기간: DAILY (rankings API filter= 파라미터)
  [프로필 랭킹] USER(멤버) / BRAND 각 30개/일
    내장 스냅 10개/프로필 → snaps + snap_products + snap_profile_snaps 동시 저장
  [브랜드·코디샵] BRAND_SNAP 100개/일 신규, CODISHOP_SNAP 증분
수집 주기: 매일 02:00
개인정보: USER_SNAP createdBy.id 수집 금지
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

SNAP_LIST_URL        = "https://content.musinsa.com/api2/content/snap/v1/snaps"
SNAP_RANKING_URL     = "https://content.musinsa.com/api2/content/snap/v1/rankings/DAILY"
PROFILE_RANKING_BASE = "https://content.musinsa.com/api2/content/snap/v1/profile-rankings"
PROFILE_DETAIL_URL   = "https://content.musinsa.com/api2/content/snap/v1/profiles/{profile_id}"

PAGE_SIZE = 20  # API는 pageSize=40 이상을 무시하고 20으로 고정

# 스냅 랭킹 — 스타일 필터 (ranking-filters API 실측)
SNAP_STYLE_FILTERS     = ["ALL", "CASUAL", "STREET", "MINIMAL", "GIRLISH", "ROMANTIC", "CHIC"]
SNAP_RANKING_MAX_PER_STYLE = 50        # 스타일당 50개 → 총 350개/일

# 프로필 랭킹
PROFILE_RANKING_TYPES  = ["USER", "BRAND"]
PROFILE_RANKING_MAX    = 30            # 각 타입 30위까지
PROFILE_SNAP_COUNT     = 10           # 프로필당 최신 스냅 10개 (API 응답에 내장)

# 브랜드/코디샵 스냅 (목록 API)
BRAND_SNAP_MAX_NEW     = 100
INCREMENTAL_TYPES      = ["CODISHOP_SNAP", "MUSINSA_SNAP"]

KST = pytz.timezone("Asia/Seoul")


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


def _kst_today() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


class SnapScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client

    # ── API 호출 ──────────────────────────────────────────────────────────────

    async def _fetch_snap_list_page(self, content_type: str, page: int, sort: str = "LATEST") -> list[dict[str, Any]]:
        """snaps 목록 API — BRAND_SNAP/CODISHOP_SNAP/MUSINSA_SNAP 공용."""

        async def _call() -> list[dict[str, Any]]:
            async with httpx.AsyncClient(timeout=30, headers=self.DEFAULT_HEADERS) as http:
                resp = await http.get(
                    SNAP_LIST_URL,
                    params={"page": page, "pageSize": 40, "sort": sort, "contentTypes": content_type},
                )
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return resp.json().get("data", {}).get("list", [])

        await self._sleep()
        return await self._with_retry(_call, label=f"snaps/{content_type}/p{page}")

    async def _fetch_rankings_page(
        self, page: int, style: str = "ALL", gender: str = "ALL",
    ) -> list[dict[str, Any]]:
        """스냅 랭킹 API — 스타일/성별 필터 지원. 400 = 페이지 초과 → 빈 리스트."""

        async def _call() -> list[dict[str, Any]]:
            async with httpx.AsyncClient(timeout=30, headers=self.DEFAULT_HEADERS) as http:
                resp = await http.get(
                    SNAP_RANKING_URL,
                    params={"page": page, "pageSize": PAGE_SIZE, "filter": style, "gender": gender},
                )
                if resp.status_code == 400:
                    return []
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return (resp.json().get("data") or {}).get("list") or []

        await self._sleep()
        return await self._with_retry(_call, label=f"snap_rankings/style={style}/p{page}")

    async def _fetch_profile_rankings_page(
        self, profile_type: str, page: int, period: str = "DAILY",
    ) -> list[dict[str, Any]]:
        """프로필 랭킹 API — USER / BRAND."""

        async def _call() -> list[dict[str, Any]]:
            async with httpx.AsyncClient(timeout=30, headers=self.DEFAULT_HEADERS) as http:
                resp = await http.get(
                    f"{PROFILE_RANKING_BASE}/{profile_type}/{period}",
                    params={"page": page, "pageSize": PAGE_SIZE},
                )
                if resp.status_code == 400:
                    return []
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return (resp.json().get("data") or {}).get("list") or []

        await self._sleep()
        return await self._with_retry(_call, label=f"profile_rankings/{profile_type}/{period}/p{page}")

    # ── DB 헬퍼 ──────────────────────────────────────────────────────────────

    def _existing_snap_ids(self, snap_ids: list[str]) -> set[str]:
        if not snap_ids:
            return set()
        result = (
            self.client.table("snaps")
            .select("snap_id")
            .in_("snap_id", snap_ids)
            .execute()
        )
        return {row["snap_id"] for row in (result.data or [])}

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

    # ── 파싱 ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_snap(item: dict[str, Any], content_type: str | None = None) -> dict[str, Any]:
        """rankings / list / profile-embedded 스냅 파싱 (공통)."""
        agg = item.get("aggregations") or {}
        model = item.get("model") or {}
        medias = item.get("medias") or []
        tags = item.get("tags") or []
        detail = item.get("detail") or {}
        style_labels = item.get("labels") or item.get("styleLabels") or []
        return {
            "snap_id": str(item["id"]),
            "content_type": content_type or item.get("contentType", ""),
            "format_type": detail.get("formatType") or item.get("formatType") or "POST",
            # profile-embedded: thumbnailUrl (top-level) 우선, 없으면 medias[0].path
            "thumbnail_url": (medias[0].get("path") if medias else None) or item.get("thumbnailUrl"),
            "content_text": detail.get("content") or item.get("text") or item.get("description") or None,
            "published_at": item.get("displayedFrom") or item.get("createdAt"),
            "like_count": agg.get("likeCount", 0) or 0,
            "view_count": agg.get("viewCount", 0) or 0,
            "comment_count": agg.get("commentCount", 0) or 0,
            "goods_click_count": agg.get("goodsClickCount", 0) or 0,
            "scrap_count": agg.get("scrapCount", 0) or 0,
            "click_count": agg.get("clickCount", 0) or 0,
            "model_gender": model.get("gender"),
            "model_height": model.get("height"),
            "model_weight": model.get("weight"),
            "model_skin_tone": model.get("skinTone"),
            "hashtags": [t["name"] for t in tags if t.get("name")],
            "style_label_ids": [sl["id"] for sl in style_labels if sl.get("id") is not None],
        }

    @staticmethod
    def _parse_snap_ranking(
        item: dict[str, Any], snapshot_date: str,
        style_filter: str = "ALL", gender_filter: str = "ALL",
    ) -> dict[str, Any]:
        ranking = item.get("ranking") or {}
        return {
            "snapshot_date": snapshot_date,
            "snap_id": str(item["id"]),
            "rank_position": ranking.get("rank"),
            "prev_rank_position": ranking.get("previousRank"),
            "highlight": ranking.get("highlight"),
            "style_filter": style_filter,
            "gender_filter": gender_filter,
            "ranking_period": "DAILY",
            "ranked_at": item.get("rankedAt"),
        }

    @staticmethod
    def _parse_profile(item: dict[str, Any], profile_type: str) -> dict[str, Any]:
        """profile-rankings 응답 프로필 파싱. snapCount·신체정보는 상세 API로 보강."""
        badge = item.get("badge") or {}
        return {
            "id": str(item["id"]),
            "profile_type": profile_type,
            "nickname": item.get("nickname") or "",
            "bio": item.get("bio"),
            "profile_image_url": item.get("profileImageUrl"),
            "follower_count": item.get("followerCount") or 0,
            "updated_at": datetime.now(KST).isoformat(),
            "badge_title": badge.get("title"),
            "badge_image_url": badge.get("imageUrl"),
        }

    @staticmethod
    def _parse_profile_detail(data: dict[str, Any]) -> dict[str, Any]:
        """profile detail API 응답 → snap_profiles 보강 필드."""
        phys = data.get("profilePhysical") or {}
        badge = data.get("badge") or {}
        return {
            "snap_count": data.get("snapCount") or 0,
            "following_count": data.get("followingCount") or 0,
            "height": phys.get("height"),
            "weight": phys.get("weight"),
            "skin_tone": phys.get("skinTone"),
            "gender": phys.get("gender"),
            "badge_title": badge.get("title"),
            "updated_at": datetime.now(KST).isoformat(),
        }

    async def _fetch_profile_detail(self, profile_id: str) -> dict[str, Any] | None:
        async def _call() -> dict[str, Any]:
            async with httpx.AsyncClient(timeout=30, headers=self.DEFAULT_HEADERS) as http:
                resp = await http.get(
                    PROFILE_DETAIL_URL.format(profile_id=profile_id),
                    headers={"Referer": f"https://www.musinsa.com/snap/user/{profile_id}"},
                )
                if resp.status_code in (404, 400):
                    return {}
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return resp.json().get("data") or {}

        await self._sleep()
        try:
            return await self._with_retry(_call, label=f"profile_detail/{profile_id}")
        except Exception as e:
            logger.warning(f"profile_detail_failed id={profile_id} error={e}")
            return None

    @staticmethod
    def _parse_profile_ranking(
        item: dict[str, Any], snapshot_date: str, profile_type: str,
    ) -> dict[str, Any]:
        ranking = item.get("ranking") or {}
        return {
            "snapshot_date": snapshot_date,
            "profile_id": str(item["id"]),
            "profile_type": profile_type,
            "rank_position": ranking.get("rank"),
            "prev_rank_position": ranking.get("previousRank"),
            "highlight": ranking.get("highlight"),
            "ranking_period": "DAILY",
            "ranked_at": item.get("rankedAt"),
        }

    def _collect_snap_products(
        self, items: list[dict[str, Any]], id_map: dict[str, str],
    ) -> list[dict[str, Any]]:
        sp_rows: list[dict[str, Any]] = []
        for item in items:
            sid = str(item["id"])
            for g in item.get("goods") or []:
                mno = str(g["goodsNo"]) if g.get("goodsNo") else None
                if not mno:
                    continue
                pid = id_map.get(mno)
                if not pid:
                    continue
                options = g.get("options") or []
                option_name = "/".join(o["optionName"] for o in options if o.get("optionName")) or None
                sp_rows.append({
                    "snap_id": sid,
                    "product_id": pid,
                    "musinsa_no": mno,
                    "goods_platform": g.get("goodsPlatform", "MUSINSA"),
                    "option_name": option_name,
                })
        return sp_rows

    def _ensure_products(self, items: list[dict[str, Any]]) -> dict[str, str]:
        all_nos = [
            str(g["goodsNo"])
            for item in items
            for g in (item.get("goods") or [])
            if g.get("goodsNo")
        ]
        unique_nos = list(dict.fromkeys(all_nos))
        if not unique_nos:
            return {}
        id_map = self._product_id_map(unique_nos)
        missing = [no for no in unique_nos if no not in id_map]
        if missing:
            self._insert_stub_products(missing)
            id_map = self._product_id_map(unique_nos)
        return id_map

    def _upsert_snap_products(self, sp_rows: list[dict[str, Any]]) -> None:
        for i in range(0, len(sp_rows), 500):
            self.client.table("snap_products").upsert(
                sp_rows[i : i + 500],
                on_conflict="snap_id,musinsa_no",
            ).execute()

    # ── 수집 루프 ────────────────────────────────────────────────────────────

    async def _run_snap_rankings(self, snapshot_date: str) -> int:
        """스냅 랭킹 — 7 스타일 × 50개 = 350개/일."""
        total = 0

        for style in SNAP_STYLE_FILTERS:
            style_count = 0

            for page in range(1, 100):
                if style_count >= SNAP_RANKING_MAX_PER_STYLE:
                    break

                items = await self._fetch_rankings_page(page, style=style)
                if not items:
                    logger.info(f"snap_ranking_empty style={style} page={page}")
                    break

                remaining = SNAP_RANKING_MAX_PER_STYLE - style_count
                items = items[:remaining]

                # snaps upsert (메트릭 갱신)
                snap_rows = [self._parse_snap(item, content_type="USER_SNAP") for item in items]
                for i in range(0, len(snap_rows), 500):
                    self.client.table("snaps").upsert(
                        snap_rows[i : i + 500], on_conflict="snap_id",
                    ).execute()

                # snap_rankings upsert
                ranking_rows = [
                    self._parse_snap_ranking(item, snapshot_date, style_filter=style)
                    for item in items
                ]
                valid_rankings = [r for r in ranking_rows if r["rank_position"] is not None]
                for i in range(0, len(valid_rankings), 500):
                    self.client.table("snap_rankings").upsert(
                        valid_rankings[i : i + 500],
                        on_conflict="snapshot_date,snap_id,style_filter,gender_filter,ranking_period",
                    ).execute()

                # snap_products
                id_map = self._ensure_products(items)
                sp_rows = self._collect_snap_products(items, id_map)
                if sp_rows:
                    self._upsert_snap_products(sp_rows)

                style_count += len(items)
                logger.info(
                    f"snap_ranking_page style={style} page={page}"
                    f" batch={len(items)} style_total={style_count}"
                )

            total += style_count
            logger.info(f"snap_ranking_style_done style={style} count={style_count}")

        logger.info(f"snap_ranking_run_done total={total}")
        return total

    async def _run_profile_rankings(self, snapshot_date: str) -> dict[str, int]:
        """USER/BRAND 프로필 랭킹 — 각 30개/일 + 내장 스냅 10개/프로필."""
        totals: dict[str, int] = {}

        for profile_type in PROFILE_RANKING_TYPES:
            collected = 0

            for page in range(1, 100):
                if collected >= PROFILE_RANKING_MAX:
                    break

                items = await self._fetch_profile_rankings_page(profile_type, page)
                if not items:
                    logger.info(f"profile_ranking_empty type={profile_type} page={page}")
                    break

                remaining = PROFILE_RANKING_MAX - collected
                items = items[:remaining]

                # 프로필 파싱
                profile_rows = []
                for item in items:
                    pr = self._parse_profile(item, profile_type)
                    # BRAND: 내장 스냅의 goods.brand.brandId로 brand_code 추출
                    if profile_type == "BRAND":
                        for s in (item.get("snaps") or []):
                            for g in (s.get("goods") or []):
                                bc = (g.get("brand") or {}).get("brandId")
                                if bc:
                                    pr["brand_code"] = bc
                                    break
                            if pr.get("brand_code"):
                                break
                    profile_rows.append(pr)

                self.client.table("snap_profiles").upsert(
                    profile_rows, on_conflict="id",
                ).execute()

                # USER 프로필 상세 보강 (snapCount·신체정보는 랭킹 API 미제공)
                if profile_type == "USER":
                    for pr in profile_rows:
                        detail = await self._fetch_profile_detail(pr["id"])
                        if detail:
                            patch = self._parse_profile_detail(detail)
                            self.client.table("snap_profiles").update(patch).eq("id", pr["id"]).execute()

                # 프로필 랭킹 upsert
                ranking_rows = [
                    self._parse_profile_ranking(item, snapshot_date, profile_type)
                    for item in items
                ]
                valid_rankings = [r for r in ranking_rows if r["rank_position"] is not None]
                if valid_rankings:
                    self.client.table("snap_profile_rankings").upsert(
                        valid_rankings,
                        on_conflict="snapshot_date,profile_id,ranking_period",
                    ).execute()

                # 내장 스냅 저장
                all_snap_items: list[dict[str, Any]] = []
                profile_snap_rows: list[dict[str, Any]] = []

                for item in items:
                    pid = str(item["id"])
                    embedded = (item.get("snaps") or [])[:PROFILE_SNAP_COUNT]
                    for order, s in enumerate(embedded):
                        ct = s.get("contentType") or (
                            "BRAND_SNAP" if profile_type == "BRAND" else "USER_SNAP"
                        )
                        all_snap_items.append({**s, "_content_type_override": ct})
                        profile_snap_rows.append({
                            "snapshot_date": snapshot_date,
                            "profile_id": pid,
                            "snap_id": str(s["id"]),
                            "display_order": order,
                        })

                if all_snap_items:
                    snap_rows = [
                        self._parse_snap(
                            {k: v for k, v in s.items() if k != "_content_type_override"},
                            content_type=s.get("_content_type_override"),
                        )
                        for s in all_snap_items
                    ]
                    for i in range(0, len(snap_rows), 500):
                        self.client.table("snaps").upsert(
                            snap_rows[i : i + 500], on_conflict="snap_id",
                        ).execute()

                    clean_items = [
                        {k: v for k, v in s.items() if k != "_content_type_override"}
                        for s in all_snap_items
                    ]
                    id_map = self._ensure_products(clean_items)
                    sp_rows = self._collect_snap_products(clean_items, id_map)
                    if sp_rows:
                        self._upsert_snap_products(sp_rows)

                    for i in range(0, len(profile_snap_rows), 500):
                        self.client.table("snap_profile_snaps").upsert(
                            profile_snap_rows[i : i + 500],
                            on_conflict="snapshot_date,profile_id,snap_id",
                        ).execute()

                collected += len(items)
                logger.info(
                    f"profile_ranking_page type={profile_type} page={page}"
                    f" batch={len(items)} total={collected}"
                )

            totals[profile_type] = collected
            logger.info(f"profile_ranking_done type={profile_type} total={collected}")

        return totals

    async def _run_brand_snap(self) -> int:
        """BRAND_SNAP 최신순 신규 BRAND_SNAP_MAX_NEW개 수집."""
        new_total = 0

        for page in range(1, 100):
            if new_total >= BRAND_SNAP_MAX_NEW:
                break

            items = await self._fetch_snap_list_page("BRAND_SNAP", page=page)
            if not items:
                break

            snap_ids = [str(item["id"]) for item in items]
            existing = self._existing_snap_ids(snap_ids)
            new_items = [item for item in items if str(item["id"]) not in existing]

            if not new_items:
                logger.info(f"snap_brand_reached_existing page={page}")
                break

            remaining = BRAND_SNAP_MAX_NEW - new_total
            new_items = new_items[:remaining]

            snap_rows = [self._parse_snap(item, content_type="BRAND_SNAP") for item in new_items]
            self.client.table("snaps").upsert(
                snap_rows, on_conflict="snap_id", ignore_duplicates=True
            ).execute()

            id_map = self._ensure_products(new_items)
            sp_rows = self._collect_snap_products(new_items, id_map)
            if sp_rows:
                self._upsert_snap_products(sp_rows)

            new_total += len(new_items)
            logger.info(f"snap_brand_page page={page} new={len(new_items)} total={new_total}")

            if len(new_items) < len(items):
                break

        logger.info(f"snap_brand_done total={new_total}")
        return new_total

    async def _run_incremental(self, content_type: str) -> int:
        """CODISHOP_SNAP / MUSINSA_SNAP 증분 수집 — 기존 snap_id 만나면 중단."""
        total = 0

        for page in range(1, 100):
            items = await self._fetch_snap_list_page(content_type, page=page)
            if not items:
                logger.info(f"snap_incremental_empty content_type={content_type} page={page}")
                break

            snap_ids = [str(item["id"]) for item in items]
            existing = self._existing_snap_ids(snap_ids)
            new_items = [item for item in items if str(item["id"]) not in existing]

            if not new_items:
                logger.info(f"snap_incremental_reached_existing content_type={content_type} page={page}")
                break

            snap_rows = [self._parse_snap(item) for item in new_items]
            self.client.table("snaps").upsert(
                snap_rows, on_conflict="snap_id", ignore_duplicates=True
            ).execute()

            id_map = self._ensure_products(new_items)
            sp_rows = self._collect_snap_products(new_items, id_map)
            if sp_rows:
                self._upsert_snap_products(sp_rows)

            total += len(new_items)
            logger.info(
                f"snap_incremental_page content_type={content_type}"
                f" page={page} new={len(new_items)} total={total}"
            )

            if len(new_items) < len(items):
                break

        logger.info(f"snap_incremental_done content_type={content_type} total={total}")
        return total

    async def run(self) -> None:
        snapshot_date = _kst_today()
        logger.info(f"snap_run_start snapshot_date={snapshot_date}")

        snap_total         = await self._run_snap_rankings(snapshot_date)
        profile_totals     = await self._run_profile_rankings(snapshot_date)
        brand_snap_count   = await self._run_brand_snap()
        incremental_counts = {}
        for ct in INCREMENTAL_TYPES:
            incremental_counts[ct] = await self._run_incremental(ct)

        logger.info(
            f"snap_run_done"
            f" snap_rankings={snap_total}"
            f" profile_USER={profile_totals.get('USER', 0)}"
            f" profile_BRAND={profile_totals.get('BRAND', 0)}"
            f" brand_snap={brand_snap_count}"
            f" CODISHOP={incremental_counts.get('CODISHOP_SNAP', 0)}"
            f" MUSINSA={incremental_counts.get('MUSINSA_SNAP', 0)}"
        )


async def main() -> None:
    from worker.utils.job_tracker import JobTracker
    client = _supabase_client()
    scraper = SnapScraper(client)
    tracker = JobTracker(client, script="musinsa_snap", label="스냅 수집")
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
