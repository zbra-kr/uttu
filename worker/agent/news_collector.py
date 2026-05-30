"""
UTTU 외부 뉴스 수집 워커.

Anthropic web_search_20250305 도구로 패션 뉴스 9개 쿼리를 검색하고
external_news 테이블에 upsert한다.

실행:
  worker/.venv/bin/python3 -m worker.agent.news_collector           # 실제 수집
  worker/.venv/bin/python3 -m worker.agent.news_collector --dry-run # DB 적재 없이 출력만
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from datetime import datetime

import anthropic
import pytz
from dotenv import load_dotenv
from loguru import logger
from supabase import create_client

from worker.utils.job_tracker import JobTracker

load_dotenv()

KST   = pytz.timezone("Asia/Seoul")
MODEL = "claude-haiku-4-5-20251001"


# ── 클라이언트 ─────────────────────────────────────────────────────────────────

def _supabase():
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], key)


def _today_kst() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


def _month_label_kst() -> str:
    return datetime.now(KST).strftime("%Y년 %m월")


# ── 검색 쿼리 9개 ──────────────────────────────────────────────────────────────

def build_queries() -> list[str]:
    m = _month_label_kst()
    return [
        # 자사 브랜드 (relevance 5 후보)
        f"커버낫 패션 뉴스 {m}",
        f"리 LEE 한국 패션 브랜드 {m}",
        f"와키윌리 WackyWilly {m}",
        # 경쟁사 (relevance 4 후보)
        f"영원무역 한세실업 패션 실적 공시 {m}",
        f"F&F LF 한섬 이랜드 패션 뉴스 {m}",
        # 플랫폼 (relevance 3~4)
        f"무신사 패션 플랫폼 뉴스 {m}",
        # 산업·트렌드 (relevance 2~3)
        f"K패션 한국 패션 트렌드 {m}",
        f"패션 산업 매출 시장 동향 {m}",
        f"패션 브랜드 콜라보 협업 신상품 {m}",
    ]


# ── 시스템 프롬프트 ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """당신은 B.CAVE(한국 패션 기업) 임직원을 위한 뉴스 큐레이터다.

자사 브랜드: 커버낫(Covernat), 리(LEE), 와키윌리(WackyWilly)
경쟁사: 영원무역, 한세실업, 신성통상, 이랜드월드, F&F, LF, 한섬, 무신사스탠다드, 디스이즈네버댓 등
플랫폼: 무신사, 지그재그, 에이블리, 29CM, SSF샵

주어진 검색어로 web_search를 실행하고, 발견한 뉴스를 아래 JSON 배열 형식으로만 응답하라.
JSON 외 다른 텍스트(설명, 인사말, 마크다운 헤더 등)는 절대 포함하지 마라.
뉴스가 없으면 빈 배열 []만 반환하라.

[
  {
    "headline": "뉴스 제목 (50자 이내 한국어)",
    "summary": "3~5줄 한국어 요약. 실제 내용 기반. 출처 매체명 포함.",
    "source_url": "https://...",
    "source_name": "한국경제",
    "category": "industry 또는 own_brand 또는 competitor 또는 trend 또는 platform",
    "relevance": 1~5 정수,
    "related_brands": ["covernat", "lee", "wackywilly"],
    "related_companies": ["커버낫", "영원무역"],
    "published_at": "2026-05-31T09:00:00+09:00"
  }
]

분류 기준:
- own_brand: 커버낫·리·와키윌리 직접 언급 → relevance 5
- competitor: 경쟁사(영원무역·한세실업·F&F 등) 직접 언급 → relevance 4
- platform: 무신사 등 플랫폼 주요 뉴스 → relevance 3
- industry: 패션 산업 매출·시장·정책 → relevance 3
- trend: K패션 트렌드 일반 → relevance 2
- 그 외: relevance 1

규칙:
- 최근 7일 이내 뉴스만
- 광고·홍보성 보도자료·낚시성 기사 제외
- source_url 없으면 null
- 동일 내용은 1건만 (중복 제거)
- 1쿼리당 최대 3건"""


# ── JSON 파싱 ──────────────────────────────────────────────────────────────────

def _extract_json(text: str) -> list[dict]:
    """응답 텍스트에서 JSON 배열 추출. 파싱 실패 시 빈 리스트."""
    # 코드블록 마커 제거
    text = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
    # 첫 번째 JSON 배열 추출
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        return []
    try:
        data = json.loads(m.group())
        return data if isinstance(data, list) else []
    except json.JSONDecodeError as e:
        logger.warning("json_parse_failed", error=str(e), raw=text[:300])
        return []


# ── LLM 호출 ──────────────────────────────────────────────────────────────────

def _run_query(client: anthropic.Anthropic, query: str) -> list[dict]:
    """
    단일 검색 쿼리 실행 → 뉴스 리스트 반환.

    web_search_20250305는 Anthropic 서버사이드 도구다.
    일반적으로 stop_reason='end_turn'으로 한 번에 완료되지만,
    stop_reason='tool_use'가 반환될 경우를 대비해 agentic loop로 처리한다.
    """
    msgs: list = [
        {"role": "user", "content": f"다음 키워드로 최신 패션 뉴스를 검색해줘: {query}"},
    ]

    for _ in range(8):
        resp = client.messages.create(
            model=MODEL,
            max_tokens=2000,
            system=SYSTEM_PROMPT,
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
            # web_search는 서버사이드 — 빈 content로 tool_result 전달 후 계속
            tool_results = [
                {"type": "tool_result", "tool_use_id": tid, "content": ""}
                for tid in tool_use_ids
            ]
            msgs = [
                *msgs,
                {"role": "assistant", "content": resp.content},
                {"role": "user",      "content": tool_results},
            ]
            continue

        # 알 수 없는 stop_reason — 텍스트가 있으면 파싱 시도
        if text_parts:
            return _extract_json("\n".join(text_parts))
        break

    return []


# ── DB 적재 ───────────────────────────────────────────────────────────────────

_VALID_CATEGORIES = {"industry", "own_brand", "competitor", "trend", "platform"}


def _upsert_news(db, items: list[dict], collected_date: str, dry_run: bool) -> int:
    """external_news 테이블에 upsert. dry_run=True면 로그 출력만."""
    inserted = 0

    for item in items:
        category = item.get("category", "industry")
        if category not in _VALID_CATEGORIES:
            category = "industry"

        record: dict = {
            "collected_date":    collected_date,
            "category":          category,
            "headline":          (item.get("headline") or "")[:500],
            "summary":           item.get("summary"),
            "source_url":        item.get("source_url") or None,
            "source_name":       item.get("source_name"),
            "relevance":         max(1, min(5, int(item.get("relevance") or 1))),
            "related_brands":    item.get("related_brands") or [],
            "related_companies": item.get("related_companies") or [],
            "published_at":      item.get("published_at"),
        }

        if dry_run:
            logger.info(
                "dry_run_item",
                headline=record["headline"][:60],
                category=record["category"],
                relevance=record["relevance"],
                source=record["source_name"],
                url=(record["source_url"] or "")[:60],
            )
            inserted += 1
            continue

        try:
            if record["source_url"]:
                # source_url UNIQUE — 중복이면 skip (ignore_duplicates)
                result = (
                    db.table("external_news")
                    .upsert(record, on_conflict="source_url", ignore_duplicates=True)
                    .execute()
                )
            else:
                # source_url NULL — 항상 insert (NULL은 UNIQUE 제약 대상 아님)
                result = db.table("external_news").insert(record).execute()

            if result.data:
                inserted += 1
        except Exception as e:
            logger.warning("upsert_failed", headline=record["headline"][:60], error=str(e))

    return inserted


# ── 메인 ──────────────────────────────────────────────────────────────────────

async def collect(dry_run: bool = False) -> int:
    """뉴스 수집 메인. 반환값: 적재된 건수 (dry_run 시 발견 건수)."""
    db   = _supabase()
    anth = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    tracker = JobTracker(db, script="news_collector", label="외부 뉴스 수집", target=9)
    if not dry_run:
        await tracker.start()

    today   = _today_kst()
    queries = build_queries()
    total_found    = 0
    total_inserted = 0

    logger.info("news_collection_start", date=today, queries=len(queries), dry_run=dry_run)

    for i, query in enumerate(queries, 1):
        try:
            items = _run_query(anth, query)
            total_found += len(items)
            n = _upsert_news(db, items, today, dry_run)
            total_inserted += n
            logger.info(
                "query_done",
                no=f"{i}/{len(queries)}",
                query=query[:45],
                found=len(items),
                inserted=n,
            )
        except Exception as e:
            logger.warning("query_failed", no=i, query=query[:45], error=str(e))
            if not dry_run:
                await tracker.progress(total_inserted)
            continue  # 1건 실패해도 전체 중단 금지

    if not dry_run:
        await tracker.finish(rows_done=total_inserted)

    logger.info(
        "news_collection_done",
        total_found=total_found,
        total_inserted=total_inserted,
        dry_run=dry_run,
    )
    return total_inserted


def main() -> None:
    parser = argparse.ArgumentParser(description="UTTU 외부 뉴스 수집 (web_search_20250305)")
    parser.add_argument("--dry-run", action="store_true", help="DB 적재 없이 결과만 출력")
    args = parser.parse_args()

    n = asyncio.run(collect(dry_run=args.dry_run))
    sys.exit(0 if n >= 0 else 1)


if __name__ == "__main__":
    main()
