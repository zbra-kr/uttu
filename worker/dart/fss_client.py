"""
dart-fss 라이브러리를 통한 감사보고서 재무 수치 추출 (비상장사 전용).

직접 DART API document.json은 비상장사 감사보고서 다운로드가 막혀있음.
dart-fss는 DART 웹 뷰어를 통해 HTML 페이지 접근 가능.
"""

import re
from typing import Any

import dart_fss as dart
from loguru import logger

_AMOUNT_RE = re.compile(r"(-?\d{1,3}(?:,\d{3})+)")

# 손익계산서 키워드 → DB 컬럼
_IS_KEYWORDS: list[tuple[str, str]] = [
    ("매출액",           "revenue"),
    ("영업수익",         "revenue"),
    ("영업이익",         "operating_income"),
    ("영업이익(손실)",   "operating_income"),
    ("당기순이익",       "net_income"),
    ("당기순이익(손실)", "net_income"),
]

# 재무상태표 키워드 → DB 컬럼
_BS_KEYWORDS: list[tuple[str, str]] = [
    ("자산총계",   "total_assets"),
    ("부채총계",   "total_liabilities"),
]

# 감사보고서 페이지 제목 키워드
_IS_PAGE_KEYS = ("손익계산서", "포괄손익계산서")
_BS_PAGE_KEYS = ("재무상태표",)


def _extract_amounts(text: str, keyword: str) -> tuple[int | None, int | None]:
    """
    평문 텍스트에서 keyword 이후 첫 두 금액 추출.
    반환: (당기금액, 전기금액)
    """
    # 다양한 표기 처리: 공백 삽입(손 익 계 산 서), 주석 번호 제거
    pattern = re.escape(keyword)
    pattern_spaced = r"\s+".join(re.escape(ch) for ch in keyword)

    for pat in (pattern, pattern_spaced):
        m = re.search(pat, text)
        if not m:
            continue
        context = text[m.start():]
        # (주석 N) 제거
        context = re.sub(r"\(주석\s*\d+\)", "", context)
        nums = _AMOUNT_RE.findall(context[:400])
        cur = int(nums[0].replace(",", "")) if nums else None
        pri = int(nums[1].replace(",", "")) if len(nums) > 1 else None
        return cur, pri

    return None, None


def _page_text(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_title(title: str) -> str:
    """'손 익 계 산 서' → '손익계산서' (DART 공백 삽입 패턴 제거)"""
    return re.sub(r"\s+", "", title)


def _parse_report_financials(report: Any, fiscal_year: int) -> dict[str, int | None]:
    """단일 감사보고서 Report 객체 → 재무 수치 dict."""
    result: dict[str, int | None] = {}
    pages = report.pages or []

    for page in pages:
        title: str = _normalize_title(page.title or "")

        if any(k in title for k in _IS_PAGE_KEYS):
            text = _page_text(page.html or "")
            for kw, col in _IS_KEYWORDS:
                if col not in result:
                    cur, _ = _extract_amounts(text, kw)
                    if cur is not None:
                        result[col] = cur
                        logger.debug("dart_fss_parsed", col=col, value=cur, page=title)

        elif any(k in title for k in _BS_PAGE_KEYS):
            text = _page_text(page.html or "")
            for kw, col in _BS_KEYWORDS:
                if col not in result:
                    cur, _ = _extract_amounts(text, kw)
                    if cur is not None:
                        result[col] = cur
                        logger.debug("dart_fss_parsed", col=col, value=cur, page=title)

    return result


def fetch_audit_financials(
    api_key: str,
    corp_code: str,
    years: int = 3,
) -> list[dict[str, Any]]:
    """
    감사보고서에서 연도별 재무 수치 수집.
    Returns: [{fiscal_year, revenue, operating_income, net_income,
               total_assets, total_liabilities, data_source}, ...]
    """
    import datetime
    dart.set_api_key(api_key)

    # corp_code로 Corp 검색
    corp_list = dart.get_corp_list()
    corp_obj = next(
        (c for c in corp_list if c.corp_code == corp_code), None
    )
    if not corp_obj:
        logger.warning("dart_fss_corp_not_found", corp_code=corp_code)
        return []

    current_year = datetime.datetime.now().year
    bgn_de = f"{current_year - years}0101"
    end_de = f"{current_year}1231"

    try:
        filings = corp_obj.search_filings(
            bgn_de=bgn_de, end_de=end_de, pblntf_ty="F"
        )
    except Exception as e:
        logger.warning("dart_fss_search_failed", corp_code=corp_code, error=str(e))
        return []

    # 감사보고서만 필터
    audit_reports = [
        f for f in filings
        if "감사보고서" in (f.report_nm or "") and "연결" not in (f.report_nm or "")
    ]

    results: list[dict[str, Any]] = []
    for report in audit_reports:
        # 보고서 이름에서 사업연도 추출: "감사보고서 (2024.12)" → 2024
        year_match = re.search(r"\((\d{4})\.\d{2}\)", report.report_nm or "")
        if not year_match:
            logger.debug("dart_fss_year_parse_skip", report_nm=report.report_nm)
            continue
        fiscal_year = int(year_match.group(1))

        logger.info("dart_fss_parsing", corp_code=corp_code, year=fiscal_year,
                    rcept_no=report.rcept_no)
        try:
            financials = _parse_report_financials(report, fiscal_year)
        except Exception as e:
            logger.warning("dart_fss_parse_error", corp_code=corp_code,
                           year=fiscal_year, error=str(e))
            continue

        if financials:
            results.append({
                "fiscal_year":       fiscal_year,
                "data_source":       "audit_report_html",
                **financials,
            })
            logger.info("dart_fss_ok", corp_code=corp_code, year=fiscal_year,
                        keys=list(financials))
        else:
            logger.warning("dart_fss_no_data", corp_code=corp_code, year=fiscal_year)

    return results
