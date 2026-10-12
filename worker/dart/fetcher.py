"""
DART OpenAPI 저수준 클라이언트
Rate limit: 1,000 req/min → 실제로는 1초 간격 유지

응답 status 코드:
  000 = 정상
  010 = 등록되지 않은 API 키
  013 = 조회 결과 없음
  020 = 요청 초과 / 키 오류 / 서버 오류 등
"""

import asyncio
import io
import json
import zipfile
from typing import Any
from xml.etree import ElementTree

import httpx
from loguru import logger

BASE = "https://opendart.fss.or.kr/api"
RATE_LIMIT_SEC = 0.1  # DART 한도 1,000건/분 = 16.7건/초 → 0.1초 = 600건/분으로 안전


class DartResponseError(RuntimeError):
    """Fixed error text without request, response, or credential content."""

    def __init__(self, classification: str, *, provider_status=None, http_status=None,
                 content_type=None):
        allowed = {"empty_response", "json_error_envelope", "xml_error_envelope",
                   "unexpected_json", "unexpected_xml", "invalid_zip",
                   "unexpected_format", "http_status", "transport_error"}
        self.classification = classification if classification in allowed else "unexpected_format"
        text = f"dart_binary_failed stage=fetch_binary classification={self.classification}"
        # Only fixed enums and bounded integers may enter diagnostics.
        if provider_status is not None:
            codes = {"000", "010", "011", "012", "013", "014", "020", "021",
                     "100", "101", "800", "900", "901"}
            self.provider_status = provider_status if isinstance(provider_status, str) and provider_status in codes else "unknown"
            self.http_status = http_status if type(http_status) is int and 100 <= http_status <= 599 else "unknown"
            types = {"xml", "json", "zip", "octet-stream", "html"}
            self.content_type = content_type if isinstance(content_type, str) and content_type in types else "unknown"
            text += (f" provider_status={self.provider_status} http_status={self.http_status}"
                     f" content_type={self.content_type}")
        super().__init__(text)


def _validate_zip_response(payload: bytes, *, http_status=None, content_type=None) -> bytes:
    if not payload:
        raise DartResponseError("empty_response")
    invalid_zip = False
    try:
        # Opening parses the directory too; is_zipfile alone accepts forged EOCDs.
        # This does not read members or prove CRC/content completeness.
        with zipfile.ZipFile(io.BytesIO(payload)):
            pass
    except (zipfile.BadZipFile, LookupError, ValueError, OverflowError, NotImplementedError):
        if payload.startswith(b"PK"):
            invalid_zip = True
    else:
        return payload
    if invalid_zip:
        raise DartResponseError("invalid_zip") from None
    stripped = payload.lstrip()
    # Only small error envelopes are parsed; their contents never enter diagnostics.
    if len(payload) <= 65536 and stripped[:1] in (b"{", b"["):
        try:
            data = json.loads(payload)
        except (ValueError, UnicodeError, RecursionError):
            pass
        else:
            error = isinstance(data, dict) and data.get("status") not in (None, "", "000")
            raise DartResponseError("json_error_envelope" if error else "unexpected_json")
    if len(payload) <= 65536 and stripped.startswith(b"<"):
        invalid_xml = False
        try:
            root = ElementTree.fromstring(payload)
        except (ElementTree.ParseError, LookupError, ValueError, OverflowError, RecursionError):
            invalid_xml = True
        else:
            status = root.findtext("status") if root.tag == "result" else None
            # Do not infer a provider cause from duplicate, nested or namespaced status.
            statuses = [node for node in root.iter()
                        if isinstance(node.tag, str) and node.tag.rsplit("}", 1)[-1] == "status"]
            valid = (root.tag == "result" and not root.attrib and len(statuses) == 1
                     and statuses[0] in list(root) and statuses[0].tag == "status"
                     and not statuses[0].attrib and len(statuses[0]) == 0
                     and not (root.text or "").strip()
                     and not (statuses[0].tail or "").strip())
            provider_status = status if valid and status else "unknown"
            classification = "xml_error_envelope" if status not in (None, "", "000") else "unexpected_xml"
            raise DartResponseError(classification,
                                    provider_status=provider_status if http_status is not None else None,
                                    http_status=http_status, content_type=content_type)
        if invalid_xml:
            raise DartResponseError("unexpected_xml") from None
    raise DartResponseError("invalid_zip" if payload.startswith(b"PK") else "unexpected_format")


async def _get_json(client: httpx.AsyncClient, url: str, params: dict[str, Any]) -> dict:
    await asyncio.sleep(RATE_LIMIT_SEC)
    resp = await client.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    status = data.get("status", "")
    if status == "010":
        raise RuntimeError("dart_json_failed stage=fetch_json classification=authentication_error") from None
    # 013=데이터없음 — 정상적인 "없음" 케이스
    if status == "013":
        logger.debug("dart_no_result", url=url, status=status)
        return {}
    if status not in ("000", ""):
        raise RuntimeError(f"DART API 오류 {status}: {data.get('message')}")
    return data


async def _get_bytes(client: httpx.AsyncClient, url: str, params: dict[str, Any]) -> bytes:
    await asyncio.sleep(RATE_LIMIT_SEC)
    failure = None
    try:
        resp = await client.get(url, params=params, timeout=60)
        resp.raise_for_status()
    except httpx.HTTPStatusError:
        failure = "http_status"
    except httpx.HTTPError:
        failure = "transport_error"
    if failure is not None:
        raise DartResponseError(failure) from None
    # Normalize locally; header values and parameters never enter the exception.
    media_type = getattr(resp, "headers", {}).get("content-type", "").split(";", 1)[0].strip().lower()
    types = {"application/xml": "xml", "text/xml": "xml", "application/json": "json",
             "application/zip": "zip", "application/x-zip-compressed": "zip",
             "application/octet-stream": "octet-stream", "text/html": "html"}
    return _validate_zip_response(resp.content, http_status=getattr(resp, "status_code", None),
                                  content_type=types.get(media_type, "unknown"))


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
    013(조회결과없음) 반환 시 빈 리스트.
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
