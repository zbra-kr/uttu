-- 00002_brands.sql
-- 무신사 브랜드 마스터 (companies 참조)
-- slug = 무신사 brand_id (영문) — brand ranking API의 onClick.eventLog.ga4.payload.brand_id
--
-- 수집 방법:
--   기본 등록: brand ranking API에서 slug + name + brand_image_url 자동 수집
--   상세 정보: httpx → www.musinsa.com/brand/{slug}
--             HTML 내 __NEXT_DATA__.props.pageProps.meta 파싱 (Playwright 불필요)
--             평균 소요: 1초/브랜드
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE brands (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        REFERENCES companies(id) ON DELETE SET NULL,
  musinsa_brand_id TEXT        UNIQUE,                   -- 무신사 내부 브랜드 코드 (숫자, 향후)

  -- ── 기본 식별 ────────────────────────────────────────────────────────────────
  slug             TEXT        UNIQUE NOT NULL,           -- brand_id slug (영문, e.g. "arcteryx")
  name             TEXT        NOT NULL,                  -- 브랜드 한글명 (brandName)
  name_eng         TEXT,                                  -- 브랜드 영문명 (brandNameEng)

  -- ── 브랜드 이미지 ────────────────────────────────────────────────────────────
  logo_url         TEXT,                                  -- 컬러 로고 (logoImageUrl / brand ranking imageUrl)
  white_logo_url   TEXT,                                  -- 흰색 로고 SVG (whiteLogoImageUrl)

  -- ── 브랜드 프로필 ────────────────────────────────────────────────────────────
  nation_code      TEXT,                                  -- 국가 코드 (brandNation: korea/germany/us 등)
  nation_name      TEXT,                                  -- 국가명 (brandNationName: 한국/독일 등)
  since_year       SMALLINT,                              -- 설립 연도 (since: 2017)
  introduction     TEXT,                                  -- 브랜드 소개글 (introduction)

  -- ── 서비스 유형 ──────────────────────────────────────────────────────────────
  service_type     TEXT,                                  -- FLAGSHIP / BRAND_SHOP
  flagship_type    TEXT,                                  -- TYPE_A / TYPE_B / TYPE_C (등급)
  is_used          BOOLEAN     NOT NULL DEFAULT false,    -- 중고거래 가능 여부 (isUsed)

  -- ── 자사 연결 ────────────────────────────────────────────────────────────────
  is_own           BOOLEAN     NOT NULL DEFAULT false,    -- 자사 브랜드 여부 (CO/LE/WA)
  erp_brand_code   TEXT,                                  -- Snowflake BRANDCD (CO/LE/WA)

  -- ── 메타 ────────────────────────────────────────────────────────────────────
  detail_fetched_at TIMESTAMPTZ,                          -- 브랜드 상세 마지막 수집 시각
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX brands_company_idx      ON brands(company_id);
CREATE INDEX brands_nation_idx       ON brands(nation_code) WHERE nation_code IS NOT NULL;
CREATE INDEX brands_service_type_idx ON brands(service_type) WHERE service_type IS NOT NULL;
CREATE INDEX brands_since_year_idx   ON brands(since_year) WHERE since_year IS NOT NULL;
CREATE INDEX brands_is_own_idx       ON brands(is_own) WHERE is_own = true;
CREATE INDEX brands_erp_code_idx     ON brands(erp_brand_code) WHERE erp_brand_code IS NOT NULL;

COMMENT ON TABLE  brands                IS '무신사 브랜드 마스터 — slug은 brand ranking ga4.payload.brand_id 값';
COMMENT ON COLUMN brands.slug           IS 'brand_id (영문 slug) — ranking brands/{slug}, viewer /market/[slug]';
COMMENT ON COLUMN brands.logo_url       IS '컬러 로고 — brand ranking title.imageUrl 또는 logoImageUrl';
COMMENT ON COLUMN brands.white_logo_url IS '흰색 로고 SVG — whiteLogoImageUrl';
COMMENT ON COLUMN brands.nation_code    IS 'brandNation: korea/germany/us/italy/france/japan 등';
COMMENT ON COLUMN brands.since_year     IS '브랜드 설립 연도 (since)';
COMMENT ON COLUMN brands.introduction   IS '브랜드 소개글 — 브랜드 페이지 introduction 필드';
COMMENT ON COLUMN brands.service_type   IS 'FLAGSHIP=플래그십(직매입/PB), BRAND_SHOP=일반 브랜드샵';
COMMENT ON COLUMN brands.flagship_type  IS 'TYPE_A > TYPE_B > TYPE_C (플래그십 등급, FLAGSHIP일 때만 의미 있음)';
COMMENT ON COLUMN brands.is_used        IS '무신사 유스드 중고거래 가능 브랜드 여부';
COMMENT ON COLUMN brands.is_own         IS '자사(B.CAVE) 브랜드 — CO(커버낫)/LE(리)/WA(와키윌리)';
COMMENT ON COLUMN brands.erp_brand_code IS 'Snowflake BRANDCD (CO/LE/WA)';

-- Rollback:
-- DROP TABLE IF EXISTS brands;
