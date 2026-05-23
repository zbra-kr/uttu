-- 00302_snap_expansion.sql
-- snaps 신규 컬럼 추가, snap_rankings 테이블 생성, snap_products.option_name 추가
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

-- 1. snaps 신규 컬럼 ──────────────────────────────────────────────────────────
ALTER TABLE snaps
  ADD COLUMN IF NOT EXISTS thumbnail_url    TEXT,
  ADD COLUMN IF NOT EXISTS content_text     TEXT,
  ADD COLUMN IF NOT EXISTS scrap_count      INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS click_count      INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_skin_tone  TEXT,
  ADD COLUMN IF NOT EXISTS hashtags         TEXT[]    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS style_label_ids  INTEGER[] NOT NULL DEFAULT '{}';

COMMENT ON TABLE  snaps                       IS '무신사 스냅 — USER_SNAP(랭킹)/BRAND_SNAP/CODISHOP_SNAP/MUSINSA_SNAP 수집';
COMMENT ON COLUMN snaps.content_type          IS 'USER_SNAP | BRAND_SNAP | CODISHOP_SNAP | MUSINSA_SNAP';
COMMENT ON COLUMN snaps.thumbnail_url         IS 'medias[0].path — 대표 이미지 URL';
COMMENT ON COLUMN snaps.scrap_count           IS 'aggregations.scrapCount — 스크랩 수';
COMMENT ON COLUMN snaps.click_count           IS 'aggregations.clickCount — 클릭 수';
COMMENT ON COLUMN snaps.model_skin_tone       IS 'model.skinTone';
COMMENT ON COLUMN snaps.hashtags              IS 'tags[].name 배열';
COMMENT ON COLUMN snaps.style_label_ids       IS 'styleLabels[].id 배열';

-- 2. snap_products.option_name 추가 ───────────────────────────────────────────
ALTER TABLE snap_products
  ADD COLUMN IF NOT EXISTS option_name TEXT;

COMMENT ON COLUMN snap_products.option_name IS 'goods[].options[].optionName 조합 (색상/사이즈 등, "/" 구분)';

-- 3. snap_rankings 테이블 생성 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snap_rankings (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  snap_id             TEXT        NOT NULL REFERENCES snaps(snap_id) ON DELETE CASCADE,
  rank_position       SMALLINT    NOT NULL,
  prev_rank_position  SMALLINT,
  highlight           TEXT,                                    -- MOST_LIKED | NEW 등 특별 표시
  gender_filter       TEXT        NOT NULL DEFAULT 'ALL',     -- ALL | WOMEN | MEN
  ranking_period      TEXT        NOT NULL DEFAULT 'DAILY',
  ranked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT snap_rankings_uq UNIQUE (snapshot_date, snap_id, gender_filter, ranking_period)
);

CREATE INDEX snap_rankings_date_idx ON snap_rankings(snapshot_date DESC);
CREATE INDEX snap_rankings_snap_idx ON snap_rankings(snap_id);
CREATE INDEX snap_rankings_rank_idx ON snap_rankings(snapshot_date, gender_filter, rank_position);

COMMENT ON TABLE  snap_rankings                    IS 'USER_SNAP 일간 인기 랭킹 스냅샷 — rankings/DAILY API';
COMMENT ON COLUMN snap_rankings.rank_position      IS 'ranking.rank — 현재 순위';
COMMENT ON COLUMN snap_rankings.prev_rank_position IS 'ranking.previousRank — 전일 순위 (null=신규 진입)';
COMMENT ON COLUMN snap_rankings.highlight          IS 'ranking.highlight — MOST_LIKED, NEW 등 특별 표시';
COMMENT ON COLUMN snap_rankings.gender_filter      IS '랭킹 요청 파라미터 — ALL | WOMEN | MEN';

-- Rollback:
-- DROP TABLE IF EXISTS snap_rankings;
-- ALTER TABLE snap_products DROP COLUMN IF EXISTS option_name;
-- ALTER TABLE snaps
--   DROP COLUMN IF EXISTS thumbnail_url,
--   DROP COLUMN IF EXISTS content_text,
--   DROP COLUMN IF EXISTS scrap_count,
--   DROP COLUMN IF EXISTS click_count,
--   DROP COLUMN IF EXISTS model_skin_tone,
--   DROP COLUMN IF EXISTS hashtags,
--   DROP COLUMN IF EXISTS style_label_ids;
