-- 00012_promotion_items.sql
-- 프로모션 내 개별 상품 (promotions 1:N)
-- API: GET https://api.musinsa.com/api2/hm/web/v3/pans/sale/modules?storeCode=musinsa
--   data.modules[].items[] 개별 파싱
--     .id                                          → musinsa_no
--     .info.brandName                              → musinsa_brand_name
--     .info.finalPrice                             → final_price
--     .info.discountRatio                          → discount_rate
--     .info.limitedOffer.totalCount                → limited_total (선착순만)
--     .info.limitedOffer.remainingCount            → limited_remaining (선착순만)
--     .info.limitedOffer.status.type               → limited_status (PROGRESS/SOLD_OUT)
--     .image.onClickLike.eventLog.ga4.payload.original_price → list_price
-- 선착순특가(limited_offer): limitedOffer 필드 존재 — 실시간 감소하는 잔여 수량 저장
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE promotion_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id      UUID        NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_id        UUID        REFERENCES products(id) ON DELETE SET NULL,
  musinsa_no        TEXT        NOT NULL,               -- 무신사 상품번호
  musinsa_brand_slug TEXT,                              -- ga4.payload.brand_id (영문 slug)
  musinsa_brand_name TEXT,                              -- info.brandName
  product_name      TEXT,                               -- amplitude.payload.product_name
  rank_in_module    INTEGER,                            -- 모듈 내 노출 순서 (0-based index)
  item_store_code   TEXT,                               -- ga4.payload.spc_code (musinsa/player 등)

  -- ── 가격 ─────────────────────────────────────────────────────────────────────
  final_price       INTEGER,                            -- info.finalPrice
  list_price        INTEGER,                            -- ga4.payload.original_price
  discount_rate     NUMERIC(5,2),                       -- info.discountRatio (%)

  -- ── 스냅샷 시점 상태 ─────────────────────────────────────────────────────────
  is_sold_out       BOOLEAN     NOT NULL DEFAULT false, -- info.isSoldOut (TWOROW) / limited_status==SOLD_OUT (ONEROW)
  review_count      INTEGER,                            -- amplitude.payload.reviewCount
  review_score      SMALLINT,                           -- amplitude.payload.reviewScore (0~100, %)

  -- ── 선착순특가 전용 ───────────────────────────────────────────────────────────
  limited_total     INTEGER,                            -- limitedOffer.totalCount (ONEROW만)
  limited_remaining INTEGER,                            -- limitedOffer.remainingCount (ONEROW만)
  limited_status    TEXT,                               -- PROGRESS / SOLD_OUT (ONEROW만)

  snapshot_date     DATE        NOT NULL,               -- 수집 날짜
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT promotion_items_uq
    UNIQUE (promotion_id, musinsa_no, snapshot_date)
);

CREATE INDEX promo_items_promotion_idx  ON promotion_items(promotion_id, snapshot_date DESC);
CREATE INDEX promo_items_product_idx    ON promotion_items(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX promo_items_date_idx       ON promotion_items(snapshot_date DESC);
CREATE INDEX promo_items_limited_idx
  ON promotion_items(promotion_id, limited_status)
  WHERE limited_total IS NOT NULL;

COMMENT ON TABLE  promotion_items                   IS '프로모션 내 개별 상품 — promotions.id와 1:N 관계';
COMMENT ON COLUMN promotion_items.promotion_id      IS 'promotions.id — ON DELETE CASCADE';
COMMENT ON COLUMN promotion_items.musinsa_brand_slug IS 'ga4.payload.brand_id — brands.slug 조인 가능';
COMMENT ON COLUMN promotion_items.item_store_code   IS 'ga4.payload.spc_code — 본관 세일탭에 노출된 타 스토어 상품 식별 (예: player)';
COMMENT ON COLUMN promotion_items.rank_in_module    IS '모듈 내 노출 순서 (0부터)';
COMMENT ON COLUMN promotion_items.review_score      IS 'amplitude.payload.reviewScore (0~100 정수, 만족도 %)';
COMMENT ON COLUMN promotion_items.limited_total     IS '선착순특가(ONEROW) 전용 — 총 수량';
COMMENT ON COLUMN promotion_items.limited_remaining IS '선착순특가(ONEROW) 전용 — 잔여 수량 (수집 시점)';
COMMENT ON COLUMN promotion_items.limited_status    IS 'PROGRESS=판매중 / SOLD_OUT=품절 (수집 시점)';

-- Rollback:
-- DROP TABLE IF EXISTS promotion_items;
