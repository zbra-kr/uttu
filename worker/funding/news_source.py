"""
UTTU 뉴스 기반 투자유치 정보 수집

/today 기능의 news_collector.py 는 패션 뉴스 9개 쿼리 고정이라 재사용 불가.
Anthropic web_search 도구를 직접 호출해 특정 회사의 투자유치 뉴스를 검색한다.
추출은 worker/agent/funding_extractor.py (Ollama gemma4:e4b) 에 위임.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

import anthropic
from loguru import logger

from worker.agent.funding_extractor import extract_funding_rounds

# ── 상수 ─────────────────────────────────────────────────────────────────────────

_MODEL = "claude-haiku-4-5-20251001"
_SEARCH_LIMIT_PER_QUERY = 3  # 쿼리당 최대 기사 수

_SYSTEM_PROMPT = """\
당신은 투자유치 뉴스 수집 도우미다.
주어진 회사명으로 web_search를 실행하고, 투자유치·자금조달 관련 뉴스의 본문을 수집해
아래 JSON 배열 형식으로만 응답하라. JSON 외 다른 텍스트 금지. 뉴스가 없으면 [].

[
  {
    "headline": "기사 제목 (100자 이내)",
    "body": "기사 본문 전체 또는 핵심 내용 (최대 2000자)",
    "source_url": "https://...",
    "published_at": "YYYY-MM-DD 또는 null"
  }
]

규칙:
- 투자유치·시리즈 라운드·유상증자·자금조달·상장(IPO)·크라우드펀딩 내용만 수집
- 무관한 일반 사업 뉴스는 제외
- source_url 없으면 null
- 동일 기사는 1건만 (중복 제거)
- 1쿼리당 최대 3건"""


# ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────────

def _build_queries(corp_name: str) -> list[str]:
    """회사명 기반 검색 쿼리 3종."""
    return [
        f"{corp_name} 투자유치 시리즈 라운드",
        f"{corp_name} 유상증자 자금조달",
        f"{corp_name} IPO 상장 크라우드펀딩",
    ]


def _extract_json(text: str) -> list[dict]:
    """응답 텍스트에서 JSON 배열 추출. 파싱 실패 시 빈 리스트."""
    text = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        return []
    try:
        data = json.loads(m.group())
        return data if isinstance(data, list) else []
    except json.JSONDecodeError as e:
        logger.warning("news_source_json_error", error=str(e), raw=text[:200])
        return []


def _run_search_query(client: anthropic.Anthropic, query: str) -> list[dict]:
    """
    단일 쿼리로 web_search 실행 → 기사 리스트 반환.
    agentic loop (tool_use stop_reason 처리).
    """
    msgs: list[Any] = [
        {"role": "user", "content": f"다음 키워드로 투자 뉴스를 검색해줘: {query}"},
    ]

    for _ in range(8):
        resp = client.messages.create(
            model=_MODEL,
            max_tokens=3000,
            system=_SYSTEM_PROMPT,
            tools=[{"type": "web_search_20250305", "name": "web_search"}],
            messages=msgs,
        )

        text_parts: list[str] = []
        tool_use_ids: list[str] = []

        for block in resp.content:
            btype = getattr(block, "type", None)
            if btype == "text":
                text_parts.append(block.text)
            elif btype == "tool_use":
                tool_use_ids.append(block.id)

        if resp.stop_reason == "end_turn":
            return _extract_json("\n".join(text_parts))

        if resp.stop_reason == "tool_use" and tool_use_ids:
            tool_results = [
                {"type": "tool_result", "tool_use_id": tid, "content": ""}
                for tid in tool_use_ids
            ]
            msgs = [
                *msgs,
                {"role": "assistant", "content": resp.content},
                {"role": "user", "content": tool_results},
            ]
            continue

        if text_parts:
            return _extract_json("\n".join(text_parts))
        break

    return []


# ── 공개 함수 ──────────────────────────────────────────────────────────────────────

async def fetch_news_rounds(
    company_name: str,
    corp_name: str,
) -> list[dict]:
    """
    회사명으로 투자유치 뉴스 검색 → Ollama NLP 추출 → rounds 리스트 반환.

    Parameters
    ----------
    company_name : companies 테이블의 name 필드 (쿼리 + 매칭 검증에 사용)
    corp_name    : DART corp_name (fallback — 없으면 company_name 사용)

    Returns
    -------
    list of dicts (source_type='news', confidence<1.00)
    """
    search_name = corp_name or company_name

    # ANTHROPIC_API_KEY 없으면 스킵
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.warning("news_source_no_anthropic_key", company=search_name)
        return []

    client = anthropic.Anthropic(api_key=api_key)
    queries = _build_queries(search_name)

    all_articles: list[dict] = []
    seen_urls: set[str] = set()

    for query in queries:
        try:
            articles = _run_search_query(client, query)
            for article in articles:
                url = article.get("source_url") or ""
                if url and url in seen_urls:
                    continue
                if url:
                    seen_urls.add(url)
                all_articles.append(article)
            logger.debug(
                "news_query_done",
                query=query[:50],
                found=len(articles),
                company=search_name,
            )
        except Exception as e:
            logger.warning("news_query_failed", query=query[:50], error=str(e))

    logger.info(
        "news_articles_found",
        company=search_name,
        total_articles=len(all_articles),
    )

    # Ollama 추출
    all_rounds: list[dict] = []
    for article in all_articles:
        body = article.get("body") or ""
        url = article.get("source_url") or ""
        if not body:
            continue
        try:
            rounds = await extract_funding_rounds(
                article_text=body,
                company_name=company_name,
                article_url=url,
            )
            all_rounds.extend(rounds)
        except Exception as e:
            logger.warning(
                "news_extract_failed",
                url=url[:60],
                error=str(e),
            )

    logger.info(
        "news_rounds_extracted",
        company=search_name,
        rounds=len(all_rounds),
    )
    return all_rounds
