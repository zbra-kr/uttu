"""
감사보고서 자본변동표(SCE) 마이닝 — 유상증자/신주발행 추출

dart-fss 라이브러리로 특정 회사의 감사보고서 SCE에서 자본 증가 행을 파싱해
funding_rounds 형식으로 반환한다.

신규 대량수집 금지 — company_id 단위 on-demand 호출만.
dart_source.py 패턴 미러.
"""
from __future__ import annotations

import contextlib
import io
import os
import re
from typing import Any

from loguru import logger

# ── 상수 ────────────────────────────────────────────────────────────────────────

# 자본변동표 페이지 제목 키워드 (DART 공백 삽입 패턴 포함)
_SCE_PAGE_KEY = "자본변동표"

# 유상증자/신주발행 행 인식 키워드 (순서 중요: 더 구체적인 것 우선)
_INCREASE_KEYWORDS: list[str] = [
    "유상증자에 의한 증가",
    "신주의 발행에 의한 증가",
    "주식발행에 의한 증가",
    "상환전환우선주의 발행",
    "전환우선주의 발행",
    "신주의 발행",
    "신주발행",
    "유상증자",
]

# 토큰 패턴: 콤마 포함 숫자, 괄호 음수, 대시(0)
_NUM_TOK_RE = re.compile(
    r"^\((\d{1,3}(?:,\d{3})*)\)$"   # (1,234,567) → 음수
    r"|^(-?\d{1,3}(?:,\d{3})*)$"    # 1,234,567 or -1,234,567
    r"|^-$"                          # - → 0
)


def _api_key() -> str:
    return os.environ["DART_API_KEY"]


def _normalize_title(title: str) -> str:
    return re.sub(r"\s+", "", title or "")


def _page_text(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s{2,}", " ", text).strip()


def _tok_to_int(tok: str) -> int | None:
    """토큰 → 정수. 파싱 실패 시 None."""
    tok = tok.strip()
    if tok == "-":
        return 0
    m_neg = re.match(r"^\((\d{1,3}(?:,\d{3})*)\)$", tok)
    if m_neg:
        return -int(m_neg.group(1).replace(",", ""))
    m_pos = re.match(r"^(-?\d{1,3}(?:,\d{3})*)$", tok)
    if m_pos:
        return int(tok.replace(",", ""))
    return None


def _extract_row_amounts(text: str, kw_pos: int, kw_len: int) -> list[int]:
    """
    키워드 이후 세그먼트에서 숫자 토큰을 추출. 한글 토큰 등장 시 종료.
    반환: 정수 리스트 (대시는 0으로 포함)
    """
    segment = text[kw_pos + kw_len:kw_pos + kw_len + 150]
    amounts: list[int] = []
    for tok in segment.split():
        v = _tok_to_int(tok)
        if v is not None:
            amounts.append(v)
        elif re.match(r"^[가-힣]", tok) and amounts:
            # 한글 시작 = 다음 행 → 종료
            break
    return amounts


def _parse_sce_text(
    text: str,
    fiscal_year: int,
    corp_code: str,
    rcept_no: str,
) -> dict | None:
    """
    자본변동표 정규화 텍스트에서 유상증자/신주발행 행 파싱.

    같은 사업연도의 복수 증자는 합산해 1건으로 반환 (스펙 §1 한계 명시).
    마지막 숫자를 총계(amount_krw)로 사용.

    Returns
    -------
    dict or None — funding_rounds 형식 1건. 유상증자 없으면 None.
    """
    total_amount = 0
    matched_keywords: list[str] = []

    # 이미 처리한 텍스트 범위 (부분문자열 중복 방지)
    processed_ranges: list[tuple[int, int]] = []

    for kw in _INCREASE_KEYWORDS:
        search_start = 0
        while True:
            idx = text.find(kw, search_start)
            if idx == -1:
                break

            # 이미 처리된 범위와 겹치면 스킵 (예: "상환전환우선주의 발행" 안의 "전환우선주의 발행")
            kw_end = idx + len(kw)
            if any(s <= idx < e for s, e in processed_ranges):
                search_start = idx + 1
                continue

            amounts = _extract_row_amounts(text, idx, len(kw))
            if not amounts:
                search_start = kw_end
                continue

            # 마지막 숫자 = 총계 컬럼
            row_total = amounts[-1]
            if row_total > 0:
                total_amount += row_total
                if kw not in matched_keywords:
                    matched_keywords.append(kw)
                processed_ranges.append((idx, kw_end + 80))
                logger.info(
                    "sce_row_found",
                    corp_code=corp_code, fiscal_year=fiscal_year,
                    keyword=kw, row_total=row_total,
                )

            search_start = kw_end

    if total_amount <= 0:
        return None

    source_ref = f"audit:{corp_code}:{fiscal_year}"
    source_url = (
        f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"
        if rcept_no else None
    )

    return {
        "round_type":     "유상증자",
        "amount_krw":     total_amount,
        "announced_date": f"{fiscal_year}-12-31",
        "investors":      [],
        "source_type":    "dart_audit",
        "source_url":     source_url,
        "source_ref":     source_ref,
        "confidence":     1.0,
        "raw": {
            "keywords":       matched_keywords,
            "total_amount":   total_amount,
            "date_precision": "year",
            "rcept_no":       rcept_no,
            "fiscal_year":    fiscal_year,
        },
    }


def _parse_report_sce(
    report: Any,
    fiscal_year: int,
    corp_code: str,
) -> tuple[dict | None, bool]:
    """
    단일 감사보고서 Report 객체 → (SCE 유상증자 라운드, sce_page_found) 반환.

    Returns
    -------
    (round_dict_or_None, sce_page_found)
      · sce_page_found=False → 자본변동표 페이지 자체 없음 (parse_failed 아님)
      · sce_page_found=True, round_dict=None → 페이지 있으나 유상증자 행 없음 (증자 없음)
      · sce_page_found=True, round_dict=dict  → 유상증자 발견
    """
    pages = report.pages or []
    rcept_no = getattr(report, "rcept_no", "") or ""

    for page in pages:
        title = _normalize_title(page.title or "")
        if _SCE_PAGE_KEY in title:
            text = _page_text(page.html or "")
            result = _parse_sce_text(text, fiscal_year, corp_code, rcept_no)
            logger.debug(
                "sce_page_parsed",
                corp_code=corp_code, fiscal_year=fiscal_year,
                found=result is not None,
            )
            return result, True

    logger.debug("sce_page_not_found", corp_code=corp_code, fiscal_year=fiscal_year)
    return None, False


def fetch_audit_rounds(corp_code: str, years: int = 5) -> list[dict]:
    """
    감사보고서 자본변동표에서 유상증자/신주발행 라운드 수집 (동기).

    dart-fss 라이브러리로 DART 웹뷰어 HTML 접근. 대량 API 호출 없음.
    dart-fss 의 stdout 출력(로딩 스피너 등)은 억제한다.

    Parameters
    ----------
    corp_code : DART 기업코드 8자리
    years     : 최근 N년 감사보고서 조회 (기본 5)

    Returns
    -------
    list[dict] — funding_rounds 형식 (source_type='dart_audit', confidence=1.0)
    """
    import datetime
    import dart_fss as dart

    dart.set_api_key(_api_key())

    # dart-fss 가 corp_list 로드 시 stdout 에 진행 표시를 출력 — cron 로그 오염 방지
    with contextlib.redirect_stdout(io.StringIO()):
        corp_list = dart.get_corp_list()

    corp_obj = next((c for c in corp_list if c.corp_code == corp_code), None)
    if not corp_obj:
        logger.warning("audit_corp_not_found", corp_code=corp_code)
        return []

    current_year = datetime.datetime.now().year
    bgn_de = f"{current_year - years}0101"
    end_de = f"{current_year}1231"

    try:
        with contextlib.redirect_stdout(io.StringIO()):
            filings = corp_obj.search_filings(
                bgn_de=bgn_de, end_de=end_de, page_count=100
            )
    except Exception as e:
        logger.debug("audit_search_no_result", corp_code=corp_code, error=str(e))
        return []

    audit_reports = [
        f for f in filings
        if "감사보고서" in (f.report_nm or "") and "연결" not in (f.report_nm or "")
    ]
    logger.info(
        "audit_reports_found",
        corp_code=corp_code,
        total_filings=len(filings),
        audit=len(audit_reports),
    )

    all_rounds: list[dict] = []
    parse_failed_count = 0
    for report in audit_reports:
        year_match = re.search(r"\((\d{4})\.\d{2}\)", report.report_nm or "")
        if not year_match:
            year_match = re.search(r"(\d{4})년", report.report_nm or "")
        if not year_match:
            logger.debug("audit_year_parse_skip", report_nm=report.report_nm)
            continue
        fiscal_year = int(year_match.group(1))

        try:
            result, sce_found = _parse_report_sce(report, fiscal_year, corp_code)
        except Exception as e:
            parse_failed_count += 1
            logger.warning(
                "audit_sce_parse_failed",
                corp_code=corp_code,
                fiscal_year=fiscal_year,
                error=str(e),
                note="parse_failed — 빈 결과를 '증자 없음'으로 오인 금지",
            )
            raise  # 예외 무음 통과 금지

        if not sce_found:
            logger.debug(
                "audit_sce_page_missing",
                corp_code=corp_code,
                fiscal_year=fiscal_year,
            )
        if result:
            all_rounds.append(result)

    logger.info(
        "audit_rounds_fetched",
        corp_code=corp_code,
        total=len(all_rounds),
        parse_failed=parse_failed_count,
    )
    return all_rounds
