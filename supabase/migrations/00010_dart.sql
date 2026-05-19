-- 00010_dart.sql
-- DART 공시·재무제표 (상장 49사 + 비상장 45사 = 98사)
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

-- 공시 목록
CREATE TABLE dart_disclosures (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rcept_no        TEXT        UNIQUE NOT NULL,          -- DART 접수번호
  report_nm       TEXT        NOT NULL,                 -- 공시명
  rcept_dt        DATE        NOT NULL,                 -- 접수일
  flr_nm          TEXT,                                 -- 제출인명
  rm              TEXT,                                 -- 비고 (유·무)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dart_disclosures_company_idx ON dart_disclosures(company_id, rcept_dt DESC);
CREATE INDEX dart_disclosures_date_idx    ON dart_disclosures(rcept_dt DESC);

-- 재무제표 (상장사: finstate API / 비상장사: 감사보고서 XML 파싱)
CREATE TABLE dart_financials (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year         SMALLINT    NOT NULL,             -- 사업연도 (예: 2024)
  revenue             BIGINT,                           -- 매출액 (원)
  operating_income    BIGINT,                           -- 영업이익 (원)
  net_income          BIGINT,                           -- 당기순이익 (원)
  total_assets        BIGINT,                           -- 자산총계 (원)
  total_liabilities   BIGINT,                           -- 부채총계 (원)
  data_source         TEXT        NOT NULL,             -- 'finstate_api' | 'audit_report_xml'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT dart_financials_uq UNIQUE (company_id, fiscal_year, data_source)
);

CREATE INDEX dart_financials_company_year_idx
  ON dart_financials(company_id, fiscal_year DESC);

COMMENT ON TABLE  dart_disclosures              IS 'DART 공시 목록 — 매주 일요일 06시 수집';
COMMENT ON TABLE  dart_financials               IS 'DART 재무제표 — 상장사 finstate_api, 비상장사 audit_report_xml';
COMMENT ON COLUMN dart_financials.data_source   IS 'finstate_api(상장사) | audit_report_xml(비상장사 감사보고서)';

-- Rollback:
-- DROP TABLE IF EXISTS dart_financials;
-- DROP TABLE IF EXISTS dart_disclosures;
