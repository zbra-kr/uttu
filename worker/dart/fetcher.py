"""
DART OpenAPI 저수준 클라이언트
Rate limit: 1,000 req/min → 실제로는 1초 간격 유지

응답 status 코드:
  000 = 정상
  010 = 조회 결과 없음
  020 = 요청 초과 / 키 오류 / 서버 오류 등
"""

import asyncio
import io
import zipfile
from typing import Any

import httpx
from loguru import logger

BASE = "https://opendart.fss.or.kr/api"
RATE_LIMIT_SEC = 0.1  # DART 한도 1,000건/분 = 16.7건/초 → 0.1초 = 600건/분으로 안전


async def _get_json(client: httpx.AsyncClient, url: str, params: dict[str, Any]) -> dict:
    await asyncio.sleep(RATE_LIMIT_SEC)
    resp = await client.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    status = data.get("status", "")
    # 010=조회결과없음, 013=데이터없음 — 정상적인 "없음" 케이스
    if status in ("010", "013"):
        logger.debug("dart_no_result", url=url, status=status)
        return {}
    if status not in ("000", ""):
        raise RuntimeError(f"DART API 오류 {status}: {data.get('message')}")
    return data


async def _get_bytes(client: httpx.AsyncClient, url: str, params: dict[str, Any]) -> bytes:
    await asyncio.sleep(RATE_LIMIT_SEC)
    resp = await client.get(url, params=params, timeout=60)
    resp.raise_for_status()
    return resp.content


async def fetch_corp_code_zip(api_key: str) -> bytes:
    """전체 기업코드 목록 ZIP 다운로드 (CORPCODE.xml 포함)."""
    async with httpx.AsyncClient() as c:
        return await _get_bytes(c, f"{BASE}/corpCode.xml", {"crtfc_key": api_key})


async def fetch_company(api_key: str, corp_code: str) -> dict:
    """기업 개황 조회 (bizr_no 포함)."""
    async with httpx.AsyncClient() as c:
        return await _get_json(c, f"{BASE}/company.json", {
            "crtfc_key": api_key,
            "corp_code": corp_code,
        })


async def fetch_disclosures(
    api_key: str,
    corp_code: str,
    bgn_de: str,
    end_de: str,
    pblntf_ty: str | None = None,
) -> list[dict]:
    """공시 목록 수집 (페이지네이션 자동 처리)."""
    results: list[dict] = []
    page = 1
    async with httpx.AsyncClient() as c:
        while True:
            params: dict[str, Any] = {
                "crtfc_key": api_key,
                "corp_code": corp_code,
                "bgn_de": bgn_de,
                "end_de": end_de,
                "page_no": page,
                "page_count": 100,
            }
            if pblntf_ty:
                params["pblntf_ty"] = pblntf_ty
            data = await _get_json(c, f"{BASE}/list.json", params)
            if not data:
                break
            items = data.get("list", [])
            results.extend(items)
            total_count = int(data.get("total_count", 0))
            if len(results) >= total_count or not items:
                break
            page += 1
    return results


async def fetch_document_zip(api_key: str, rcept_no: str) -> bytes:
    """공시 원문 ZIP 다운로드."""
    async with httpx.AsyncClient() as c:
        return await _get_bytes(c, f"{BASE}/document.json", {
            "crtfc_key": api_key,
            "rcept_no": rcept_no,
        })


async def fetch_financials(
    api_key: str,
    corp_code: str,
    bsns_year: int,
    reprt_code: str = "11011",
    fs_div: str = "OFS",
) -> list[dict]:
    """
    단일회사 주요계정 조회 (상장사 + 일부 외감 비상장사).
    비상장사는 010(조회결과없음) 반환 시 빈 리스트.
    """
    async with httpx.AsyncClient() as c:
        data = await _get_json(c, f"{BASE}/fnlttSinglAcnt.json", {
            "crtfc_key": api_key,
            "corp_code": corp_code,
            "bsns_year": str(bsns_year),
            "reprt_code": reprt_code,
            "fs_div": fs_div,
        })
    return data.get("list", [])
