"""
투자정보 브리핑 생성 — Claude Sonnet
입력: 회사명 + funding_rounds 목록
출력: 한국어 경영진용 마크다운 브리핑
"""
from __future__ import annotations

import asyncio
import json
from datetime import date

from loguru import logger

from worker.agent.claude_client import generate_text, FUNDING_BRIEF_MODEL

# ── 상수 ─────────────────────────────────────────────────────────────────────────

_FALLBACK_NO_DATA = (
    "수집된 투자정보 없음 — 공시·뉴스에서 투자유치 이력을 찾지 못했습니다."
)

_SYSTEM_PROMPT = (
    "당신은 패션 기업 투자 분석가다. "
    "경영진 보고용 투자이력 브리핑을 한국어로 작성한다. "
    "간결·객관·사실 위주. 미검증 정보는 명시적으로 표시한다. "
    "마크다운 형식. "
    "【절대 규칙】제공된 데이터의 수치(금액·날짜·투자자명)를 그대로 인용하라. "
    "임의 변형·반올림·계산·생성 절대 금지. "
    "금액은 '**금액**' 항목에 표기된 문자열을 그대로 복사하라."
)


# ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────────

def _format_amount(amount_krw: int | None) -> str:
    """
    원 단위 → 경영진용 금액 표기.

    규칙:
      - 1조원 이상: N.Ng조원 (유효숫자 4자리, 예: 1.5조원)
      - 1억원 이상: N.N억원 (소수점 1자리, 1억 단위면 정수, 예: 557.1억원, 500억원)
      - 1만원 이상: N만원 (예: 3000만원, 5000만원)
      - 미만: 원 단위 (쉼표 포함)
    LLM이 재계산하지 않도록 Python에서 pre-format해서 프롬프트에 전달.
    """
    if amount_krw is None:
        return "금액 불명"
    eok = amount_krw / 100_000_000
    if eok >= 10_000:
        jo = amount_krw / 1_000_000_000_000
        return f"{jo:.4g}조원"
    if eok >= 1:
        # 소수점 1자리 — 1억 단위 정수면 소수점 생략
        if amount_krw % 100_000_000 == 0:
            return f"{int(eok)}억원"
        return f"{eok:.1f}억원"
    man = amount_krw / 10_000
    if man >= 1:
        if amount_krw % 10_000 == 0:
            return f"{int(man)}만원"
        return f"{man:.1f}만원"
    return f"{amount_krw:,}원"


def _j(obj) -> str:
    """JSON pretty-print (date 직렬화 포함)."""
    def _default(o):
        if isinstance(o, date):
            return o.isoformat()
        raise TypeError(f"Not serializable: {type(o)}")
    return json.dumps(obj, ensure_ascii=False, indent=2, default=_default)


def _round_to_text(r: dict, idx: int) -> str:
    """단일 라운드를 브리핑 텍스트 블록으로 변환."""
    round_type    = r.get("round_type") or "라운드 불명"
    amount_str    = _format_amount(r.get("amount_krw"))
    announced     = r.get("announced_date") or "날짜 불명"
    investors     = r.get("investors") or []
    source_type   = r.get("source_type", "news")
    confidence    = float(r.get("confidence") or 0.5)

    # 신뢰도 레이블
    if confidence >= 1.0 or source_type in ("dart_estkrs", "dart_piic"):
        label = "(공시)"
    else:
        label = "(미검증 — 뉴스 추출)"

    investors_str = ", ".join(investors) if investors else "투자자 불명"

    lines = [
        f"### 라운드 {idx + 1}: {round_type} {label}",
        f"- **금액**: {amount_str}",
        f"- **발표일**: {announced}",
        f"- **투자자**: {investors_str}",
        f"- **출처 유형**: {source_type}",
    ]
    source_url = r.get("source_url") or r.get("source_ref")
    if source_url:
        lines.append(f"- **원문**: {source_url}")
    return "\n".join(lines)


def _build_prompt(corp_name: str, rounds: list[dict]) -> str:
    """
    브리핑 생성용 사용자 메시지 구성.

    amount_krw를 Python에서 pre-format해 LLM이 재계산하지 않도록 한다.
    """
    rounds_text = "\n\n".join(
        _round_to_text(r, i) for i, r in enumerate(rounds)
    )

    # 공시 확인 금액만 합산 (Python에서 계산, LLM에 결과 직접 제공)
    confirmed_sum = sum(
        r.get("amount_krw") or 0
        for r in rounds
        if r.get("amount_krw") and (
            r.get("confidence", 0) >= 1.0
            or r.get("source_type") in ("dart_estkrs", "dart_piic")
        )
    )
    confirmed_sum_str = _format_amount(confirmed_sum) if confirmed_sum else "없음"

    return (
        f"## 회사명: {corp_name}\n\n"
        f"## 투자유치 이력 ({len(rounds)}건)\n\n"
        f"{rounds_text}\n\n"
        "---\n\n"
        "위 투자유치 이력을 바탕으로 경영진 보고용 브리핑을 작성하라.\n"
        "- 라운드 전체를 시간순(오래된 것 먼저)으로 요약\n"
        f"- 총 누적 투자유치 금액(공시 확인): **{confirmed_sum_str}** — 이 값을 그대로 사용하라, 계산 금지\n"
        "- 미검증 항목은 '*(미검증)*' 표시 후 별도 섹션에 정리\n"
        "- 공시 출처는 '*(공시)*' 표시\n"
        "- 금액은 '**금액**' 항목에 표기된 문자열을 그대로 인용하라, 절대 변형 금지\n"
        "- 데이터에 없는 사실 절대 만들지 말 것\n"
    )


# ── 공개 함수 ──────────────────────────────────────────────────────────────────────

async def generate_brief(
    corp_name: str,
    rounds: list[dict],  # merged funding rounds (same structure as funding_rounds table)
) -> str:
    """
    투자유치 이력 브리핑 생성.

    Parameters
    ----------
    corp_name : 회사명
    rounds    : merge된 funding_rounds 목록

    Returns
    -------
    마크다운 브리핑 문자열
    """
    if not rounds:
        logger.info("brief_writer_no_rounds", company=corp_name)
        return _FALLBACK_NO_DATA

    prompt = _build_prompt(corp_name, rounds)

    # generate_text 는 동기 함수이므로 asyncio.to_thread 사용
    text = await asyncio.to_thread(
        generate_text,
        prompt,
        _SYSTEM_PROMPT,
        FUNDING_BRIEF_MODEL,
        1024,
    )

    if text is None:
        logger.warning("brief_writer_llm_failed", company=corp_name)
        # 폴백: 간단한 텍스트 브리핑 직접 생성
        lines = [f"# {corp_name} 투자유치 이력\n"]
        for i, r in enumerate(rounds):
            lines.append(_round_to_text(r, i))
            lines.append("")
        return "\n".join(lines)

    logger.info(
        "brief_writer_done",
        company=corp_name,
        rounds=len(rounds),
        chars=len(text),
    )
    return text
