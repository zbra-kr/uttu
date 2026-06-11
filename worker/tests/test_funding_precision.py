"""
투자정보 수집 정밀도 회귀 테스트

케이스1 (차단): enetnews 50781 핵심 문장 픽스처
  타깃 "주식회사 레이어" → substring·펀딩키워드 도배에도 채택 0건.

케이스2 (recall 보존): 정상 기사 픽스처
  타깃이 실제 투자 주체 → 채택 통과.

LLM 호출 없이 게이트·매칭 함수만 단위 테스트.
"""
from worker.agent.funding_extractor import _match_company
from worker.funding.name_utils import (
    is_high_risk,
    name_equals,
    name_in_text,
    normalize_company,
)
from worker.funding.news_source import (
    _core_name,
    _passes_disambiguator,
    _passes_funding_gate,
)

# ── 픽스처 ───────────────────────────────────────────────────────────────────────

# enetnews 50781 핵심 문장 (저작권 배제 — 기사 주체·기술명 문장만 발췌)
_BODY_50781 = (
    "오픈그라디언트(OpenGradient)가 950만달러 규모의 시리즈A 투자유치에 성공했다. "
    "오픈그라디언트는 레이어제로(LayerZero) 기술 기반의 AI 솔루션을 개발하는 "
    "스타트업으로 본 라운드를 통해 총 2000만달러의 누적 투자를 달성했다."
)

# 정상 기사: 타깃이 실제 투자 주체
_BODY_NORMAL = (
    "에이피알이 300억원 규모의 시리즈B 투자유치를 완료했다. "
    "이번 라운드에는 IMM인베스트먼트와 스틱인베스트먼트가 참여했으며, "
    "에이피알은 이 자금을 해외 시장 확장에 활용할 예정이다."
)


# ── name_utils 단위 테스트 ────────────────────────────────────────────────────────

class TestNormalizeCompany:
    def test_removes_legal_prefix(self):
        assert normalize_company("주식회사 레이어") == "레이어"

    def test_removes_legal_suffix(self):
        assert normalize_company("레이어주식회사") == "레이어"

    def test_removes_parentheses_english(self):
        assert normalize_company("차일디(CHILDY Co., Ltd.)") == "차일디"

    def test_lowercase(self):
        assert normalize_company("APR주식회사") == "apr"


class TestNameEquals:
    def test_same_company(self):
        assert name_equals("주식회사 레이어", "레이어") is True

    def test_different_company(self):
        assert name_equals("레이어제로", "레이어") is False

    def test_open_gradient_vs_layer(self):
        assert name_equals("오픈그라디언트", "주식회사 레이어") is False

    def test_empty(self):
        assert name_equals("", "레이어") is False


class TestNameInText:
    def test_rejects_substring_in_compound(self):
        """레이어제로 안의 레이어는 불일치해야 한다."""
        assert name_in_text("레이어", "레이어제로(LayerZero) 기술") is False

    def test_rejects_layerzero_body(self):
        assert name_in_text("레이어", _BODY_50781) is False

    def test_accepts_josa(self):
        """레이어가/레이어는 — 조사 뒤 토큰 경계 허용."""
        assert name_in_text("레이어", "레이어가 투자유치를 완료했다.") is True

    def test_accepts_josa_는(self):
        assert name_in_text("레이어", "레이어는 시리즈A를 유치했다.") is True

    def test_accepts_word_boundary_space(self):
        assert name_in_text("에이피알", "에이피알 300억원 투자") is True

    def test_rejects_english_suffix(self):
        """LayerZero — 영문자가 바로 붙으면 불일치."""
        assert name_in_text("Layer", "LayerZero protocol") is False

    def test_rejects_hangul_before(self):
        """앞 문자가 한글이면 불일치."""
        assert name_in_text("레이어", "주식레이어가 투자") is False

    def test_accepts_at_start(self):
        assert name_in_text("레이어", "레이어 관련 기사") is True


class TestIsHighRisk:
    def test_two_chars(self):
        assert is_high_risk("루트") is True   # ≤2자

    def test_common_generic_three_chars(self):
        assert is_high_risk("레이어") is True   # _COMMON_GENERIC (3자지만 범용어)

    def test_four_chars_not_high_risk(self):
        assert is_high_risk("에이피알") is False  # 4자 고유명사 → False (recall 보존)

    def test_long_name(self):
        assert is_high_risk("오픈그라디언트") is False  # 7자


# ── 케이스1: enetnews 50781 차단 ─────────────────────────────────────────────────

class TestCase1Block:
    TARGET = "주식회사 레이어"

    def test_gate_rejects_50781(self):
        """_passes_funding_gate 가 50781 본문을 차단해야 한다."""
        core = _core_name(self.TARGET)
        assert _passes_funding_gate(_BODY_50781, core) is False

    def test_match_rejects_opengradienet(self):
        """추출 주체가 오픈그라디언트이면 레이어 타깃에 불일치."""
        r = {"company": "오픈그라디언트"}
        assert _match_company(r, self.TARGET) is False

    def test_match_rejects_layerzero(self):
        """추출 주체가 레이어제로이면 레이어 타깃에 불일치 (substring 아님)."""
        r = {"company": "레이어제로"}
        assert _match_company(r, self.TARGET) is False

    def test_match_rejects_empty_company(self):
        """company 필드 없으면 False (주체 확인 불가)."""
        r = {"company": ""}
        assert _match_company(r, self.TARGET) is False

    def test_match_rejects_none_company(self):
        r = {"company": None}
        assert _match_company(r, self.TARGET) is False


# ── 케이스2: recall 보존 ──────────────────────────────────────────────────────────

class TestCase2Recall:
    TARGET = "에이피알"

    def test_gate_passes_normal(self):
        """에이피알 정상 기사는 게이트를 통과해야 한다."""
        core = _core_name(self.TARGET)
        assert _passes_funding_gate(_BODY_NORMAL, core) is True

    def test_match_passes_exact(self):
        """추출 주체가 에이피알이면 타깃과 일치."""
        r = {"company": "에이피알"}
        assert _match_company(r, self.TARGET) is True

    def test_match_passes_with_legal(self):
        """주식회사 에이피알 → 정규화 후 에이피알과 일치."""
        r = {"company": "주식회사 에이피알"}
        assert _match_company(r, self.TARGET) is True


# ── 케이스3: 긴 이름 정상 채택 ───────────────────────────────────────────────────

_BODY_NORMAL_LONG = (
    "오픈그라디언트가 1000억원 규모의 시리즈C 투자유치를 완료했다. "
    "이번 라운드에는 IMM인베스트먼트와 한국투자파트너스가 참여했으며, "
    "오픈그라디언트는 이 자금을 글로벌 사업 확장에 사용할 예정이다."
)


class TestCase3NormalLong:
    TARGET = "오픈그라디언트"  # 7자 — not high-risk

    def test_not_high_risk(self):
        assert is_high_risk(_core_name(self.TARGET)) is False

    def test_gate_passes(self):
        core = _core_name(self.TARGET)
        assert _passes_funding_gate(_BODY_NORMAL_LONG, core) is True

    def test_match_passes_exact(self):
        r = {"company": "오픈그라디언트"}
        assert _match_company(r, self.TARGET) is True


# ── 케이스4: high-risk + investors → 채택 ────────────────────────────────────────

_BODY_HIGH_RISK_INVESTORS = (
    "루트가 50억원 규모의 시드 투자유치를 완료했다. "
    "이번 라운드에는 카카오벤처스가 단독 참여했다."
)


class TestCase4HighRiskWithInvestors:
    TARGET = "루트"  # 2자 — high-risk by length

    def test_is_high_risk(self):
        assert is_high_risk(_core_name(self.TARGET)) is True

    def test_disambiguator_passes_with_investors(self):
        """investors ≥ 1이면 브랜드 언급 없어도 채택."""
        r = {"company": "루트", "investors": ["카카오벤처스"]}
        assert _passes_disambiguator(r, _BODY_HIGH_RISK_INVESTORS, []) is True

    def test_disambiguator_rejects_no_brand_no_investors(self):
        """브랜드도 없고 투자자도 없으면 차단."""
        r = {"company": "루트", "investors": []}
        body = "루트가 50억원 투자를 받았다."
        assert _passes_disambiguator(r, body, []) is False

    def test_disambiguator_passes_with_brand(self):
        """브랜드명이 본문에 등장하면 채택 (투자자 없어도)."""
        r = {"company": "루트", "investors": []}
        body = "루트 브랜드가 50억원 투자를 받았다."
        assert _passes_disambiguator(r, body, ["루트"]) is True
