"""
DART 응답 파싱 유틸리티

corpCode.xml ZIP → 기업코드 목록
감사보고서 ZIP  → 재무 수치 (비상장사)
fnlttSinglAcnt  → 재무 수치 (상장사/외감법인)
"""

import io
import re
import zipfile
from typing import Any
from xml.etree import ElementTree as ET

from loguru import logger


# ── 기업코드 목록 파싱 ────────────────────────────────────────────────────────

def parse_corp_codes(zip_bytes: bytes) -> list[dict[str, str]]:
    """
    CORPCODE.xml ZIP → [{corp_code, corp_name, stock_code}, ...]
    인코딩: EUC-KR 또는 UTF-8 자동 감지
    """
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        xml_name = next((n for n in zf.namelist() if n.upper().endswith(".XML")), None)
        if not xml_name:
            raise ValueError("CORPCODE.xml not found in ZIP")
        raw = zf.read(xml_name)

    for enc in ("utf-8", "euc-kr", "cp949"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")

    root = ET.fromstring(text)
    return [
        {
            "corp_code":  item.findtext("corp_code", "").strip(),
            "corp_name":  item.findtext("corp_name", "").strip(),
            "stock_code": item.findtext("stock_code", "").strip(),
        }
        for item in root.findall(".//list")
        if item.findtext("corp_code", "").strip()
    ]


# ── 재무제표 API 응답 파싱 (상장사/외감법인) ──────────────────────────────────

_ACCOUNT_MAP = {
    # 손익계산서
    "매출액":           "revenue",
    "영업수익":         "revenue",
    "영업이익":         "operating_income",
    "영업이익(손실)":   "operating_income",
    "당기순이익":       "net_income",
    "당기순이익(손실)": "net_income",
    # 재무상태표
    "자산총계":         "total_assets",
    "부채총계":         "total_liabilities",
}


def parse_financial_api(rows: list[dict]) -> dict[str, int | None]:
    """fnlttSinglAcnt API 응답 rows → 재무 수치 dict."""
    result: dict[str, int | None] = {}
    for row in rows:
        key = _ACCOUNT_MAP.get(row.get("account_nm", ""))
        if not key:
            continue
        raw = row.get("thstrm_amount", "") or ""
        val = _parse_amount(raw)
        if val is not None and key not in result:
            result[key] = val
    return result


# ── 감사보고서 ZIP 파싱 (비상장사) ──────────────────────────────────────────

def parse_audit_financials(zip_bytes: bytes) -> dict[str, int | None]:
    """
    감사보고서 document.json ZIP → 재무 수치 dict.
    전략 1: XBRL/XML ItemName-Amount 구조
    전략 2: HTML/텍스트 정규식 테이블 파싱
    """
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()
            logger.debug("audit_zip_files", files=names)

            # 전략 1: XML 파일 파싱
            for name in names:
                if not name.lower().endswith(".xml"):
                    continue
                try:
                    raw = zf.read(name)
                    result = _parse_xbrl(raw)
                    if result:
                        logger.debug("audit_xbrl_ok", file=name, keys=list(result))
                        return result
                except Exception as e:
                    logger.debug("audit_xbrl_fail", file=name, error=str(e))

            # 전략 2: HTML/텍스트 파일 정규식
            for name in names:
                ext = name.lower().split(".")[-1]
                if ext not in ("htm", "html", "txt"):
                    continue
                try:
                    raw = zf.read(name)
                    result = _parse_html_financials(raw)
                    if result:
                        logger.debug("audit_html_ok", file=name, keys=list(result))
                        return result
                except Exception as e:
                    logger.debug("audit_html_fail", file=name, error=str(e))

    except zipfile.BadZipFile as e:
        logger.warning("audit_bad_zip", error=str(e))

    logger.warning("audit_parse_failed_no_data")
    return {}


def _parse_xbrl(raw: bytes) -> dict[str, int | None]:
    """DART XBRL XML → 재무 수치 (ItemName/Amount 또는 IFRS namespace)."""
    for enc in ("utf-8", "euc-kr", "cp949"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")

    root = ET.fromstring(text)
    result: dict[str, int | None] = {}

    # ItemName/Amount 구조
    for item in root.findall(".//Item"):
        label = (item.findtext("ItemName") or item.findtext("item_nm") or "").strip()
        amount = (item.findtext("Amount") or item.findtext("thstrm_amount") or "").strip()
        key = _ACCOUNT_MAP.get(label)
        if key and key not in result:
            val = _parse_amount(amount)
            if val is not None:
                result[key] = val

    # XBRL 네임스페이스 구조 (account_nm 태그)
    for elem in root.iter():
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        label = (elem.get("account_nm") or elem.get("label") or "").strip()
        key = _ACCOUNT_MAP.get(label) or _ACCOUNT_MAP.get(tag)
        if key and key not in result:
            val = _parse_amount((elem.text or "").strip())
            if val is not None:
                result[key] = val

    return result


# 테이블 셀에서 금액 패턴 추출 (단위: 원)
_AMOUNT_RE = re.compile(r"(-?\d[\d,]{3,})")


def _parse_html_financials(raw: bytes) -> dict[str, int | None]:
    """HTML/텍스트에서 재무항목 정규식 추출."""
    for enc in ("utf-8", "euc-kr", "cp949"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        return {}

    result: dict[str, int | None] = {}
    lines = text.splitlines()

    for i, line in enumerate(lines):
        clean = re.sub(r"<[^>]+>", " ", line)  # HTML 태그 제거
        for label, key in _ACCOUNT_MAP.items():
            if label in clean and key not in result:
                # 같은 줄 또는 다음 2줄에서 금액 탐색
                context = " ".join(lines[i:i+3])
                context = re.sub(r"<[^>]+>", " ", context)
                matches = _AMOUNT_RE.findall(context)
                if matches:
                    val = _parse_amount(matches[0])
                    if val is not None:
                        result[key] = val

    return result


def _parse_amount(value: str) -> int | None:
    try:
        cleaned = re.sub(r"[^\d\-]", "", str(value))
        return int(cleaned) if cleaned and cleaned != "-" else None
    except (ValueError, TypeError):
        return None
