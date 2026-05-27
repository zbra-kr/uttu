"""
무신사 자사 브랜드 상품 리뷰 스크래퍼

수집 모드:
  --backfill  전체 수집 (1회성). is_own=True 전체 상품, 모든 페이지 수집.
              NULL review_checked_at 상품 먼저 → review_count 많은 순.
              재시작 시 이미 처리된 상품은 자동 스킵 (마커파일 기반).
  (기본)      일별 증분 수집. ranking_snapshots 최근 30일 등장 활성 상품만.
              _get_last_review_date 이후 신규 리뷰만 수집.

금지: userNickName, userId, encryptedUserId — 개인정보 절대 저장 금지
pageSize 최대 20 (50+ → HTTP 400)
"""

import os
import pathlib
from datetime import date, datetime, timedelta
from typing import Any


def _fmt_duration(td: timedelta) -> str:
    """timedelta → '2시간 15분' 형식."""
    total_sec = int(td.total_seconds())
    h, rem = divmod(total_sec, 3600)
    m = rem // 60
    if h > 0:
        return f"{h}시간 {m}분"
    return f"{m}분"


def _safe_smallint(val: Any) -> int | None:
    """SMALLINT 범위(-32768~32767) 초과 값은 None 처리. API sentinel(2147483647 등) 방어."""
    if val is None:
        return None
    try:
        v = int(val)
    except (TypeError, ValueError):
        return None
    return v if -32768 <= v <= 32767 else None

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

# backfill 재시작 지원용 마커파일
BACKFILL_MARKER = pathlib.Path.home() / ".uttu_backfill_started"


def _supabase_client() -> Client:
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], service_key)


class ReviewScraper(BaseScraper):
    def __init__(self, client: Client) -> None:
        self.client = client
        # 실시간 진행 상태 (페이지 루프에서 매 페이지 갱신)
        self.progress_product_idx: int = 0
        self.progress_product_total: int = 0
        self.progress_product_no: str = "-"
        self.progress_product_name: str = "-"
        self.progress_review_collected: int = 0
        self.progress_review_total: int = 0
        self.progress_grand_total: int = 0         # 전체 누적 수집 리뷰 수
        self.progress_started_at: datetime | None = None
        self.progress_last_notify_at: datetime | None = None

    def _send_hourly(self) -> None:
        """1시간 경과 체크 후 Telegram 발송. 페이지 루프에서 호출."""
        from worker.tasks.notify import send
        now = datetime.now(KST)
        if self.progress_last_notify_at and (now - self.progress_last_notify_at).total_seconds() < 3600:
            return
        self.progress_last_notify_at = now

        idx    = self.progress_product_idx
        total  = self.progress_product_total
        prod_pct = idx / total * 100 if total else 0

        rev_now   = self.progress_review_collected
        rev_total = self.progress_review_total
        rev_pct   = rev_now / rev_total * 100 if rev_total else 0

        elapsed = now - self.progress_started_at if self.progress_started_at else timedelta(0)
        if idx > 0:
            rate_sec = elapsed.total_seconds() / idx
            remaining = timedelta(seconds=rate_sec * (total - idx))
            rem_str = _fmt_duration(remaining)
        else:
            rem_str = "계산 중"

        send(
            f"[UTTU] 리뷰 backfill 진행 중\n"
            f"━━━━━━━━━━━━━━\n"
            f"상품: {idx:,}/{total:,}개 ({prod_pct:.1f}%)\n"
            f"누적 리뷰: {self.progress_grand_total:,}건\n"
            f"\n"
            f"현재 품번: {self.progress_product_no} {self.progress_product_name}\n"
            f"리뷰: {rev_now:,}/{rev_total:,}건 ({rev_pct:.1f}%)\n"
            f"\n"
            f"시작: {self.progress_started_at.strftime('%m/%d %H:%M') if self.progress_started_at else '-'}\n"
            f"경과: {_fmt_duration(elapsed)}\n"
            f"잔여: {rem_str} (예상)"
        )

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

        # 체형정보 — 닉네임·사용자ID는 절대 수집 금지 (개인정보)
        profile = item.get("userProfileInfo") or {}

        # 만족도: [{attribute: "사이즈", answer: "정사이즈"}, ...]
        satisfaction_raw = item.get("reviewSurveySatisfaction") or {}
        questions = satisfaction_raw.get("questions") or []
        satisfactions: list[dict] | None = [
            {"attribute": q["attribute"], "answer": q["answers"][0]["answerShortText"]}
            for q in questions
            if q.get("answers")
        ] or None

        return {
            "product_id": product_id,
            "musinsa_review_id": str(item["no"]),
            "rating": int(item.get("grade") or 0),
            "review_text": item.get("content") or "",
            "review_date": review_date,
            "helpful_count": item.get("likeCount") or 0,
            "has_image": len(image_urls) > 0,
            "image_urls": image_urls,
            "purchase_option": item.get("goodsOption") or None,
            "member_height": _safe_smallint(profile.get("userHeight")),
            "member_weight": _safe_smallint(profile.get("userWeight")),
            "member_gender": profile.get("reviewSex") or None,
            "satisfactions": satisfactions,
            "is_experience": bool(item.get("specialtyCodes")),
        }

    # ── DB 헬퍼 ──────────────────────────────────────────────────────────────

    def _get_backfill_start(self) -> str:
        """
        backfill 시작 시각을 마커파일에서 읽거나 신규 생성.
        재시작 시 이 시각 이후 review_checked_at인 상품은 스킵 (이미 처리됨).
        """
        if BACKFILL_MARKER.exists():
            ts = BACKFILL_MARKER.read_text().strip()
            logger.info("backfill_resume", backfill_started=ts)
            return ts
        ts = datetime.now(KST).isoformat()
        BACKFILL_MARKER.write_text(ts)
        logger.info("backfill_start_new", backfill_started=ts)
        return ts

    def _get_products_backfill(self) -> list[dict]:
        """
        backfill 대상: is_own=True 전체 상품.
        - review_checked_at IS NULL 인 상품 먼저 (미처리)
        - 그 다음 review_checked_at < backfill_start 인 상품 (이전 daily로 체크됐지만 전수 미수집)
        - 이미 이번 backfill에서 처리된 상품(checked_at >= backfill_start)은 스킵
        - review_count 많은 순 정렬
        """
        backfill_start = self._get_backfill_start()

        all_products: list[dict] = []
        offset = 0
        while True:
            rows = (
                self.client.table("products")
                .select("id, musinsa_no, name, review_count, review_checked_at")
                .eq("is_own", True)
                .or_(f"review_checked_at.is.null,review_checked_at.lt.{backfill_start}")
                .range(offset, offset + 999)
                .execute()
                .data or []
            )
            all_products.extend(rows)
            if len(rows) < 1000:
                break
            offset += 1000

        # NULL checked_at 먼저, 그 다음 review_count 많은 순
        all_products.sort(
            key=lambda p: (
                0 if p.get("review_checked_at") is None else 1,
                -(p.get("review_count") or 0),
            )
        )
        return all_products

    def _get_products_daily(self) -> list[dict]:
        """
        daily 대상: ranking_snapshots 최근 30일 등장 + is_sold_out=False 자사 상품.
        review_checked_at 기준 수집 주기 적용 (1일 미경과 상품 스킵).
        """
        cutoff_date = (date.today() - timedelta(days=30)).isoformat()
        now = datetime.now(KST)
        daily_cutoff = (now - timedelta(days=1)).isoformat()

        # Step 1: 최근 30일 활성 product_id 수집 (is_sold_out=False)
        active_pids: set[str] = set()
        offset = 0
        while True:
            rows = (
                self.client.table("ranking_snapshots")
                .select("product_id")
                .gte("snapshot_date", cutoff_date)
                .eq("is_sold_out", False)
                .range(offset, offset + 999)
                .execute()
                .data or []
            )
            active_pids.update(r["product_id"] for r in rows)
            if len(rows) < 1000:
                break
            offset += 1000

        if not active_pids:
            logger.warning("daily_no_active_products_in_ranking")
            return []

        # Step 2: 자사 상품 필터 + 수집 주기 체크 (500개씩 배치)
        targets: list[dict] = []
        pid_list = list(active_pids)
        for i in range(0, len(pid_list), 500):
            rows = (
                self.client.table("products")
                .select("id, musinsa_no, review_count, review_checked_at")
                .eq("is_own", True)
                .in_("id", pid_list[i : i + 500])
                .execute()
                .data or []
            )
            for p in rows:
                checked = p.get("review_checked_at")
                if checked is None or checked < daily_cutoff:
                    targets.append(p)

        # review_count 많은 순 정렬
        targets.sort(key=lambda p: p.get("review_count") or 0, reverse=True)
        return targets

    def _mark_checked(self, product_id: str) -> None:
        self.client.table("products").update(
            {"review_checked_at": datetime.now(KST).isoformat()}
        ).eq("id", product_id).execute()

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

    @staticmethod
    def _sanitize(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """PostgreSQL이 거부하는 \x00 null byte를 텍스트 필드에서 제거."""
        def clean(v: Any) -> Any:
            return v.replace('\x00', '') if isinstance(v, str) else v
        return [{k: clean(v) for k, v in row.items()} for row in rows]

    def _upsert_reviews(self, rows: list[dict[str, Any]]) -> int:
        """upsert 후 실제 삽입된 행 수 반환 (중복은 ignore_duplicates=True로 스킵)."""
        rows = self._sanitize(rows)
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

    async def run_product(
        self,
        product_id: str,
        musinsa_no: str,
        full_collect: bool = False,
        product_idx: int = 0,
        product_total: int = 0,
    ) -> int:
        """
        단일 상품 리뷰 수집.
        full_collect=True (backfill): last_date 무시, 전체 페이지 수집.
        full_collect=False (daily):   last_review_date 이후 신규 리뷰만 수집.
        product_idx / product_total: 진행 상황 추적용 (0이면 로그 생략).
        반환값: 실제 새로 삽입된 리뷰 수.
        """
        last_date = None if full_collect else self._get_last_review_date(product_id)
        page = 1
        total_inserted = 0
        stop_early = False
        review_total_count = 0           # API가 알려주는 해당 상품 전체 리뷰 수
        reviews_seen = 0                 # 이번 순회에서 페이지를 넘기며 본 리뷰 수

        # 실시간 진행 상태 초기화
        self.progress_review_collected = 0
        self.progress_review_total = 0

        while not stop_early:
            resp = await self._fetch_page(musinsa_no, page)
            if not resp:
                break

            data = resp.get("data") or {}
            items = data.get("list") or []
            pagination = data.get("page") or {}
            total_pages = pagination.get("totalPages", 1)

            # 첫 페이지에서 전체 리뷰 수 확보
            if page == 1:
                review_total_count = pagination.get("total") or (total_pages * PAGE_SIZE)
                self.progress_review_total = review_total_count

            if not items:
                break

            rows_to_insert: list[dict] = []
            for item in items:
                create_date_str = item.get("createDate", "")
                review_date = date.fromisoformat(create_date_str[:10]) if create_date_str else None

                if last_date and review_date and review_date < last_date:
                    stop_early = True
                    break

                rows_to_insert.append(self._parse_review(item, product_id))

            reviews_seen += len(rows_to_insert)
            self.progress_review_collected = reviews_seen

            if rows_to_insert:
                total_inserted += self._upsert_reviews(rows_to_insert)

            # 페이지 단위 진행 로그 + 1시간 알림 체크 (backfill + 10페이지마다)
            if product_idx and page % 10 == 0:
                prod_pct = product_idx / product_total * 100 if product_total else 0
                rev_pct  = reviews_seen / review_total_count * 100 if review_total_count else 0
                logger.info(
                    f"[{product_idx}/{product_total} ({prod_pct:.1f}%)] "
                    f"품번 {musinsa_no} | 리뷰 {reviews_seen:,}/{review_total_count:,} ({rev_pct:.1f}%) "
                    f"| 페이지 {page}/{total_pages}"
                )
                self._send_hourly()

            if page >= total_pages:
                break
            page += 1

        if total_inserted > 0:
            logger.debug(
                "review_product_done",
                musinsa_no=musinsa_no,
                new_reviews=total_inserted,
                pages=page,
                mode="backfill" if full_collect else "incremental",
            )
        return total_inserted

    async def run_backfill(self, limit: int | None = None) -> int:
        """
        전체 수집 모드 (1회성 backfill).
        - 모든 자사 상품 대상 (style_no, 연도 무관)
        - NULL review_checked_at 먼저, 이후 나머지 순
        - 재시작 시 이번 backfill에서 이미 처리된 상품 자동 스킵
        - 1시간마다 Telegram 진행 상황 알림
        - 완료 시 마커파일 삭제
        """
        from worker.tasks.notify import send

        products = self._get_products_backfill()
        if limit:
            products = products[:limit]

        total = len(products)
        started_at = datetime.now(KST)

        # 공유 상태 초기화 (페이지 루프에서 갱신, _send_hourly에서 읽음)
        self.progress_product_total = total
        self.progress_grand_total   = 0
        self.progress_started_at    = started_at
        self.progress_last_notify_at = started_at  # 시작 직후 알림 방지

        logger.info("review_backfill_start", total_products=total)
        send(
            f"[UTTU] 리뷰 backfill 시작\n"
            f"━━━━━━━━━━━━━━\n"
            f"대상 상품: {total:,}개\n"
            f"시작: {started_at.strftime('%Y-%m-%d %H:%M')}\n"
            f"예상 소요: 2~4일"
        )

        grand_total = 0

        for idx, row in enumerate(products, 1):
            product_id = row["id"]
            musinsa_no = row["musinsa_no"]

            # 페이지 루프가 _send_hourly에서 읽는 상태 갱신
            self.progress_product_idx  = idx
            self.progress_product_no   = musinsa_no
            self.progress_product_name = (row.get("name") or musinsa_no)[:20]
            self.progress_grand_total  = grand_total

            upserted = await self.run_product(
                product_id, musinsa_no,
                full_collect=True,
                product_idx=idx,
                product_total=total,
            )
            self._mark_checked(product_id)
            grand_total += upserted
            self.progress_grand_total = grand_total

            if idx % 100 == 0:
                logger.info(
                    f"review_backfill_progress done={idx}/{total} reviews={grand_total:,}"
                )

        elapsed_total = datetime.now(KST) - started_at
        logger.info("review_backfill_done", total_products=total, total_reviews=grand_total)
        send(
            f"[UTTU] 리뷰 backfill 완료\n"
            f"━━━━━━━━━━━━━━\n"
            f"수집 상품: {total:,}개\n"
            f"총 리뷰: {grand_total:,}건\n"
            f"소요 시간: {_fmt_duration(elapsed_total)}"
        )

        # 완료 후 마커파일 삭제 (다음 backfill 실행 시 새 타임스탬프 생성)
        if BACKFILL_MARKER.exists():
            BACKFILL_MARKER.unlink()
            logger.info("backfill_marker_removed")

        return grand_total

    async def run_daily(self, limit: int | None = None) -> int:
        """
        일별 증분 수집.
        - ranking_snapshots 최근 30일 등장 + is_sold_out=False 자사 상품만
        - review_checked_at 기준 1일 이내 상품은 스킵
        """
        from worker.tasks.notify import send

        products = self._get_products_daily()
        if limit:
            products = products[:limit]

        total = len(products)
        logger.info("review_daily_start", total_products=total)

        grand_total = 0
        for idx, row in enumerate(products, 1):
            product_id = row["id"]
            musinsa_no = row["musinsa_no"]
            upserted = await self.run_product(product_id, musinsa_no, full_collect=False)
            self._mark_checked(product_id)
            grand_total += upserted

            if idx % 100 == 0:
                logger.info(
                    "review_daily_progress",
                    done=idx,
                    total=total,
                    reviews_so_far=grand_total,
                )

        logger.info("review_daily_done", total_products=total, total_reviews=grand_total)
        send(
            f"[UTTU] 리뷰 수집 완료\n"
            f"활성 상품: {total}개 / 신규 리뷰: {grand_total:,}건"
        )
        return grand_total


async def main(backfill: bool = False, limit: int | None = None) -> None:
    from worker.utils.job_tracker import JobTracker
    client = _supabase_client()
    scraper = ReviewScraper(client)
    label = "리뷰 전체수집(backfill)" if backfill else "리뷰 증분수집"
    tracker = JobTracker(client, script="musinsa_review", label=label)
    await tracker.start()
    try:
        if backfill:
            total = await scraper.run_backfill(limit=limit)
        else:
            total = await scraper.run_daily(limit=limit)
        await tracker.finish(rows_done=total or 0)
    except Exception as e:
        await tracker.error(str(e))
        raise


if __name__ == "__main__":
    import asyncio
    import argparse

    parser = argparse.ArgumentParser(description="무신사 자사 상품 리뷰 수집")
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="전체 수집 모드 (1회성). 모든 자사 상품의 모든 리뷰를 수집."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="테스트용 상품 수 제한 (두 모드 공통)"
    )
    args = parser.parse_args()
    asyncio.run(main(backfill=args.backfill, limit=args.limit))
