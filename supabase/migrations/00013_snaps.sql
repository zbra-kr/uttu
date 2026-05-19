-- 00013_snaps.sql
-- 무신사 스냅 수집 (CODISHOP_SNAP + MUSINSA_SNAP)
-- API: content.musinsa.com/api2/content/snap/v1/snaps (인증 불필요)
-- 수집 주기: 매일 증분 (collected_at 기준)
-- USER_SNAP은 수집 제외 (볼륨 과다), contentType 컬럼에 기록만
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE snaps (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  snap_id         TEXT        NOT NULL UNIQUE,              -- snowflake ID (content.musinsa.com)
  content_type    TEXT        NOT NULL,                     -- CODISHOP_SNAP | MUSINSA_SNAP
  format_type     TEXT        NOT NULL DEFAULT 'POST',      -- POST | SHORTS
  published_at    TIMESTAMPTZ NOT NULL,                     -- createdAt
  like_count      INTEGER     NOT NULL DEFAULT 0,
  view_count      INTEGER     NOT NULL DEFAULT 0,
  comment_count   INTEGER     NOT NULL DEFAULT 0,
  goods_click_count INTEGER   NOT NULL DEFAULT 0,
  model_gender    TEXT,                                     -- WOMEN | MEN (작성자 체형 정보)
  model_height    SMALLINT,                                 -- cm
  model_weight    SMALLINT,                                 -- kg
  collected_at    DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX snaps_published_idx   ON snaps(published_at DESC);
CREATE INDEX snaps_collected_idx   ON snaps(collected_at DESC);
CREATE INDEX snaps_type_idx        ON snaps(content_type, published_at DESC);

COMMENT ON TABLE  snaps                  IS '무신사 스냅 — CODISHOP_SNAP/MUSINSA_SNAP 수집. USER_SNAP 제외';
COMMENT ON COLUMN snaps.snap_id         IS 'content.musinsa.com snowflake ID — UNIQUE 중복 방지';
COMMENT ON COLUMN snaps.content_type    IS 'CODISHOP_SNAP(공식 코디샵) | MUSINSA_SNAP(공식 계정)';
COMMENT ON COLUMN snaps.model_gender    IS '스냅 작성자 체형 — WOMEN | MEN (없으면 NULL)';

-- Rollback:
-- DROP TABLE IF EXISTS snap_products;
-- DROP TABLE IF EXISTS snaps;


CREATE TABLE snap_products (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  snap_id         TEXT        NOT NULL REFERENCES snaps(snap_id) ON DELETE CASCADE,
  product_id      UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  musinsa_no      TEXT        NOT NULL,
  goods_platform  TEXT        NOT NULL DEFAULT 'MUSINSA',   -- MUSINSA | SOLDOUT
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT snap_products_uq UNIQUE (snap_id, musinsa_no)
);

CREATE INDEX snap_products_snap_idx    ON snap_products(snap_id);
CREATE INDEX snap_products_product_idx ON snap_products(product_id);
CREATE INDEX snap_products_no_idx      ON snap_products(musinsa_no);

COMMENT ON TABLE  snap_products               IS '스냅 × 상품 연결 — 스냅에 태그된 상품 목록';
COMMENT ON COLUMN snap_products.goods_platform IS 'MUSINSA | SOLDOUT';

-- Rollback:
-- DROP TABLE IF EXISTS snap_products;
