"""
DART 투자유치 공시 수집

엔드포인트:
  1. estkRs.json  — 증권신고서 지분증권 (공모 유상증자·IPO)
  2. piicDecsn.json — 주요사항보고서 유상증자결정 (사모 포함)

worker/dart/fetcher.py 의 httpx 클라이언트·rate limit을 재사용한다.
"""
from __future__ import annotations

import asyncio
import os
import re
from typing import Any

import httpx
from loguru import logger

from worker.dart.fetcher import BASE, RATE_LIMIT_SEC

# ── 내부 헬퍼 ───────────────────────────────────────────────────────────────────

def _api_key() -> str:
    return os.environ["DART_API_KEY"]


async def _get_json(client: httpx.AsyncClient, endpoint: str, params: dict[str, Any]) -> dict:
    """DART API GET + rate limit. status 010/013 = 정상적인 빈 결과."""
    await asyncio.sleep(RATE_LIMIT_SEC)
    resp = await client.get(f"{BASE}/{endpoint}", params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    status = data.get("status", "")
    if status in ("010", "013"):
        logger.debug("dart_no_result", endpoint=endpoint, corp_code=params.get("corp_code"))
        return {}
    if status not in ("000", ""):
        raise RuntimeError(f"DART API 오류 {status}: {data.get('message')}")
    return data


def _parse_amount(s: str) -> int | None:
    """콤마 포함 금액 문자열 → 정수. '-' 또는 빈값은 None."""
    if not s or s.strip() in ("-", ""):
        return None
    cleaned = re.sub(r"[^\d]", "", s)
    return int(cleaned) if cleaned else None


def _parse_date_ko(s: str) -> str | None:
    """
    '2024년 02월 19일' → '2024-02-19'
    '20230403'       → '2023-04-03'
    '-' / None       → None
    """
    if not s or s.strip() in ("-", ""):
        return None
    # 한국어 날짜 형식
    m = re.match(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일", s.strip())
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    # YYYYMMDD 형식
    m2 = re.match(r"(\d{4})(\d{2})(\d{2})", s.strip())
    if m2:
        return f"{m2.group(1)}-{m2.group(2)}-{m2.group(3)}"
    return None


# ── estkRs 파싱 ─────────────────────────────────────────────────────────────────

def _parse_estkrs(groups: list[dict]) -> list[dict]:
    """
    estkRs group 배열 → funding_rounds 형식 list.

    group 구조:
      [{"title": "증권의종류", "list": [{rcept_no, stksen, slta, slmthn, ...}]},
       {"title": "인수인정보", "list": [{rcept_no, actnmn, ...}]},
       {"title": "일반사항",   "list": [{rcept_no, pymd, ...}]}, ...]

    rcept_no 기준으로 그룹핑 후 필드 병합.
    """
    # rcept_no별 데이터 병합
    by_rcept: dict[str, dict] = {}

    for group in groups:
        title = group.get("title", "")
        for item in group.get("list", []):
            rcept_no = item.get("rcept_no", "")
            if not rcept_no:
                continue
            if rcept_no not in by_rcept:
                by_rcept[rcept_no] = {"rcept_no": rcept_no, "raw_groups": []}
            by_rcept[rcept_no]["raw_groups"].append({title: item})

            if title == "증권의종류":
                # slta = 모집총액, stksen = 주식유형, slmthn = 발행방법
                amt = _parse_amount(item.get("slta", ""))
                if amt:
                    by_rcept[rcept_no]["amount_krw"] = (
                        by_rcept[rcept_no].get("amount_krw", 0) + amt
                    )
                by_rcept[rcept_no].setdefault("stksen", item.get("stksen", ""))
                by_rcept[rcept_no].setdefault("slmthn", item.get("slmthn", ""))

            elif title == "인수인정보":
                # actnmn = 인수인 회사명
                investor = item.get("actnmn", "").strip()
                if investor and investor != "-":
                    by_rcept[rcept_no].setdefault("investors", [])
                    if investor not in by_rcept[rcept_no]["investors"]:
                        by_rcept[rcept_no]["investors"].append(investor)

            elif title == "일반사항":
                # pymd = 납입일
                pymd = _parse_date_ko(item.get("pymd", ""))
                if pymd:
                    by_rcept[rcept_no].setdefault("announced_date", pymd)

    # 결과 변환
    rounds: list[dict] = []
    for rcept_no, data in by_rcept.items():
        stksen = data.get("stksen", "")
        slmthn = data.get("slmthn", "")
        round_type = _estkrs_round_type(stksen, slmthn)

        rounds.append({
            "round_type":     round_type,
            "amount_krw":     data.get("amount_krw"),
            "announced_date": data.get("announced_date"),
            "investors":      data.get("investors", []),
            "source_type":    "dart_estkrs",
            "source_url":     f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}",
            "source_ref":     rcept_no,
            "confidence":     1.00,
            "raw":            {"rcept_no": rcept_no, "groups": data.get("raw_groups", [])},
        })

    logger.debug("estkrs_parsed", count=len(rounds))
    return rounds


def _estkrs_round_type(stksen: str, slmthn: str) -> str:
    """
    증권신고서 주식유형(stksen)·발행방법(slmthn) → round_type 레이블.

    ⚠️ estkRs 엔드포인트는 상장 전 IPO뿐 아니라 상장 후 공모증자도 포함한다.
       "공모" 단어만으로 IPO를 단정하면 안 된다 — slmthn 원문 기반 세분류.

    실제 slmthn 값 예시:
      "주주배정후 실권주 일반공모"  → 공모증자 (주주배정후 실권주 일반공모)
      "주주우선공모"               → 공모증자 (주주우선공모)
      "일반공모"                   → 공모증자 (일반공모)
      "우리사주조합"               → 공모증자 (우리사주)
      "제3자배정"                  → 제3자배정 공모증자
    """
    s = slmthn.strip() if slmthn else ""
    if not s:
        s = stksen.strip() if stksen else ""
    if not s:
        return "기타"

    sl = s.lower()

    # 제3자배정 — 공모/비공모 모두 포함
    if "제3자배정" in s:
        return "제3자배정 공모증자"

    # 우리사주조합
    if "우리사주" in s:
        return "공모증자 (우리사주)"

    # 주주우선공모 (단독, "주주배정후 실권주" 아닌 경우)
    if s == "주주우선공모":
        return "공모증자 (주주우선공모)"

    # 일반공모 (단독)
    if s == "일반공모":
        return "공모증자 (일반공모)"

    # 주주배정 계열 — 가장 흔한 상장 후 유상증자
    if "주주배정" in s:
        return f"공모증자 ({s})"

    # 나머지 공모 포함 케이스 — IPO로 단정 금지, 원문 유지
    if "공모" in sl:
        return f"공모증자 ({s})"

    # 유상증자·신주 키워드
    if "유상증자" in sl or "신주" in sl:
        return f"유상증자 ({s})"

    # 그 외
    return s or "기타"


def _piic_round_type(ic_mthn: str) -> str:
    """
    piicDecsn ic_mthn 원문 → round_type 레이블.

    실제 ic_mthn 값 예시:
      "주주배정후 실권주 일반공모" → 주주배정 유상증자 (주주배정후 실권주 일반공모)
      "제3자배정증자"             → 제3자배정 유상증자
      "주주우선공모증자"           → 주주우선공모 유상증자
      ""  / "-"                   → 유상증자
    """
    s = ic_mthn.strip() if ic_mthn else ""
    if not s or s == "-":
        return "유상증자"

    if "제3자배정" in s:
        return "제3자배정 유상증자"

    if "주주우선공모" in s:
        return "주주우선공모 유상증자"

    if "주주배정" in s:
        return f"주주배정 유상증자 ({s})"

    # 기타 공모 케이스
    if "공모" in s:
        return f"유상증자 ({s})"

    # 그 외 원문 유지
    return s


# ── piicDecsn 파싱 ───────────────────────────────────────────────────────────────

def _parse_piic(items: list[dict]) -> list[dict]:
    """
    piicDecsn list 배열 → funding_rounds 형식.

    주요 필드:
      fdpp_op   : 운영자금 (str, 원 단위)
      fdpp_fclt : 시설자금
      fdpp_bsninh: 사업인수
      ic_mthn   : 발행방법 (주주우선공모증자 등)
      ssl_bgd   : 이사회결의일 YYYYMMDD
      rcept_no  : 접수번호
    """
    rounds: list[dict] = []

    for item in items:
        rcept_no = item.get("rcept_no", "")
        if not rcept_no:
            continue

        # 자금사용목적 합산 (운영자금 + 시설자금 + 사업인수)
        total = 0
        for field in ("fdpp_op", "fdpp_fclt", "fdpp_bsninh"):
            v = _parse_amount(item.get(field, ""))
            if v:
                total += v
        amount_krw = total if total > 0 else None

        # 날짜: ssl_bgd (이사회결의일)
        announced_date = _parse_date_ko(item.get("ssl_bgd", ""))

        # round_type: ic_mthn 원문 기반 세분류
        ic_mthn = (item.get("ic_mthn") or "").strip()
        round_type = _piic_round_type(ic_mthn)

        rounds.append({
            "round_type":     round_type,
            "amount_krw":     amount_krw,
            "announced_date": announced_date,
            "investors":      [],
            "source_type":    "dart_piic",
            "source_url":     f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}",
            "source_ref":     rcept_no,
            "confidence":     1.00,
            "raw":            item,
        })

    logger.debug("piic_parsed", count=len(rounds))
    return rounds


# ── 공개 함수 ───────────────────────────────────────────────────────────────────

async def fetch_dart_rounds(
    corp_code: str,
    bgn_de: str = "20150101",
) -> list[dict]:
    """
    DART estkRs + piicDecsn 두 엔드포인트를 조회해 투자라운드 리스트 반환.

    Parameters
    ----------
    corp_code : DART 기업코드 (8자리)
    bgn_de    : 조회 시작일 YYYYMMDD (기본 2015-01-01)

    Returns
    -------
    list of dicts — funding_rounds 테이블 삽입 준비된 형태
    """
    import datetime as _dt
    end_de = _dt.date.today().strftime("%Y%m%d")
    key = _api_key()
    params_base = {
        "crtfc_key": key,
        "corp_code": corp_code,
        "bgn_de": bgn_de,
        "end_de": end_de,
    }

    rounds: list[dict] = []

    async with httpx.AsyncClient() as client:
        # 1. estkRs — 증권신고서 지분증권
        try:
            data = await _get_json(client, "estkRs.json", params_base)
            if data:
                groups = data.get("group", [])
                rounds.extend(_parse_estkrs(groups))
        except Exception as e:
            logger.warning("estkrs_fetch_error", corp_code=corp_code, error=str(e))

        # 2. piicDecsn — 유상증자결정
        try:
            data2 = await _get_json(client, "piicDecsn.json", params_base)
            if data2:
                items = data2.get("list", [])
                rounds.extend(_parse_piic(items))
        except Exception as e:
            logger.warning("piic_fetch_error", corp_code=corp_code, error=str(e))

    logger.info(
        "dart_rounds_fetched",
        corp_code=corp_code,
        total=len(rounds),
    )
    return rounds
