"""
Claude API 클라이언트 — funding 도메인 LLM 처리
- FUNDING_EXTRACT_MODEL : Haiku (고빈도 정형 추출)
- FUNDING_BRIEF_MODEL   : Sonnet (저빈도 브리핑 생성)
env override 가능: CLAUDE_EXTRACT_MODEL, CLAUDE_BRIEF_MODEL
"""
from __future__ import annotations

import json
import os
import re
import time
from typing import Any

import anthropic
from loguru import logger

FUNDING_EXTRACT_MODEL = os.environ.get("CLAUDE_EXTRACT_MODEL", "claude-haiku-4-5-20251001")
FUNDING_BRIEF_MODEL   = os.environ.get("CLAUDE_BRIEF_MODEL",   "claude-sonnet-4-6")

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        api_key = os.environ["ANTHROPIC_API_KEY"]
        _client = anthropic.Anthropic(api_key=api_key)
    return _client


def _strip_json_fence(text: str) -> str:
    """```json ... ``` 코드블록 마커 제거."""
    text = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
    return text


def extract_json(
    prompt: str,
    system: str = "",
    model: str = FUNDING_EXTRACT_MODEL,
    max_tokens: int = 2048,
) -> dict | list | None:
    """
    Claude에 prompt를 보내고 JSON(dict 또는 list)을 반환한다.

    Parameters
    ----------
    prompt     : 사용자 메시지
    system     : 시스템 프롬프트 (JSON 출력 지시가 자동으로 추가됨)
    model      : 사용할 모델 ID (기본: FUNDING_EXTRACT_MODEL = Haiku)
    max_tokens : 최대 출력 토큰

    Returns
    -------
    dict | list — JSON 파싱 성공 시
    None        — JSON 파싱 실패 또는 API 오류
    """
    json_instruction = (
        "반드시 JSON만 출력하라. "
        "설명, 마크다운 코드블록, 추가 텍스트 없이 JSON 객체/배열만."
    )
    full_system = f"{system}\n{json_instruction}".strip() if system else json_instruction

    client = _get_client()
    max_retries = 3
    delay = 2.0

    for attempt in range(max_retries):
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=full_system,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text
            logger.debug(
                "claude_extract_done",
                model=model,
                input_tokens=resp.usage.input_tokens,
                output_tokens=resp.usage.output_tokens,
            )
        except anthropic.RateLimitError as e:
            if attempt < max_retries - 1:
                logger.warning(
                    "claude_rate_limit_retry",
                    attempt=attempt + 1,
                    wait=delay,
                    error=str(e),
                )
                time.sleep(delay)
                delay *= 2
                continue
            logger.error("claude_rate_limit_exceeded", error=str(e))
            return None
        except anthropic.APIError as e:
            logger.error("claude_api_error", model=model, error=str(e))
            return None

        # JSON 파싱
        clean = _strip_json_fence(text)
        # 객체 또는 배열 추출
        m = re.search(r"(\{.*\}|\[.*\])", clean, re.DOTALL)
        if not m:
            logger.warning("claude_extract_no_json", model=model, raw=text[:200])
            return None
        try:
            return json.loads(m.group())
        except json.JSONDecodeError as e:
            logger.warning("claude_extract_json_error", model=model, error=str(e), raw=text[:300])
            return None

    return None


def generate_text(
    prompt: str,
    system: str = "",
    model: str = FUNDING_BRIEF_MODEL,
    max_tokens: int = 1024,
) -> str | None:
    """
    Claude에 prompt를 보내고 텍스트 응답을 반환한다.

    Parameters
    ----------
    prompt     : 사용자 메시지
    system     : 시스템 프롬프트
    model      : 사용할 모델 ID (기본: FUNDING_BRIEF_MODEL = Sonnet)
    max_tokens : 최대 출력 토큰

    Returns
    -------
    str  — 응답 텍스트
    None — API 오류
    """
    client = _get_client()

    try:
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system

        resp = client.messages.create(**kwargs)
        text = resp.content[0].text
        logger.debug(
            "claude_generate_done",
            model=model,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
        )
        return text
    except anthropic.APIError as e:
        logger.error("claude_generate_error", model=model, error=str(e))
        return None
