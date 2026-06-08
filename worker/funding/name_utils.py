"""
회사명 정규화 · 매칭 공용 헬퍼

funding_extractor.py 와 news_source.py 양쪽에서 사용.
substring(`in`) 직접 비교는 이 모듈 밖에서 절대 사용하지 않는다.
"""
from __future__ import annotations

import re

# ── 상수 ────────────────────────────────────────────────────────────────────────

# 토큰 뒤에 바로 붙어도 단어 경계로 허용하는 한글 조사 (1자)
_JOSA = frozenset("가나는은를을이의에도와과로서면며고나야")

# 법인 어휘: 정규화 시 제거
_LEGAL_TOKENS = [
    "주식회사", "㈜", "(주)", "유한회사", "유한책임회사",
    "합자회사", "합명회사",
    " inc", " corp", " co.", " ltd", " llc",
]

# high-risk 1차: 이 길이 이하는 무조건 짧은 이름 (한국어 2자 이하는 너무 범용)
# 3자 이상은 대부분 충분히 고유함 — 에이피알·커버낫·무신사 등 false-positive 방지
_HIGH_RISK_MAX_LEN = 2

# high-risk 2차: 길이 무관하지만 범용 일반어라 동명이인 오탐 가능성 높은 단어 (최소화)
# ⚠️ 이 사전은 len>2 에도 high-risk를 적용하는 예외 케이스만 — 과설계 금지
_COMMON_GENERIC: frozenset[str] = frozenset([
    "레이어", "베이스", "플러스", "메타", "스타일", "데이", "코어",
])


# ── 내부 헬퍼 ───────────────────────────────────────────────────────────────────

def normalize_company(s: str) -> str:
    """
    회사명 정규화.
    법인 접두·접미어 제거 → 소문자 → 공백·특수문자·영문 괄호 제거.
    """
    s = s.strip().lower()
    for tok in _LEGAL_TOKENS:
        s = s.replace(tok.lower(), "")
    # "(apr)", "(childy co., ltd.)" 같은 괄호 영문 제거
    s = re.sub(r"\([a-z0-9\s\.\-,]+\)", "", s)
    # 공백·특수문자·구두점 제거
    s = re.sub(r"[\s\-_()+·.]+", "", s)
    return s.strip()


# ── 공개 함수 ────────────────────────────────────────────────────────────────────

def name_equals(a: str, b: str) -> bool:
    """
    두 회사명을 정규화한 후 **완전 일치** 여부 반환.

    Parameters
    ----------
    a, b : 원본 회사명 (정규화 전)

    Returns
    -------
    bool — 정규화 후 완전 일치하면 True, 아니면 False.
           부분 일치(substring)는 True 로 처리하지 않는다.
    """
    na, nb = normalize_company(a), normalize_company(b)
    if not na or not nb:
        return False
    return na == nb


def name_in_text(name: str, text: str) -> bool:
    """
    토큰 경계 기반으로 name 이 text 에 등장하는지 검사.

    "레이어" 검색 시 "레이어제로" 는 불일치, "레이어가" 는 일치.

    앞 경계
    -------
    매칭 직전 문자가 한글 또는 영숫자이면 불일치.
    (예: "주식레이어" 에서 직전 '식'이 한글 → 불일치)

    뒤 경계
    -------
    매칭 직후 문자가 한글이면 _JOSA 화이트리스트 한정 허용.
      · 조사(가/는/은/를/을/이/의 등) → 일치
      · 그 외 한글(제/드/컷 등) → 불일치 → "레이어제로/레이어드" 컷
    매칭 직후 문자가 영숫자이면 불일치 (예: "LayerZero").
    그 외(공백·구두점·끝) → 일치.
    """
    if not name or not text:
        return False

    name_len = len(name)
    start = 0

    while True:
        idx = text.find(name, start)
        if idx == -1:
            return False

        # 앞 경계 검사
        if idx > 0:
            ch_before = text[idx - 1]
            if re.match(r"[가-힣a-zA-Z0-9]", ch_before):
                start = idx + 1
                continue

        # 뒤 경계 검사
        end = idx + name_len
        if end < len(text):
            ch_after = text[end]
            if "가" <= ch_after <= "힣":
                if ch_after not in _JOSA:
                    start = idx + 1
                    continue
            elif re.match(r"[a-zA-Z0-9]", ch_after):
                start = idx + 1
                continue

        return True


def is_high_risk(core_name: str) -> bool:
    """
    정규화되지 않은 핵심 이름이 짧거나 일반어면 True.

    high-risk = 동명이인 오탐 가능성이 높아 보조 디스앰비규에이터가 필요.
    **1차 방어는 _match_company 완전일치**. 이 분류는 보조 방어 전용.

    분류 기준
    ---------
    · ≤2자 : 한국어 2자 이하는 너무 범용 (원/결/루 등)
    · _COMMON_GENERIC : 3자↑이라도 범용 일반어 (레이어/베이스/메타 등)

    ⚠️ 일반 고유명사(에이피알·커버낫·무신사 등)는 False — recall 보존.
    이 분류는 뉴스 라운드에만 영향. 공시 라운드(dart_*) 무관.
    """
    return len(core_name) <= _HIGH_RISK_MAX_LEN or core_name in _COMMON_GENERIC
