-- 00003_products.sql
-- 무신사 상품 마스터
-- 주의: current_price 컬럼 없음 — 가격은 ranking_snapshots LATERAL 조회
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE products (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID        REFERENCES brands(id) ON DELETE SET NULL,
  musinsa_no       TEXT        UNIQUE NOT NULL,         -- 무신사 상품번호
  name             TEXT        NOT NULL,                -- 상품명
  category_code    TEXT        NOT NULL DEFAULT '000',  -- 카테고리 코드 (000~020)
  gender           TEXT,                                -- 성별 (M/F/U)
  colors           TEXT[]      NOT NULL DEFAULT '{}',   -- 색상 목록 (빈 배열 가능)
  is_own           BOOLEAN     NOT NULL DEFAULT false,  -- 자사 상품 여부
  erp_style_code   TEXT,                                -- Snowflake STYLECD (자사만)
  detail_fetched_at TIMESTAMPTZ,                        -- 상품 상세 마지막 수집 시각
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX products_brand_idx       ON products(brand_id);
CREATE INDEX products_category_idx    ON products(category_code);
CREATE INDEX products_is_own_idx      ON products(is_own) WHERE is_own = true;
CREATE INDEX products_erp_style_idx   ON products(erp_style_code) WHERE erp_style_code IS NOT NULL;

COMMENT ON TABLE  products                IS '무신사 상품 마스터 — 가격은 ranking_snapshots LATERAL 조회';
COMMENT ON COLUMN products.colors         IS 'options API → COLOR_CHIP optionValues 파싱 결과';
COMMENT ON COLUMN products.erp_style_code IS 'Snowflake SW_STYLEINFO.STYLECD (자사 상품만)';

-- Rollback:
-- DROP TABLE IF EXISTS products;
