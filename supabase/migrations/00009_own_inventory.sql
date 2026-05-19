-- 00009_own_inventory.sql
-- 자사 재고 현황 스냅샷 (Snowflake SW_WHINV → 집계 후 적재)
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE own_inventory (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date  DATE        NOT NULL,                  -- 재고 기준일
  erp_style_code TEXT        NOT NULL,                  -- Snowflake STYLECD
  color_code     TEXT        NOT NULL DEFAULT '',       -- Snowflake COLORCD
  size_code      TEXT        NOT NULL DEFAULT '',       -- Snowflake SIZECD
  avail_qty      INTEGER     NOT NULL DEFAULT 0,        -- 가용재고
  online_qty     INTEGER     NOT NULL DEFAULT 0,        -- 온라인재고
  offline_qty    INTEGER     NOT NULL DEFAULT 0,        -- 오프라인재고
  product_id     UUID        REFERENCES products(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT own_inventory_uq
    UNIQUE (snapshot_date, erp_style_code, color_code, size_code)
);

CREATE INDEX own_inventory_date_idx   ON own_inventory(snapshot_date DESC);
CREATE INDEX own_inventory_style_idx  ON own_inventory(erp_style_code, snapshot_date DESC);
CREATE INDEX own_inventory_product_idx ON own_inventory(product_id) WHERE product_id IS NOT NULL;

COMMENT ON TABLE  own_inventory              IS 'Snowflake SW_WHINV 재고 스냅샷 — 상품기획/영업기획 활용';
COMMENT ON COLUMN own_inventory.product_id   IS 'erp_style_code → products.erp_style_code 매핑 후 채움';

-- Rollback:
-- DROP TABLE IF EXISTS own_inventory;
