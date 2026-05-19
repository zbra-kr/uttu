-- 00005_promotions.sql
-- 무신사 프로모션 모듈 (세일 탭 — 선착순특가/하루특가/브랜드위크/패션페스타/뷰티 등)
-- API: GET https://api.musinsa.com/api2/hm/web/v3/pans/sale/modules?storeCode=musinsa
-- 2026-05-19 응답 구조 확인:
--   7개 모듈: ONEROW(한정수량 선착순), TWOROW(하루특가·패션페스타·뷰티·쿠폰·최저가), BRAND(브랜드위크)
--   module.id → musinsa_event_id (영구 고정 ID)
--   module.title.targetDate (ms) → end_at (없으면 NULL)
--   개별 상품 데이터는 promotion_items 테이블에 분리 저장
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE promotions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  musinsa_event_id TEXT        UNIQUE NOT NULL,          -- module.id (고정 ID, 날짜 무관)
  title            TEXT        NOT NULL,                  -- module.title.title.text
  promotion_type   TEXT        NOT NULL DEFAULT 'general',
                                                          -- limited_offer: ONEROW (선착순 한정수량)
                                                          -- daily_sale:    TWOROW (하루특가·기획전)
                                                          -- brand_week:    BRAND (브랜드위크)
                                                          -- general:       기타
  items_count      INTEGER     NOT NULL DEFAULT 0,        -- 수집 당시 module.items 수
  end_at           TIMESTAMPTZ,                           -- module.title.targetDate (ms→TIMESTAMPTZ), null 허용
  snapshot_date    DATE        NOT NULL,                  -- 수집 날짜 (upsert 기준)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX promotions_snapshot_idx ON promotions(snapshot_date DESC);
CREATE INDEX promotions_end_at_idx   ON promotions(end_at) WHERE end_at IS NOT NULL;
CREATE INDEX promotions_type_idx     ON promotions(promotion_type, snapshot_date DESC);

COMMENT ON TABLE  promotions                  IS '무신사 세일탭 프로모션 모듈 — 개별 상품은 promotion_items';
COMMENT ON COLUMN promotions.musinsa_event_id IS 'module.id (고정값): CAROUSEL_ONEROW_...-{N} / CAROUSEL_TWOROW_...-{N}';
COMMENT ON COLUMN promotions.promotion_type   IS 'ONEROW→limited_offer / TWOROW→daily_sale / BRAND→brand_week';
COMMENT ON COLUMN promotions.end_at           IS 'module.title.targetDate (ms) → TIMESTAMPTZ. 마감 없으면 NULL';

-- promotion_type 분류 기준:
--   CAROUSEL_ONEROW_DYNAMIC_TAB-*          → limited_offer (한정수량 선착순 특가)
--   CAROUSEL_TWOROW_DYNAMIC_TAB-*          → daily_sale    (하루특가/패션페스타/뷰티/쿠폰/최저가)
--   CAROUSEL_MODULAR_SNAPPING_*_BRAND-*    → brand_week    (브랜드위크)
--   기타                                   → general

-- Rollback:
-- DROP TABLE IF EXISTS promotions;
