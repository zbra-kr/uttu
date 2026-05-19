-- 00002_brands.sql
-- 무신사 브랜드 마스터 (companies 참조)
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE brands (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        REFERENCES companies(id) ON DELETE SET NULL,
  musinsa_brand_id TEXT      UNIQUE,                   -- 무신사 브랜드 코드
  name           TEXT        NOT NULL,                  -- 브랜드명
  slug           TEXT        UNIQUE NOT NULL,           -- URL slug (viewer 크로스링크용)
  is_own         BOOLEAN     NOT NULL DEFAULT false,    -- 자사 브랜드 여부 (CO/LE/WA)
  erp_brand_code TEXT,                                  -- ERP 브랜드 코드 (CO/LE/WA)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX brands_company_idx   ON brands(company_id);
CREATE INDEX brands_is_own_idx    ON brands(is_own) WHERE is_own = true;
CREATE INDEX brands_erp_code_idx  ON brands(erp_brand_code) WHERE erp_brand_code IS NOT NULL;

COMMENT ON TABLE  brands               IS '무신사 브랜드 마스터';
COMMENT ON COLUMN brands.is_own        IS '자사(B.CAVE) 브랜드 — CO(커버낫)/LE(리)/WA(와키윌리)';
COMMENT ON COLUMN brands.erp_brand_code IS 'Snowflake BRANDCD (CO/LE/WA)';
COMMENT ON COLUMN brands.slug          IS 'viewer /market/[slug] 라우팅용 — ROUTES 상수에서만 사용';

-- Rollback:
-- DROP TABLE IF EXISTS brands;
