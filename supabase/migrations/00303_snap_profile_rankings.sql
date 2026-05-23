-- 00303_snap_profile_rankings.sql
-- snap_rankings 스타일 필터 추가 + 프로필 랭킹 테이블 3종 신설
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

-- ── 1. snap_rankings.style_filter 추가 ───────────────────────────────────────
ALTER TABLE snap_rankings
  ADD COLUMN IF NOT EXISTS style_filter TEXT NOT NULL DEFAULT 'ALL';

-- 기존 UNIQUE 제약 교체 (style_filter 포함)
ALTER TABLE snap_rankings DROP CONSTRAINT IF EXISTS snap_rankings_uq;
ALTER TABLE snap_rankings ADD CONSTRAINT snap_rankings_uq
  UNIQUE (snapshot_date, snap_id, style_filter, gender_filter, ranking_period);

CREATE INDEX IF NOT EXISTS snap_rankings_style_idx
  ON snap_rankings(snapshot_date DESC, style_filter);

COMMENT ON COLUMN snap_rankings.style_filter IS
  '스타일 필터 — ALL | CASUAL | STREET | MINIMAL | GIRLISH | ROMANTIC | CHIC (ranking-filters API)';

-- ── 2. snap_profiles 테이블 ─────────────────────────────────────────────────
-- USER: 멤버 프로필 / BRAND: 브랜드 프로필
-- 키·몸무게·팔로잉·게시물수는 /profiles/:id 상세 API로 보강 (랭킹 API 미제공)
CREATE TABLE IF NOT EXISTS snap_profiles (
  id                TEXT        PRIMARY KEY,              -- snap 플랫폼 프로필 ID
  profile_type      TEXT        NOT NULL CHECK (profile_type IN ('USER', 'BRAND')),
  nickname          TEXT        NOT NULL,
  bio               TEXT,
  profile_image_url TEXT,
  follower_count    INTEGER     NOT NULL DEFAULT 0,
  following_count   INTEGER     NOT NULL DEFAULT 0,       -- 상세 API 보강 전 0
  snap_count        INTEGER     NOT NULL DEFAULT 0,       -- 상세 API 보강 전 0
  height            SMALLINT,                             -- USER만, profilePhysical.height
  weight            SMALLINT,                             -- USER만, profilePhysical.weight
  skin_tone         TEXT,                                 -- USER만, profilePhysical.skinTone
  gender            TEXT,                                 -- USER만, profilePhysical.gender
  badge_title       TEXT,                                 -- USER | BRAND | OFFICIAL | null
  badge_image_url   TEXT,
  brand_code        TEXT,                                 -- BRAND만, goods.brand.brandId
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS snap_profiles_type_idx
  ON snap_profiles(profile_type);
CREATE INDEX IF NOT EXISTS snap_profiles_brand_code_idx
  ON snap_profiles(brand_code) WHERE brand_code IS NOT NULL;

COMMENT ON TABLE  snap_profiles                     IS '스냅 멤버·브랜드 프로필 — profile-rankings API';
COMMENT ON COLUMN snap_profiles.profile_type        IS 'USER (멤버) | BRAND';
COMMENT ON COLUMN snap_profiles.brand_code          IS 'BRAND 전용 — goods.brand.brandId (e.g. "dolzabi")';
COMMENT ON COLUMN snap_profiles.height              IS 'USER 전용 — profilePhysical.height (cm)';
COMMENT ON COLUMN snap_profiles.weight              IS 'USER 전용 — profilePhysical.weight (kg)';

-- ── 3. snap_profile_rankings 테이블 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snap_profile_rankings (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  profile_id          TEXT        NOT NULL REFERENCES snap_profiles(id) ON DELETE CASCADE,
  profile_type        TEXT        NOT NULL,               -- USER | BRAND
  rank_position       SMALLINT    NOT NULL,
  prev_rank_position  SMALLINT,
  highlight           TEXT,                               -- MOST_FOLLOWED | MOST_BRAND_FOLLOWED | NEW 등
  ranking_period      TEXT        NOT NULL DEFAULT 'DAILY',
  ranked_at           TIMESTAMPTZ,

  CONSTRAINT snap_profile_rankings_uq
    UNIQUE (snapshot_date, profile_id, ranking_period)
);

CREATE INDEX IF NOT EXISTS snap_profile_rankings_date_idx
  ON snap_profile_rankings(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS snap_profile_rankings_profile_idx
  ON snap_profile_rankings(profile_id);
CREATE INDEX IF NOT EXISTS snap_profile_rankings_rank_idx
  ON snap_profile_rankings(snapshot_date, profile_type, rank_position);

COMMENT ON TABLE  snap_profile_rankings                     IS '멤버·브랜드 일간 랭킹 스냅샷 — profile-rankings API';
COMMENT ON COLUMN snap_profile_rankings.profile_type        IS 'USER | BRAND';
COMMENT ON COLUMN snap_profile_rankings.highlight           IS 'MOST_FOLLOWED | MOST_BRAND_FOLLOWED | NEW 등';

-- ── 4. snap_profile_snaps 테이블 ─────────────────────────────────────────────
-- 랭킹 수집 시점에 각 프로필에 내장된 최근 스냅 목록 (최대 10개/프로필/일)
CREATE TABLE IF NOT EXISTS snap_profile_snaps (
  snapshot_date   DATE        NOT NULL,
  profile_id      TEXT        NOT NULL REFERENCES snap_profiles(id) ON DELETE CASCADE,
  snap_id         TEXT        NOT NULL REFERENCES snaps(snap_id) ON DELETE CASCADE,
  display_order   SMALLINT    NOT NULL DEFAULT 0,         -- API 응답 순서 (0-based)

  CONSTRAINT snap_profile_snaps_uq UNIQUE (snapshot_date, profile_id, snap_id)
);

CREATE INDEX IF NOT EXISTS snap_profile_snaps_profile_idx
  ON snap_profile_snaps(profile_id, snapshot_date DESC);

COMMENT ON TABLE  snap_profile_snaps               IS '프로필 랭킹 수집 시점 최근 스냅 목록 (10개/프로필)';
COMMENT ON COLUMN snap_profile_snaps.display_order IS 'profile-rankings 응답 내 snaps[] 순서 (0-based)';

-- ── Rollback ────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS snap_profile_snaps;
-- DROP TABLE IF EXISTS snap_profile_rankings;
-- DROP TABLE IF EXISTS snap_profiles;
-- ALTER TABLE snap_rankings DROP CONSTRAINT IF EXISTS snap_rankings_uq;
-- ALTER TABLE snap_rankings ADD CONSTRAINT snap_rankings_uq
--   UNIQUE (snapshot_date, snap_id, gender_filter, ranking_period);
-- DROP INDEX IF EXISTS snap_rankings_style_idx;
-- ALTER TABLE snap_rankings DROP COLUMN IF EXISTS style_filter;
