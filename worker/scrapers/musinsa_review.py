"""
무신사 자사 브랜드 상품 리뷰 스크래퍼

수집 모드:
  --smart     그룹 기반 증분 수집 (일별 권장 ★).
              color_group_id 단위로 묶어 대표 1개 goodsNo로 리뷰 API 호출.
              페이지 1 응답의 api_total vs DB count 비교 → 자동으로 증분/전수 결정.
              연속 3페이지 전부 중복 시 조기 종료.
  --backfill  전체 수집 (1회성). is_own=True 전체 상품, 모든 페이지 수집.
              NULL review_checked_at 상품 먼저 → review_count 많은 순.
              재시작 시 이미 처리된 상품은 자동 스킵 (마커파일 기반).
  (기본)      일별 증분 수집. ranking_snapshots 최근 30일 등장 활성 상품만.

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
    """SMALLINT 범위(-32768~32767) 초과 값은 None 처리. API sentinel(2147483647 등) 및 0 방어."""
    if val is None:
        return None
    try:
        v = int(val)
    except (TypeError, ValueError):
        return None
    if v == 0:
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
PAGE_SIZE = 7
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
        from worker.tasks.schedule_notify import send_progress as _notify
        now = datetime.now(KST)
        if self.progress_last_notify_at and (now - self.progress_last_notify_at).total_seconds() < 3600:
            return
        self.progress_last_notify_at = now

        idx   = self.progress_product_idx
        total = self.progress_product_total

        elapsed = now - self.progress_started_at if self.progress_started_at else timedelta(0)
        if idx > 0:
            rate_sec = elapsed.total_seconds() / idx
            remaining = timedelta(seconds=rate_sec * (total - idx))
            rem_str = _fmt_duration(remaining)
        else:
            rem_str = "계산 중"

        _notify("backfill", idx, total, _fmt_duration(elapsed), rem_str)

    # ── API 호출 ──────────────────────────────────────────────────────────────

    async def _fetch_page(self, musinsa_no: str, page: int) -> dict[str, Any] | None:
        async def _call() -> dict[str, Any]:
            async with httpx.AsyncClient(timeout=30) as http:
                resp = await http.get(
                    REVIEW_URL,
                    params={"goodsNo": musinsa_no, "page": page, "pageSize": PAGE_SIZE, "sort": "recent"},
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
    def _parse_review(
        item: dict[str, Any],
        product_id: str,
        goods_no: str | None = None,
        color_group_id: int | None = None,
    ) -> dict[str, Any]:
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

        # 그룹 수집 시 item.goods.goodsNo 가 실제 리뷰 달린 variant
        item_goods_no = str((item.get("goods") or {}).get("goodsNo") or "")

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
            "goods_no": item_goods_no or goods_no,
            "color_group_id": color_group_id,
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

    def _get_products_smart(self) -> list[dict]:
        """
        스마트 수집 대상: is_own=True + review_count > 0 상품.
        - review_checked_at NULL (미수집) 먼저
        - 이후 review_checked_at 오래된 순 (가장 오래전 체크 상품 우선)
        - 23시간 이내 체크된 상품은 스킵 (중복 방지)
        - review_count = 0 상품은 수집 불필요 → 제외
        """
        daily_cutoff = (datetime.now(KST) - timedelta(hours=23)).isoformat()

        all_products: list[dict] = []
        offset = 0
        while True:
            rows = (
                self.client.table("products")
                .select("id, musinsa_no, name, review_count, review_checked_at")
                .eq("is_own", True)
                .gt("review_count", 0)
                .or_(f"review_checked_at.is.null,review_checked_at.lt.{daily_cutoff}")
                .range(offset, offset + 999)
                .execute()
                .data or []
            )
            all_products.extend(rows)
            if len(rows) < 1000:
                break
            offset += 1000

        # NULL checked_at 먼저 → 오래된 순 → review_count 많은 순
        all_products.sort(
            key=lambda p: (
                0 if p.get("review_checked_at") is None else 1,
                p.get("review_checked_at") or "",
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

    def _mark_checked_group(self, color_group_id: int) -> None:
        """그룹 내 모든 상품 review_checked_at 일괄 업데이트."""
        self.client.table("products").update(
            {"review_checked_at": datetime.now(KST).isoformat()}
        ).eq("color_group_id", color_group_id).execute()

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

    def _get_last_date_for_group(self, color_group_id: int) -> date | None:
        """그룹의 가장 최근 리뷰 날짜. 없으면 None."""
        result = (
            self.client.table("reviews")
            .select("review_date")
            .eq("color_group_id", color_group_id)
            .order("review_date", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if not rows or not rows[0].get("review_date"):
            return None
        return date.fromisoformat(rows[0]["review_date"])

    def _get_db_count_for_group(self, color_group_id: int) -> int:
        """그룹의 DB 내 리뷰 수."""
        result = (
            self.client.table("reviews")
            .select("id", count="exact")
            .eq("color_group_id", color_group_id)
            .limit(1)
            .execute()
        )
        return result.count or 0

    def _get_group_product_map(self, color_group_id: int) -> dict[str, str]:
        """color_group_id 그룹 내 musinsa_no → product UUID 매핑."""
        rows = (
            self.client.table("products")
            .select("id, musinsa_no")
            .eq("color_group_id", color_group_id)
            .execute()
            .data or []
        )
        return {r["musinsa_no"]: r["id"] for r in rows}

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
        cutoff_date: date = date.today() - timedelta(days=5)  # 5일치 윈도우
        page = 1
        total_inserted = 0
        review_total_count = 0
        reviews_seen = 0

        self.progress_review_collected = 0
        self.progress_review_total = 0

        while True:
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
            page_has_recent = False

            for item in items:
                create_date_str = item.get("createDate", "")
                review_date = date.fromisoformat(create_date_str[:10]) if create_date_str else None

                rows_to_insert.append(self._parse_review(item, product_id))

                if not full_collect and review_date and review_date >= cutoff_date:
                    page_has_recent = True

            reviews_seen += len(rows_to_insert)
            self.progress_review_collected = reviews_seen

            if rows_to_insert:
                total_inserted += self._upsert_reviews(rows_to_insert)

            if product_idx and page % 10 == 0:
                prod_pct = product_idx / product_total * 100 if product_total else 0
                rev_pct  = reviews_seen / review_total_count * 100 if review_total_count else 0
                logger.info(
                    f"[{product_idx}/{product_total} ({prod_pct:.1f}%)] "
                    f"품번 {musinsa_no} | 리뷰 {reviews_seen:,}/{review_total_count:,} ({rev_pct:.1f}%) "
                    f"| 페이지 {page}/{total_pages}"
                )
                self._send_hourly()

            if not full_collect and not page_has_recent:
                break
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
        from worker.tasks.schedule_notify import send_done as _notify_done
        from worker.tasks.schedule_notify import send_progress as _notify

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
        _notify("backfill", 0, total)

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

            # 상품 간 추가 딜레이 — 수집량이 많을수록 더 길게 쉬어 차단 방지
            inter_delay = 10 if upserted > 500 else 5
            await asyncio.sleep(inter_delay)

            if idx % 100 == 0:
                logger.info(
                    f"review_backfill_progress done={idx}/{total} reviews={grand_total:,}"
                )

        elapsed_total = datetime.now(KST) - started_at
        logger.info("review_backfill_done", total_products=total, total_reviews=grand_total)
        _notify_done("backfill", f"상품 {total:,}개 · 리뷰 {grand_total:,}건 · 소요 {_fmt_duration(elapsed_total)}")

        # 완료 후 마커파일 삭제 (다음 backfill 실행 시 새 타임스탬프 생성)
        if BACKFILL_MARKER.exists():
            BACKFILL_MARKER.unlink()
            logger.info("backfill_marker_removed")

        return grand_total

    async def run_smart(self, limit: int | None = None, force_full: bool = False, force_smart: bool = False) -> int:
        """
        스마트 수집: 그룹 기반 증분 + 전수 자동 결정.
        force_full=True:  review_checked_at 무시 + 모든 그룹 전수 스캔 (전수조사 모드).
        force_smart=True: review_checked_at 무시 + 증분 스캔 유지 (전체 그룹 대상, 일별 방식).
        """
        from worker.tasks.schedule_notify import send_done as _notify_done
        from worker.tasks.schedule_notify import send_progress as _notify

        daily_cutoff = None if (force_full or force_smart) else (datetime.now(KST) - timedelta(hours=18)).isoformat()
        groups, standalones = self._get_groups_for_smart(daily_cutoff)

        if limit:
            groups = groups[:max(1, limit // 2)]
            standalones = standalones[:max(1, limit // 2)]

        total_groups = len(groups)
        total_standalones = len(standalones)
        total_items = total_groups + total_standalones
        logger.info(
            f"review_smart_start groups={total_groups} standalones={total_standalones}"
        )

        # task key: force_full=True면 backfill, 아니면 로그 파일명으로 구분
        import os as _os
        if force_full:
            _task_key = "backfill"
        else:
            _task_key = "smart_chain" if "reviews_smart" in (_os.environ.get("_SMART_LOG", "") or "") else "smart_daily"

        NOTIFY_INTERVAL_SEC = 30 * 60
        started_at = datetime.now(KST)
        last_notify_at = started_at
        _notify(_task_key, 0, total_items)

        grand_total = 0
        done_items = 0

        # ── 그룹 수집 ────────────────────────────────────────────
        for idx, grp in enumerate(groups, 1):
            cgid    = grp["color_group_id"]
            rep_no  = grp["rep_no"]
            rep_id  = grp["rep_id"]

            upserted = await self.run_group(
                cgid, rep_no, rep_id,
                group_idx=idx, group_total=total_groups,
                force_full=force_full,
            )
            self._mark_checked_group(cgid)
            grand_total += upserted
            done_items += 1

            if idx % 50 == 0:
                logger.info(
                    f"review_smart_group_progress {idx}/{total_groups} "
                    f"reviews={grand_total:,}"
                )

            now = datetime.now(KST)
            if (now - last_notify_at).total_seconds() >= NOTIFY_INTERVAL_SEC:
                last_notify_at = now
                elapsed = now - started_at
                if done_items > 0:
                    rate = elapsed.total_seconds() / done_items
                    rem = timedelta(seconds=rate * (total_items - done_items))
                    rem_str = _fmt_duration(rem)
                else:
                    rem_str = "계산 중"
                _notify(_task_key, done_items, total_items, _fmt_duration(elapsed), rem_str)

        # ── 단독 상품 수집 (color_group_id=0 or NULL) ────────────
        for idx, row in enumerate(standalones, 1):
            product_id = row["id"]
            musinsa_no = row["musinsa_no"]
            upserted = await self.run_product(product_id, musinsa_no, full_collect=force_full)
            self._mark_checked(product_id)
            grand_total += upserted
            done_items += 1

            if idx % 100 == 0:
                logger.info(
                    f"review_smart_standalone_progress {idx}/{total_standalones} "
                    f"reviews={grand_total:,}"
                )

            now = datetime.now(KST)
            if (now - last_notify_at).total_seconds() >= NOTIFY_INTERVAL_SEC:
                last_notify_at = now
                elapsed = now - started_at
                if done_items > 0:
                    rate = elapsed.total_seconds() / done_items
                    rem = timedelta(seconds=rate * (total_items - done_items))
                    rem_str = _fmt_duration(rem)
                else:
                    rem_str = "계산 중"
                _notify(_task_key, done_items, total_items, _fmt_duration(elapsed), rem_str)

        elapsed_total = datetime.now(KST) - started_at
        if force_full:
            logger.info("review_backfill_done", total_groups=total_groups, total_standalones=total_standalones, total_reviews=grand_total)
        else:
            logger.info(
                f"review_smart_done groups={total_groups} standalones={total_standalones} "
                f"total_reviews={grand_total:,}"
            )
        _notify_done(_task_key, f"그룹 {total_groups:,} · 단독 {total_standalones:,} · 신규 리뷰 {grand_total:,}건 · 소요 {_fmt_duration(elapsed_total)}")
        return grand_total

    def _get_groups_for_smart(self, daily_cutoff: str | None) -> tuple[list[dict], list[dict]]:
        """
        스마트 수집 대상을 그룹 vs 단독 상품으로 분리.
        daily_cutoff=None 이면 review_checked_at 필터 없이 전체 대상.
        """
        all_products: list[dict] = []
        offset = 0
        while True:
            q = (
                self.client.table("products")
                .select("id, musinsa_no, name, review_count, review_checked_at, color_group_id")
                .eq("is_own", True)
                .gt("review_count", 0)
            )
            if daily_cutoff:
                q = q.or_(f"review_checked_at.is.null,review_checked_at.lt.{daily_cutoff}")
            rows = q.range(offset, offset + 999).execute().data or []
            all_products.extend(rows)
            if len(rows) < 1000:
                break
            offset += 1000

        groups_map: dict[int, dict] = {}
        standalones: list[dict] = []

        for p in all_products:
            cgid = p.get("color_group_id")
            if cgid and cgid != 0:
                # 그룹 상품: color_group_id 당 review_count 최대인 것이 대표
                existing = groups_map.get(cgid)
                if existing is None or (p.get("review_count") or 0) > (existing.get("review_count") or 0):
                    groups_map[cgid] = {
                        "color_group_id": cgid,
                        "rep_no": p["musinsa_no"],
                        "rep_id": p["id"],
                        "review_count": p.get("review_count") or 0,
                        "review_checked_at": p.get("review_checked_at"),
                    }
            else:
                standalones.append(p)

        groups = sorted(
            groups_map.values(),
            key=lambda g: (
                0 if g.get("review_checked_at") is None else 1,
                g.get("review_checked_at") or "",
                -g["review_count"],
            ),
        )
        standalones.sort(
            key=lambda p: (
                0 if p.get("review_checked_at") is None else 1,
                p.get("review_checked_at") or "",
                -(p.get("review_count") or 0),
            )
        )
        return groups, standalones

    async def run_group(
        self,
        color_group_id: int,
        rep_no: str,
        rep_id: str,
        group_idx: int = 0,
        group_total: int = 0,
        force_full: bool = False,
    ) -> int:
        """
        색상 그룹 단위 리뷰 수집.
        force_full=True 이면 db_count 비율 무관, 항상 전수 모드 (total_pages까지 전부 스캔).
        """
        product_map = self._get_group_product_map(color_group_id)

        cutoff_date: date = date.today() - timedelta(days=5)  # 5일치 윈도우
        page = 1
        total_inserted = 0
        api_total = 0

        while True:
            resp = await self._fetch_page(rep_no, page)
            if not resp:
                break

            data = resp.get("data") or {}
            items = data.get("list") or []
            pagination = data.get("page") or {}
            total_pages = pagination.get("totalPages", 1)

            if page == 1:
                api_total = data.get("total") or (total_pages * PAGE_SIZE)
                logger.info(
                    f"[그룹{group_idx}/{group_total}] cg={color_group_id} rep={rep_no} "
                    f"api={api_total:,} mode={'전수' if force_full else '5일'}"
                )

            if not items:
                break

            rows_to_insert: list[dict] = []
            page_has_recent = False

            for item in items:
                create_date_str = item.get("createDate", "")
                review_date = date.fromisoformat(create_date_str[:10]) if create_date_str else None

                item_goods_no = str((item.get("goods") or {}).get("goodsNo") or "")
                pid = product_map.get(item_goods_no, rep_id)
                rows_to_insert.append(
                    self._parse_review(item, pid, color_group_id=color_group_id)
                )

                if not force_full and review_date and review_date >= cutoff_date:
                    page_has_recent = True

            if rows_to_insert:
                inserted = self._upsert_reviews(rows_to_insert)
                total_inserted += inserted

            if group_idx and page % 10 == 0:
                logger.info(
                    f"  cg={color_group_id} 페이지 {page}/{total_pages} "
                    f"신규 {total_inserted:,}건"
                )
                self._send_hourly()

            # force_full: 전 페이지 / 일반: 이 페이지에 5일 이내 리뷰 없으면 중단
            if not force_full and not page_has_recent:
                break
            if page >= total_pages:
                break
            page += 1

        return total_inserted

    async def run_daily(self, limit: int | None = None) -> int:
        """
        일별 증분 수집.
        - ranking_snapshots 최근 30일 등장 + is_sold_out=False 자사 상품만
        - review_checked_at 기준 1일 이내 상품은 스킵
        """
        from worker.tasks.schedule_notify import send_done as _notify_done

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
        _notify_done("smart_daily", f"활성 상품 {total:,}개 · 신규 리뷰 {grand_total:,}건")
        return grand_total


async def main(backfill: bool = False, smart: bool = False, force_full: bool = False, force_smart: bool = False, limit: int | None = None) -> None:
    from worker.utils.job_tracker import JobTracker
    client = _supabase_client()
    scraper = ReviewScraper(client)
    if backfill:
        label = "리뷰 전체수집(backfill)"
    elif force_full:
        label = "리뷰 전수조사(force-full)"
    elif force_smart:
        label = "리뷰 전체증분수집(force-smart)"
    elif smart:
        label = "리뷰 스마트수집"
    else:
        label = "리뷰 증분수집"
    tracker = JobTracker(client, script="musinsa_review", label=label)
    await tracker.start()
    try:
        if backfill:
            total = await scraper.run_backfill(limit=limit)
        elif force_full:
            total = await scraper.run_smart(limit=limit, force_full=True)
        elif smart or force_smart:
            total = await scraper.run_smart(limit=limit, force_smart=force_smart)
        else:
            total = await scraper.run_daily(limit=limit)
        await tracker.finish(rows_done=total or 0)
    except Exception as e:
        await tracker.error(str(e))
        raise


if __name__ == "__main__":
    import argparse
    import asyncio

    parser = argparse.ArgumentParser(description="무신사 자사 상품 리뷰 수집")
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="전체 수집 모드 (1회성). 모든 자사 상품의 모든 리뷰를 수집."
    )
    parser.add_argument(
        "--smart",
        action="store_true",
        help="스마트 수집 모드 (일별 권장). 전체 자사 상품 대상, 신규 리뷰만 증분 수집. "
             "ranking 활성 여부 무관. 신규 없는 상품은 1회 API 호출 후 즉시 skip."
    )
    parser.add_argument(
        "--force-full",
        action="store_true",
        help="전수조사 모드. review_checked_at 무시, 모든 그룹·상품 전 페이지 스캔."
    )
    parser.add_argument(
        "--force-smart",
        action="store_true",
        help="전체증분 모드. review_checked_at 무시하고 전체 3,971개 대상, 증분(신규만) 스캔."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="테스트용 상품 수 제한 (모든 모드 공통)"
    )
    args = parser.parse_args()
    asyncio.run(main(backfill=args.backfill, smart=args.smart, force_full=args.force_full, force_smart=args.force_smart, limit=args.limit))
