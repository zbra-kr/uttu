"""
매거진 피처링 → 상품 순위 급등 탐지.

로직:
  - 최근 7일 이내 발행된 매거진 기사에 연결된 상품을 대상으로
  - 발행 전(최대 3일 전)과 발행 후(최대 3일 후) ranking_snapshots 비교
  - 순위 상승 폭이 임계값 이상이면 anomaly 생성

기준 랭킹: category_code='000', gender_filter='A' (전체 카테고리, 전체 성별)

이상 유형:
  magazine_rank_boost  — 매거진 피처링 후 순위 급등
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from loguru import logger

from supabase import Client
from worker.detectors.base import Anomaly

MODULE = "magazine"

# 랭킹 기준
RANK_CATEGORY  = "000"
RANK_GENDER    = "A"
RANK_STORE     = "musinsa"

# 탐지 임계값
ARTICLE_LOOKBACK_DAYS = 7   # 며칠 전 발행 기사까지 대상으로 할지
BEFORE_WINDOW_DAYS    = 3   # 발행 전 최대 몇 일 전 랭킹을 "before"로 볼지
AFTER_WINDOW_DAYS     = 3   # 발행 후 최대 몇 일 후 랭킹을 "after"로 볼지

RANK_UNCHARTED = 9999       # 랭킹 미진입 시 대체값

HIGH_DELTA   = 50;  HIGH_TOP   = 30    # 50위↑ 상승 + TOP30 진입
MED_DELTA    = 20;  MED_TOP    = 100   # 20위↑ 상승 + TOP100 진입
LOW_DELTA    = 10;  LOW_TOP    = 200   # 10위↑ 상승 + TOP200 진입


def _load_articles_with_products(
    client: Client, since: date
) -> list[dict]:
    """
    발행일 >= since인 매거진 기사 + 연결 상품 목록.
    반환: [{ article_id, title, pub_date, view_count, musinsa_no, product_id, product_name, is_own }]
    """
    rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("magazine_article_products")
            .select(
                "article_id, musinsa_no, product_id, "
                "products(name, is_own), "
                "magazine_articles!inner(id, title, published_at, view_count)"
            )
            .gte("magazine_articles.published_at", since.isoformat())
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    result = []
    for r in rows:
        ma = r.get("magazine_articles") or {}
        p  = r.get("products") or {}
        pub_str = ma.get("published_at", "")
        if not pub_str:
            continue
        result.append({
            "article_id":          r["article_id"],
            "magazine_article_uuid": ma.get("id"),        # magazine_articles.id (UUID)
            "title":               ma.get("title", ""),
            "pub_date":            date.fromisoformat(pub_str[:10]),
            "view_count":          ma.get("view_count", 0),
            "musinsa_no":          r["musinsa_no"],
            "product_id":          r["product_id"],
            "product_name":        p.get("name", ""),
            "is_own":              p.get("is_own", False),
        })
    return result


def _load_ranking_window(
    client: Client,
    musinsa_nos: list[str],
    date_from: date,
    date_to: date,
) -> dict[str, dict[date, int]]:
    """
    musinsa_no → { snapshot_date → rank_position } 반환.
    지정 날짜 범위, 기준 category/gender 필터 적용.
    """
    if not musinsa_nos:
        return {}

    ranks: dict[str, dict[date, int]] = defaultdict(dict)
    for i in range(0, len(musinsa_nos), 500):
        chunk = musinsa_nos[i:i+500]
        offset = 0
        while True:
            batch = (
                client.table("ranking_snapshots")
                .select("musinsa_no, snapshot_date, rank_position")
                .in_("musinsa_no", chunk)
                .gte("snapshot_date", date_from.isoformat())
                .lte("snapshot_date", date_to.isoformat())
                .eq("category_code", RANK_CATEGORY)
                .eq("gender_filter",  RANK_GENDER)
                .eq("store_code",     RANK_STORE)
                .range(offset, offset + 999)
                .execute()
                .data or []
            )
            for row in batch:
                d = date.fromisoformat(row["snapshot_date"])
                ranks[row["musinsa_no"]][d] = row["rank_position"]
            if len(batch) < 1000:
                break
            offset += 1000
    return ranks


def detect_magazine_boost(client: Client, today: date) -> list[Anomaly]:
    since = today - timedelta(days=ARTICLE_LOOKBACK_DAYS)

    articles = _load_articles_with_products(client, since)
    if not articles:
        logger.info("magazine_boost: no articles with products in window")
        return []

    # 랭킹 조회 날짜 범위
    date_from = since - timedelta(days=BEFORE_WINDOW_DAYS)
    date_to   = today

    musinsa_nos = list({a["musinsa_no"] for a in articles})
    ranks = _load_ranking_window(client, musinsa_nos, date_from, date_to)

    logger.info(
        f"magazine_boost: articles={len(articles)} products={len(musinsa_nos)} "
        f"rank_window={date_from}~{date_to}"
    )

    # 상품+기사 단위로 집계 (같은 상품이 여러 기사에 등장할 수 있음)
    # key: (musinsa_no, article_id)
    anomalies: list[Anomaly] = []
    seen: set[tuple[str, str]] = set()

    for art in articles:
        key = (art["musinsa_no"], art["article_id"])
        if key in seen:
            continue
        seen.add(key)

        mno    = art["musinsa_no"]
        pub_dt = art["pub_date"]
        snap   = ranks.get(mno, {})

        # before: 발행일 전 최대 BEFORE_WINDOW_DAYS일 중 가장 최근 데이터
        before_rank: int = RANK_UNCHARTED
        for d_offset in range(1, BEFORE_WINDOW_DAYS + 1):
            d = pub_dt - timedelta(days=d_offset)
            if d in snap:
                before_rank = snap[d]
                break

        # after: 발행일 후 최대 AFTER_WINDOW_DAYS일 중 가장 좋은(낮은) 순위
        after_rank: int | None = None
        for d_offset in range(1, AFTER_WINDOW_DAYS + 1):
            d = pub_dt + timedelta(days=d_offset)
            if d in snap:
                r = snap[d]
                if after_rank is None or r < after_rank:
                    after_rank = r

        if after_rank is None:
            continue  # 발행 후 랭킹 데이터 없음

        delta = before_rank - after_rank  # 양수 = 순위 상승

        if delta >= HIGH_DELTA and after_rank <= HIGH_TOP:
            severity = "high"
        elif delta >= MED_DELTA and after_rank <= MED_TOP:
            severity = "medium"
        elif delta >= LOW_DELTA and after_rank <= LOW_TOP:
            severity = "low"
        else:
            continue

        is_new_entry = before_rank >= RANK_UNCHARTED
        anomaly_type = "magazine_rank_new_entry" if is_new_entry else "magazine_rank_boost"

        if is_new_entry:
            desc = (
                f"매거진 '{art['title']}' 발행 후 랭킹 외 → {after_rank}위 신규 진입 "
                f"· 기사 조회 {art['view_count']:,}"
            )
        else:
            desc = (
                f"매거진 '{art['title']}' 발행 후 {before_rank}위 → {after_rank}위 "
                f"({delta}위 상승) · 기사 조회 {art['view_count']:,}"
            )

        anomalies.append(Anomaly(
            module       = MODULE,
            severity     = severity,
            anomaly_type = anomaly_type,
            entity_type  = "product",
            entity_id    = art["product_id"],
            entity_name  = art["product_name"] or mno,
            description  = desc,
            meta         = {
                "article_id":            art["article_id"],
                "magazine_article_uuid": art.get("magazine_article_uuid"),
                "article_title":         art["title"],
                "pub_date":              pub_dt.isoformat(),
                "musinsa_no":            art["musinsa_no"],
                "rank_before":           None if is_new_entry else before_rank,
                "rank_after":            after_rank,
                "rank_delta":            None if is_new_entry else delta,
                "article_views":         art["view_count"],
                "is_own":                art["is_own"],
            },
        ))

    logger.info(f"magazine_boost: detected={len(anomalies)}")
    return anomalies
