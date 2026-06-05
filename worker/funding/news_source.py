"""
UTTU 뉴스 기반 투자유치 정보 수집 — Naver News API

Naver 뉴스 검색 API로 특정 회사의 투자유치 뉴스를 검색한다.
추출은 worker/agent/funding_extractor.py (Claude Haiku) 에 위임.

API: https://openapi.naver.com/v1/search/news.json
인증: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET (X-Naver-Client-Id, X-Naver-Client-Secret)
"""
from __future__ import annotations

import html
import os
import re
import time
import random

import httpx
from loguru import logger

from worker.agent.funding_extractor import extract_funding_rounds

# ── 상수 ─────────────────────────────────────────────────────────────────────────

_NAVER_SEARCH_URL = "https://openapi.naver.com/v1/search/news.json"
_DISPLAY = 10          # 쿼리당 기사 수
_BODY_FETCH_LIMIT = 5  # 본문 직접 fetch 최대 건수 (상위 5건만 직접 fetch)
_MIN_DELAY_SEC = 1.0   # Naver API 요청 간 최소 딜레이
_BODY_TIMEOUT_SEC = 8.0  # 본문 fetch 타임아웃 (기존 10초 → 8초로 단축)

# 펀딩 관련성 하드 게이트 키워드
_FUNDING_KEYWORDS: list[str] = [
    "투자", "유치", "시리즈", "라운드", "증자", "조달",
    "펀딩", "투자유치", "프리A", "시드",
]

# 법인 접두·접미어 패턴 (core name 추출에 사용)
_LEGAL_PREFIXES = re.compile(
    r"^(?:주식회사|㈜|\(주\)|유한회사|유한책임회사|합자회사|합명회사)\s*",
)
_LEGAL_SUFFIXES = re.compile(
    r"\s*(?:주식회사|㈜|\(주\)|유한회사|유한책임회사)$",
)
# 괄호 안 영문 사명 제거: "(COVERNAT)", "(CHILDY Co., Ltd.)" 등
_PAREN_ENGLISH = re.compile(r"\s*\([A-Za-z0-9\s\.\-,]+\)\s*$")


# ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────────

def _core_name(corp_name: str) -> str:
    """
    법인 접두·접미어를 제거하여 핵심 사명만 반환.

    Examples
    --------
    '주식회사 에스제이그룹' → '에스제이그룹'
    '(주)커버낫'            → '커버낫'
    '주식회사 차일디(CHILDY Co., Ltd.)' → '차일디'
    """
    name = corp_name.strip()
    name = _LEGAL_PREFIXES.sub("", name)
    name = _LEGAL_SUFFIXES.sub("", name)
    name = _PAREN_ENGLISH.sub("", name)
    return name.strip()


def _fetch_brand_names(company_id: str) -> list[str]:
    """
    brands 테이블에서 해당 회사의 브랜드 이름 목록을 반환 (최대 5개).
    실패 시 빈 리스트 반환.
    """
    if not company_id:
        return []
    try:
        from supabase import create_client
        service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
        sb = create_client(os.environ["SUPABASE_URL"], service_key)
        r = sb.from_("brands").select("name").eq("company_id", company_id).limit(5).execute()
        return [b["name"] for b in (r.data or []) if b.get("name")]
    except Exception as e:
        logger.warning("brand_fetch_failed", company_id=company_id, error=str(e))
        return []


def _build_queries(corp_name: str, company_id: str = "") -> list[str]:
    """
    회사명 기반 검색 쿼리 생성 (최대 5개, 각 display=10 → 최대 50건).

    개선:
      - 법인 접두어 제거한 핵심명으로 검색 (정확도 향상)
      - brands 테이블 브랜드명 추가 쿼리 (최대 2개 더)
      - 일일 한도: 5 queries × 10 = 50 API 호출 (25,000 한도 내)
    """
    core = _core_name(corp_name)

    queries = [
        f"{core} 투자유치",
        f"{core} 유상증자",
        f"{core} 시리즈",
    ]

    # 브랜드명 쿼리 추가 (최대 2개, core와 다른 것만)
    if company_id:
        brand_names = _fetch_brand_names(company_id)
        added = 0
        core_tokens = {core}
        for brand in brand_names:
            brand_core = _core_name(brand)
            if brand_core and brand_core not in core_tokens and len(brand_core) >= 2:
                queries.append(f"{brand_core} 투자유치")
                core_tokens.add(brand_core)
                added += 1
                if added >= 2:
                    break

    # Naver daily limit 대응: 최대 5 쿼리
    return queries[:5]


def _strip_html(text: str) -> str:
    """HTML 태그 및 엔티티 제거."""
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return text.strip()


def _naver_search(client_id: str, client_secret: str, query: str) -> list[dict]:
    """
    Naver News API 단일 쿼리 실행 → 기사 메타데이터 리스트 반환.
    중복은 originallink 기준으로 제거.
    """
    headers = {
        "X-Naver-Client-Id":     client_id,
        "X-Naver-Client-Secret": client_secret,
    }
    params = {
        "query":   query,
        "display": _DISPLAY,
        "sort":    "date",
    }
    try:
        with httpx.Client(timeout=15.0) as http:
            resp = http.get(_NAVER_SEARCH_URL, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        logger.warning("naver_search_http_error", query=query[:50], error=str(e))
        return []
    except Exception as e:
        logger.warning("naver_search_error", query=query[:50], error=str(e))
        return []

    items = data.get("items") or []
    results: list[dict] = []
    for item in items:
        results.append({
            "title":         _strip_html(item.get("title") or ""),
            "description":   _strip_html(item.get("description") or ""),
            "source_url":    item.get("originallink") or item.get("link") or "",
            "published_at":  item.get("pubDate") or None,
            # 본문 fetch를 위해 두 URL 모두 보존
            "link":          item.get("link") or "",
            "originallink":  item.get("originallink") or "",
        })
    return results


def _fetch_article_body_single(url: str) -> str | None:
    """
    단일 URL에서 본문 텍스트 fetch. 실패 시 None 반환.
    """
    if not url:
        return None
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/136.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9",
            "Referer": "https://search.naver.com/",
        }
        with httpx.Client(timeout=_BODY_TIMEOUT_SEC, follow_redirects=True) as http:
            resp = http.get(url, headers=headers)
            resp.raise_for_status()
            text = resp.text
            # 태그 제거 후 공백 정규화
            clean = re.sub(r"<[^>]+>", " ", text)
            clean = html.unescape(clean)
            clean = re.sub(r"\s{3,}", "\n\n", clean).strip()
            if len(clean) < 100:
                return None
            return clean[:4000]
    except Exception as e:
        logger.debug("article_body_fetch_failed", url=url[:80], error=str(e))
        return None


def _fetch_article_body(item: dict) -> str | None:
    """
    기사 dict에서 본문 텍스트 fetch.
    우선순위: Naver 리더(n.news.naver.com) → originallink → link(일반)
    실패 시 None 반환 (fallback to description).
    """
    link = item.get("link") or ""
    original = item.get("originallink") or ""

    # URL 우선순위 결정
    urls_to_try: list[str] = []
    if link and "naver.com" in link:
        urls_to_try.append(link)       # Naver 리더 — 보통 파싱 용이
    if original and original not in urls_to_try:
        urls_to_try.append(original)   # 원본 출처
    if link and link not in urls_to_try:
        urls_to_try.append(link)       # 기타 링크

    for url in urls_to_try:
        body = _fetch_article_body_single(url)
        if body:
            return body
    return None


def _passes_funding_gate(body: str, core_name: str) -> bool:
    """
    하드 게이트: core_name AND ≥1 펀딩키워드가 본문에 동시 등장.
    통과 못 하면 Claude 추출 대상에서 제외 (오기사·무관기사 컷).
    """
    if core_name not in body:
        return False
    return any(kw in body for kw in _FUNDING_KEYWORDS)


def _brand_confidence_delta(body: str, brand_names: list[str]) -> float:
    """
    소프트 신호: 브랜드명이 본문에 있으면 +0.1, 없으면 -0.05.
    브랜드는 게이트 아님 — legit 기사가 브랜드 미언급일 수 있어 recall 보호.
    """
    if not brand_names:
        return 0.0
    if any(b in body for b in brand_names if b):
        return 0.1
    return -0.05


def _dedup_articles(articles: list[dict]) -> list[dict]:
    """originallink 기준 중복 제거."""
    seen: set[str] = set()
    result: list[dict] = []
    for a in articles:
        url = a.get("source_url") or ""
        key = url if url else id(a)
        if key in seen:
            continue
        seen.add(key)
        result.append(a)
    return result


# ── 공개 함수 ──────────────────────────────────────────────────────────────────────

async def fetch_news_rounds(
    company_name: str,
    corp_name: str,
    company_id: str = "",
) -> list[dict]:
    """
    회사명으로 Naver 뉴스 검색 → Claude Haiku NLP 추출 → rounds 리스트 반환.

    Parameters
    ----------
    company_name : companies 테이블의 corp_name (쿼리 + 매칭 검증에 사용)
    corp_name    : DART corp_name (corp_name이 있으면 우선 사용, 없으면 company_name 사용)
    company_id   : companies.id (brands 테이블 조회로 추가 쿼리 생성에 사용)

    Returns
    -------
    list of dicts (source_type='news', confidence<1.00)
    """
    search_name = corp_name or company_name

    # Naver 키 확인
    client_id     = os.environ.get("NAVER_CLIENT_ID")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET")
    if not client_id or not client_secret:
        logger.warning("news_source_no_naver_keys", company=search_name)
        return []

    # 핵심 사명으로 쿼리 생성 (법인 접두어 자동 제거)
    core = _core_name(search_name)
    queries = _build_queries(search_name, company_id=company_id)
    logger.info(
        "naver_queries_built",
        company=search_name,
        core_name=core,
        queries=queries,
    )
    all_articles: list[dict] = []
    query_counts: dict[str, int] = {}

    for query in queries:
        articles = _naver_search(client_id, client_secret, query)
        all_articles.extend(articles)
        query_counts[query] = len(articles)
        logger.info(
            "naver_query_done",
            query=query,
            found=len(articles),
            company=search_name,
        )
        # Naver API 요청 간 딜레이
        time.sleep(_MIN_DELAY_SEC + random.uniform(0, 0.5))

    raw_total = len(all_articles)
    logger.info(
        "naver_search_stage",
        company=search_name,
        queries=len(queries),
        raw_total=raw_total,
        per_query=query_counts,
    )

    # 중복 제거
    all_articles = _dedup_articles(all_articles)
    dedup_total = len(all_articles)
    logger.info(
        "naver_articles_found",
        company=search_name,
        raw_total=raw_total,
        after_dedup=dedup_total,
        duplicates_removed=raw_total - dedup_total,
    )

    # 상위 5건 본문 fetch (나머지는 description fallback)
    body_success = 0
    body_fallback = 0
    for i, article in enumerate(all_articles):
        if i < _BODY_FETCH_LIMIT:
            body = _fetch_article_body(article)
            if body:
                article["body"] = body
                body_success += 1
            else:
                article["body"] = article.get("description") or ""
                body_fallback += 1
            if i < len(all_articles) - 1 and i < _BODY_FETCH_LIMIT - 1:
                time.sleep(_MIN_DELAY_SEC + random.uniform(0, 0.3))
        else:
            article["body"] = article.get("description") or ""
            body_fallback += 1

    logger.info(
        "naver_body_fetch_stage",
        company=search_name,
        body_success=body_success,
        body_fallback=body_fallback,
        total_articles=dedup_total,
    )

    # Claude Haiku 추출 + 정밀도 필터
    brand_names = _fetch_brand_names(company_id) if company_id else []
    all_rounds: list[dict] = []
    articles_with_rounds = 0
    gate_cut = 0
    for article in all_articles:
        body = article.get("body") or ""
        url  = article.get("source_url") or ""
        if not body:
            continue

        # ① 하드 게이트: core_name AND 펀딩키워드 동시 등장
        if not _passes_funding_gate(body, core):
            gate_cut += 1
            logger.debug("funding_gate_cut", url=url[:60], company=search_name)
            continue

        try:
            rounds = await extract_funding_rounds(
                article_text=body,
                company_name=core,
                article_url=url,
            )
            if rounds:
                articles_with_rounds += 1

            # ② 소프트 신호: 브랜드 confidence 보정 (뉴스는 항상 <1.0 유지)
            delta = _brand_confidence_delta(body, brand_names)
            if delta != 0.0:
                for r in rounds:
                    orig = float(r.get("confidence") or 0.0)
                    r["confidence"] = max(0.0, min(0.9, orig + delta))

            all_rounds.extend(rounds)
        except Exception as e:
            logger.warning(
                "news_extract_failed",
                url=url[:60],
                error=str(e),
            )

    logger.info(
        "funding_gate_stats",
        company=search_name,
        gate_cut=gate_cut,
        passed=dedup_total - gate_cut,
    )

    logger.info(
        "naver_extract_stage",
        company=search_name,
        articles_processed=dedup_total,
        articles_with_rounds=articles_with_rounds,
        rounds_extracted=len(all_rounds),
    )

    logger.info(
        "news_rounds_extracted",
        company=search_name,
        rounds=len(all_rounds),
    )
    return all_rounds
