-- 00003_products.sql
-- 무신사 상품 마스터
-- 주의: current_price 컬럼 없음 — 가격은 ranking_snapshots LATERAL 조회
--
-- 수집 방법:
--   기본 정보 (name~ranking_best_records):
--     httpx → www.musinsa.com/products/{id}
--     HTML 내 window.__MSS__.product.state JSON 파싱 (Playwright 불필요)
--     평균 소요: 1~2초/상품
--   색상·사이즈 옵션 (colors, sizes):
--     Playwright → goods-detail.musinsa.com/api2/goods/{id}/options
--     평균 소요: 18초/상품 (자사 상품 위주 수집 권장)
--
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE products (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID        REFERENCES brands(id) ON DELETE SET NULL,
  musinsa_no       TEXT        UNIQUE NOT NULL,

  -- 자사 연결
  is_own           BOOLEAN     NOT NULL DEFAULT false,
  erp_style_code   TEXT,                                    -- Snowflake STYLECD (자사만)

  -- ── 기본 식별 정보 ──────────────────────────────────────────────────────────
  name             TEXT        NOT NULL,                    -- goodsNm (한글)
  name_eng         TEXT,                                    -- goodsNmEng (영문)
  style_no         TEXT,                                    -- styleNo (브랜드 자체 스타일번호)
  thumbnail_url    TEXT,                                    -- thumbnailImageUrl

  -- ── 카테고리 ────────────────────────────────────────────────────────────────
  category_code    TEXT        NOT NULL DEFAULT '000',      -- depth1 코드 (000~020)
  category_d2_code TEXT,                                    -- depth2 코드
  category_d2_name TEXT,                                    -- depth2 명
  category_d3_code TEXT,                                    -- depth3 코드 (있는 경우만)
  category_d3_name TEXT,                                    -- depth3 명 (있는 경우만)
  category_path    TEXT,                                    -- "Clothing > 바지 > 코튼 팬츠"

  -- ── 성별 / 시즌 ──────────────────────────────────────────────────────────────
  gender           TEXT,                                    -- M=남성, F=여성, U=공용 (sexCode 기반)
  season_year      TEXT,                                    -- "2024" / "" = 시즌리스
  season_code      TEXT,                                    -- "1"=SS, "2"=FW, ""=없음

  -- ── 상품 특성 (goodsMaterial — 의류 전용, 비의류는 NULL) ─────────────────────
  fit              TEXT,                                    -- 스키니/슬림/레귤러/루즈/오버사이즈
  texture          TEXT,                                    -- 부드러움/보통/뻣뻣함 등
  elasticity       TEXT,                                    -- 없음/거의없음/보통/약간있음/있음
  transparency     TEXT,                                    -- 있음/약간있음/보통/거의없음/없음
  thickness        TEXT,                                    -- 얇음/약간얇음/보통/약간두꺼움/두꺼움
  item_seasons     TEXT[]      NOT NULL DEFAULT '{}',       -- ['봄','여름','가을','겨울'] (계절)

  -- ── 특수 플래그 (수집 시점 기준, updated_at으로 최신성 확인) ──────────────────
  is_musinsa_monopoly  BOOLEAN NOT NULL DEFAULT false,      -- 무신사 단독 (전 채널)
  is_online_monopoly   BOOLEAN NOT NULL DEFAULT false,      -- 온라인 단독
  is_first             BOOLEAN NOT NULL DEFAULT false,      -- 신규 출시 (첫 등록)
  is_clearance         BOOLEAN NOT NULL DEFAULT false,      -- 클리어런스 (재고 처리)
  is_outlet            BOOLEAN NOT NULL DEFAULT false,      -- 아울렛
  is_limited_quantity  BOOLEAN NOT NULL DEFAULT false,      -- 한정수량
  is_drop              BOOLEAN NOT NULL DEFAULT false,      -- 드롭 상품
  is_adult             BOOLEAN NOT NULL DEFAULT false,      -- 성인 상품
  is_parallel_import   BOOLEAN NOT NULL DEFAULT false,      -- 병행수입
  is_free_return       BOOLEAN NOT NULL DEFAULT false,      -- 무료반품

  -- ── 레이블 ──────────────────────────────────────────────────────────────────
  labels           TEXT[]      NOT NULL DEFAULT '{}',       -- labels[].code 배열
                                                            -- e.g. ['exclusive-musinsa','outlet']

  -- ── 리뷰 요약 (수집 시점 스냅샷, 일별 갱신) ────────────────────────────────
  review_count     INTEGER     NOT NULL DEFAULT 0,          -- goodsReview.totalCount
  satisfaction_score NUMERIC(3,1),                          -- goodsReview.satisfactionScore (4.9)

  -- ── 랭킹 이력 (rankingRecord — 월별 카테고리 최고 순위 기록) ──────────────────
  ranking_best_records JSONB   NOT NULL DEFAULT '[]',
  -- [{rank, gender, depth1CategoryCode, depth1CategoryName,
  --   depth2CategoryCode, depth2CategoryName, year, month, depth}]

  -- ── 색상 / 사이즈 옵션 (Playwright goods-detail/options API) ─────────────────
  colors           TEXT[]      NOT NULL DEFAULT '{}',       -- COLOR_CHIP optionValues[].name
  sizes            TEXT[]      NOT NULL DEFAULT '{}',       -- 사이즈 옵션 목록

  -- ── 메타 ────────────────────────────────────────────────────────────────────
  detail_fetched_at TIMESTAMPTZ,                            -- 상세(httpx) 마지막 수집
  options_fetched_at TIMESTAMPTZ,                           -- 옵션(Playwright) 마지막 수집
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 핵심 인덱스
CREATE INDEX products_brand_idx        ON products(brand_id);
CREATE INDEX products_category_idx     ON products(category_code);
CREATE INDEX products_category_d2_idx  ON products(category_d2_code) WHERE category_d2_code IS NOT NULL;
CREATE INDEX products_gender_idx       ON products(gender) WHERE gender IS NOT NULL;
CREATE INDEX products_is_own_idx       ON products(is_own) WHERE is_own = true;
CREATE INDEX products_erp_style_idx    ON products(erp_style_code) WHERE erp_style_code IS NOT NULL;
CREATE INDEX products_monopoly_idx     ON products(is_musinsa_monopoly) WHERE is_musinsa_monopoly = true;
CREATE INDEX products_season_idx       ON products(season_year, season_code) WHERE season_year IS NOT NULL;
CREATE INDEX products_labels_idx       ON products USING gin(labels);
CREATE INDEX products_item_seasons_idx ON products USING gin(item_seasons);
CREATE INDEX products_ranking_best_idx ON products USING gin(ranking_best_records);
CREATE INDEX products_review_score_idx ON products(satisfaction_score DESC) WHERE review_count > 0;

COMMENT ON TABLE  products IS '무신사 상품 마스터 — 가격은 ranking_snapshots LATERAL 조회';
COMMENT ON COLUMN products.erp_style_code  IS 'Snowflake SW_STYLEINFO.STYLECD (자사 상품만)';
COMMENT ON COLUMN products.style_no        IS '브랜드 자체 스타일번호 (goodsNm 뒤 코드, ERP 매핑 후보)';
COMMENT ON COLUMN products.category_code   IS 'depth1 코드 (000~020) — 랭킹 수집 기준';
COMMENT ON COLUMN products.gender          IS 'M=남성, F=여성, U=공용 — sexCode(2→M, 4→F, 6→U)';
COMMENT ON COLUMN products.fit             IS '의류 전용: 스키니/슬림/레귤러/루즈/오버사이즈';
COMMENT ON COLUMN products.item_seasons    IS '복수 선택: ["봄","여름","가을","겨울"]';
COMMENT ON COLUMN products.labels          IS 'labels[].code — exclusive-musinsa/outlet/big-campaign-sale 등';
COMMENT ON COLUMN products.review_count    IS '수집 시점 총 리뷰 수 (detail_fetched_at 기준)';
COMMENT ON COLUMN products.ranking_best_records IS 'rankingRecord.rankingRecordsTop — 월별 카테고리 최고 순위 이력';
COMMENT ON COLUMN products.colors          IS 'Playwright options API — COLOR_CHIP optionValues[].name';
COMMENT ON COLUMN products.sizes           IS 'Playwright options API — 사이즈 옵션 목록';
COMMENT ON COLUMN products.detail_fetched_at  IS 'httpx 상세 수집 시각 (colors 제외)';
COMMENT ON COLUMN products.options_fetched_at IS 'Playwright 옵션 수집 시각 (colors, sizes)';

-- Rollback:
-- DROP TABLE IF EXISTS products;
