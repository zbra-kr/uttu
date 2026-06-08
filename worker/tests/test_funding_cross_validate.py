"""
교차검증(cross-validate) 블랙박스 테스트 — merge_rounds 경유

4개 분기 검증:
  enrich  : 금액 일치 + 45일 이내 → 공시에 투자자 병합, 뉴스 폐기
  conflict: 같은 시점인데 금액 >10% 차이 → 뉴스 폐기
  keep    : 대응 공시 없음 → 뉴스 미검증 유지
  audit   : dart_audit 기준 같은 사업연도 → 병합 (날짜 45일 무관)

공시 라운드(confidence=1.0)는 어떤 경우에도 삭제·강등되지 않음.
"""
import pytest
from worker.funding.merge import merge_rounds

COMPANY_ID = "test-company-uuid"


def _make_dart(
    amount: int,
    date: str,
    source_ref: str,
    investors: list[str] | None = None,
    source_type: str = "dart_piic",
) -> dict:
    return {
        "round_type": "유상증자",
        "amount_krw": amount,
        "announced_date": date,
        "investors": investors or [],
        "source_type": source_type,
        "source_ref": source_ref,
        "confidence": 1.0,
        "raw": {},
    }


def _make_news(
    amount: int | None,
    date: str | None,
    source_ref: str,
    investors: list[str] | None = None,
    confidence: float = 0.7,
) -> dict:
    return {
        "round_type": "시리즈A",
        "amount_krw": amount,
        "announced_date": date,
        "investors": investors or ["뉴스투자자"],
        "source_type": "news",
        "source_ref": source_ref,
        "confidence": confidence,
        "raw": {},
    }


# ── enrich: 금액 일치 + 45일 이내 → 뉴스 폐기, 공시에 투자자 병합 ─────────────────

class TestEnrich:
    def test_news_dropped_dart_kept(self):
        dart = _make_dart(10_000_000_000, "2024-03-01", "dart:ref1", investors=["기존투자자"])
        news = _make_news(10_000_000_000, "2024-03-10", "news:url1", investors=["뉴스투자자"])

        result = merge_rounds([dart, news], COMPANY_ID)

        # 뉴스 라운드 폐기 (source_ref 기준)
        refs = [r["source_ref"] for r in result]
        assert "news:url1" not in refs, "뉴스 라운드가 폐기되어야 함"

    def test_dart_investors_merged(self):
        dart = _make_dart(10_000_000_000, "2024-03-01", "dart:ref1", investors=["기존투자자"])
        news = _make_news(10_000_000_000, "2024-03-10", "news:url1", investors=["뉴스투자자"])

        result = merge_rounds([dart, news], COMPANY_ID)

        dart_out = next(r for r in result if r["source_ref"] == "dart:ref1")
        assert "뉴스투자자" in dart_out["investors"], "뉴스 투자자가 공시에 병합되어야 함"
        assert "기존투자자" in dart_out["investors"], "기존 투자자 유지되어야 함"

    def test_dart_confidence_unchanged(self):
        dart = _make_dart(10_000_000_000, "2024-03-01", "dart:ref1")
        news = _make_news(10_000_000_000, "2024-03-10", "news:url1")

        result = merge_rounds([dart, news], COMPANY_ID)

        dart_out = next(r for r in result if r["source_ref"] == "dart:ref1")
        assert dart_out["confidence"] == 1.0, "공시 confidence 는 강등 불가"

    def test_within_45days(self):
        """44일 차이 → 여전히 enrich."""
        dart = _make_dart(10_000_000_000, "2024-01-01", "dart:ref2")
        news = _make_news(10_000_000_000, "2024-02-14", "news:url2")  # 44일 차

        result = merge_rounds([dart, news], COMPANY_ID)
        refs = [r["source_ref"] for r in result]
        assert "news:url2" not in refs


# ── conflict: 같은 시점 금액 >10% 차이 → 뉴스 폐기 ───────────────────────────────

class TestConflict:
    def test_conflict_news_dropped(self):
        dart = _make_dart(10_000_000_000, "2024-03-01", "dart:ref3")
        news = _make_news(15_000_000_000, "2024-03-10", "news:url3")  # 50% 차이

        result = merge_rounds([dart, news], COMPANY_ID)
        refs = [r["source_ref"] for r in result]
        assert "news:url3" not in refs, "충돌 뉴스는 폐기되어야 함"

    def test_conflict_dart_kept(self):
        dart = _make_dart(10_000_000_000, "2024-03-01", "dart:ref3")
        news = _make_news(15_000_000_000, "2024-03-10", "news:url3")

        result = merge_rounds([dart, news], COMPANY_ID)
        refs = [r["source_ref"] for r in result]
        assert "dart:ref3" in refs, "공시 라운드는 충돌 시에도 유지되어야 함"

    def test_exactly_10pct_not_conflict(self):
        """10% 차이 → conflict 임계에 걸리지 않음 (≤0.10 은 enrich)."""
        dart = _make_dart(10_000_000_000, "2024-03-01", "dart:ref4")
        news = _make_news(11_000_000_000, "2024-03-10", "news:url4")  # 정확히 10%

        result = merge_rounds([dart, news], COMPANY_ID)
        refs = [r["source_ref"] for r in result]
        # 10% 이내는 enrich → 뉴스 폐기, 공시 유지
        assert "news:url4" not in refs


# ── keep: 대응 공시 없음 → 뉴스 미검증 유지 ───────────────────────────────────────

class TestKeep:
    def test_news_kept_when_no_matching_dart(self):
        """공시와 날짜가 1년 이상 차이 나면 매칭 없음 → 뉴스 유지."""
        dart = _make_dart(10_000_000_000, "2022-01-01", "dart:ref5")
        news = _make_news(5_000_000_000, "2024-06-01", "news:url5")

        result = merge_rounds([dart, news], COMPANY_ID)
        refs = [r["source_ref"] for r in result]
        assert "news:url5" in refs, "대응 공시 없는 뉴스는 유지되어야 함"
        assert "dart:ref5" in refs, "공시도 유지되어야 함"

    def test_news_kept_confidence_unchanged(self):
        dart = _make_dart(10_000_000_000, "2022-01-01", "dart:ref5b")
        news = _make_news(5_000_000_000, "2024-06-01", "news:url5b", confidence=0.7)

        result = merge_rounds([dart, news], COMPANY_ID)
        news_out = next((r for r in result if r["source_ref"] == "news:url5b"), None)
        assert news_out is not None
        assert news_out["confidence"] == 0.7, "유지된 뉴스 confidence 변경 불가"


# ── audit 연도 매칭: dart_audit → 같은 사업연도이면 병합 ───────────────────────────

class TestAuditYearMatch:
    def test_same_fiscal_year_merged(self):
        """dart_audit 은 날짜 정밀도가 연 단위 — 같은 연도이면 뉴스 병합."""
        audit = _make_dart(
            10_000_000_000, "2023-12-31", "audit:01449428:2023",
            source_type="dart_audit",
        )
        news = _make_news(10_000_000_000, "2023-05-15", "news:url6")  # 같은 연도, 230일 차

        result = merge_rounds([audit, news], COMPANY_ID)
        refs = [r["source_ref"] for r in result]
        assert "news:url6" not in refs, "같은 사업연도 뉴스는 audit에 병합되어야 함"

    def test_different_fiscal_year_kept(self):
        audit = _make_dart(
            10_000_000_000, "2023-12-31", "audit:01449428:2023",
            source_type="dart_audit",
        )
        news = _make_news(10_000_000_000, "2024-05-15", "news:url7")  # 다른 연도

        result = merge_rounds([audit, news], COMPANY_ID)
        refs = [r["source_ref"] for r in result]
        assert "news:url7" in refs, "다른 사업연도 뉴스는 별도 유지되어야 함"


# ── 공시 불변성 보장 ───────────────────────────────────────────────────────────────

class TestAuthoritativeInvariant:
    def test_dart_never_deleted(self):
        """어떤 교차검증 결과에도 confidence=1.0 공시 라운드는 남아있어야 한다."""
        dart = _make_dart(10_000_000_000, "2024-03-01", "dart:invariant")
        news1 = _make_news(10_000_000_000, "2024-03-10", "news:match")   # enrich 케이스
        news2 = _make_news(20_000_000_000, "2024-03-05", "news:conflict")  # conflict
        news3 = _make_news(5_000_000_000, "2020-01-01", "news:keep")    # keep

        result = merge_rounds([dart, news1, news2, news3], COMPANY_ID)
        dart_rounds = [r for r in result if r.get("source_ref") == "dart:invariant"]
        assert len(dart_rounds) == 1, "공시 라운드는 정확히 1건 유지"
        assert dart_rounds[0]["confidence"] == 1.0
