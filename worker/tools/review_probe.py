"""
리뷰 단일 품번 진단·강제수집 도구

사용:
  python -m worker.tools.review_probe --musinsa-no 1848166
  python -m worker.tools.review_probe --musinsa-no 1848166 --dry-run   # API 진단만
  python -m worker.tools.review_probe --musinsa-no 1848166 --page-size 20

기존 스크래퍼와의 차이:
  - 날짜 윈도우(5일) 없음 — 전체 페이지 무조건 수집
  - 단일 품번에 대한 모든 color variant 개별 진단
  - 페이지마다 DB 삽입 수 / API 총계 실시간 출력
  - PAGE_SIZE 최대값(20) 사용 (기존 7 → 3배 빠름)
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime
from typing import Any

import httpx
import pytz
from dotenv import load_dotenv
from loguru import logger

from supabase import Client, create_client
from worker.scrapers.base import BaseScraper, BotBlockedError

load_dotenv()

KST = pytz.timezone("Asia/Seoul")
REVIEW_URL = "https://api.musinsa.com/api2/review/v1/view/list"
COLOR_GROUP_URL = "https://goods-detail.musinsa.com/api2/goods/{goods_no}/curation/other-color"
CDN_BASE = "https://image.msscdn.net"
DEFAULT_PAGE_SIZE = 20  # 기존 스크래퍼 7 → 최대 허용 20


# ── Supabase ──────────────────────────────────────────────────────────────────

def _make_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


# ── 파싱 헬퍼 ─────────────────────────────────────────────────────────────────

def _safe_smallint(val: Any) -> int | None:
    if val is None:
        return None
    try:
        v = int(val)
    except (TypeError, ValueError):
        return None
    if v == 0:
        return None
    return v if -32768 <= v <= 32767 else None


def _parse_review(item: dict[str, Any], product_id: str, color_group_id: int | None) -> dict[str, Any]:
    images = item.get("images") or []
    image_urls = [
        (CDN_BASE + img["imageUrl"]) if img.get("imageUrl", "").startswith("/") else img["imageUrl"]
        for img in images if img.get("imageUrl")
    ]
    create_date_str = item.get("createDate", "")
    review_date = create_date_str[:10] if create_date_str else None

    profile = item.get("userProfileInfo") or {}
    satisfaction_raw = item.get("reviewSurveySatisfaction") or {}
    questions = satisfaction_raw.get("questions") or []
    satisfactions = [
        {"attribute": q["attribute"], "answer": q["answers"][0]["answerShortText"]}
        for q in questions if q.get("answers")
    ] or None

    item_goods_no = str((item.get("goods") or {}).get("goodsNo") or "")

    text = (item.get("content") or "").replace('\x00', '')

    return {
        "product_id":        product_id,
        "musinsa_review_id": str(item["no"]),
        "rating":            int(item.get("grade") or 0),
        "review_text":       text,
        "review_date":       review_date,
        "helpful_count":     item.get("likeCount") or 0,
        "has_image":         len(image_urls) > 0,
        "image_urls":        image_urls,
        "purchase_option":   item.get("goodsOption") or None,
        "member_height":     _safe_smallint(profile.get("userHeight")),
        "member_weight":     _safe_smallint(profile.get("userWeight")),
        "member_gender":     profile.get("reviewSex") or None,
        "satisfactions":     satisfactions,
        "is_experience":     bool(item.get("specialtyCodes")),
        "goods_no":          item_goods_no,
        "color_group_id":    color_group_id,
    }


# ── 메인 프로브 ───────────────────────────────────────────────────────────────

class ReviewProbe(BaseScraper):
    def __init__(self, client: Client, page_size: int = DEFAULT_PAGE_SIZE) -> None:
        self.client = client
        self.page_size = page_size

    # ── API 호출 ─────────────────────────────────────────────────────────────

    async def _fetch_review_page(self, goods_no: str, page: int) -> dict[str, Any] | None:
        async def _call() -> dict[str, Any]:
            async with httpx.AsyncClient(timeout=30) as http:
                resp = await http.get(
                    REVIEW_URL,
                    params={
                        "goodsNo":  goods_no,
                        "page":     page,
                        "pageSize": self.page_size,
                        "sort":     "recent",
                    },
                    headers={
                        **self.DEFAULT_HEADERS,
                        "Referer": f"https://www.musinsa.com/products/{goods_no}",
                    },
                )
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return resp.json()

        await self._sleep()
        try:
            return await self._with_retry(_call, label=f"review/{goods_no}/p{page}")
        except BotBlockedError:
            raise
        except Exception as e:
            logger.error(f"fetch 실패 goods={goods_no} page={page}: {e}")
            return None

    async def _fetch_color_group(self, goods_no: str) -> dict[str, Any] | None:
        async def _call() -> dict[str, Any]:
            url = COLOR_GROUP_URL.format(goods_no=goods_no)
            async with httpx.AsyncClient(timeout=20) as http:
                resp = await http.get(
                    url,
                    headers={
                        **self.DEFAULT_HEADERS,
                        "Referer": f"https://www.musinsa.com/products/{goods_no}",
                    },
                )
                if resp.status_code == 404:
                    return {}
                resp.raise_for_status()
                self._check_bot_blocked(resp.text)
                return resp.json()

        await self._sleep()
        try:
            return await self._with_retry(_call, label=f"color_group/{goods_no}")
        except Exception as e:
            logger.warning(f"color_group fetch 실패: {e}")
            return None

    # ── DB 조회 ──────────────────────────────────────────────────────────────

    def _db_product(self, musinsa_no: str) -> dict | None:
        rows = (
            self.client.table("products")
            .select("id, musinsa_no, name, review_count, color_group_id, review_checked_at")
            .eq("musinsa_no", musinsa_no)
            .limit(1)
            .execute()
            .data or []
        )
        return rows[0] if rows else None

    def _db_review_count(self, product_id: str) -> int:
        result = (
            self.client.table("reviews")
            .select("id", count="exact")
            .eq("product_id", product_id)
            .limit(1)
            .execute()
        )
        return result.count or 0

    def _db_review_count_by_group(self, color_group_id: int) -> int:
        result = (
            self.client.table("reviews")
            .select("id", count="exact")
            .eq("color_group_id", color_group_id)
            .limit(1)
            .execute()
        )
        return result.count or 0

    def _db_group_products(self, color_group_id: int) -> list[dict]:
        return (
            self.client.table("products")
            .select("id, musinsa_no, name, review_count")
            .eq("color_group_id", color_group_id)
            .order("review_count", desc=True)
            .execute()
            .data or []
        )

    def _upsert(self, rows: list[dict]) -> int:
        """
        ignore_duplicates=False (UPDATE 모드):
        이미 존재하는 musinsa_review_id도 product_id/goods_no 등 전체 컬럼을 재기록.
        기존에 잘못 귀속된 리뷰(goods_no/product_id 오류)를 API 원본값으로 교정.
        """
        if not rows:
            return 0
        for r in rows:
            if isinstance(r.get("review_text"), str):
                r["review_text"] = r["review_text"].replace('\x00', '')
        written = 0
        for i in range(0, len(rows), 500):
            result = (
                self.client.table("reviews")
                .upsert(rows[i:i+500], on_conflict="musinsa_review_id", ignore_duplicates=False)
                .execute()
            )
            written += len(result.data or [])
        return written

    # ── 진단 ─────────────────────────────────────────────────────────────────

    async def diagnose(self, musinsa_no: str) -> dict:
        """API 첫 페이지만 조회해서 총 리뷰 수, DB 현황, color group 정보를 출력."""
        logger.info("─" * 55)
        logger.info(f"진단 대상: goodsNo={musinsa_no}")
        logger.info("─" * 55)

        prod = self._db_product(musinsa_no)
        if not prod:
            logger.warning(f"[DB] 해당 품번({musinsa_no})이 products 테이블에 없음")
        else:
            db_review_cnt = self._db_review_count(prod["id"])
            logger.info(f"[DB] 상품명: {prod['name']}")
            logger.info(f"[DB] products.review_count = {prod['review_count']:,}")
            logger.info(f"[DB] 실제 reviews 행 수    = {db_review_cnt:,}  "
                        f"(갭: {(prod['review_count'] or 0) - db_review_cnt:+,})")
            logger.info(f"[DB] color_group_id       = {prod['color_group_id']}")
            logger.info(f"[DB] review_checked_at    = {prod['review_checked_at']}")

            if prod["color_group_id"] and prod["color_group_id"] != 0:
                group_cnt = self._db_review_count_by_group(prod["color_group_id"])
                logger.info(f"[DB] 그룹 전체 reviews (cg={prod['color_group_id']}) = {group_cnt:,}")
                group_prods = self._db_group_products(prod["color_group_id"])
                logger.info(f"[DB] 그룹 내 상품 {len(group_prods)}개:")
                for gp in group_prods:
                    logger.info(f"     goodsNo={gp['musinsa_no']}  review_count={gp['review_count']:,}  {gp['name'][:35]}")

        logger.info(f"[API] goodsNo={musinsa_no} 첫 페이지 조회 중...")
        resp = await self._fetch_review_page(musinsa_no, 1)
        api_info = {}
        if resp:
            data = resp.get("data") or {}
            pagination = data.get("page") or {}
            api_total = data.get("total") or 0
            api_pages = pagination.get("totalPages") or 1
            real_pages = (api_total + self.page_size - 1) // self.page_size if api_total else api_pages
            items = data.get("list") or []
            api_info = {"total": api_total, "total_pages": api_pages, "real_pages": real_pages}

            logger.info(f"[API] total={api_total:,}  totalPages(내부)={api_pages:,}  "
                        f"실제페이지(size={self.page_size})={real_pages:,}")
            if items:
                newest = items[0].get("createDate", "")[:10]
                oldest_page = items[-1].get("createDate", "")[:10]
                goods_on_page = {str((it.get("goods") or {}).get("goodsNo") or "") for it in items}
                logger.info(f"[API] 페이지1 최신={newest}  최구={oldest_page}  "
                             f"goodsNos={goods_on_page}")
        else:
            logger.error("[API] 응답 없음")

        logger.info(f"[COLOR_GROUP] goodsNo={musinsa_no} 색상 그룹 조회 중...")
        cg_resp = await self._fetch_color_group(musinsa_no)
        variants = []
        if cg_resp:
            for tab in (cg_resp.get("data") or {}).get("list") or []:
                if tab.get("curationTypeCode") == "OTHER_COLOR":
                    curation_id = tab.get("curationId")
                    for item in tab.get("goodsList") or []:
                        variants.append({
                            "goods_no":   str(item.get("goodsNo", "")),
                            "goods_name": item.get("goodsName", "")[:35],
                            "curation_id": curation_id,
                        })
                    break

        if variants:
            logger.info(f"[COLOR_GROUP] {len(variants)}개 variants:")
            for v in variants:
                logger.info(f"     goodsNo={v['goods_no']}  curationId={v['curation_id']}  {v['goods_name']}")
        else:
            logger.info("[COLOR_GROUP] 색상 그룹 없음 (단독 상품)")

        logger.info("─" * 55)
        return {"prod": prod, "api": api_info, "variants": variants}

    # ── 수집 ─────────────────────────────────────────────────────────────────

    async def collect_all(self, musinsa_no: str) -> int:
        """지정 품번 + 모든 color variant의 전체 리뷰를 날짜 필터 없이 수집."""
        prod = self._db_product(musinsa_no)
        if not prod:
            logger.error(f"goodsNo={musinsa_no} 가 products 테이블에 없음. 상품 수집 먼저 필요.")
            sys.exit(1)

        product_id = prod["id"]
        color_group_id = prod.get("color_group_id")

        no_to_pid: dict[str, str] = {musinsa_no: product_id}
        if color_group_id and color_group_id != 0:
            for gp in self._db_group_products(color_group_id):
                no_to_pid[gp["musinsa_no"]] = gp["id"]

        logger.info("=" * 55)
        logger.info(f"강제수집 시작: goodsNo={musinsa_no}")
        logger.info(f"variant 매핑: {len(no_to_pid)}개 → {list(no_to_pid.keys())}")
        logger.info(f"color_group_id: {color_group_id}")
        logger.info(f"page_size: {self.page_size}")
        logger.info(f"시작: {datetime.now(KST).strftime('%H:%M:%S')}")
        logger.info("=" * 55)

        if color_group_id and color_group_id != 0:
            group_prods = self._db_group_products(color_group_id)
            rep_no = group_prods[0]["musinsa_no"] if group_prods else musinsa_no
            logger.info(f"★ 그룹 대표 goodsNo={rep_no} 로 전체 수집 (review_count 최대)")
        else:
            rep_no = musinsa_no
            logger.info(f"★ 단독 상품 goodsNo={rep_no}")

        grand_total = await self._collect_goods(rep_no, no_to_pid, color_group_id)

        logger.info("─" * 55)
        if color_group_id and color_group_id != 0:
            after_cnt = self._db_review_count_by_group(color_group_id)
            logger.info(f"수집 후 그룹 reviews = {after_cnt:,}")
        else:
            after_cnt = self._db_review_count(product_id)
            logger.info(f"수집 후 상품 reviews = {after_cnt:,}")
        logger.info(f"이번 수집 신규 삽입  = {grand_total:,}")
        logger.info(f"완료: {datetime.now(KST).strftime('%H:%M:%S')}")
        logger.info("─" * 55)

        return grand_total

    async def _collect_goods(
        self,
        goods_no: str,
        no_to_pid: dict[str, str],
        color_group_id: int | None,
    ) -> int:
        """단일 goodsNo 전 페이지 수집. review item의 goods.goodsNo로 product_id 결정."""
        default_pid = no_to_pid.get(goods_no) or next(iter(no_to_pid.values()))

        page = 1
        real_pages = 1
        api_total = 0
        total_inserted = 0
        total_seen = 0

        logger.info(f"goodsNo={goods_no} 수집 시작...")

        while True:
            resp = await self._fetch_review_page(goods_no, page)
            if not resp:
                logger.error(f"page={page} 응답 없음, 중단")
                break

            data = resp.get("data") or {}
            items = data.get("list") or []
            pagination = data.get("page") or {}

            if page == 1:
                api_total = data.get("total") or 0
                total_pages_api = pagination.get("totalPages") or 1
                real_pages = (api_total + self.page_size - 1) // self.page_size if api_total else total_pages_api
                logger.info(f"API total={api_total:,}  totalPages(내부)={total_pages_api:,}  "
                             f"실제페이지={real_pages:,}")

            if not items:
                logger.info(f"page={page} items 없음, 종료")
                break

            rows: list[dict] = []
            for item in items:
                item_gno = str((item.get("goods") or {}).get("goodsNo") or "")
                pid = no_to_pid.get(item_gno, default_pid)
                rows.append(_parse_review(item, pid, color_group_id))

            total_seen += len(rows)
            inserted = self._upsert(rows)
            total_inserted += inserted

            pct = total_seen / api_total * 100 if api_total else 0
            oldest = (items[-1].get("createDate") or "")[:10]
            logger.info(
                f"p{page:>5}/{real_pages}  "
                f"seen={total_seen:>6,}/{api_total:,} ({pct:5.1f}%)  "
                f"교정/삽입={inserted:>4}  누적={total_inserted:>6,}  "
                f"oldest={oldest}"
            )

            if page >= real_pages:
                break
            page += 1

        return total_inserted


# ── 엔트리포인트 ──────────────────────────────────────────────────────────────

async def main(musinsa_no: str, dry_run: bool, page_size: int) -> None:
    client = _make_client()
    probe = ReviewProbe(client, page_size=page_size)

    diag = await probe.diagnose(musinsa_no)

    if dry_run:
        logger.info("[--dry-run] 수집 없이 종료")
        return

    if not diag["api"]:
        logger.error("API 응답 없음 — 수집 중단")
        sys.exit(1)

    await probe.collect_all(musinsa_no)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="특정 품번 리뷰 진단·강제수집")
    parser.add_argument("--musinsa-no", default="1848166", help="무신사 품번")
    parser.add_argument("--dry-run", action="store_true", help="진단만, DB 쓰기 없음")
    parser.add_argument(
        "--page-size", type=int, default=DEFAULT_PAGE_SIZE,
        help=f"페이지 크기 (기본: {DEFAULT_PAGE_SIZE}, 최대: 20)",
    )
    args = parser.parse_args()

    asyncio.run(main(
        musinsa_no=args.musinsa_no,
        dry_run=args.dry_run,
        page_size=min(args.page_size, 20),
    ))
