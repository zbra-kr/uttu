"""
UTTU 투자유치 정보 NLP 추출 (Claude Haiku)

뉴스 기사 본문에서 투자유치/자금조달 라운드 정보를 추출한다.
08-funding.md §5의 프롬프트를 그대로 사용.

사용:
    from worker.agent.funding_extractor import extract_funding_rounds
    rounds = await extract_funding_rounds(article_text, company_name="에이피알")
"""
from __future__ import annotations

import asyncio
import re

from loguru import logger

from worker.agent.claude_client import FUNDING_EXTRACT_MODEL, extract_json
from worker.funding.name_utils import name_equals

# ── 상수 ────────────────────────────────────────────────────────────────────────

_PROMPT_TEMPLATE = """\
다음 뉴스 본문에서 투자유치 정보를 추출해 JSON만 출력해. 설명·markdown 금지. 정보 없으면 rounds: [].
{{ "rounds": [ {{
  "company": "...", "round_type": "seed|pre-A|series-A|...|유상증자|IPO|크라우드펀딩|기타",
  "amount_krw": 정수(원 단위, 불명 null), "investors": ["..."],
  "announced_date": "YYYY-MM-DD|null", "confidence": 0.0~1.0
}} ] }}
본문: \"\"\"{article}\"\"\""""

_MAX_ARTICLE_CHARS = 4000  # 너무 긴 기사는 잘라서 전달


# ── 내부 헬퍼 ───────────────────────────────────────────────────────────────────

def _build_prompt(article_text: str) -> str:
    truncated = article_text[:_MAX_ARTICLE_CHARS]
    return _PROMPT_TEMPLATE.format(article=truncated)


def _parse_result(result: dict | list | None) -> list[dict]:
    """extract_json 결과에서 rounds 배열 추출."""
    if result is None:
        return []
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        rounds = result.get("rounds", [])
        if isinstance(rounds, list):
            return rounds
    return []


def _match_company(round_dict: dict, company_name: str) -> bool:
    """
    추출된 라운드의 company 필드가 검색한 회사와 **정확일치**하는지 검증.

    Rules
    -----
    - company 필드 없거나 빈 문자열 → False (주체 확인 불가 = 리스크)
    - 정규화 후 완전 일치(==) → True
    - 부분 일치(substring) 허용 안 함 — "레이어제로" ≠ "레이어"
    """
    extracted_company = (round_dict.get("company") or "").strip()
    if not extracted_company:
        logger.debug(
            "subject_mismatch",
            reason="company_field_empty",
            company_name=company_name,
        )
        return False

    if name_equals(extracted_company, company_name):
        return True

    logger.debug(
        "subject_mismatch",
        extracted=extracted_company,
        target=company_name,
    )
    return False


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

    prompt = _build_prompt(article_text)

    # extract_json 은 동기 함수이므로 asyncio.to_thread 사용
    result = await asyncio.to_thread(
        extract_json,
        prompt,
        "",  # system (JSON 지시는 claude_client 내부에서 추가)
        FUNDING_EXTRACT_MODEL,
        2048,
    )

    rounds_raw = _parse_result(result)

    # 회사 매칭 검증 — 엉뚱한 회사 기사 필터링
    matched = [r for r in rounds_raw if _match_company(r, company_name)]
    logger.info(
        "funding_extractor_company_filter",
        company=company_name,
        extracted=len(rounds_raw),
        matched=len(matched),
        dropped=len(rounds_raw) - len(matched),
    )
    if len(matched) < len(rounds_raw):
        logger.debug(
            "funding_extractor_filtered",
            original=len(rounds_raw),
            matched=len(matched),
            company=company_name,
        )

    # funding_rounds 테이블 형식으로 변환
    result_list: list[dict] = []
    for r in matched:
        # announced_date: "null" 문자열 → None 처리
        raw_date = r.get("announced_date")
        announced_date = None
        if raw_date and str(raw_date).strip().lower() not in ("null", "none", ""):
            announced_date = str(raw_date).strip()

        result_list.append({
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
        rounds_found=len(result_list),
        url=article_url[:60] if article_url else "",
    )
    return result_list


def _to_int(val) -> int | None:
    """
    다양한 형태의 금액 값을 정수(원)로 변환.

    지원 형식:
      - 순수 정수/실수: 1234, 3.14
      - 조 단위: "1조", "1.5조"
      - 억+만 복합: "557억1300만", "50억원", "100억"
      - 만 단위: "5000만", "2000만원"
      - 쉼표 포함 숫자: "50,000,000,000"
      - None / "비공개" 등 → None
    """
    if val is None:
        return None
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(val)
    s = str(val).strip()

    # 조 단위 (억보다 먼저 검사) — 복합: "1조2천억", "1조2000억" 지원
    if "조" in s:
        # 조 + 억 복합: "1조2천억" → "1조" + "2000억"
        m_jo_eok = re.match(r"([\d.]+)\s*조\s*([\d,천백]+)?\s*억", s)
        if m_jo_eok:
            jo = float(m_jo_eok.group(1))
            eok_str = m_jo_eok.group(2) or "0"
            # "천" → 1000 처리
            eok_str = eok_str.replace("천", "000").replace(",", "")
            eok = float(eok_str)
            return int(jo * 1_000_000_000_000 + eok * 100_000_000)
        # 조 단독: "1조", "1.5조"
        m = re.match(r"([\d.]+)\s*조", s)
        if m:
            return int(float(m.group(1)) * 1_000_000_000_000)

    # 억 단위 — 억+만 복합 표현 지원 ("557억1300만" → 55,713,000,000)
    if "억" in s:
        m = re.match(r"([\d.]+)\s*억\s*([\d]+)?\s*만?", s)
        if m:
            eok = float(m.group(1))
            man = int(m.group(2)) if m.group(2) else 0
            return int(eok * 100_000_000 + man * 10_000)

    # 만 단위
    if "만" in s:
        m = re.match(r"([\d.]+)\s*만", s)
        if m:
            return int(float(m.group(1)) * 10_000)

    # 숫자만 (쉼표·단위 문자 제거)
    cleaned = re.sub(r"[^\d]", "", s)
    if cleaned:
        return int(cleaned)
    return None
