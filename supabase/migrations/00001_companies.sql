-- 00001_companies.sql
-- 무신사 인기 브랜드를 보유한 회사 (상장 49사 + 비상장 45사 = 98사)
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE companies (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  corp_name     TEXT        NOT NULL,                   -- 법인명
  corp_code     TEXT        UNIQUE,                     -- DART 고유번호
  stock_code    TEXT,                                   -- 종목코드 (상장사만)
  is_listed     BOOLEAN     NOT NULL DEFAULT false,     -- 상장 여부
  ceo_name      TEXT,
  address       TEXT,
  website       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX companies_corp_code_idx ON companies(corp_code) WHERE corp_code IS NOT NULL;
CREATE INDEX companies_listed_idx    ON companies(is_listed);

COMMENT ON TABLE  companies              IS '무신사 인기 브랜드 보유 법인 (상장 49 + 비상장 45)';
COMMENT ON COLUMN companies.corp_code   IS 'DART 고유번호 (8자리)';
COMMENT ON COLUMN companies.stock_code  IS 'KRX 종목코드 (상장사만)';

-- Rollback:
-- DROP TABLE IF EXISTS companies;
