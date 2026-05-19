-- 00002_brands.sql
-- 무신사 브랜드 마스터 (companies 참조)
-- slug = 무신사 brand_id (영문) — brand ranking API의 onClick.eventLog.ga4.payload.brand_id
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE brands (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        REFERENCES companies(id) ON DELETE SET NULL,
  musinsa_brand_id TEXT        UNIQUE,                   -- 무신사 내부 브랜드 코드 (숫자, 향후)
  slug             TEXT        UNIQUE NOT NULL,           -- 무신사 brand_id slug (영문, e.g. "arcteryx")
  name             TEXT        NOT NULL,                  -- 브랜드 한글명
  brand_image_url  TEXT,                                  -- 로고 이미지 (brand ranking titleURL)
  is_own           BOOLEAN     NOT NULL DEFAULT false,    -- 자사 브랜드 여부 (CO/LE/WA)
  erp_brand_code   TEXT,                                  -- ERP 브랜드 코드 (CO/LE/WA)
  detail_fetched_at TIMESTAMPTZ,                          -- 브랜드 상세 마지막 수집 시각
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX brands_company_idx   ON brands(company_id);
CREATE INDEX brands_is_own_idx    ON brands(is_own) WHERE is_own = true;
CREATE INDEX brands_erp_code_idx  ON brands(erp_brand_code) WHERE erp_brand_code IS NOT NULL;

COMMENT ON TABLE  brands                  IS '무신사 브랜드 마스터 — slug은 brand ranking ga4.payload.brand_id 값';
COMMENT ON COLUMN brands.slug             IS '무신사 brand_id (영문 slug) — ranking brands/{slug}, viewer /market/[slug]';
COMMENT ON COLUMN brands.brand_image_url  IS '브랜드 로고 — brand ranking title.imageUrl';
COMMENT ON COLUMN brands.is_own           IS '자사(B.CAVE) 브랜드 — CO(커버낫)/LE(리)/WA(와키윌리)';
COMMENT ON COLUMN brands.erp_brand_code   IS 'Snowflake BRANDCD (CO/LE/WA)';

-- Rollback:
-- DROP TABLE IF EXISTS brands;
