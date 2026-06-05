"""
UTTU 투자유치 정보 NLP 추출 (Ollama gemma4:e4b)

뉴스 기사 본문에서 투자유치/자금조달 라운드 정보를 추출한다.
08-funding.md §5의 프롬프트를 그대로 사용.

사용:
    from worker.agent.funding_extractor import extract_funding_rounds
    rounds = await extract_funding_rounds(article_text, company_name="에이피알")
"""
from __future__ import annotations

import json
import os
import re

import httpx
from loguru import logger

# ── 상수 ────────────────────────────────────────────────────────────────────────

_PROMPT_TEMPLATE = """\
다음 뉴스 본문에서 투자유치 정보를 추출해 JSON만 출력해. 설명·markdown 금지. 정보 없으면 rounds: [].
{{ "rounds": [ {{
  "company": "...", "round_type": "seed|pre-A|series-A|...|유상증자|IPO|크라우드펀딩|기타",
  "amount_krw": 정수(원 단위, 불명 null), "investors": ["..."],
  "announced_date": "YYYY-MM-DD|null", "confidence": 0.0~1.0
}} ] }}
본문: \"\"\"{article}\"\"\""""

_TIMEOUT_SEC = 120
_MAX_ARTICLE_CHARS = 4000  # 너무 긴 기사는 잘라서 전달


# ── 내부 헬퍼 ───────────────────────────────────────────────────────────────────

def _build_prompt(article_text: str) -> str:
    truncated = article_text[:_MAX_ARTICLE_CHARS]
    return _PROMPT_TEMPLATE.format(article=truncated)


def _parse_response(raw: str) -> list[dict]:
    """Ollama 응답 텍스트에서 rounds 배열 추출."""
    # 코드블록 마커 제거
    text = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()
    # JSON 객체 추출
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        logger.warning("funding_extractor_no_json", raw=raw[:200])
        return []
    try:
        data = json.loads(m.group())
        rounds = data.get("rounds", [])
        if not isinstance(rounds, list):
            return []
        return rounds
    except json.JSONDecodeError as e:
        logger.warning("funding_extractor_json_error", error=str(e), raw=raw[:300])
        return []


def _match_company(round_dict: dict, company_name: str) -> bool:
    """
    추출된 라운드의 company 필드가 검색한 회사와 일치하는지 검증.
    엉뚱한 회사 기사 필터링.
    """
    extracted_company = (round_dict.get("company") or "").strip()
    if not extracted_company:
        return True  # company 필드 없으면 통과 (추출 실패일 수 있음)
    # 회사명 단순 포함 검사 (약칭 대응)
    # e.g. "에이피알" in "주식회사 에이피알" → True
    return (
        company_name in extracted_company
        or extracted_company in company_name
        or extracted_company[:4] in company_name
    )


# ── 공개 함수 ───────────────────────────────────────────────────────────────────

async def extract_funding_rounds(
    article_text: str,
    company_name: str,
    article_url: str = "",
) -> list[dict]:
    """
    뉴스 기사 본문에서 투자유치 라운드를 추출한다.

    Parameters
    ----------
    article_text : 기사 본문 (plain text)
    company_name : 검색에 사용한 회사명 (매칭 검증에 사용)
    article_url  : 기사 원문 URL (source_ref·source_url에 저장)

    Returns
    -------
    list of round dicts — funding_rounds 테이블 삽입 준비된 형태:
      company_name, round_type, amount_krw, investors, announced_date,
      source_type='news', source_ref=article_url, confidence, raw
    """
    if not article_text or not article_text.strip():
        return []

    ollama_host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
    model = os.environ.get("OLLAMA_LLM_MODEL", "gemma4:e4b")
    prompt = _build_prompt(article_text)

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SEC) as client:
            resp = await client.post(
                f"{ollama_host}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "format": "json",
                    "stream": False,
                },
            )
            resp.raise_for_status()
            payload = resp.json()
            raw_text = payload.get("response", "")
    except httpx.HTTPError as e:
        logger.warning("funding_extractor_http_error", error=str(e))
        return []

    rounds_raw = _parse_response(raw_text)

    # 회사 매칭 검증 — 엉뚱한 회사 기사 필터링
    matched = [r for r in rounds_raw if _match_company(r, company_name)]
    if len(matched) < len(rounds_raw):
        logger.debug(
            "funding_extractor_filtered",
            original=len(rounds_raw),
            matched=len(matched),
            company=company_name,
        )

    # funding_rounds 테이블 형식으로 변환
    result: list[dict] = []
    for r in matched:
        # announced_date: "null" 문자열 → None 처리
        raw_date = r.get("announced_date")
        announced_date = None
        if raw_date and str(raw_date).strip().lower() not in ("null", "none", ""):
            announced_date = str(raw_date).strip()

        result.append({
            "round_type":      r.get("round_type"),
            "amount_krw":      _to_int(r.get("amount_krw")),
            "announced_date":  announced_date,
            "investors":       r.get("investors") or [],
            "source_type":     "news",
            "source_url":      article_url or None,
            "source_ref":      article_url or None,
            "confidence":      float(r.get("confidence") or 0.5),
            "raw":             {"article_excerpt": article_text[:500], "extracted": r},
        })

    logger.debug(
        "funding_extractor_done",
        company=company_name,
        rounds_found=len(result),
        url=article_url[:60] if article_url else "",
    )
    return result


def _to_int(val) -> int | None:
    """다양한 형태의 금액 값을 정수(원)로 변환."""
    if val is None:
        return None
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(val)
    s = str(val).strip()
    # "50억" → 50_0000_0000
    if "억" in s:
        m = re.match(r"([\d.]+)\s*억", s)
        if m:
            return int(float(m.group(1)) * 100_000_000)
    if "조" in s:
        m = re.match(r"([\d.]+)\s*조", s)
        if m:
            return int(float(m.group(1)) * 1_000_000_000_000)
    cleaned = re.sub(r"[^\d]", "", s)
    if cleaned:
        return int(cleaned)
    return None
