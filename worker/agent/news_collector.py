"""
UTTU 외부 뉴스 수집 워커 — Naver News API 기반.

Naver 뉴스 검색 API로 패션 전반 뉴스를 수집하고,
Claude Haiku가 배치 단위로 요약·분류·relevance 스코어링 후 external_news에 upsert.

(검색은 Naver, 요약/분류는 Claude — 할루시네이션 없음)

실행:
  worker/.venv/bin/python3 -m worker.agent.news_collector           # 실제 수집
  worker/.venv/bin/python3 -m worker.agent.news_collector --dry-run # DB 적재 없이 출력만
"""
from __future__ import annotations

import argparse
import asyncio
import html as html_lib
import json
import os
import re
import sys
import time
import random
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import anthropic
import httpx
import pytz
from dotenv import load_dotenv
from loguru import logger
from supabase import create_client

from worker.utils.job_tracker import JobTracker

load_dotenv()

KST   = pytz.timezone("Asia/Seoul")
MODEL = "claude-haiku-4-5-20251001"

_NAVER_SEARCH_URL = "https://openapi.naver.com/v1/search/news.json"
_DISPLAY          = 10    # 쿼리당 기사 수
_MIN_DELAY_SEC    = 0.5   # Naver API 요청 간 최소 딜레이
_BATCH_SIZE       = 12    # Claude 분류 배치 크기


# ── 클라이언트 ─────────────────────────────────────────────────────────────────

def _supabase():
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], key)


def _today_kst() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


# ── 검색 쿼리 — 패션 전반 위주 ────────────────────────────────────────────────
#
# 자사(커버낫 등) 직접 뉴스보다 산업·트렌드·플랫폼 전반을 중심으로 수집.
# 수집된 뉴스는 브리핑 LLM이 무신사 랭킹·이상탐지 데이터와 교차해 인사이트 생성.

QUERIES: list[str] = [
    # 플랫폼 — 무신사 랭킹 데이터와 직접 연결
    "무신사",
    # 카테고리 트렌드 — ranking_snapshots 카테고리 변동과 연결
    "스트릿 캐주얼 패션 트렌드",
    "스포츠 아웃도어 패션",
    # 산업 전반
    "한국 패션 산업 시장",
    "패션 브랜드 매출 실적",
    # 기업 이벤트 — DART 공시와 교차
    "패션 기업 투자 합병 IPO",
    # 경쟁사 — 브랜드 랭킹 변동과 교차
    "영원무역 한세실업 F&F LF 한섬",
    # 소비자·트렌드
    "MZ 패션 소비 트렌드",
    # 자사 (결과 없어도 OK)
    "커버낫",
]


# ── Naver API ─────────────────────────────────────────────────────────────────

def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = html_lib.unescape(text)
    return text.strip()


def _parse_pubdate(pub_date_str: str | None) -> str | None:
    """RFC 822 pubDate → ISO 8601 문자열. 실패 시 None."""
    if not pub_date_str:
        return None
    try:
        dt = parsedate_to_datetime(pub_date_str)
        return dt.isoformat()
    except Exception:
        return None


def _naver_search(query: str) -> list[dict]:
    """Naver 뉴스 API 단일 쿼리 → 기사 메타데이터 리스트."""
    client_id     = os.environ.get("NAVER_CLIENT_ID", "")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise RuntimeError("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수 없음")

    headers = {
        "X-Naver-Client-Id":     client_id,
        "X-Naver-Client-Secret": client_secret,
    }
    params = {"query": query, "display": _DISPLAY, "sort": "date"}

    try:
        with httpx.Client(timeout=15.0) as http:
            resp = http.get(_NAVER_SEARCH_URL, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        logger.warning("naver_http_error", query=query[:50], error=str(e))
        return []

    results: list[dict] = []
    for item in (data.get("items") or []):
        source_url = item.get("originallink") or item.get("link") or ""
        pub_raw    = item.get("pubDate")
        pub_iso    = _parse_pubdate(pub_raw)
        results.append({
            "title":       _strip_html(item.get("title") or ""),
            "description": _strip_html(item.get("description") or ""),
            "source_url":  source_url,
            "source_name": _extract_source_name(source_url),
            "published_at": pub_iso,
            # Naver 리더 URL (본문 fetch용, 저장 안 함)
            "_naver_link": item.get("link") or "",
        })
    return results


def _extract_source_name(url: str) -> str | None:
    """URL 도메인에서 매체명 추출 (간략)."""
    if not url:
        return None
    m = re.search(r"https?://(?:www\.)?([^/]+)", url)
    if not m:
        return None
    domain = m.group(1)
    _KNOWN = {
        "hankyung.com":   "한국경제",
        "mk.co.kr":       "매일경제",
        "chosun.com":     "조선일보",
        "joongang.co.kr": "중앙일보",
        "donga.com":      "동아일보",
        "seoul.co.kr":    "서울경제",
        "mt.co.kr":       "머니투데이",
        "heraldcorp.com": "헤럴드경제",
        "edaily.co.kr":   "이데일리",
        "news1.kr":       "뉴스1",
        "newsis.com":     "뉴시스",
        "yna.co.kr":      "연합뉴스",
        "fashionbiz.co.kr":  "패션비즈",
        "apparelnews.co.kr": "어패럴뉴스",
        "fi.co.kr":       "패션인사이트",
        "ktnews.com":     "한국섬유신문",
        "texherald.com":  "텍스헤럴드",
        "newswire.co.kr": "뉴스와이어",
        "musinsa.com":    "무신사",
    }
    for k, v in _KNOWN.items():
        if k in domain:
            return v
    # 알 수 없는 도메인은 두 번째 레벨 도메인 반환
    parts = domain.split(".")
    return parts[-2] if len(parts) >= 2 else domain


def _dedup(articles: list[dict]) -> list[dict]:
    """source_url 기준 중복 제거."""
    seen: set[str] = set()
    result: list[dict] = []
    for a in articles:
        url = a.get("source_url") or ""
        key = url if url else str(id(a))
        if key not in seen:
            seen.add(key)
            result.append(a)
    return result


def _filter_by_date(articles: list[dict], days: int = 7) -> list[dict]:
    """published_at 기준 days일 초과 기사 제거. published_at 없으면 통과."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result: list[dict] = []
    for a in articles:
        pub = a.get("published_at")
        if pub:
            try:
                pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                if pub_dt.tzinfo is None:
                    pub_dt = pub_dt.replace(tzinfo=timezone.utc)
                if pub_dt < cutoff:
                    continue
            except (ValueError, TypeError):
                pass
        result.append(a)
    return result


# ── Claude 분류 ───────────────────────────────────────────────────────────────

_CLASSIFY_SYSTEM = """당신은 B.CAVE(한국 패션 기업) 인텔리전스 시스템의 뉴스 분류·평가 전문가다.

# 회사 컨텍스트

## B.CAVE 자사 브랜드
- 커버낫(Covernat) — 자사 핵심 브랜드, 무신사 매출 1위 시즌 있음
- 리(LEE) — 자사 라이센스 브랜드
- 와키윌리(WackyWilly) — 자사 신규 브랜드
- B.CAVE 모회사명: 비케이브

## 경쟁사 (직접 경쟁)
- 영원무역홀딩스 (노스페이스·콜롬비아·룩캐스트 등 12개 브랜드)
- 한세실업 / 한세엠케이
- 신성통상 (탑텐·올젠)
- 이랜드월드 (스파오·미쏘·로엠 등)
- F&F (MLB·디스커버리)
- LF (헤지스·닥스·라푸마)
- 한섬 (타임·시스템·마인)
- 무신사스탠다드 (무신사 자체 브랜드)
- 디스이즈네버댓
- 마르디 매크르디 / 피스피스스튜디오
- 마뗑킴 / 하고하우스
- 아이더 / K2 / 디스커버리 익스페디션

## 플랫폼 (유통 채널)
- 무신사 (자사 핵심 채널, 임플리시트하게 가장 중요)
- 지그재그 / 에이블리 (여성 패션 플랫폼)
- 29CM / SSF샵 / W컨셉 (큐레이션 플랫폼)
- 카카오스타일 / 패션바이카카오

# 분류 기준 — 6개 필드

주어진 기사 목록을 분석하여 아래 JSON 배열로만 응답하라.
JSON 외 다른 텍스트(설명, 인사말, 마크다운, 백틱 등)는 절대 포함하지 마라.

[
  {
    "idx": 0,
    "story_key": "피스피스스튜디오-코스닥-상장",
    "headline": "뉴스 제목 (50자 이내 한국어, 원제목 기반 + 핵심 팩트)",
    "summary": "3~5줄 한국어 요약. 누가·언제·무엇을·왜·영향. 출처 매체명 포함.",
    "category": "industry|own_brand|competitor|trend|platform",
    "event_type": "ipo|m_and_a|leadership_change|financial_disclosure|product_launch|store_open|partnership|investment|regulatory|trend_signal|general",
    "importance": 1~5,
    "relevance": 1~5,
    "freshness_check": "fresh|stale|unknown",
    "published_at_iso": "2026-06-01T09:00:00+09:00",
    "related_brands": ["covernat", "lee"],
    "related_companies": ["피스피스스튜디오", "월스"],
    "verify_source": "tier1|tier2|tier3"
  }
]

# 필드 정의

## category (보도 영역)
- own_brand: 커버낫·리·와키윌리·B.CAVE·비케이브 직접 언급
- competitor: 위 경쟁사 회사명·브랜드명 직접 언급
- platform: 무신사·지그재그·29CM 등 플랫폼 자체 뉴스 (실적·정책·확장 등)
- industry: 패션 산업 매출·시장 동향·정책·규제·투자
- trend: K패션·소비 행태·스타일·세대 트렌드

## event_type (사건 유형) — 신규 필수 필드
- ipo: 상장·IPO·신규 등록 (코스닥·코스피·해외)
- m_and_a: 합병·인수·분할·지분 인수
- leadership_change: 대표이사·CFO·최대주주 변경
- financial_disclosure: 분기·연간 실적, 매출·영업이익 변동
- product_launch: 신상 발매·콜라보·캡슐 컬렉션
- store_open: 매장 오픈·폐점·플래그십·해외 진출
- partnership: 협업·파트너십·라이센스 계약
- investment: 투자 유치·전환사채·신주 발행
- regulatory: 규제·정책·공정위·세무 이슈
- trend_signal: 트렌드·소비자 행태 변화
- general: 그 외 (단순 보도·인물 인터뷰·시상식 등)

## importance (사건 본질적 중요도) — 신규 필수 필드
다음 기준으로 1~5 부여. 자사 관련성과 별개로 사건 자체의 무게.

5 (CRITICAL — 산업 구조 변화):
- 코스닥·코스피 상장 (event_type=ipo)
- 대형 M&A (event_type=m_and_a, 거래 규모 100억 이상)
- 무신사 자체의 결정적 변화 (예: 거래소 상장·해외 진출·정책 변경)
- 자사 직접 영향 사건 (자사 브랜드 매각·합병 등)

4 (HIGH — 시장 변화 신호):
- 경쟁사 매출 ±20% 이상 변동 공시
- 신규 증권 발행·대규모 투자 유치
- 경쟁사 대표 변경
- 자사 vs 경쟁사 직접 비교 보도
- 무신사 신규 정책·요율 변경

3 (MEDIUM — 일상 비즈니스):
- 분기 실적 보고서 (큰 변동 없음)
- 매장 오픈·신상 발매·콜라보
- 임원 변경 (대표 외)
- 산업 매출 통계

2 (LOW — 트렌드·관찰):
- 트렌드 분석 기사
- 소비자 행태 변화 보도
- 일반 인터뷰

1 (NOISE — 매거진 제외):
- 단순 인사 동향
- 시상식·이벤트 단신
- 광고성 보도

## relevance (자사 직접 영향도)
- 5: 자사 브랜드(커버낫·리·와키윌리·B.CAVE) 직접 언급
- 4: 직접 경쟁사 또는 핵심 채널(무신사) 직접 언급
- 3: 한국 패션 산업 매출·정책 (자사 간접 영향)
- 2: 일반 패션 트렌드 (자사 영향 추정 수준)
- 1: 자사 무관 (배제 대상)

## freshness_check (신선도) — 신규 필수 필드
오늘 날짜를 기준으로 published_at 검증:

- fresh: 발행일 ≤ 7일 이내 → 매거진 사용 가능
- stale: 발행일 8일 이상 → 무조건 배제
- unknown: 발행일 확인 불가 → 보수적으로 배제

발행일이 명확하지 않으면 절대 추측하지 말고 unknown으로 표시하라.

## published_at_iso (발행 시각)
- ISO 8601 형식, 한국 시간(+09:00) 명시
- 기사 본문 또는 메타데이터에서 추출
- 추정 금지 — 명시되지 않으면 null 또는 freshness_check=unknown

## verify_source (출처 신뢰도) — 신규 필수 필드
- tier1: 1군 (한국경제·매일경제·조선비즈·연합뉴스·뉴스1·뉴시스·DART·금감원·거래소)
- tier2: 2군 (패션 전문 매체 — 패션비즈·어패럴뉴스·WWD코리아·텍스헤럴드·인터패션플래닝)
- tier3: 3군 (위 외 — 보조용으로만 허용. 다른 tier1·2가 같은 사건 보도 시 신뢰)
- 회사 공식 보도자료(뉴스와이어·PRNewswire)는 tier1으로 분류
- 개인 블로그·카페·SNS·낚시성 기사는 결과에서 무조건 배제

## story_key (사건 식별자)
- 동일 사건을 여러 매체가 보도한 기사는 반드시 같은 story_key
- 소문자 한글·영어·하이픈, 30자 이내
- 형식: "{회사·브랜드}-{사건명}" 또는 "{영역}-{사건명}"
- 예시:
  - "피스피스스튜디오-코스닥-상장"
  - "무신사-티몰-입점"
  - "f&f-mlb-q1-매출"
  - "lf-헤지스-대표-변경"

# 출력 절대 규칙

1. JSON 외 텍스트 절대 포함 금지 (마크다운 ```json``` 백틱 포함 X)
2. freshness_check="stale" 또는 "unknown"은 배열에서 **무조건 제외**
3. importance=1 인 항목은 배열에서 **무조건 제외**
4. relevance=1 인 항목은 배열에서 **무조건 제외**
5. verify_source=tier3 이면서 다른 tier1·2 보도가 없는 단독 보도는 **제외**
6. category가 위 5종에 안 맞으면 (예: 정치·연예 등) **제외**
7. 광고성 신호:
   - "주목" / "화제" / "급부상" 같은 마케팅 어휘만 반복
   - "성공 비결" / "비밀" 같은 클릭베이트
   - 본문이 보도자료 복사 수준이면서 출처 회사가 광고주
   → 모두 제외
8. 출력 항목 순서: importance 내림차순 → relevance 내림차순

# 출력 검증 자가 점검

배열 생성 후 다음을 확인:
- 모든 published_at이 오늘 기준 7일 이내인가?
- importance ≥ 4 이벤트(상장·M&A·대표 변경)를 놓치지 않았나?
- 같은 사건이 다른 story_key로 중복되지 않았나?
- 자사 브랜드 직접 언급인데 relevance가 5가 아닌 게 있나?

문제 발견 시 수정 후 반환하라."""


def _classify_batch(client: anthropic.Anthropic, articles: list[dict]) -> list[dict]:
    """
    articles 배치를 Claude Haiku에 전달해 분류·요약·relevance 반환.
    실패 시 빈 리스트.
    """
    if not articles:
        return []

    lines = []
    for i, a in enumerate(articles):
        lines.append(f"[{i}] 제목: {a['title']}")
        lines.append(f"    설명: {a['description'][:300]}")
        lines.append(f"    URL: {a.get('source_url', '')}")
        lines.append(f"    발행: {a.get('published_at', '알 수 없음')}")
        lines.append("")
    user_msg = f"다음 기사 {len(articles)}개를 분류·요약하라:\n\n" + "\n".join(lines)

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=6000,
            system=_CLASSIFY_SYSTEM,
            messages=[{"role": "user", "content": user_msg}],
        )
        text = resp.content[0].text
        text = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
        m = re.search(r"\[.*\]", text, re.DOTALL)
        if not m:
            return []
        data = json.loads(m.group())
        return data if isinstance(data, list) else []
    except Exception as e:
        logger.warning("classify_batch_failed", count=len(articles), error=str(e))
        return []


# ── DB 적재 ───────────────────────────────────────────────────────────────────

_VALID_CATEGORIES = {"industry", "own_brand", "competitor", "trend", "platform"}


def _upsert_news(
    db,
    raw_articles: list[dict],
    classified: list[dict],
    collected_date: str,
    dry_run: bool,
) -> int:
    """분류 결과 + 원본 메타를 합쳐 external_news upsert."""
    inserted = 0
    skipped  = 0

    for item in classified:
        idx = item.get("idx")
        if idx is None or idx >= len(raw_articles):
            continue
        raw = raw_articles[idx]

        # ── 백엔드 가드 (프롬프트 규칙 이중 확인) ────────────────────────────
        importance      = int(item.get("importance") or 1)
        freshness       = (item.get("freshness_check") or "unknown").strip().lower()
        verify_source   = (item.get("verify_source") or "tier3").strip().lower()
        mention_count   = max(1, int(item.get("mention_count") or 1))

        if importance <= 1:
            skipped += 1
            continue
        if freshness in ("stale", "unknown"):
            skipped += 1
            continue
        # tier3 단독 보도 (같은 story 다른 매체 없음) → 제외
        if verify_source == "tier3" and mention_count == 1:
            skipped += 1
            continue

        category = item.get("category", "industry")
        if category not in _VALID_CATEGORIES:
            skipped += 1
            continue

        relevance = max(1, min(5, int(item.get("relevance") or 1)))
        if relevance <= 1:
            skipped += 1
            continue

        # published_at: Claude가 추출한 ISO 우선, 없으면 Naver pubDate
        pub_at = item.get("published_at_iso") or raw.get("published_at")

        record: dict = {
            "collected_date":    collected_date,
            "category":          category,
            "headline":          (item.get("headline") or raw["title"])[:500],
            "summary":           item.get("summary"),
            "source_url":        raw.get("source_url") or None,
            "source_name":       raw.get("source_name"),
            "relevance":         relevance,
            "importance":        importance,
            "mention_count":     mention_count,
            "related_brands":    item.get("related_brands") or [],
            "related_companies": item.get("related_companies") or [],
            "published_at":      pub_at,
        }

        if dry_run:
            logger.info(
                "dry_run_item",
                headline=record["headline"][:60],
                category=record["category"],
                importance=importance,
                relevance=record["relevance"],
                freshness=freshness,
                source_tier=verify_source,
                mention=mention_count,
                source=record["source_name"],
            )
            inserted += 1
            continue

        try:
            if record["source_url"]:
                result = (
                    db.table("external_news")
                    .upsert(record, on_conflict="source_url", ignore_duplicates=True)
                    .execute()
                )
            else:
                result = db.table("external_news").insert(record).execute()

            if result.data:
                inserted += 1
        except Exception as e:
            logger.warning("upsert_failed", headline=record["headline"][:60], error=str(e))

    if skipped:
        logger.info("upsert_skipped", skipped=skipped, reason="importance/freshness/tier3/category/relevance guard")
    return inserted


# ── 메인 ──────────────────────────────────────────────────────────────────────

async def collect(dry_run: bool = False) -> int:
    """뉴스 수집 메인. 반환값: 적재된 건수 (dry_run 시 발견 건수)."""
    db   = _supabase()
    anth = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    tracker = JobTracker(db, script="news_collector", label="외부 뉴스 수집", target=len(QUERIES))
    if not dry_run:
        await tracker.start()

    today = _today_kst()
    logger.info("news_collection_start", date=today, queries=len(QUERIES), dry_run=dry_run)

    # ── 1단계: Naver API 수집 ──────────────────────────────────────────────────
    raw_all: list[dict] = []
    for i, query in enumerate(QUERIES, 1):
        try:
            articles = _naver_search(query)
            raw_all.extend(articles)
            logger.info("naver_query_done", no=f"{i}/{len(QUERIES)}", query=query[:40], found=len(articles))
        except Exception as e:
            logger.warning("naver_query_failed", query=query[:40], error=str(e))
        time.sleep(_MIN_DELAY_SEC + random.uniform(0, 0.3))

    logger.info("naver_raw_total", count=len(raw_all))

    # ── 2단계: 중복 제거 + 7일 날짜 필터 ─────────────────────────────────────
    articles = _dedup(raw_all)
    articles = _filter_by_date(articles, days=7)
    logger.info("articles_after_filter", count=len(articles))

    if not articles:
        if not dry_run:
            await tracker.finish(rows_done=0)
        return 0

    # ── 3단계: Claude 배치 분류 ────────────────────────────────────────────────
    all_classified: list[dict] = []
    offset = 0
    batch_no = 0
    while offset < len(articles):
        batch_raw   = articles[offset: offset + _BATCH_SIZE]
        batch_no   += 1
        classified  = _classify_batch(anth, batch_raw)

        # idx를 전역 인덱스로 보정
        for c in classified:
            if "idx" in c:
                c["_raw_idx"] = offset + c["idx"]
                c["idx"]      = offset + c["idx"]
        all_classified.extend(classified)

        logger.info(
            "classify_batch_done",
            batch=batch_no,
            input=len(batch_raw),
            output=len(classified),
        )
        offset += _BATCH_SIZE

    logger.info("classify_total", total_classified=len(all_classified))

    # ── story_key 기반 mention_count 산출 ─────────────────────────────────────
    # 동일 이슈를 여러 매체가 보도한 기사는 같은 story_key → 화제성 지표
    from collections import defaultdict as _defaultdict
    _story_groups: dict[str, list[dict]] = _defaultdict(list)
    for item in all_classified:
        key = (item.get("story_key") or f"__uid_{item.get('idx', id(item))}").strip()
        _story_groups[key].append(item)
    for _key, _group in _story_groups.items():
        cnt = len(_group)
        for item in _group:
            item["mention_count"] = cnt
    multi = sum(1 for g in _story_groups.values() if len(g) >= 2)
    logger.info("mention_count_computed", story_keys=len(_story_groups), multi_outlet=multi)

    # ── 4단계: DB 적재 ─────────────────────────────────────────────────────────
    total_inserted = _upsert_news(db, articles, all_classified, today, dry_run)

    if not dry_run:
        await tracker.finish(rows_done=total_inserted)

    logger.info(
        "news_collection_done",
        raw=len(raw_all),
        after_filter=len(articles),
        classified=len(all_classified),
        inserted=total_inserted,
        dry_run=dry_run,
    )
    return total_inserted


def main() -> None:
    parser = argparse.ArgumentParser(description="UTTU 외부 뉴스 수집 (Naver News API)")
    parser.add_argument("--dry-run", action="store_true", help="DB 적재 없이 결과만 출력")
    args = parser.parse_args()

    n = asyncio.run(collect(dry_run=args.dry_run))
    sys.exit(0 if n >= 0 else 1)


if __name__ == "__main__":
    main()
