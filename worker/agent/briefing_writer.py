"""
UTTU 데일리 브리핑 생성 워커 (Stage 8 — audience별 입력 분리).

모델: claude-sonnet-4-6 (max_tokens=4000)
audience: executive / staff / cs — asyncio.gather로 병렬 생성
각 audience는 서로 다른 입력 데이터 영역을 받음 (데이터 격리)

실행:
  worker/.venv/bin/python3 -m worker.agent.briefing_writer
  worker/.venv/bin/python3 -m worker.agent.briefing_writer --date 2026-05-30
  worker/.venv/bin/python3 -m worker.agent.briefing_writer --date 2026-05-30 --dry-run
  worker/.venv/bin/python3 -m worker.agent.briefing_writer --audience executive
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import re
import sys
import time
from datetime import date, datetime

import anthropic
import pytz
from dotenv import load_dotenv
from loguru import logger

from supabase import create_client
from worker.agent._briefing_queries import (
    collect_cs_inputs,
    collect_executive_inputs,
    collect_staff_inputs,
)
from worker.notifications.enqueue import enqueue_for_subscribers
from worker.utils.job_tracker import JobTracker

load_dotenv()

KST       = pytz.timezone("Asia/Seoul")
MODEL     = "claude-sonnet-4-6"
AUDIENCES = ["executive", "staff", "cs"]


def _failure_kind(exc: BaseException) -> str:
    kinds = {"ValueError", "TypeError", "KeyError", "JSONDecodeError", "RuntimeError", "CancelledError",
             "TimeoutError", "ConnectionError", "OSError", "APIConnectionError",
             "APITimeoutError", "RateLimitError", "AuthenticationError",
             "PermissionDeniedError", "BadRequestError", "NotFoundError",
             "UnprocessableEntityError", "InternalServerError", "APIStatusError"}
    kind = type(exc).__name__
    return kind if kind in kinds else "OtherError"


def _failure_diagnostic(stage: str, audience: str, exc: BaseException) -> str:
    """Allowlisted metadata in message text, visible with the default Loguru sink."""
    stages = {"summary", "detail_page", "details", "publication", "notification"}
    stage = stage if stage in stages else "worker"
    audience = audience if audience in {"executive", "staff", "cs"} else "unknown"
    kind = _failure_kind(exc)
    return f"briefing_failure stage={stage} audience={audience} kind={kind}"


# ── 클라이언트 ─────────────────────────────────────────────────────────────────

def _supabase():
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], key)


def _today_kst() -> date:
    return datetime.now(KST).date()


# ── 시스템 프롬프트 3종 ───────────────────────────────────────────────────────

_SYSTEM_EXECUTIVE = """당신은 B.CAVE(한국 패션 기업)의 경영진 시점 매거진을 작성하는 분석가다.

## 회사 컨텍스트
- 자사: 커버낫(Covernat), 리(LEE), 와키윌리(WackyWilly)
- 본부: 재경사업본부
- 핵심 채널: 무신사
- 경쟁사: 영원무역홀딩스, 한세실업, F&F, 이랜드월드, LF, 한섬, 무신사스탠다드 등

## 톤
- 결정자 톤. "해야 한다"·"고려해야 한다"·"검토 필요" 같은 액션 동사
- 숫자 적게, 문장 적게, 핵심만
- "어제 일어난 일" + "이번 주 트렌드" + "외부 변화" 3축
- 자사 영향이 큰 정보 우선 노출

## 출력 형식 — JSON 외 다른 텍스트 절대 금지

{
  "headline": "오늘 가장 중요한 한 가지 — 자사 영향 기준 (40자 이내)",
  "daily_brief": [
    "어제의 핵심 1 (35자 이내, 자사 변동)",
    "어제의 핵심 2 (35자 이내, 경쟁·외부)",
    "어제의 핵심 3 (35자 이내, 결정 필요 사항)"
  ],
  "weekly_brief": [
    "금주 자사 트렌드 1 (40자 이내)",
    "금주 자사 트렌드 2 (40자 이내)",
    "금주 경쟁사 동향 (40자 이내)"
  ],
  "card_comments": {
    "competitor":  "경쟁사 카드 한 줄 (30자 이내)",
    "news":        "패션 뉴스 카드 한 줄 (30자 이내)",
    "own_ranking": "자사 한눈에 카드 한 줄 (30자 이내)",
    "anomaly":     "즉시 결정사항 카드 한 줄 (30자 이내)"
  },
  "insights": [
    {
      "title": "인사이트 1 제목 (25자 이내, 결정 시사점)",
      "body":  "100자 이내. 데이터 근거 + 시사점.",
      "link":  "/company?id=<companies.id> 또는 /anomaly?id=<anomaly_id> 등"
    }
  ],
  "news_picks": [
    {
      "headline":    "뉴스 헤드라인 그대로",
      "summary":     "1줄 요약 (50자 이내)",
      "source_name": "출처",
      "source_url":  "https://...",
      "relevance":   4
    }
  ]
}

## 규칙
- insights는 근거가 있는 항목만 0~10개. 개수를 채우기 위한 반복·추측 금지. 근거가 없으면 빈 배열 []
- DART 공시(dart_disclosures)가 있으면 insights[0]에 최우선 배치 — 절대 누락 금지
  * importance 5(CRITICAL): 합병·유증·상장폐지 등 → headline에도 반드시 반영
  * importance 4(HIGH): 영업이익·주요계약 등 → insights[0~2]에 배치
  * importance 3(MEDIUM): 임원·소송 등 → insights[0~4]에 배치
  * 여러 공시가 있으면 importance 내림차순으로 배치
- news_picks는 4개 슬롯(news_hot/news_own/news_common/news_major) 중 relevance ≥ 4 기사만, 최대 5개
  우선순위: 자사연관 → 화제성 → 주요이슈 → 공통. 슬롯이 비어있으면 해당 슬롯 건너뜀.
- 자사 영향이 큰 순으로 정렬
- 데이터에 없는 사실 절대 만들지 마라
- 외부 뉴스(external_news) 기반 insights 작성 규칙 (절대 준수):
  * news_picks 내용을 insights body에 인용할 때 반드시 "(출처: [source_name])" 표기
  * 기사 주장을 확인된 사실처럼 서술 금지 — "~라고 보도됨" 또는 "보도에 따르면" 표현 사용
  * 뉴스 기사 하나만을 근거로 "해야 한다"·"앞당겨야 한다"·"검토 필요" 같은 액션 권고 생성 금지
  * 기사에 명시되지 않은 수치·선정 결과·순위를 body에 포함 금지
- 링크 규칙 (절대 준수):
  * 입력 데이터 항목에 "link" 필드가 있으면 반드시 그 값을 그대로 복사 — 절대 수정·추측 금지
  * "link" 필드가 없는 항목만 아래 형식으로 직접 생성:
    - 브랜드: /brand?slug=<brand_slug>
    - 랭킹: /ranking
    - 상품: /product?id=<product_id>
  * company_id, anomaly_id 같은 UUID를 직접 추측하거나 조합 절대 금지

## 데이터 영역 격리 규칙 (절대)
당신은 경영진(Executive) 시점 전용이다. Staff·CS 영역은 절대 다루지 않는다.
금지: 자사 상품별 랭킹 디테일, 카테고리별 트렌드, 리뷰 내용, 할인율·SKU 같은 상품 운영 디테일
허용: 회사·재무·공시·외부 뉴스·HIGH 이상탐지·자사 매출(ERP)·경쟁사 회사 단위 동향만
"리뷰"·"SKU"·"카테고리 트렌드"가 생각나면 해당 인사이트를 빼고 다른 데이터로 교체
입력 데이터에 없는 사실 절대 만들지 마라
출력 JSON 외 다른 텍스트 절대 포함 금지"""


_SYSTEM_STAFF = """당신은 B.CAVE 기획/영업팀의 매거진을 작성하는 데이터 분석가다.

## 회사 컨텍스트
- 자사: 커버낫(Covernat), 리(LEE), 와키윌리(WackyWilly)
- 본부: 재경사업본부
- 핵심 채널: 무신사
- 경쟁사: 영원무역홀딩스, 한세실업, F&F, 이랜드월드, LF, 한섬, 무신사스탠다드 등

## 톤
- 동료 톤. "오늘 일어난 일"·"이번 주 트렌드"·"카테고리 핫이슈"
- 결정·지시 톤 아님. 정보 전달·관찰 톤
- 그래프·KPI 친화적 (텍스트 + 숫자 균형)
- 자사 상품 단위·브랜드 단위 분석에 집중

## 출력 형식

{
  "headline": "오늘 본 것 한 줄 (40자 이내)",
  "daily_brief": [
    "자사 상품 어제 변화 1 (40자 이내)",
    "자사 상품 어제 변화 2 (40자 이내)",
    "자사 상품 어제 변화 3 (40자 이내)"
  ],
  "weekly_brief": [
    "이번 주 카테고리 강세 (40자 이내)",
    "이번 주 카테고리 약세 (40자 이내)",
    "이번 주 경쟁 브랜드 동향 (40자 이내)"
  ],
  "card_comments": {
    "own_ranking": "랭킹 변동 한 줄 (30자)",
    "promotion":   "프로모션 동향 한 줄 (30자)",
    "anomaly":     "이상탐지 한 줄 (30자)",
    "review":      "자사 리뷰 건수 한 줄 (30자)",
    "competitor":  "경쟁사 추이 한 줄 (30자)",
    "trend":       "카테고리 트렌드 한 줄 (30자)",
    "dart":        "DART 공시 한 줄 (30자, 없으면 생략)",
    "news":        "패션 뉴스 한 줄 (30자, 없으면 생략)"
  },
  "insights": [
    { "title": "...", "body": "100자 이내", "link": "/ranking?... 또는 /brand?slug=... 등" }
  ]
}

## 콘텐츠 전후 관찰 규칙 (핵심)
입력 데이터에 snap_effectiveness / promo_effectiveness / magazine_effectiveness 가 있으면:
- rank_delta는 수집된 순위의 전후 차이일 뿐, 콘텐츠 효과의 검증 결과가 아니다
- 동일 상품·카테고리·성별·연령·비교 날짜가 확인된 경우에만 순위 전후 변화로 서술
- "등장 이후 수집된 순위가 X위→Y위로 관찰됨. 콘텐츠와의 인과관계는 확인되지 않음"처럼 관찰과 해석을 구분
- 랭킹·조회수·리뷰 증가만으로 매출·수요·전환율 증가 또는 높은 ROI 확인을 주장하지 말 것
- 프로모션·매거진이 상승을 유발했다거나 효과가 입증됐다고 단정 금지
- 양수 변화만 골라 성공 사례로 일반화하지 말 것. 비교 근거가 없으면 해당 인사이트 생략

## 규칙
- insights는 근거가 있는 항목만 0~10개. 개수를 채우기 위한 반복·추측 금지. 근거가 없으면 빈 배열 [] (카테고리·세그먼트별 다양하게)
- news_picks는 출력 안 함 (executive 전용)
- 자사 + 경쟁사 브랜드 균형
- 카테고리 다양성 (한 카테고리에 인사이트 몰리지 않게)
- 링크 규칙 (절대 준수):
  * 입력 데이터 항목에 "link" 필드가 있으면 반드시 그 값을 그대로 복사 — 절대 수정·추측 금지
  * "link" 필드가 없는 항목만 아래 형식으로 직접 생성:
    - 브랜드: /brand?slug=<brand_slug>
    - 랭킹: /ranking
    - 상품: /product?id=<product_id>
  * UUID를 직접 추측하거나 조합 절대 금지

## 데이터 영역 격리 규칙 (절대)
당신은 기획/영업(Staff) 시점 전용이다. Executive·CS 영역은 절대 다루지 않는다.
금지: 자사 매출(ERP·Snowflake), DART 재무공시, 외부 뉴스, 리뷰 본문 디테일, 회사 단위 동향
허용: 자사 상품 랭킹변동, 카테고리 트렌드, 경쟁사 브랜드 동향, 프로모션, 이상탐지(HIGH+MED)만
"재무"·"공시"·"주가"·"ERP매출"이 생각나면 해당 인사이트를 빼고 다른 데이터로 교체
리뷰 건수·별점 집계는 허용, 리뷰 본문 인용·패턴 분석은 금지 (CS 영역)
입력 데이터에 없는 사실 절대 만들지 마라
출력 JSON 외 다른 텍스트 절대 포함 금지"""


_SYSTEM_CS = """당신은 B.CAVE CS팀의 매거진을 작성하는 분석가다. 자사 리뷰 패턴에만 집중.

## 톤
- 운영 톤. "어떤 문제가 일어나고 있는지"·"어떤 강점이 있는지"·"무엇을 응답해야 할지"
- 리뷰 본문 인용 시 닉네임·사용자ID 절대 포함 금지
- 1점·5점 리뷰 패턴에 집중, 권장 대응은 해당 리뷰 근거가 충분할 때만 제안

## 출력 형식

{
  "headline": "오늘 CS 핵심 한 줄 (40자 이내, 문제 또는 강점)",
  "daily_brief": [
    "어제 1~2점 리뷰 패턴 (40자 이내)",
    "어제 4~5점 리뷰 패턴 (40자 이내)",
    "긴급 대응 근거가 있으면 요약, 근거 부족 시 '확인 필요' (40자 이내)"
  ],
  "weekly_brief": [
    "이번 주 공통 문제 패턴 (40자 이내)",
    "이번 주 공통 강점 패턴 (40자 이내)",
    "리뷰 활동 추이 (40자 이내)"
  ],
  "card_comments": {
    "today_reviews":   "오늘 리뷰 카드 한 줄",
    "low_pattern":     "1~2점 패턴 한 줄",
    "high_pattern":    "4~5점 패턴 한 줄",
    "problem_product": "문제 상품 한 줄"
  },
  "insights": [
    { "title": "문제 패턴 1 (25자)", "body": "100자 이내, 근거 있는 경우만 권장 대응", "link": "/reviews?..." }
  ]
}

## 규칙
- insights는 근거가 있는 항목만 0~10개. 개수를 채우기 위한 반복·추측 금지. 근거가 없으면 빈 배열 [] (리뷰 패턴·문제 상품·강점·권장 대응 다양하게)
- 1점·2점 리뷰 본문은 인용해도 됨 (단, 닉네임·ID 절대 제외)
- 5점 리뷰의 강점 키워드 추출
- news_picks 출력 안 함
- 권장 대응(예: "사이즈 가이드 보강 필요")은 리뷰 근거가 충분할 때만 포함. 근거 부족 시 확인 필요로 표시

## 데이터 영역 격리 규칙 (절대)
당신은 CS 시점 전용이다. Executive·Staff 영역은 절대 다루지 않는다.
금지: 랭킹, 매출, 재무, 외부 뉴스, 경쟁사 리뷰, 이상탐지
허용: 자사 리뷰 데이터만 — 별점 분포, 문제 패턴, 강점 패턴, 권장 대응
"랭킹"·"재무"·"매출"·"경쟁사"·"이상탐지"가 생각나면 해당 인사이트를 빼고 다른 리뷰 데이터로 교체
입력 데이터에 없는 사실 절대 만들지 마라
출력 JSON 외 다른 텍스트 절대 포함 금지"""


# Shared evidence constraints also govern detailed articles, which must not amplify
# unsupported claims inherited from a short insight.
_EVIDENCE_RULES = """
## 근거·표본 범위 (모든 출력 필드에 적용)
- headline, daily_brief, weekly_brief, card_comments, insights, article, key_metrics, chart 모두 입력 원자료만 근거로 사용
- 인사이트 요약 자체는 근거가 아니다. 상세 기사 작성 시 원자료로 확인되지 않는 주장·숫자는 반복하거나 확장하지 말 것
- 랭킹·조회수 변화만으로 매출·수요·전환율 증가, 콘텐츠의 인과적 효과 또는 ROI 확인을 주장하지 말 것
- 리뷰는 생성 당시 수집·조회된 표본이다. 건수·평점은 '조회 표본 N건 중'처럼 범위를 표시하고 전체 고객·전체 리뷰로 일반화 금지
- '어제 리뷰 4건 전원 5점' 대신 날짜가 확인된 경우에만 '어제 작성된 조회 표본 4건 중 4건 5점'처럼 작성
- 미수집·지연 수집·조회 제한이 있을 수 있다. 빈 배열을 '리뷰 없음', '문제 없음'의 증거로 사용 금지
- 비교 날짜·상품·브랜드·세그먼트가 명시된 경우 그대로 보존. 누락된 범위나 ID를 추측하지 말 것
- 입력 link가 있으면 쿼리 문자열까지 그대로 복사. 없으면 원자료에 실제 있는 ID만 사용하고, 특정 근거 링크를 만들 수 없으면 생략
- 근거 부족 시 확인 필요로 표시하고 추정 수치·차트·권고를 만들지 말 것
"""

_SYSTEM_EXECUTIVE += _EVIDENCE_RULES
_SYSTEM_STAFF += _EVIDENCE_RULES
_SYSTEM_CS += _EVIDENCE_RULES

_SYSTEM_PROMPTS: dict[str, str] = {
    "executive": _SYSTEM_EXECUTIVE,
    "staff":     _SYSTEM_STAFF,
    "cs":        _SYSTEM_CS,
}

# ── 인사이트 상세 페이지 생성 시스템 프롬프트 ────────────────────────────────────

_SYSTEM_INSIGHT_PAGE = """당신은 B.CAVE 인텔리전스 시스템의 인사이트 상세 페이지를 작성하는 데이터 저널리스트다.

## 역할
브리핑의 인사이트 한 줄 요약을 받아, 배경 데이터를 근거로 신문 기사 형식의 심층 분석 페이지를 생성한다.

## 출력 형식 — JSON 외 절대 금지

{
  "article": "300~500자 분석 기사. 단락 구분은 \\n\\n. 첫 단락은 핵심 팩트, 이후 배경·맥락·시사점 순. 숫자는 데이터에 있는 것만 사용.",
  "key_metrics": [
    {"label": "지표명 (8자 이내)", "value": "값 (단위 포함)", "change": "+5위 또는 생략 가능"},
    {"label": "...", "value": "...", "change": "..."}
  ],
  "chart": {
    "type": "bar",
    "title": "차트 제목 (20자 이내)",
    "x_labels": ["레이블1", "레이블2"],
    "series": [{"name": "시리즈명", "values": [숫자1, 숫자2]}],
    "reversed": false
  }
}

## 규칙
- article은 반드시 입력 데이터에 있는 사실만 서술. 없는 수치 생성 금지
- key_metrics는 원자료로 확인된 숫자만 0~4개. 없으면 빈 배열 []
- chart는 데이터가 있을 때만 생성. 없으면 null
- chart type: "bar"(비교), "line"(추이) 중 택1
- reversed: 순위·등수 데이터(숫자가 작을수록 좋은 경우)는 반드시 true, 나머지는 false
- x_labels와 series[].values 길이 반드시 일치
- 데이터가 희박하면 article만 작성하고 chart는 null로
- 출력 JSON 외 다른 텍스트 절대 포함 금지"""


_SYSTEM_INSIGHT_PAGE += _EVIDENCE_RULES


# ── 사용자 메시지 포맷 (audience별 분리) ──────────────────────────────────────

def _j(obj) -> str:
    """JSON pretty-print (date 직렬화 포함)."""
    def _default(o):
        if isinstance(o, date):
            return o.isoformat()
        raise TypeError(f"Not serializable: {type(o)}")
    return json.dumps(obj, ensure_ascii=False, indent=2, default=_default)


def _header(target_date, weekday: str, audience: str) -> str:
    return f"=== 브리핑 날짜: {target_date} ({weekday}) / audience: {audience} ===\n"


def _format_executive_message(inputs: dict) -> str:
    lines = [
        _header(inputs["date"], inputs["weekday"], "executive"),
        "## 자사 매출 ERP (Snowflake 미연동 — 현재 빈 dict)",
        _j(inputs.get("own_sales") or {}),
        "",
        "## DART 공시 (어제 신규, 자사·경쟁사 회사 단위)",
        _j(inputs.get("dart_disclosures") or []),
        "",
        "## DART 재무 시그널 (최근 7일 분기·반기·사업보고서)",
        _j(inputs.get("dart_financial_signals") or []),
        "",
        "## 외부 패션 뉴스 (2일 이내, 슬롯별 분류 — 없으면 빈 배열)",
        "### [화제성] 동일 이슈 다매체 보도 (mention_count 높은 순)",
        _j(inputs.get("news_hot") or []),
        "",
        "### [자사 연관] 커버낫·리·와키윌리 직접 언급",
        _j(inputs.get("news_own") or []),
        "",
        "### [패션 공통] 업계·트렌드·플랫폼 이슈",
        _j(inputs.get("news_common") or []),
        "",
        "### [주요 이슈] relevance≥4 핵심 이슈",
        _j(inputs.get("news_major") or []),
        "",
        "## 이상탐지 HIGH (어제, 자사 중심)",
        _j(inputs.get("anomalies_high_own") or []),
        "",
        "## 경쟁사 회사 단위 동향 (어제, 상위 변동 5건)",
        _j(inputs.get("competitor_company_movers") or []),
        "",
        "## 자사 이번 주 랭킹 추이 (요약용)",
        _j(inputs.get("own_weekly_summary") or []),
        "",
    ]
    return "\n".join(lines)


def _format_staff_message(inputs: dict) -> str:
    lines = [
        _header(inputs["date"], inputs["weekday"], "staff"),
        "## 자사 상품 랭킹 변동 (어제 vs 그제, 전체카테고리·A·AGE_BAND_ALL)",
        _j(inputs.get("own_ranking_delta") or []),
        "",
        "## 금주(월~전날) 자사 브랜드 일별 최고순위 추이",
        _j(inputs.get("own_weekly_trend") or []),
        "",
        "## 카테고리별 핫 트렌드 (어제 카테고리 TOP5 브랜드)",
        _j(inputs.get("category_trends") or []),
        "",
        "## 경쟁사 TOP10 신규 진입 (어제)",
        _j(inputs.get("competitor_brand_new_entrants") or []),
        "",
        "## 경쟁사 브랜드 ±5위 이상 변동 (어제)",
        _j(inputs.get("competitor_brand_movers") or []),
        "",
        "## 활성 프로모션 (어제 기준, 자사 포함 여부·평균 할인율)",
        _j(inputs.get("active_promotions") or []),
        "",
        "## 이상탐지 HIGH + MED (어제)",
        _j(inputs.get("anomalies_all") or {}),
        "",
        "## [콘텐츠 전후 관찰] 스냅 고참여 → 상품 순위 변화 (최근 7일, rank_delta 큰 순)",
        _j(inputs.get("snap_effectiveness") or []),
        "",
        "## [콘텐츠 전후 관찰] 프로모션 실행 → 상품 순위·리뷰 변화 (최근 14일, rank_delta 큰 순)",
        _j(inputs.get("promo_effectiveness") or []),
        "",
        "## [콘텐츠 전후 관찰] 매거진 피처링 → 상품 순위 변화 (최근 7일, rank_delta 큰 순)",
        _j(inputs.get("magazine_effectiveness") or []),
        "",
    ]
    return "\n".join(lines)


def _format_cs_message(inputs: dict) -> str:
    lines = [
        _header(inputs["date"], inputs["weekday"], "cs"),
        "## 자사 리뷰 요약 (어제, 건수·평균별점·분포)",
        _j(inputs.get("review_summary_yesterday") or {}),
        "",
        "## 1~2점 리뷰 샘플 (어제, 최대 10건 — 닉네임·ID 제외)",
        _j(inputs.get("low_reviews") or []),
        "",
        "## 4~5점 리뷰 샘플 (어제, 최대 10건 — 닉네임·ID 제외)",
        _j(inputs.get("high_reviews") or []),
        "",
        "## 이번 주 자사 브랜드별 리뷰 패턴 (평균별점·건수)",
        _j(inputs.get("weekly_review_pattern") or []),
        "",
        "## 이번 주 문제 상품 TOP5 (1~2점 누적 많은 순)",
        _j(inputs.get("problem_products_top") or []),
        "",
        "## 이번 주 강점 상품 TOP5 (4~5점 누적 많은 순)",
        _j(inputs.get("strength_products_top") or []),
        "",
    ]
    return "\n".join(lines)


def format_user_message(audience: str, inputs: dict) -> str:
    if audience == "executive":
        return _format_executive_message(inputs)
    elif audience == "staff":
        return _format_staff_message(inputs)
    elif audience == "cs":
        return _format_cs_message(inputs)
    raise ValueError(f"Unknown audience: {audience}")


# ── JSON 파싱 ──────────────────────────────────────────────────────────────────

def _extract_json_dict(text: str) -> dict:
    """응답 텍스트에서 JSON 객체 추출. 실패 시 ValueError."""
    text = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError(f"No JSON object in response: {text[:200]}")
    try:
        return json.loads(m.group())
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON parse error: {e}. Raw: {text[:300]}") from e


# ── LLM 호출 ──────────────────────────────────────────────────────────────────

async def generate_briefing(
    audience: str,
    inputs: dict,
    client: anthropic.AsyncAnthropic,
) -> dict:
    """단일 audience 브리핑 생성. 실패 시 Exception (gather return_exceptions=True)."""
    user_msg = format_user_message(audience, inputs)
    start_ms = time.monotonic()

    resp = await client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=_SYSTEM_PROMPTS[audience],
        messages=[{"role": "user", "content": user_msg}],
    )

    generation_ms = int((time.monotonic() - start_ms) * 1000)
    text   = resp.content[0].text
    parsed = _extract_json_dict(text)

    return {
        "audience":      audience,
        "headline":      parsed["headline"],
        "daily_brief":   parsed["daily_brief"],
        "weekly_brief":  parsed.get("weekly_brief"),
        "card_comments": parsed["card_comments"],
        "insights":      parsed["insights"],
        "news_picks":    parsed.get("news_picks") if audience == "executive" else None,
        "model":         MODEL,
        "input_tokens":  resp.usage.input_tokens,
        "output_tokens": resp.usage.output_tokens,
        "generation_ms": generation_ms,
    }


# ── 인사이트 상세 페이지 생성 ─────────────────────────────────────────────────

def _validate_insight_detail(parsed: dict) -> dict:
    """Validate fields consumed by the detail renderer; not a factual verification."""
    def text(value):
        return isinstance(value, str) and bool(value.strip())

    if not isinstance(parsed, dict) or not text(parsed.get("article")):
        raise ValueError("insight article must be a nonblank string")
    metrics = parsed.get("key_metrics")
    if metrics is None:
        metrics = []
    if (not isinstance(metrics, list) or len(metrics) > 4
            or any(not isinstance(m, dict) or not text(m.get("label"))
                   or not text(m.get("value"))
                   or ("change" in m and not isinstance(m["change"], str)) for m in metrics)):
        raise ValueError("invalid insight key_metrics")
    chart = parsed.get("chart")
    if chart is not None:
        if (not isinstance(chart, dict) or chart.get("type") not in ("bar", "line")
                or not text(chart.get("title"))
                or not isinstance(chart.get("x_labels"), list) or not chart["x_labels"]
                or not all(text(label) for label in chart["x_labels"])
                or not isinstance(chart.get("series"), list) or not chart["series"]
                or ("reversed" in chart and not isinstance(chart["reversed"], bool))):
            raise ValueError("invalid insight chart")
        for series in chart["series"]:
            if (not isinstance(series, dict) or not text(series.get("name"))
                    or not isinstance(series.get("values"), list)
                    or len(series["values"]) != len(chart["x_labels"])
                    or any(type(value) not in (int, float) or not math.isfinite(value)
                           for value in series["values"])):
                raise ValueError("invalid insight chart series")
        names = [series["name"] for series in chart["series"]]
        if "name" in names or len(set(names)) != len(names):
            raise ValueError("chart series names must be unique and not replace x labels")
    return {"article": parsed["article"], "key_metrics": metrics, "chart": chart}


async def generate_insight_page(
    idx: int,
    insight: dict,
    inputs: dict,
    audience: str,
    client: anthropic.AsyncAnthropic,
) -> dict:
    """단일 인사이트에 대한 상세 페이지 생성."""
    if (not isinstance(insight, dict)
            or any(not isinstance(insight.get(key), str) or not insight[key].strip()
                   for key in ("title", "body"))
            or not isinstance(insight.get("link", ""), str)):
        raise ValueError("invalid insight summary fields")
    user_msg = (
        f"## 인사이트 ({audience}, #{idx + 1})\n"
        f"제목: {insight.get('title', '')}\n"
        f"요약: {insight.get('body', '')}\n"
        f"링크: {insight.get('link', '')}\n\n"
        f"## 배경 데이터\n{_j(inputs)}"
    )
    try:
        resp = await client.messages.create(
            model=MODEL,
            max_tokens=1500,
            system=_SYSTEM_INSIGHT_PAGE,
            messages=[{"role": "user", "content": user_msg}],
        )
        parsed = _validate_insight_detail(_extract_json_dict(resp.content[0].text))
        return {
            "idx":         idx,
            "title":       insight.get("title", ""),
            "body":        insight.get("body", ""),
            "link":        insight.get("link", ""),
            "article":     parsed["article"],
            "key_metrics": parsed["key_metrics"],
            "chart":       parsed["chart"],
        }
    except Exception as e:
        logger.warning(_failure_diagnostic("detail_page", audience, e))
        raise


async def generate_insight_pages(
    result: dict,
    inputs: dict,
    client: anthropic.AsyncAnthropic,
) -> list[dict]:
    """브리핑 결과의 모든 인사이트에 대해 상세 페이지를 병렬 생성."""
    insights = result.get("insights")
    if insights is None:
        insights = []
    if not isinstance(insights, list):
        raise ValueError("insights must be an array")
    audience = result["audience"]
    tasks = [
        generate_insight_page(i, ins, inputs, audience, client)
        for i, ins in enumerate(insights)
    ]
    pages = await asyncio.gather(*tasks)
    return list(pages)


# ── DB 적재 ───────────────────────────────────────────────────────────────────

def _upsert_briefing(db, result: dict, briefing_date: date, pages: list[dict]) -> None:
    """Publish one complete revision; concurrent attempts use last committed write.

    A response failure cannot prove whether the atomic write committed. Never
    retry automatically or perform a separate late detail-page update.
    """
    response = db.table("daily_briefings").upsert(
        {
            "briefing_date": briefing_date.isoformat(),
            "audience":      result["audience"],
            "headline":      result["headline"],
            "daily_brief":   result["daily_brief"],
            "weekly_brief":  result["weekly_brief"],
            "card_comments": result["card_comments"],
            "insights":      result["insights"],
            "insight_pages": pages,
            "generated_at":  datetime.now(KST).isoformat(),
            "news_picks":    result["news_picks"],
            "model":         result["model"],
            "input_tokens":  result["input_tokens"],
            "output_tokens": result["output_tokens"],
            "generation_ms": result["generation_ms"],
        },
        on_conflict="briefing_date,audience",
    ).execute()
    if (not isinstance(response.data, list) or len(response.data) != 1
            or response.data[0].get("briefing_date") != briefing_date.isoformat()
            or response.data[0].get("audience") != result["audience"]):
        raise RuntimeError("briefing publication response could not be confirmed")


# ── 메인 실행 ─────────────────────────────────────────────────────────────────

async def run(
    target_date: date,
    dry_run: bool = False,
    audiences: list[str] | None = None,
) -> int:
    """
    브리핑 생성 메인 (Stage 8: audience별 입력 분리).
    반환값: upsert 성공 건수 (dry_run 시 0).
    """
    # Preserve direct-call defaults for [] and separate attempts for duplicates.
    target_audiences = list(audiences or AUDIENCES)

    db   = _supabase()
    anth = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    tracker = JobTracker(
        db,
        script="briefing_writer",
        label="데일리 브리핑 생성",
        target=len(target_audiences),
    )
    if not dry_run:
        await tracker.start()

    # 1. Audience별 입력 데이터 수집 (데이터 영역 분리)
    logger.info("briefing_inputs_start", date=target_date, audiences=target_audiences)
    _collect_fn = {
        "executive": collect_executive_inputs,
        "staff":     collect_staff_inputs,
        "cs":        collect_cs_inputs,
    }
    inputs_map: dict[str, dict] = {}
    for aud in target_audiences:
        inputs_map[aud] = _collect_fn[aud](db, target_date)
        logger.info(
            "briefing_inputs_collected",
            audience=aud,
            keys=[k for k in inputs_map[aud] if k not in ("date", "weekday")],
        )

    if dry_run:
        for aud in target_audiences:
            inputs = inputs_map[aud]
            print(f"\n{'='*60}")
            print(f"BRIEFING INPUTS [{aud.upper()}] — {target_date} ({inputs['weekday']})")
            print('='*60)
            for key, val in inputs.items():
                if key in ("date", "weekday"):
                    continue
                print(f"\n--- {key} ---")
                print(_j(val))
        print(f"\n{'='*60}")
        print("dry-run 완료: LLM 호출 및 DB 적재 건너뜀")
        return 0

    # 2. Audience 3종 병렬 생성 (각각 다른 inputs)
    tasks = [generate_briefing(aud, inputs_map[aud], anth) for aud in target_audiences]
    results: list = list(await asyncio.gather(*tasks, return_exceptions=True))

    # 3. 실패 audience 30분 후 1회 재시도
    failed_idx = [i for i, r in enumerate(results) if isinstance(r, Exception)]
    if failed_idx:
        failed_auds = [target_audiences[i] for i in failed_idx]
        logger.warning("briefing_retry_scheduled", failed=failed_auds, wait_min=5)
        await asyncio.sleep(5 * 60)
        retry_tasks = [
            generate_briefing(target_audiences[i], inputs_map[target_audiences[i]], anth)
            for i in failed_idx
        ]
        retry_results = list(await asyncio.gather(*retry_tasks, return_exceptions=True))
        for i, r in zip(failed_idx, retry_results):
            results[i] = r

    # 4. Prepare all details before any complete-revision publication.
    success_count = 0
    error_msgs: list[str] = []
    prepared_results = [r for r in results if not isinstance(r, (Exception, asyncio.CancelledError))]
    all_pages = await asyncio.gather(
        *[generate_insight_pages(r, inputs_map[r["audience"]], anth)
          for r in prepared_results],
        return_exceptions=True,
    )
    # Gather preserves order; audience names need not be unique for direct callers.
    page_results = iter(all_pages)

    for audience, r in zip(target_audiences, results):
        if isinstance(r, (Exception, asyncio.CancelledError)):
            diagnostic = _failure_diagnostic("summary", audience, r)
            error_msgs.append(diagnostic)
            logger.error(diagnostic)
            continue
        pages = next(page_results)
        if isinstance(pages, (Exception, asyncio.CancelledError)):
            diagnostic = _failure_diagnostic("details", audience, pages)
            error_msgs.append(diagnostic)
            logger.error(diagnostic)
            continue
        try:
            _upsert_briefing(db, r, target_date, pages)
            success_count += 1
            logger.info(
                "briefing_upserted",
                audience=r["audience"],
                in_tok=r["input_tokens"],
                out_tok=r["output_tokens"],
                ms=r["generation_ms"],
            )
        except Exception as e:
            diagnostic = _failure_diagnostic("publication", audience, e)
            error_msgs.append(diagnostic)
            logger.error(diagnostic)

    # 5. collection_jobs 상태 업데이트
    if tracker.job_id is not None:
        finished_at = datetime.now(KST).isoformat()
        if error_msgs and success_count == 0:
            await tracker.error("\n".join(error_msgs))
        elif error_msgs:
            db.table("collection_jobs").update({
                # The required run failed; confirmed audience outputs remain.
                "status":      "error",
                "rows_done":   success_count,
                "error_msg":   "\n".join(error_msgs)[:500],
                "finished_at": finished_at,
            }).eq("id", tracker.job_id).execute()
        else:
            await tracker.finish(rows_done=success_count)

    # 6. 전체 성공 시 daily_summary 구독자에게 알림 enqueue
    if success_count == len(target_audiences) and not dry_run:
        exec_result = next(
            (r for r in results if not isinstance(r, Exception) and r.get("audience") == "executive"),
            None,
        )
        exec_headline = exec_result["headline"] if exec_result else "오늘의 매거진이 도착했습니다"
        try:
            n_notified = enqueue_for_subscribers(
                event_type="daily_summary",
                title="오늘의 매거진 도착",
                body=exec_headline,
                link="/today",
                client=db,
            )
            logger.info("briefing_notification_sent", count=n_notified)
        except Exception as e:
            logger.warning(_failure_diagnostic("notification", "unknown", e))

    complete = success_count == len(target_audiences)
    log_outcome = logger.info if complete else logger.warning
    log_outcome(
        "briefing_run_done" if complete else "briefing_run_incomplete",
        date=target_date,
        success=success_count,
        requested=len(target_audiences),
        errors=len(error_msgs),
    )
    return success_count


def main() -> None:
    parser = argparse.ArgumentParser(description="UTTU 데일리 브리핑 생성 (Stage 8)")
    parser.add_argument(
        "--date",
        type=lambda s: date.fromisoformat(s),
        default=None,
        help="생성 날짜 YYYY-MM-DD (기본: 오늘 KST)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="audience별 입력 데이터 출력, LLM 호출·DB 적재 건너뜀",
    )
    parser.add_argument(
        "--audience",
        choices=AUDIENCES,
        default=None,
        help="특정 audience만 생성 (기본: 전체 3종)",
    )
    args = parser.parse_args()

    target_date      = args.date or _today_kst()
    target_audiences = [args.audience] if args.audience else list(AUDIENCES)

    try:
        n = asyncio.run(run(target_date, dry_run=args.dry_run, audiences=target_audiences))
    except Exception as exc:
        # Render safe diagnostics in the default message-only sink. Exception
        # text/traceback locals may contain credentials or dependency URLs.
        if isinstance(exc, KeyError):
            reason = "required configuration or briefing field is missing"
        elif isinstance(exc, (ValueError, TypeError)):
            reason = "invalid configuration or briefing data"
        elif isinstance(exc, OSError):
            reason = "dependency access failed"
        else:
            reason = "worker execution or publication tracking failed"
        logger.error("briefing_cli_failed: {kind}; {reason}",
                     kind=_failure_kind(exc), reason=reason)
        sys.exit(1)
    complete = args.dry_run or n == len(target_audiences)
    log_outcome = logger.info if complete else logger.error
    log_outcome(
        "briefing_cli_complete" if complete else "briefing_cli_incomplete",
        success=n,
        requested=len(target_audiences),
        dry_run=args.dry_run,
    )
    sys.exit(0 if complete else 1)


if __name__ == "__main__":
    main()
