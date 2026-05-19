-- 00001_companies.sql
-- 무신사 인기 브랜드를 보유한 회사 (법인 마스터)
--
-- 데이터 흐름:
--   1. 상품 상세 수집 → company.businessNumber 추출
--   2. companies upsert (business_number 기준)
--   3. brands.company_id 자동 연결
--   4. DART 수집 → business_number로 corp_code 조회 후 채움
--   5. dart_disclosures / dart_financials 수집
--
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE companies (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── 법인 기본 정보 ────────────────────────────────────────────────────────────
  corp_name        TEXT        NOT NULL,                   -- 법인명 (company.name)
  business_number  TEXT        UNIQUE,                     -- 사업자번호 (company.businessNumber, 10자리)
  ceo_name         TEXT,                                   -- 대표자명 (company.ceoName)
  address          TEXT,                                   -- 주소 (company.address)
  phone            TEXT,                                   -- 전화번호 (company.phoneNumber)
  email            TEXT,                                   -- 이메일 (company.email)
  mail_order_no    TEXT,                                   -- 통신판매업신고번호 (company.mailOrderReportNumber)

  -- ── DART 연결 ────────────────────────────────────────────────────────────────
  corp_code        TEXT        UNIQUE,                     -- DART 고유번호 (8자리, business_number로 조회)
  stock_code       TEXT,                                   -- KRX 종목코드 (상장사만)
  is_listed        BOOLEAN     NOT NULL DEFAULT false,     -- 상장 여부

  -- ── 기타 ─────────────────────────────────────────────────────────────────────
  website          TEXT,
  dart_fetched_at  TIMESTAMPTZ,                            -- DART corp_code 마지막 조회 시각
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX companies_business_number_idx ON companies(business_number) WHERE business_number IS NOT NULL;
CREATE INDEX companies_corp_code_idx       ON companies(corp_code) WHERE corp_code IS NOT NULL;
CREATE INDEX companies_listed_idx          ON companies(is_listed);

COMMENT ON TABLE  companies                   IS '무신사 브랜드 보유 법인 — 상품 상세 company.businessNumber로 자동 수집';
COMMENT ON COLUMN companies.business_number   IS '사업자번호 (10자리) — 상품 상세 window.__MSS__.product.state.company.businessNumber';
COMMENT ON COLUMN companies.mail_order_no     IS '통신판매업신고번호 — company.mailOrderReportNumber';
COMMENT ON COLUMN companies.corp_code         IS 'DART 고유번호 (8자리) — business_number로 DART API 조회 후 채움';
COMMENT ON COLUMN companies.stock_code        IS 'KRX 종목코드 (상장사만)';
COMMENT ON COLUMN companies.dart_fetched_at   IS 'DART corp_code 조회 완료 시각 (NULL=미조회)';

-- Rollback:
-- DROP TABLE IF EXISTS companies;
