-- 00004_ranking_snapshots.sql
-- 랭킹 스냅샷 — UTTU 핵심 테이블
-- 2026-05-19 API 변경 확인:
--   구 API (api.musinsa.com/api2/dp/v1/plp/ranking) 폐기 → HTTP 400
--   신 API (client.musinsa.com/api/home/web/v5/pans/ranking/sections/199)
--   age 파라미터명 변경: age=10/20/... → ageBand=AGE_BAND_20/...
--   age_filter 컬럼에 ageBand 값 그대로 저장 (AGE_BAND_ALL 등)
--   조합 수: 189 (9×3×7) — gf×ageBand 모두 서버에서 실제 다른 결과 반환 확인
-- 조회: LATERAL JOIN 패턴 필수 (docs/skills/02-supabase.md 참고)
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE ranking_snapshots (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  snapshot_date  DATE        NOT NULL,                  -- 수집 날짜 (KST 기준, period=DAILY)
  category_code  TEXT        NOT NULL,                  -- 000~020
  gender_filter  TEXT        NOT NULL,                  -- A/M/F
  age_filter     TEXT        NOT NULL DEFAULT 'AGE_BAND_ALL',
                                                        -- ageBand 값 그대로 저장
                                                        -- AGE_BAND_ALL/MINOR/20/25/30/35/40
  rank_position  INTEGER     NOT NULL,                  -- 랭킹 순위 (1~N, ~102)
  list_price     INTEGER,                               -- 정상가 (원, ga4.payload.original_price)
  final_price    INTEGER,                               -- 최종가 (원, info.finalPrice)
  discount_rate  NUMERIC(5,2),                          -- 할인율 (info.discountRatio)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ranking_snapshots_uq
    UNIQUE (product_id, snapshot_date, category_code, gender_filter, age_filter)
);

-- 핵심 인덱스 (docs/skills/02-supabase.md 인덱스 전략 준수)
CREATE INDEX ranking_date_cat_idx
  ON ranking_snapshots(snapshot_date DESC, category_code);

CREATE INDEX ranking_gender_age_idx
  ON ranking_snapshots(gender_filter, age_filter, snapshot_date DESC);

CREATE INDEX ranking_top50_idx
  ON ranking_snapshots(category_code, gender_filter, age_filter, rank_position)
  WHERE rank_position <= 50;

CREATE INDEX ranking_product_date_idx
  ON ranking_snapshots(product_id, snapshot_date DESC);

COMMENT ON TABLE  ranking_snapshots              IS '무신사 랭킹 스냅샷 — 189조합/일(9×3×7), LATERAL 조회 필수';
COMMENT ON COLUMN ranking_snapshots.snapshot_date IS 'period=DAILY 기준 KST 날짜 (실시간 now 금지)';
COMMENT ON COLUMN ranking_snapshots.gender_filter IS 'A=전체, M=남성, F=여성';
COMMENT ON COLUMN ranking_snapshots.age_filter    IS 'ageBand 값: AGE_BAND_ALL/MINOR/20/25/30/35/40 (구 API의 age=A/10/20/... 대체)';
COMMENT ON COLUMN ranking_snapshots.list_price    IS '정상가 — ga4.payload.original_price';
COMMENT ON COLUMN ranking_snapshots.final_price   IS '최종가(할인 적용) — info.finalPrice';

-- Rollback:
-- DROP TABLE IF EXISTS ranking_snapshots;
