# 법인(companies) 테이블 설계

> 2026-05-19 실측 기반. 무신사 상품 상세에서 company 객체 추출 → DART 연결.

---

## 데이터 흐름

```
상품 상세 수집
  ↓
window.__MSS__.product.state.company 추출
  ↓
companies 테이블 upsert (business_number 기준)
  ↓
brands.company_id 자동 연결
  ↓
DART API → business_number로 corp_code 조회 → 채움
  ↓
dart_disclosures / dart_financials 수집
```

---

## 수집 방법

| 단계 | 트리거 | 방법 | 수집 항목 |
|---|---|---|---|
| **자동 등록** | 상품 상세 수집 시 신규 회사 발견 | `state.company` 객체 파싱 | business_number, corp_name, ceo_name, address, phone, email, mail_order_no |
| **DART 연결** | 별도 배치 | DART API → business_number로 corp_code 조회 | corp_code, stock_code, is_listed |

---

## 수집 가능 항목 (상품 상세 company 객체)

| 필드 (API) | 컬럼 | 예시 |
|---|---|---|
| `name` | `corp_name` | (주)제이씨패밀리 |
| `ceoName` | `ceo_name` | 김예철 |
| `businessNumber` | `business_number` | 2118658580 |
| `mailOrderReportNumber` | `mail_order_no` | 2017-서울성동-1359 |
| `phoneNumber` | `phone` | 0220156000 |
| `email` | `email` | pyoyopyo@jcfamily.co.kr |
| `address` | `address` | 서울특별시 성동구 ... |

> ※ 브랜드 페이지에는 회사 정보 없음 — 상품 상세에서만 수집 가능

---

## DART 연결 항목

| 컬럼 | 출처 | 비고 |
|---|---|---|
| `corp_code` | DART API | 8자리 고유번호 — business_number로 조회 |
| `stock_code` | DART API | KRX 종목코드 (상장사만) |
| `is_listed` | DART API | 상장 여부 |
| `dart_fetched_at` | 내부 | DART 조회 완료 시각 (NULL=미조회) |

---

## 마이그레이션 파일

[supabase/migrations/00001_companies.sql](../../supabase/migrations/00001_companies.sql)

---

## 스크래핑 패턴

```python
def _extract_company(state: dict) -> dict | None:
    company = state.get("company", {})
    biz_no = company.get("businessNumber")
    if not biz_no:
        return None
    return {
        "corp_name":        company.get("name", ""),
        "business_number":  biz_no,
        "ceo_name":         company.get("ceoName"),
        "address":          company.get("address"),
        "phone":            company.get("phoneNumber"),
        "email":            company.get("email"),
        "mail_order_no":    company.get("mailOrderReportNumber"),
    }
```

### DB upsert 패턴

```python
def upsert_company(client, data: dict) -> str | None:
    """business_number 기준 upsert. company UUID 반환."""
    result = (
        client.table("companies")
        .upsert(data, on_conflict="business_number")
        .execute()
    )
    rows = result.data
    return rows[0]["id"] if rows else None
```
