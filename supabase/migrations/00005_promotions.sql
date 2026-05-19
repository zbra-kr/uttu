-- 00005_promotions.sql
-- 무신사 프로모션 (세일·이벤트) 수집
-- API: GET https://api.musinsa.com/api2/hm/web/v3/pans/sale/modules (엔드포인트 동일)
-- 2026-05-19 응답 구조 확인:
--   - data.modules[] — 오늘 기준 7개 모듈
--   - module.id: CAROUSEL_TWOROW_DYNAMIC_TAB-{숫자} 형식이 이벤트 고유 ID
--   - module.title.targetDate: 마감 timestamp (ms, 없으면 null)
--   - discount_rate: 상품 개별 항목 (모듈 레벨 없음) → raw_json에 보존
--   - start_at: API 미제공 → NULL
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE promotions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  musinsa_event_id TEXT       UNIQUE NOT NULL,          -- module.id (e.g., CAROUSEL_TWOROW_DYNAMIC_TAB-1954)
  title           TEXT        NOT NULL,                  -- module.title.title.text
  promotion_type  TEXT        NOT NULL DEFAULT 'general',-- module.id prefix 기반 분류
                                                         -- limited_offer/daily_sale/brand_week/general
  items_count     INTEGER     NOT NULL DEFAULT 0,        -- module.items 수
  end_at          TIMESTAMPTZ,                           -- module.title.targetDate (ms → TIMESTAMPTZ)
  target_brands   TEXT[]      NOT NULL DEFAULT '{}',    -- items에서 brandName 집계
  target_categories TEXT[]    NOT NULL DEFAULT '{}',    -- 대상 카테고리 (파싱 가능 시)
  snapshot_date   DATE        NOT NULL,                  -- 수집 날짜
  raw_json        JSONB,                                 -- 원본 module JSON (할인율 등 상품별 데이터 포함)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX promotions_snapshot_idx  ON promotions(snapshot_date DESC);
CREATE INDEX promotions_end_at_idx    ON promotions(end_at) WHERE end_at IS NOT NULL;
CREATE INDEX promotions_type_idx      ON promotions(promotion_type, snapshot_date DESC);
CREATE INDEX promotions_brands_idx    ON promotions USING gin(target_brands);

COMMENT ON TABLE  promotions                 IS '무신사 프로모션 모듈 수집 (오늘 기준 7개)';
COMMENT ON COLUMN promotions.musinsa_event_id IS 'module.id — CAROUSEL_TWOROW_DYNAMIC_TAB-{숫자} 형식';
COMMENT ON COLUMN promotions.promotion_type  IS 'module.id prefix: limited_offer/daily_sale/brand_week/general';
COMMENT ON COLUMN promotions.end_at          IS 'module.title.targetDate (ms) → TIMESTAMPTZ 변환. 마감일 없으면 NULL';
COMMENT ON COLUMN promotions.raw_json        IS '원본 module JSON — 상품별 할인율·한정수량 등 포함';

-- promotion_type 분류 참고:
--   CAROUSEL_ONEROW_DYNAMIC_TAB   → limited_offer (한정수량)
--   CAROUSEL_TWOROW_DYNAMIC_TAB   → daily_sale (하루특가/일반특가)
--   CAROUSEL_MODULAR_SNAPPING_*_BRAND → brand_week (브랜드위크)
--   기타 → general

-- Rollback:
-- DROP TABLE IF EXISTS promotions;
