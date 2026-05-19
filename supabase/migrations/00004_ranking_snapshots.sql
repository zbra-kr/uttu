-- 00004_ranking_snapshots.sql
-- 랭킹 스냅샷 — UTTU 핵심 테이블
-- 189 조합 × 100건 = 18,900건/일 적재
-- 조회: LATERAL JOIN 패턴 필수 (docs/skills/02-supabase.md 참고)
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE ranking_snapshots (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  snapshot_date  DATE        NOT NULL,                  -- 수집 날짜 (KST 기준, period=DAILY)
  category_code  TEXT        NOT NULL,                  -- 000~020
  gender_filter  TEXT        NOT NULL,                  -- A/M/F
  age_filter     TEXT        NOT NULL,                  -- A/10/20/25/30/35/40
  rank_position  INTEGER     NOT NULL,                  -- 랭킹 순위 (1~100)
  list_price     INTEGER,                               -- 정상가 (원)
  discount_rate  NUMERIC(5,2),                          -- 할인율 (0~100)
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

COMMENT ON TABLE  ranking_snapshots              IS '무신사 랭킹 스냅샷 — 189조합×100건/일, LATERAL 조회 필수';
COMMENT ON COLUMN ranking_snapshots.snapshot_date IS 'period=DAILY 기준 KST 날짜 (실시간 now 금지)';
COMMENT ON COLUMN ranking_snapshots.gender_filter IS 'A=전체, M=남성, F=여성';
COMMENT ON COLUMN ranking_snapshots.age_filter    IS 'A=전체, 10=19세이하, 20=20~24, 25=25~29, 30=30~34, 35=35~39, 40=40이상';

-- Rollback:
-- DROP TABLE IF EXISTS ranking_snapshots;
