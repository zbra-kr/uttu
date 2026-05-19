-- 00011_brand_ranking_snapshots.sql
-- 브랜드 랭킹 스냅샷
-- API: GET https://client.musinsa.com/api/home/web/v5/pans/ranking/sections/1054
--   sectionId=1054 (브랜드 랭킹 전용, 고정)
--   storeCode=musinsa, 파라미터: categoryCode, gf, ageBand, period=DAILY
--   응답: 200개 RANKING_BRAND 모듈
--     title.rank                → 브랜드 순위 ("1"~"200")
--     title.title.text          → 브랜드 한글명
--     title.imageUrl            → 로고 이미지 URL
--     title.onClick.url         → https://www.musinsa.com/brand/{slug}
--     title.onClick.eventLog.ga4.payload.brand_id → slug
-- 조합: 상품 랭킹과 동일 — 13 × 3 × 7 = 273조합 × 200브랜드 ≈ 54,600행/일
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE brand_ranking_snapshots (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            UUID        REFERENCES brands(id) ON DELETE SET NULL,
  musinsa_brand_slug  TEXT        NOT NULL,               -- brands.slug (영문 brand_id)
  brand_name          TEXT        NOT NULL,               -- title.title.text (한글명 스냅샷)
  brand_image_url     TEXT,                               -- title.imageUrl (수집 시점 로고)
  snapshot_date       DATE        NOT NULL,               -- 수집 날짜 (KST, period=DAILY)
  category_code       TEXT        NOT NULL,               -- 000~020
  gender_filter       TEXT        NOT NULL,               -- A/M/F
  age_filter          TEXT        NOT NULL DEFAULT 'AGE_BAND_ALL',
                                                          -- AGE_BAND_ALL/MINOR/20/25/30/35/40
  rank_position       INTEGER     NOT NULL,               -- 브랜드 순위 (1~200)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT brand_ranking_snapshots_uq
    UNIQUE (musinsa_brand_slug, snapshot_date, category_code, gender_filter, age_filter)
);

CREATE INDEX brand_ranking_date_cat_idx
  ON brand_ranking_snapshots(snapshot_date DESC, category_code);

CREATE INDEX brand_ranking_gender_age_idx
  ON brand_ranking_snapshots(gender_filter, age_filter, snapshot_date DESC);

CREATE INDEX brand_ranking_top20_idx
  ON brand_ranking_snapshots(category_code, gender_filter, age_filter, rank_position)
  WHERE rank_position <= 20;

CREATE INDEX brand_ranking_brand_date_idx
  ON brand_ranking_snapshots(brand_id, snapshot_date DESC)
  WHERE brand_id IS NOT NULL;

CREATE INDEX brand_ranking_slug_date_idx
  ON brand_ranking_snapshots(musinsa_brand_slug, snapshot_date DESC);

COMMENT ON TABLE  brand_ranking_snapshots                  IS '무신사 브랜드 랭킹 스냅샷 — 273조합×200브랜드/일, LATERAL 조회 필수';
COMMENT ON COLUMN brand_ranking_snapshots.musinsa_brand_slug IS 'brands.slug — brands 미등록 브랜드도 저장 가능';
COMMENT ON COLUMN brand_ranking_snapshots.brand_name       IS '수집 시점 한글명 (brands.name과 다를 수 있음)';
COMMENT ON COLUMN brand_ranking_snapshots.rank_position    IS '브랜드 순위 (1~200)';

-- Rollback:
-- DROP TABLE IF EXISTS brand_ranking_snapshots;
