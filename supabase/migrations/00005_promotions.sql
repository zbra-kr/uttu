-- 00005_promotions.sql
-- 무신사 프로모션 (세일·이벤트) 수집
-- API: GET /api2/hm/web/v3/pans/sale/modules (~214건/회)
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE promotions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  musinsa_event_id TEXT       UNIQUE NOT NULL,          -- 무신사 이벤트 고유 ID
  title           TEXT        NOT NULL,                  -- 프로모션 제목
  discount_rate   NUMERIC(5,2),                         -- 할인율
  start_at        TIMESTAMPTZ,                          -- 시작일시
  end_at          TIMESTAMPTZ,                          -- 종료일시
  target_brands   TEXT[]      NOT NULL DEFAULT '{}',    -- 참여 브랜드명 목록
  target_categories TEXT[]    NOT NULL DEFAULT '{}',    -- 대상 카테고리
  snapshot_date   DATE        NOT NULL,                  -- 수집 날짜
  raw_json        JSONB,                                 -- 원본 API 응답 보존
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX promotions_snapshot_idx  ON promotions(snapshot_date DESC);
CREATE INDEX promotions_end_at_idx    ON promotions(end_at) WHERE end_at IS NOT NULL;
CREATE INDEX promotions_brands_idx    ON promotions USING gin(target_brands);

COMMENT ON TABLE  promotions              IS '무신사 프로모션 수집 (~214건/회)';
COMMENT ON COLUMN promotions.raw_json     IS '원본 API 응답 — 스키마 변경 시 재파싱 용도';

-- Rollback:
-- DROP TABLE IF EXISTS promotions;
