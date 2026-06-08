"""
브리핑 워커용 DB 쿼리 함수 모음.
모든 함수는 실패 시 빈 구조를 반환한다 (외부에서 except 불필요).
"""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta

from loguru import logger
from supabase import Client


# ── 날짜 헬퍼 ─────────────────────────────────────────────────────────────────

def _prev(d: date, n: int = 1) -> date:
    return d - timedelta(days=n)


def _week_monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


# ── 공통 마스터 ───────────────────────────────────────────────────────────────

def get_own_brand_slugs(db: Client) -> list[str]:
    """brands.is_own=true인 slug 목록."""
    try:
        res = db.table("brands").select("slug").eq("is_own", True).limit(20).execute()
        return [r["slug"] for r in (res.data or [])]
    except Exception as e:
        logger.warning("own_slugs_failed", error=str(e))
        return []


def get_own_product_ids(db: Client) -> list[str]:
    """products.is_own=true인 id 목록 (리뷰 조회에 사용)."""
    try:
        res = db.table("products").select("id").eq("is_own", True).limit(500).execute()
        return [r["id"] for r in (res.data or [])]
    except Exception as e:
        logger.warning("own_product_ids_failed", error=str(e))
        return []


# ── 자사 랭킹 ─────────────────────────────────────────────────────────────────

def fetch_own_ranking_delta(
    db: Client, target_date: date, own_slugs: list[str]
) -> list[dict]:
    """
    자사 브랜드 순위 변동 — 14일 이력 기반 변동성 분류 포함.

    volatility_class:
      "anomaly"  — |delta| ≥ 2σ: LLM 필수 전달 (이상 변동)
      "notable"  — |delta| ≥ 1σ: LLM 전달 (주목할 변동)
      "normal"   — |delta| < 1σ: LLM 전달 제외 (일상 노이즈)

    structural_trend: 최근 7일 best_rank 추세
      "상승" — 후반 7일 best_rank가 전반보다 2위 이상 개선
      "하락" — 후반 7일 best_rank가 전반보다 2위 이상 악화
      "안정" — 그 외
    """
    yesterday  = _prev(target_date, 1)
    day_before = _prev(target_date, 2)
    since_14d  = _prev(target_date, 14)
    if not own_slugs:
        return []

    results = []
    for slug in own_slugs:
        try:
            r_y = (
                db.table("ranking_snapshots")
                .select("rank_position, product_name, musinsa_no, category_code")
                .eq("brand_slug", slug)
                .eq("snapshot_date", yesterday.isoformat())
                .eq("gender_filter", "A")
                .eq("age_filter", "AGE_BAND_ALL")
                .order("rank_position")
                .limit(5)
                .execute()
            )
            r_db = (
                db.table("ranking_snapshots")
                .select("rank_position")
                .eq("brand_slug", slug)
                .eq("snapshot_date", day_before.isoformat())
                .eq("gender_filter", "A")
                .eq("age_filter", "AGE_BAND_ALL")
                .order("rank_position")
                .limit(1)
                .execute()
            )
            # 14일 이력 — 일별 best_rank 계산에 사용
            r_hist = (
                db.table("ranking_snapshots")
                .select("snapshot_date, rank_position")
                .eq("brand_slug", slug)
                .gte("snapshot_date", since_14d.isoformat())
                .lte("snapshot_date", day_before.isoformat())
                .eq("gender_filter", "A")
                .eq("age_filter", "AGE_BAND_ALL")
                .limit(2000)
                .execute()
            )

            items_y = r_y.data or []
            best_y  = items_y[0]["rank_position"] if items_y else None
            best_db = r_db.data[0]["rank_position"] if r_db.data else None
            delta   = (best_db - best_y) if (best_y and best_db) else None  # 양수=상승

            # 일별 best_rank 집계 (rank_position 최소 = 가장 높은 순위)
            by_date: dict[str, int] = {}
            for row in (r_hist.data or []):
                ds = row["snapshot_date"]
                rp = row["rank_position"]
                if ds not in by_date or rp < by_date[ds]:
                    by_date[ds] = rp

            daily_best_values = [by_date[d] for d in sorted(by_date)]

            # Historical std 계산
            historical_std: float | None = None
            volatility_class = "normal"
            if len(daily_best_values) >= 3 and delta is not None:
                mean_r = sum(daily_best_values) / len(daily_best_values)
                variance = sum((x - mean_r) ** 2 for x in daily_best_values) / len(daily_best_values)
                historical_std = variance ** 0.5
                if historical_std > 0:
                    ratio = abs(delta) / historical_std
                    if ratio >= 2.0:
                        volatility_class = "anomaly"
                    elif ratio >= 1.0:
                        volatility_class = "notable"

            # Structural trend: 최근 7일을 전반/후반 분할 비교
            structural_trend: str | None = None
            recent_dates = sorted(by_date.keys())[-7:]
            if len(recent_dates) >= 4:
                half = len(recent_dates) // 2
                avg_first  = sum(by_date[d] for d in recent_dates[:half]) / half
                avg_second = sum(by_date[d] for d in recent_dates[half:]) / (len(recent_dates) - half)
                diff = avg_first - avg_second  # 양수 = 후반 rank 더 낮음 = 순위 상승
                if diff > 2:
                    structural_trend = "상승"
                elif diff < -2:
                    structural_trend = "하락"
                else:
                    structural_trend = "안정"

            results.append({
                "brand_slug":           slug,
                "best_rank_yesterday":  best_y,
                "best_rank_day_before": best_db,
                "rank_delta":           delta,
                "historical_std":       round(historical_std, 1) if historical_std is not None else None,
                "volatility_class":     volatility_class,
                "structural_trend":     structural_trend,
                "top5_yesterday": [
                    {
                        "product_name": x["product_name"],
                        "rank":         x["rank_position"],
                        "musinsa_no":   x["musinsa_no"],
                        "category":     x["category_code"],
                    }
                    for x in items_y
                ],
            })
        except Exception as e:
            logger.warning("own_ranking_delta_failed", slug=slug, error=str(e))

    return results


def fetch_own_brand_avg_rank(
    db: Client, target_date: date, own_slugs: list[str]
) -> list[dict]:
    """자사 브랜드별 어제 평균 순위 (전체카테고리·A·AGE_BAND_ALL)."""
    yesterday = _prev(target_date, 1)
    results = []
    for slug in own_slugs:
        try:
            res = (
                db.table("ranking_snapshots")
                .select("rank_position")
                .eq("brand_slug", slug)
                .eq("snapshot_date", yesterday.isoformat())
                .eq("gender_filter", "A")
                .eq("age_filter", "AGE_BAND_ALL")
                .limit(500)
                .execute()
            )
            ranks = [r["rank_position"] for r in (res.data or [])]
            if ranks:
                results.append({
                    "brand_slug": slug,
                    "avg_rank":   round(sum(ranks) / len(ranks), 1),
                    "min_rank":   min(ranks),
                    "count":      len(ranks),
                })
        except Exception as e:
            logger.warning("own_avg_rank_failed", slug=slug, error=str(e))
    return results


def fetch_own_weekly_trend(
    db: Client, target_date: date, own_slugs: list[str]
) -> list[dict]:
    """금주(월요일~전날) 자사 브랜드 일별 최고순위 추이."""
    monday    = _week_monday(target_date)
    yesterday = _prev(target_date, 1)
    if monday > yesterday:
        return []

    results = []
    for slug in own_slugs:
        try:
            res = (
                db.table("ranking_snapshots")
                .select("snapshot_date, rank_position")
                .eq("brand_slug", slug)
                .gte("snapshot_date", monday.isoformat())
                .lte("snapshot_date", yesterday.isoformat())
                .eq("gender_filter", "A")
                .eq("age_filter", "AGE_BAND_ALL")
                .order("snapshot_date")
                .limit(1000)
                .execute()
            )
            by_date: dict[str, list[int]] = {}
            for row in (res.data or []):
                by_date.setdefault(row["snapshot_date"], []).append(row["rank_position"])

            results.append({
                "brand_slug": slug,
                "daily_best": [
                    {"date": d, "best_rank": min(ps)}
                    for d, ps in sorted(by_date.items())
                ],
            })
        except Exception as e:
            logger.warning("own_weekly_trend_failed", slug=slug, error=str(e))
    return results


# ── 이상탐지 ──────────────────────────────────────────────────────────────────

def fetch_anomalies(db: Client, target_date: date, severity: str) -> list[dict]:
    """이상탐지 결과 — 어제 날짜, 지정 severity."""
    yesterday = _prev(target_date, 1)
    try:
        res = (
            db.table("anomalies")
            .select("id, anomaly_type, entity_type, entity_name, description, module, meta")
            .eq("detection_date", yesterday.isoformat())
            .eq("severity", severity)
            .order("detected_at")
            .limit(20)
            .execute()
        )
        rows = res.data or []
        for r in rows:
            r["link"] = f"/anomaly?id={r['id']}"
        return rows
    except Exception as e:
        logger.warning("anomalies_failed", severity=severity, error=str(e))
        return []


# ── 경쟁사 동향 ───────────────────────────────────────────────────────────────

def fetch_competitor_movers(db: Client, target_date: date) -> list[dict]:
    """경쟁사 브랜드 TOP20 순위 변동 — 어제 vs 그제 (전체카테고리·A·AGE_BAND_ALL)."""
    yesterday  = _prev(target_date, 1)
    day_before = _prev(target_date, 2)
    try:
        r_y = (
            db.table("brand_ranking_snapshots")
            .select("musinsa_brand_slug, brand_name, rank_position")
            .eq("snapshot_date", yesterday.isoformat())
            .eq("category_code", "000")
            .eq("gender_filter", "A")
            .eq("age_filter", "AGE_BAND_ALL")
            .lte("rank_position", 20)
            .order("rank_position")
            .limit(20)
            .execute()
        )
        r_db = (
            db.table("brand_ranking_snapshots")
            .select("musinsa_brand_slug, rank_position")
            .eq("snapshot_date", day_before.isoformat())
            .eq("category_code", "000")
            .eq("gender_filter", "A")
            .eq("age_filter", "AGE_BAND_ALL")
            .lte("rank_position", 50)
            .order("rank_position")
            .limit(50)
            .execute()
        )
        prev = {r["musinsa_brand_slug"]: r["rank_position"] for r in (r_db.data or [])}

        return [
            {
                "brand_slug":      r["musinsa_brand_slug"],
                "brand_name":      r["brand_name"],
                "rank_yesterday":  r["rank_position"],
                "rank_day_before": prev.get(r["musinsa_brand_slug"]),
                "delta": (
                    prev[r["musinsa_brand_slug"]] - r["rank_position"]
                    if r["musinsa_brand_slug"] in prev else None
                ),
                "is_new_entrant": r["musinsa_brand_slug"] not in prev,
            }
            for r in (r_y.data or [])
        ]
    except Exception as e:
        logger.warning("competitor_movers_failed", error=str(e))
        return []


def fetch_competitor_new_entrants(db: Client, target_date: date) -> list[dict]:
    """경쟁사 TOP10 신규 진입 — 어제 TOP10이지만 그제는 TOP10 밖."""
    yesterday  = _prev(target_date, 1)
    day_before = _prev(target_date, 2)
    try:
        r_y = (
            db.table("brand_ranking_snapshots")
            .select("musinsa_brand_slug, brand_name, rank_position")
            .eq("snapshot_date", yesterday.isoformat())
            .eq("category_code", "000")
            .eq("gender_filter", "A")
            .eq("age_filter", "AGE_BAND_ALL")
            .lte("rank_position", 10)
            .order("rank_position")
            .limit(10)
            .execute()
        )
        r_db = (
            db.table("brand_ranking_snapshots")
            .select("musinsa_brand_slug")
            .eq("snapshot_date", day_before.isoformat())
            .eq("category_code", "000")
            .eq("gender_filter", "A")
            .eq("age_filter", "AGE_BAND_ALL")
            .lte("rank_position", 10)
            .limit(10)
            .execute()
        )
        prev_top10 = {r["musinsa_brand_slug"] for r in (r_db.data or [])}

        return [
            {
                "brand_slug": r["musinsa_brand_slug"],
                "brand_name": r["brand_name"],
                "rank":       r["rank_position"],
            }
            for r in (r_y.data or []) if r["musinsa_brand_slug"] not in prev_top10
        ]
    except Exception as e:
        logger.warning("new_entrants_failed", error=str(e))
        return []


# ── 프로모션 ──────────────────────────────────────────────────────────────────

def fetch_active_promotions(
    db: Client, target_date: date, own_slugs: list[str]
) -> list[dict]:
    """어제 기준 프로모션 목록 + 자사 상품 포함 여부·평균 할인율."""
    yesterday     = _prev(target_date, 1)
    own_slugs_set = set(own_slugs)
    try:
        res_p = (
            db.table("promotions")
            .select("id, title, promotion_type, items_count, end_at")
            .eq("snapshot_date", yesterday.isoformat())
            .limit(20)
            .execute()
        )
        results = []
        for p in (res_p.data or []):
            res_items = (
                db.table("promotion_items")
                .select("product_name, musinsa_brand_slug, discount_rate, is_sold_out")
                .eq("promotion_id", p["id"])
                .eq("snapshot_date", yesterday.isoformat())
                .limit(50)
                .execute()
            )
            items     = res_items.data or []
            own_items = [i for i in items if i.get("musinsa_brand_slug") in own_slugs_set]
            rates     = [float(i["discount_rate"] or 0) for i in items if i.get("discount_rate")]
            avg_disc  = round(sum(rates) / len(rates), 1) if rates else 0.0

            results.append({
                "title":            p["title"],
                "promotion_type":   p["promotion_type"],
                "total_items":      p["items_count"],
                "end_at":           p["end_at"],
                "avg_discount_rate": avg_disc,
                "has_own_brand":    bool(own_items),
                "own_brand_items": [
                    {
                        "product_name": x["product_name"],
                        "brand_slug":   x["musinsa_brand_slug"],
                        "discount_rate": x["discount_rate"],
                    }
                    for x in own_items[:5]
                ],
            })
        return results
    except Exception as e:
        logger.warning("active_promotions_failed", error=str(e))
        return []


# ── 리뷰 ──────────────────────────────────────────────────────────────────────

def fetch_review_summary(
    db: Client, target_date: date, own_product_ids: list[str]
) -> dict:
    """어제 자사 브랜드 리뷰 요약 — 건수·평균 별점·저점/고점 샘플."""
    yesterday = _prev(target_date, 1)
    if not own_product_ids:
        return {}
    try:
        # .in_() 안전 상한: product_id 최대 100개
        res = (
            db.table("reviews")
            .select("rating, review_text, product_id")
            .in_("product_id", own_product_ids[:100])
            .eq("review_date", yesterday.isoformat())
            .order("helpful_count", desc=True)
            .limit(200)
            .execute()
        )
        reviews = res.data or []
        if not reviews:
            return {"count": 0, "avg_rating": None, "low_samples": [], "high_samples": []}

        ratings    = [r["rating"] for r in reviews]
        avg_rating = round(sum(ratings) / len(ratings), 2)

        low  = [r for r in reviews if r["rating"] <= 2][:5]
        high = [r for r in reviews if r["rating"] >= 4][:5]

        return {
            "count":      len(reviews),
            "avg_rating": avg_rating,
            "rating_dist": {
                str(i): sum(1 for r in reviews if r["rating"] == i)
                for i in range(1, 6)
            },
            "low_samples": [
                {"rating": r["rating"], "text": (r["review_text"] or "")[:200]}
                for r in low
            ],
            "high_samples": [
                {"rating": r["rating"], "text": (r["review_text"] or "")[:200]}
                for r in high
            ],
        }
    except Exception as e:
        logger.warning("review_summary_failed", error=str(e))
        return {}


# ── DART ──────────────────────────────────────────────────────────────────────

# DART 공시 importance 스코어링 테이블
# 5=CRITICAL, 4=HIGH, 3=MEDIUM — 이 기준 미만은 브리핑에서 제외
_DART_IMPORTANCE: list[tuple[int, list[str]]] = [
    (5, ["합병", "분할", "상장폐지", "유상증자", "전환사채", "신주인수권부사채", "공개매수", "주식교환", "포괄적 주식교환", "기업인수합병"]),
    (4, ["영업이익", "매출액", "당기순이익", "주요사항보고서", "주요계약", "특수관계인", "대규모내부거래", "IPO", "상장예비심사", "공모", "사업보고서", "반기보고서", "분기보고서", "결산"]),
    (3, ["임원", "대표이사", "특허", "소송", "최대주주", "조회공시", "기업설명회", "자기주식"]),
]


def _dart_importance(report_nm: str) -> int:
    """report_nm 키워드 기반 importance 스코어. 미해당=1(LOW)."""
    rn = report_nm or ""
    for score, keywords in _DART_IMPORTANCE:
        if any(kw in rn for kw in keywords):
            return score
    return 1


def fetch_dart_disclosures(db: Client, target_date: date) -> list[dict]:
    """어제 DART 공시 목록 + importance 스코어링 (MEDIUM 이상만 반환, importance 내림차순)."""
    yesterday = _prev(target_date, 1)
    try:
        res = (
            db.table("dart_disclosures")
            .select("report_nm, rcept_dt, flr_nm, companies(id, corp_name, is_listed, stock_code)")
            .eq("rcept_dt", yesterday.isoformat())
            .order("rcept_dt", desc=True)
            .limit(50)
            .execute()
        )
        rows = res.data or []
        for r in rows:
            co = r.get("companies") or {}
            if co.get("id"):
                r["link"] = f"/company?id={co['id']}"
            r["importance"] = _dart_importance(r.get("report_nm", ""))

        # MEDIUM(3) 이상만 필터, importance 내림차순
        rows = [r for r in rows if r.get("importance", 1) >= 3]
        rows.sort(key=lambda r: r.get("importance", 1), reverse=True)
        return rows[:20]
    except Exception as e:
        logger.warning("dart_disclosures_failed", error=str(e))
        return []


# ── 외부 뉴스 ─────────────────────────────────────────────────────────────────

def fetch_external_news(
    db: Client, target_date: date, min_relevance: int = 3
) -> list[dict]:
    """
    최근 7일 수집된 외부 패션 뉴스 (relevance ≥ min_relevance).

    수집일(collected_date) 기준 7일 창을 사용하되,
    published_at이 있는 항목은 발행일 7일 초과 시 추가 필터링.
    """
    since = (target_date - timedelta(days=7)).isoformat()
    try:
        res = (
            db.table("external_news")
            .select(
                "headline, summary, source_name, source_url, category, "
                "relevance, published_at, related_brands, related_companies"
            )
            .gte("collected_date", since)
            .gte("relevance", min_relevance)
            .order("relevance", desc=True)
            .order("collected_date", desc=True)
            .limit(30)
            .execute()
        )
        rows = res.data or []

        # published_at 있으면 발행일 7일 초과 항목 제거
        cutoff_iso = since + "T00:00:00+00:00"
        filtered: list[dict] = []
        for r in rows:
            pub = r.get("published_at")
            if pub:
                try:
                    if pub < cutoff_iso:
                        continue
                except TypeError:
                    pass
            filtered.append(r)

        return filtered[:20]
    except Exception as e:
        logger.warning("external_news_failed", error=str(e))
        return []


# ── 외부 뉴스 슬롯 (4-slot 큐레이션) ────────────────────────────────────────

def fetch_external_news_slots(db: Client, target_date: date) -> dict:
    """
    2일 이내 기사를 4개 슬롯으로 분류. 없으면 빈 리스트 (강제 채움 없음).

    슬롯:
      hot:       화제성 — mention_count 높은 순 (동일 이슈 다매체 보도)
      own_brand: 자사 직접 언급 (없으면 생략)
      common:    패션 공통 — industry/trend/platform
      major:     주요 이슈 — relevance ≥ 4, competitor/industry/platform

    슬롯 간 URL 중복 없음 (앞 슬롯 우선).
    """
    since_2d   = (target_date - timedelta(days=2)).isoformat()
    cutoff_iso = since_2d + "T00:00:00+00:00"

    # mention_count 컬럼 존재 여부 — 마이그레이션 01308 적용 후 True
    _WITH_MENTION = (
        "headline, summary, source_name, source_url, category, "
        "relevance, mention_count, published_at, related_brands, related_companies"
    )
    _NO_MENTION = (
        "headline, summary, source_name, source_url, category, "
        "relevance, published_at, related_brands, related_companies"
    )

    def _fetch(
        category_filter=None,
        min_relevance: int = 2,
        order_mention: bool = False,
        limit: int = 2,
        exclude_urls: set | None = None,
    ) -> list[dict]:
        def _build(cols: str, with_mention: bool) -> list[dict]:
            q = (
                db.table("external_news")
                .select(cols)
                .gte("collected_date", since_2d)
                .gte("relevance", min_relevance)
            )
            if category_filter:
                if isinstance(category_filter, list):
                    q = q.in_("category", category_filter)
                else:
                    q = q.eq("category", category_filter)
            if order_mention and with_mention:
                q = q.order("mention_count", desc=True).order("relevance", desc=True)
            else:
                q = q.order("relevance", desc=True).order("published_at", desc=True)
            return q.limit(limit + 10).execute().data or []

        # mention_count 포함 시도 → 실패 시 폴백
        try:
            rows = _build(_WITH_MENTION, with_mention=True)
        except Exception as e:
            if "mention_count" in str(e):
                rows = _build(_NO_MENTION, with_mention=False)
            else:
                raise

        result: list[dict] = []
        for r in rows:
            url = r.get("source_url") or ""
            if exclude_urls and url in exclude_urls:
                continue
            pub = r.get("published_at")
            if pub:
                try:
                    if pub < cutoff_iso:
                        continue
                except TypeError:
                    pass
            result.append(r)
            if len(result) >= limit:
                break
        return result

    try:
        slot_hot = _fetch(order_mention=True, min_relevance=2, limit=2)
        used = {r.get("source_url") for r in slot_hot}

        slot_own = _fetch(
            category_filter="own_brand", min_relevance=1,
            exclude_urls=used, limit=2,
        )
        used |= {r.get("source_url") for r in slot_own}

        slot_common = _fetch(
            category_filter=["industry", "trend", "platform"],
            min_relevance=2, exclude_urls=used, limit=2,
        )
        used |= {r.get("source_url") for r in slot_common}

        slot_major = _fetch(
            category_filter=["competitor", "industry", "platform"],
            min_relevance=4, exclude_urls=used, limit=2,
        )

        return {
            "hot":       slot_hot,
            "own_brand": slot_own,
            "common":    slot_common,
            "major":     slot_major,
        }
    except Exception as e:
        logger.warning("external_news_slots_failed", error=str(e))
        return {"hot": [], "own_brand": [], "common": [], "major": []}


# ── ERP 매출 ──────────────────────────────────────────────────────────────────

def fetch_own_sales(_db: Client, _target_date: date) -> dict:
    """자사 매출 ERP — Snowflake 미연동. 빈 dict 반환."""
    return {}


# ── 이상탐지 확장 ─────────────────────────────────────────────────────────────

def fetch_anomalies_own_high(
    db: Client, target_date: date, own_slugs: list[str]
) -> list[dict]:
    """HIGH 이상탐지 중 own_slugs entity_name 필터 (매칭 없으면 전체 HIGH 반환)."""
    all_high = fetch_anomalies(db, target_date, "high")
    if not own_slugs:
        return all_high
    own_set = {s.lower() for s in own_slugs}
    filtered = [
        a for a in all_high
        if any(s in (a.get("entity_name") or "").lower() for s in own_set)
        or any(s in str(a.get("meta") or "").lower() for s in own_set)
    ]
    return filtered if filtered else all_high


def fetch_anomalies_combined(db: Client, target_date: date) -> dict:
    """HIGH + MED 이상탐지 어제 합산 (staff 전용)."""
    return {
        "high":   fetch_anomalies(db, target_date, "high"),
        "medium": fetch_anomalies(db, target_date, "medium"),
    }


# ── 경쟁사 회사 단위 동향 ─────────────────────────────────────────────────────

def fetch_competitor_company_movers(db: Client, target_date: date) -> list[dict]:
    """
    경쟁사 브랜드 변동을 회사 단위로 집계 (brands → companies 조인).
    조인 실패 시 브랜드 단위 top-5로 폴백.
    """
    movers = fetch_competitor_movers(db, target_date)
    if not movers:
        return []
    try:
        slugs = [m["brand_slug"] for m in movers]
        res = (
            db.table("brands")
            .select("slug, companies(id, corp_name)")
            .in_("slug", slugs[:20])
            .limit(20)
            .execute()
        )
        co_by_slug: dict[str, dict] = {
            b["slug"]: b["companies"]
            for b in (res.data or [])
            if b.get("companies")
        }

        company_map: dict[str, dict] = {}
        for m in movers:
            co = co_by_slug.get(m["brand_slug"])
            if not co:
                continue
            co_id  = co["id"]
            m_delta = abs(m.get("delta") or 0)
            if co_id not in company_map or m_delta > abs(company_map[co_id].get("max_delta") or 0):
                company_map[co_id] = {
                    "company_id":    co_id,
                    "corp_name":     co["corp_name"],
                    "brand_slug":    m["brand_slug"],
                    "brand_name":    m["brand_name"],
                    "rank_yesterday":  m["rank_yesterday"],
                    "rank_day_before": m.get("rank_day_before"),
                    "max_delta":       m.get("delta"),
                    "is_new_entrant":  m.get("is_new_entrant", False),
                }

        sorted_cos = sorted(
            company_map.values(),
            key=lambda x: abs(x.get("max_delta") or 0),
            reverse=True,
        )
        result = sorted_cos[:5] if sorted_cos else movers[:5]
        for r in result:
            if r.get("company_id"):
                r["link"] = f"/company?id={r['company_id']}"
        return result
    except Exception as e:
        logger.warning("competitor_company_movers_failed", error=str(e))
        return movers[:5]


# ── 경쟁사 브랜드 유의미 변동 ─────────────────────────────────────────────────

def fetch_competitor_brand_significant_movers(
    db: Client, target_date: date, min_delta: int = 5
) -> list[dict]:
    """경쟁사 TOP20 중 ±min_delta 이상 순위 변동 (staff 전용)."""
    movers = fetch_competitor_movers(db, target_date)
    return [
        m for m in movers
        if m.get("delta") is not None and abs(m["delta"]) >= min_delta
    ]


# ── 카테고리별 핫 트렌드 ──────────────────────────────────────────────────────

def fetch_category_trends(db: Client, target_date: date) -> list[dict]:
    """어제 카테고리별 TOP5 브랜드 (category_code != '000', 최대 9개 카테고리)."""
    yesterday = _prev(target_date, 1)
    try:
        res = (
            db.table("ranking_snapshots")
            .select("category_code, brand_slug, rank_position")
            .eq("snapshot_date", yesterday.isoformat())
            .eq("gender_filter", "A")
            .eq("age_filter", "AGE_BAND_ALL")
            .neq("category_code", "000")
            .order("category_code")
            .order("rank_position")
            .limit(500)
            .execute()
        )
        by_cat: dict[str, list[dict]] = {}
        for row in (res.data or []):
            cat = row["category_code"]
            if len(by_cat.get(cat, [])) < 5:
                by_cat.setdefault(cat, []).append(
                    {"brand_slug": row["brand_slug"], "rank": row["rank_position"]}
                )
        return [
            {"category_code": cat, "top_brands": entries}
            for cat, entries in sorted(by_cat.items())
        ][:9]
    except Exception as e:
        logger.warning("category_trends_failed", error=str(e))
        return []


# ── DART 재무 시그널 ──────────────────────────────────────────────────────────

_FINANCIAL_KEYWORDS = [
    "분기보고서", "사업보고서", "영업실적", "매출액", "반기보고서", "잠정실적",
]


def fetch_dart_financial_signals(db: Client, target_date: date) -> list[dict]:
    """최근 7일 DART 공시 중 분기·반기·사업보고서 등 재무 키워드 필터링."""
    since     = _prev(target_date, 7)
    yesterday = _prev(target_date, 1)
    try:
        res = (
            db.table("dart_disclosures")
            .select("report_nm, rcept_dt, flr_nm, companies(id, corp_name, is_listed)")
            .gte("rcept_dt", since.isoformat())
            .lte("rcept_dt", yesterday.isoformat())
            .order("rcept_dt", desc=True)
            .limit(30)
            .execute()
        )
        return [
            r for r in (res.data or [])
            if any(kw in (r.get("report_nm") or "") for kw in _FINANCIAL_KEYWORDS)
        ]
    except Exception as e:
        logger.warning("dart_financial_signals_failed", error=str(e))
        return []


# ── CS: 저점/고점 리뷰 본문 샘플 ─────────────────────────────────────────────

def fetch_low_reviews(
    db: Client, target_date: date, own_product_ids: list[str], max_samples: int = 10
) -> list[dict]:
    """어제 자사 1~2점 리뷰 본문 샘플 (닉네임·사용자ID 절대 포함 금지)."""
    yesterday = _prev(target_date, 1)
    if not own_product_ids:
        return []
    try:
        res = (
            db.table("reviews")
            .select("rating, review_text, review_date, product_id")
            .in_("product_id", own_product_ids[:100])
            .eq("review_date", yesterday.isoformat())
            .lte("rating", 2)
            .order("helpful_count", desc=True)
            .limit(max_samples)
            .execute()
        )
        return [
            {
                "rating":      r["rating"],
                "text":        (r["review_text"] or "")[:200],
                "review_date": r["review_date"],
            }
            for r in (res.data or [])
        ]
    except Exception as e:
        logger.warning("low_reviews_failed", error=str(e))
        return []


def fetch_high_reviews(
    db: Client, target_date: date, own_product_ids: list[str], max_samples: int = 10
) -> list[dict]:
    """어제 자사 4~5점 리뷰 본문 샘플 (닉네임·사용자ID 절대 포함 금지)."""
    yesterday = _prev(target_date, 1)
    if not own_product_ids:
        return []
    try:
        res = (
            db.table("reviews")
            .select("rating, review_text, review_date, product_id")
            .in_("product_id", own_product_ids[:100])
            .eq("review_date", yesterday.isoformat())
            .gte("rating", 4)
            .order("helpful_count", desc=True)
            .limit(max_samples)
            .execute()
        )
        return [
            {
                "rating":      r["rating"],
                "text":        (r["review_text"] or "")[:200],
                "review_date": r["review_date"],
            }
            for r in (res.data or [])
        ]
    except Exception as e:
        logger.warning("high_reviews_failed", error=str(e))
        return []


# ── CS: 이번 주 브랜드별 리뷰 패턴 ──────────────────────────────────────────

def fetch_weekly_review_pattern(
    db: Client, target_date: date,
    own_product_ids: list[str], own_slugs: list[str],
) -> list[dict]:
    """이번 주(월~전날) 자사 브랜드별 평균 별점·신규 건수."""
    monday    = _week_monday(target_date)
    yesterday = _prev(target_date, 1)
    if monday > yesterday or not own_product_ids:
        return []
    try:
        res = (
            db.table("reviews")
            .select("rating, product_id")
            .in_("product_id", own_product_ids[:100])
            .gte("review_date", monday.isoformat())
            .lte("review_date", yesterday.isoformat())
            .limit(1000)
            .execute()
        )
        reviews = res.data or []
        if not reviews:
            return []

        # product_id → brand_slug 매핑
        all_pids = list({r["product_id"] for r in reviews})
        brand_map: dict[str, str] = {}
        try:
            pr = (
                db.table("products")
                .select("id, brand_slug")
                .in_("id", all_pids[:100])
                .limit(100)
                .execute()
            )
            brand_map = {p["id"]: p["brand_slug"] for p in (pr.data or [])}
        except Exception:
            pass

        by_brand: dict[str, list[int]] = {}
        for r in reviews:
            slug = brand_map.get(r["product_id"], "unknown")
            by_brand.setdefault(slug, []).append(r["rating"])

        period = f"{monday.isoformat()} ~ {yesterday.isoformat()}"
        return [
            {
                "brand_slug": slug,
                "period":     period,
                "count":      len(ratings),
                "avg_rating": round(sum(ratings) / len(ratings), 2),
                "rating_dist": {
                    str(i): sum(1 for rt in ratings if rt == i)
                    for i in range(1, 6)
                },
            }
            for slug, ratings in sorted(by_brand.items())
        ]
    except Exception as e:
        logger.warning("weekly_review_pattern_failed", error=str(e))
        return []


# ── CS: 문제 상품 / 강점 상품 ─────────────────────────────────────────────────

def fetch_problem_products(
    db: Client, target_date: date, own_product_ids: list[str]
) -> list[dict]:
    """이번 주 1~2점 누적 많은 자사 상품 TOP5."""
    monday    = _week_monday(target_date)
    yesterday = _prev(target_date, 1)
    if not own_product_ids:
        return []
    try:
        res = (
            db.table("reviews")
            .select("product_id, rating")
            .in_("product_id", own_product_ids[:100])
            .gte("review_date", monday.isoformat())
            .lte("review_date", yesterday.isoformat())
            .lte("rating", 2)
            .limit(500)
            .execute()
        )
        counts = Counter(r["product_id"] for r in (res.data or []))
        top5   = [pid for pid, _ in counts.most_common(5)]
        if not top5:
            return []

        prod_info: dict[str, dict] = {}
        try:
            pr = (
                db.table("products")
                .select("id, name, brand_slug")
                .in_("id", top5)
                .limit(5)
                .execute()
            )
            prod_info = {p["id"]: p for p in (pr.data or [])}
        except Exception:
            pass

        return [
            {
                "product_id":       pid,
                "product_name":     prod_info.get(pid, {}).get("name", pid),
                "brand_slug":       prod_info.get(pid, {}).get("brand_slug", ""),
                "low_review_count": counts[pid],
            }
            for pid in top5
        ]
    except Exception as e:
        logger.warning("problem_products_failed", error=str(e))
        return []


def fetch_strength_products(
    db: Client, target_date: date, own_product_ids: list[str]
) -> list[dict]:
    """이번 주 4~5점 누적 많은 자사 상품 TOP5."""
    monday    = _week_monday(target_date)
    yesterday = _prev(target_date, 1)
    if not own_product_ids:
        return []
    try:
        res = (
            db.table("reviews")
            .select("product_id, rating")
            .in_("product_id", own_product_ids[:100])
            .gte("review_date", monday.isoformat())
            .lte("review_date", yesterday.isoformat())
            .gte("rating", 4)
            .limit(500)
            .execute()
        )
        counts = Counter(r["product_id"] for r in (res.data or []))
        top5   = [pid for pid, _ in counts.most_common(5)]
        if not top5:
            return []

        prod_info: dict[str, dict] = {}
        try:
            pr = (
                db.table("products")
                .select("id, name, brand_slug")
                .in_("id", top5)
                .limit(5)
                .execute()
            )
            prod_info = {p["id"]: p for p in (pr.data or [])}
        except Exception:
            pass

        return [
            {
                "product_id":        pid,
                "product_name":      prod_info.get(pid, {}).get("name", pid),
                "brand_slug":        prod_info.get(pid, {}).get("brand_slug", ""),
                "high_review_count": counts[pid],
            }
            for pid in top5
        ]
    except Exception as e:
        logger.warning("strength_products_failed", error=str(e))
        return []


# ── 콘텐츠 효과 분석 ──────────────────────────────────────────────────────────

def fetch_snap_effectiveness(db: Client, target_date: date) -> list[dict]:
    """
    최근 7일 고참여 스냅 → 연결 상품의 랭킹 변화.
    engagement_score = view×1 + like×5 + comment×10 + goods_click×3
    """
    since     = _prev(target_date, 7)
    yesterday = _prev(target_date, 1)
    try:
        # 고참여 스냅 로드
        snap_rows = (
            db.table("snap_products")
            .select(
                "musinsa_no, product_id, "
                "products(name, is_own, brand_id), "
                "snaps!inner(snap_id, view_count, like_count, "
                "comment_count, goods_click_count, collected_at)"
            )
            .gte("snaps.collected_at", since.isoformat())
            .limit(500)
            .execute()
        ).data or []

        def _eng(s: dict) -> int:
            return (
                (s.get("view_count") or 0) * 1
                + (s.get("like_count") or 0) * 5
                + (s.get("comment_count") or 0) * 10
                + (s.get("goods_click_count") or 0) * 3
            )

        top_snaps = sorted(
            [r for r in snap_rows if _eng(r.get("snaps") or {}) >= 100],
            key=lambda r: _eng(r.get("snaps") or {}),
            reverse=True,
        )[:20]

        if not top_snaps:
            return []

        musinsa_nos = list({r["musinsa_no"] for r in top_snaps if r.get("musinsa_no")})
        if not musinsa_nos:
            return []

        # 랭킹 전후 조회 (수집일 -3일 ~ 오늘)
        date_from = since - timedelta(days=3)
        rank_rows = (
            db.table("ranking_snapshots")
            .select("musinsa_no, snapshot_date, rank_position")
            .in_("musinsa_no", musinsa_nos[:200])
            .gte("snapshot_date", date_from.isoformat())
            .lte("snapshot_date", yesterday.isoformat())
            .eq("category_code", "000")
            .eq("gender_filter", "A")
            .limit(2000)
            .execute()
        ).data or []

        from collections import defaultdict
        rank_by_no: dict = defaultdict(dict)
        for row in rank_rows:
            d = date.fromisoformat(row["snapshot_date"])
            rank_by_no[row["musinsa_no"]][d] = row["rank_position"]

        results = []
        seen: set = set()
        for r in top_snaps:
            mno  = r.get("musinsa_no")
            snap = r.get("snaps") or {}
            p    = r.get("products") or {}
            if not mno or mno in seen:
                continue
            seen.add(mno)

            col_str = snap.get("collected_at", "")
            if not col_str:
                continue
            col_dt = date.fromisoformat(str(col_str)[:10])
            ranks  = rank_by_no.get(mno, {})
            eng    = _eng(snap)

            before_rank = None
            for offset in range(1, 4):
                d = col_dt - timedelta(days=offset)
                if d in ranks:
                    before_rank = ranks[d]
                    break

            after_rank = None
            for offset in range(1, 4):
                d = col_dt + timedelta(days=offset)
                if d in ranks:
                    r2 = ranks[d]
                    if after_rank is None or r2 < after_rank:
                        after_rank = r2

            rank_delta = (before_rank - after_rank) if (before_rank and after_rank) else None

            results.append({
                "snap_id":        snap.get("snap_id"),
                "collected_at":   col_str[:10],
                "engagement":     eng,
                "view_count":     snap.get("view_count", 0),
                "like_count":     snap.get("like_count", 0),
                "goods_click":    snap.get("goods_click_count", 0),
                "musinsa_no":     mno,
                "product_name":   p.get("name", ""),
                "is_own":         p.get("is_own", False),
                "rank_before":    before_rank,
                "rank_after":     after_rank,
                "rank_delta":     rank_delta,
            })

        return sorted(results, key=lambda x: abs(x.get("rank_delta") or 0), reverse=True)[:10]
    except Exception as e:
        logger.warning("snap_effectiveness_failed", error=str(e))
        return []


def fetch_promo_effectiveness(db: Client, target_date: date) -> list[dict]:
    """
    최근 14일 프로모션 → 연결 상품의 랭킹·리뷰 변화.
    프로모션 타입별 효과 비교 포함.
    """
    since     = _prev(target_date, 14)
    yesterday = _prev(target_date, 1)
    try:
        item_rows = (
            db.table("promotion_items")
            .select(
                "musinsa_no, product_id, product_name, musinsa_brand_slug, "
                "discount_rate, snapshot_date, "
                "promotions!inner(id, title, promotion_type)"
            )
            .gte("snapshot_date", since.isoformat())
            .limit(500)
            .execute()
        ).data or []

        if not item_rows:
            return []

        musinsa_nos = list({r["musinsa_no"] for r in item_rows if r.get("musinsa_no")})

        rank_rows = (
            db.table("ranking_snapshots")
            .select("musinsa_no, snapshot_date, rank_position, review_count")
            .in_("musinsa_no", musinsa_nos[:200])
            .gte("snapshot_date", (since - timedelta(days=3)).isoformat())
            .lte("snapshot_date", yesterday.isoformat())
            .eq("category_code", "000")
            .eq("gender_filter", "A")
            .limit(3000)
            .execute()
        ).data or []

        from collections import defaultdict
        rank_by_no: dict = defaultdict(dict)
        for row in rank_rows:
            d = date.fromisoformat(row["snapshot_date"])
            rank_by_no[row["musinsa_no"]][d] = (
                row["rank_position"],
                row.get("review_count") or 0,
            )

        results = []
        seen: set = set()
        for item in item_rows:
            mno   = item.get("musinsa_no")
            promo = item.get("promotions") or {}
            key   = (mno, str(promo.get("id")))
            if not mno or key in seen:
                continue
            seen.add(key)

            promo_d = date.fromisoformat(item["snapshot_date"])
            ranks   = rank_by_no.get(mno, {})

            before_rank, before_reviews = 9999, 0
            for offset in range(1, 4):
                d = promo_d - timedelta(days=offset)
                if d in ranks:
                    before_rank, before_reviews = ranks[d]
                    break

            after_rank, after_reviews = None, 0
            for offset in range(1, 6):
                d = promo_d + timedelta(days=offset)
                if d in ranks:
                    r2, rev = ranks[d]
                    if after_rank is None or r2 < after_rank:
                        after_rank, after_reviews = r2, rev

            if after_rank is None:
                continue

            rank_delta   = (before_rank - after_rank) if before_rank < 9999 else None
            review_delta = after_reviews - before_reviews

            results.append({
                "promo_title":     promo.get("title", ""),
                "promo_type":      promo.get("promotion_type", ""),
                "promo_date":      item["snapshot_date"],
                "discount_rate":   float(item.get("discount_rate") or 0),
                "musinsa_no":      mno,
                "product_name":    item.get("product_name", ""),
                "brand_slug":      item.get("musinsa_brand_slug", ""),
                "rank_before":     before_rank if before_rank < 9999 else None,
                "rank_after":      after_rank,
                "rank_delta":      rank_delta,
                "review_before":   before_reviews,
                "review_after":    after_reviews,
                "review_delta":    review_delta,
            })

        return sorted(results, key=lambda x: abs(x.get("rank_delta") or 0), reverse=True)[:10]
    except Exception as e:
        logger.warning("promo_effectiveness_failed", error=str(e))
        return []


def fetch_magazine_effectiveness(db: Client, target_date: date) -> list[dict]:
    """
    최근 7일 매거진 기사 → 연결 상품의 랭킹 변화.
    조회수 높은 기사 우선.
    """
    since     = _prev(target_date, 7)
    yesterday = _prev(target_date, 1)
    try:
        art_rows = (
            db.table("magazine_article_products")
            .select(
                "musinsa_no, product_id, "
                "products(name, is_own), "
                "magazine_articles!inner(id, title, view_count, published_at)"
            )
            .gte("magazine_articles.published_at", since.isoformat())
            .limit(500)
            .execute()
        ).data or []

        if not art_rows:
            return []

        musinsa_nos = list({r["musinsa_no"] for r in art_rows if r.get("musinsa_no")})

        rank_rows = (
            db.table("ranking_snapshots")
            .select("musinsa_no, snapshot_date, rank_position")
            .in_("musinsa_no", musinsa_nos[:200])
            .gte("snapshot_date", (since - timedelta(days=3)).isoformat())
            .lte("snapshot_date", yesterday.isoformat())
            .eq("category_code", "000")
            .eq("gender_filter", "A")
            .limit(3000)
            .execute()
        ).data or []

        from collections import defaultdict
        rank_by_no: dict = defaultdict(dict)
        for row in rank_rows:
            d = date.fromisoformat(row["snapshot_date"])
            rank_by_no[row["musinsa_no"]][d] = row["rank_position"]

        results = []
        seen: set = set()
        for r in art_rows:
            mno = r.get("musinsa_no")
            art = r.get("magazine_articles") or {}
            p   = r.get("products") or {}
            pub_str = art.get("published_at", "")
            key = (mno, art.get("id"))
            if not mno or not pub_str or key in seen:
                continue
            seen.add(key)

            pub_dt = date.fromisoformat(pub_str[:10])
            ranks  = rank_by_no.get(mno, {})

            before_rank = None
            for offset in range(1, 4):
                d = pub_dt - timedelta(days=offset)
                if d in ranks:
                    before_rank = ranks[d]
                    break

            after_rank = None
            for offset in range(1, 4):
                d = pub_dt + timedelta(days=offset)
                if d in ranks:
                    r2 = ranks[d]
                    if after_rank is None or r2 < after_rank:
                        after_rank = r2

            if after_rank is None:
                continue

            rank_delta = (before_rank - after_rank) if before_rank else None

            results.append({
                "article_title":  art.get("title", ""),
                "published_at":   pub_str[:10],
                "view_count":     art.get("view_count", 0),
                "musinsa_no":     mno,
                "product_name":   p.get("name", ""),
                "is_own":         p.get("is_own", False),
                "rank_before":    before_rank,
                "rank_after":     after_rank,
                "rank_delta":     rank_delta,
            })

        return sorted(results, key=lambda x: abs(x.get("rank_delta") or 0), reverse=True)[:10]
    except Exception as e:
        logger.warning("magazine_effectiveness_failed", error=str(e))
        return []


# ── 공통: weekday 한국어 변환 ─────────────────────────────────────────────────

WEEKDAY_KO: dict[str, str] = {
    "Monday": "월요일", "Tuesday": "화요일", "Wednesday": "수요일",
    "Thursday": "목요일", "Friday": "금요일", "Saturday": "토요일",
    "Sunday": "일요일",
}


# ── Audience별 입력 수집 함수 3종 ────────────────────────────────────────────

def collect_executive_inputs(db: Client, target_date: date) -> dict:
    """
    경영진(Executive) 시점 입력.
    포함: DART공시·재무시그널·외부뉴스(4슬롯)·HIGH이상탐지·회사단위동향·자사매출요약
    제외: 상품 랭킹 디테일·카테고리 트렌드·리뷰·프로모션 세부
    """
    own_slugs  = get_own_brand_slugs(db)
    news_slots = fetch_external_news_slots(db, target_date)
    return {
        "date":    target_date,
        "weekday": WEEKDAY_KO.get(target_date.strftime("%A"), target_date.strftime("%A")),
        "own_sales":                 fetch_own_sales(db, target_date),
        "dart_disclosures":          fetch_dart_disclosures(db, target_date),
        "dart_financial_signals":    fetch_dart_financial_signals(db, target_date),
        # 외부 뉴스 4-slot (2일 이내, 슬롯별)
        "news_hot":                  news_slots["hot"],
        "news_own":                  news_slots["own_brand"],
        "news_common":               news_slots["common"],
        "news_major":                news_slots["major"],
        "anomalies_high_own":        fetch_anomalies_own_high(db, target_date, own_slugs),
        "competitor_company_movers": fetch_competitor_company_movers(db, target_date),
        "own_weekly_summary":        fetch_own_weekly_trend(db, target_date, own_slugs),
    }


def collect_staff_inputs(db: Client, target_date: date) -> dict:
    """
    기획/영업(Staff) 시점 입력.
    포함: 자사 랭킹변동·주간추이·카테고리트렌드·경쟁브랜드·프로모션·이상탐지(HIGH+MED)
    제외: DART재무·외부뉴스·자사매출ERP·리뷰본문
    """
    own_slugs = get_own_brand_slugs(db)
    # normal_volatility는 LLM에서 제외 — notable/anomaly만 전달 (노이즈 감소)
    ranking_delta_all = fetch_own_ranking_delta(db, target_date, own_slugs)
    ranking_delta_llm = [r for r in ranking_delta_all if r.get("volatility_class") != "normal"]
    return {
        "date":    target_date,
        "weekday": WEEKDAY_KO.get(target_date.strftime("%A"), target_date.strftime("%A")),
        "own_ranking_delta":             ranking_delta_llm,
        "own_weekly_trend":              fetch_own_weekly_trend(db, target_date, own_slugs),
        "category_trends":               fetch_category_trends(db, target_date),
        "competitor_brand_new_entrants": fetch_competitor_new_entrants(db, target_date),
        "competitor_brand_movers":       fetch_competitor_brand_significant_movers(db, target_date),
        "active_promotions":             fetch_active_promotions(db, target_date, own_slugs),
        "anomalies_all":                 fetch_anomalies_combined(db, target_date),
        # 콘텐츠 효과 분석 (스냅·프로모션·매거진 → 랭킹 변화)
        "snap_effectiveness":      fetch_snap_effectiveness(db, target_date),
        "promo_effectiveness":     fetch_promo_effectiveness(db, target_date),
        "magazine_effectiveness":  fetch_magazine_effectiveness(db, target_date),
    }


def collect_cs_inputs(db: Client, target_date: date) -> dict:
    """
    CS 시점 입력.
    포함: 리뷰 요약·저점샘플·고점샘플·주간브랜드패턴·문제상품·강점상품
    제외: 랭킹·매출·재무·외부뉴스·이상탐지
    """
    own_product_ids = get_own_product_ids(db)
    own_slugs       = get_own_brand_slugs(db)
    return {
        "date":    target_date,
        "weekday": WEEKDAY_KO.get(target_date.strftime("%A"), target_date.strftime("%A")),
        "review_summary_yesterday": fetch_review_summary(db, target_date, own_product_ids),
        "low_reviews":              fetch_low_reviews(db, target_date, own_product_ids),
        "high_reviews":             fetch_high_reviews(db, target_date, own_product_ids),
        "weekly_review_pattern":    fetch_weekly_review_pattern(
                                        db, target_date, own_product_ids, own_slugs
                                    ),
        "problem_products_top":     fetch_problem_products(db, target_date, own_product_ids),
        "strength_products_top":    fetch_strength_products(db, target_date, own_product_ids),
    }
