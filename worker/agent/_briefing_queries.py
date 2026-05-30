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
    자사 브랜드 상품 TOP 순위 변동 — 어제 vs 그제.
    gender=A, age=AGE_BAND_ALL 기준 브랜드별 최고 순위 비교.
    """
    yesterday  = _prev(target_date, 1)
    day_before = _prev(target_date, 2)
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
            items_y = r_y.data or []
            best_y  = items_y[0]["rank_position"] if items_y else None
            best_db = r_db.data[0]["rank_position"] if r_db.data else None
            delta   = (best_db - best_y) if (best_y and best_db) else None  # 양수=상승

            results.append({
                "brand_slug":           slug,
                "best_rank_yesterday":  best_y,
                "best_rank_day_before": best_db,
                "rank_delta":           delta,
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
        return res.data or []
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

def fetch_dart_disclosures(db: Client, target_date: date) -> list[dict]:
    """어제 DART 공시 목록 + 회사 정보 (자사·경쟁사 구분은 LLM이 판단)."""
    yesterday = _prev(target_date, 1)
    try:
        res = (
            db.table("dart_disclosures")
            .select("report_nm, rcept_dt, flr_nm, companies(id, corp_name, is_listed, stock_code)")
            .eq("rcept_dt", yesterday.isoformat())
            .order("rcept_dt", desc=True)
            .limit(30)
            .execute()
        )
        return res.data or []
    except Exception as e:
        logger.warning("dart_disclosures_failed", error=str(e))
        return []


# ── 외부 뉴스 ─────────────────────────────────────────────────────────────────

def fetch_external_news(
    db: Client, target_date: date, min_relevance: int = 3
) -> list[dict]:
    """당일 수집된 외부 패션 뉴스 (relevance ≥ min_relevance)."""
    try:
        res = (
            db.table("external_news")
            .select(
                "headline, summary, source_name, source_url, category, "
                "relevance, published_at, related_brands, related_companies"
            )
            .eq("collected_date", target_date.isoformat())
            .gte("relevance", min_relevance)
            .order("relevance", desc=True)
            .limit(20)
            .execute()
        )
        return res.data or []
    except Exception as e:
        logger.warning("external_news_failed", error=str(e))
        return []


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
        return sorted_cos[:5] if sorted_cos else movers[:5]
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
    포함: DART공시·재무시그널·외부뉴스(≥4)·HIGH이상탐지·회사단위동향·자사매출요약
    제외: 상품 랭킹 디테일·카테고리 트렌드·리뷰·프로모션 세부
    """
    own_slugs = get_own_brand_slugs(db)
    return {
        "date":    target_date,
        "weekday": WEEKDAY_KO.get(target_date.strftime("%A"), target_date.strftime("%A")),
        "own_sales":                 fetch_own_sales(db, target_date),
        "dart_disclosures":          fetch_dart_disclosures(db, target_date),
        "dart_financial_signals":    fetch_dart_financial_signals(db, target_date),
        "external_news":             fetch_external_news(db, target_date, min_relevance=4),
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
    return {
        "date":    target_date,
        "weekday": WEEKDAY_KO.get(target_date.strftime("%A"), target_date.strftime("%A")),
        "own_ranking_delta":             fetch_own_ranking_delta(db, target_date, own_slugs),
        "own_weekly_trend":              fetch_own_weekly_trend(db, target_date, own_slugs),
        "category_trends":               fetch_category_trends(db, target_date),
        "competitor_brand_new_entrants": fetch_competitor_new_entrants(db, target_date),
        "competitor_brand_movers":       fetch_competitor_brand_significant_movers(db, target_date),
        "active_promotions":             fetch_active_promotions(db, target_date, own_slugs),
        "anomalies_all":                 fetch_anomalies_combined(db, target_date),
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
