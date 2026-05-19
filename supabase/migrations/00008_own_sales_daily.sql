-- 00008_own_sales_daily.sql
-- 자사 일별 매출 집계 (Snowflake SW_SALEINFO → 집계 후 소량 적재)
-- 원본 3,072만행 직접 적재 금지 — Snowflake에서 집계 후 소량만 저장
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE own_sales_daily (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_date        DATE        NOT NULL,                -- SALEDT (YYYYMMDD → DATE)
  brand_code       TEXT        NOT NULL,                -- ERP BRANDCD (CO/LE/WA)
  brand_name       TEXT,
  shop_name        TEXT        NOT NULL,                -- ERP SHOPNM
  channel_type     TEXT        NOT NULL DEFAULT 'etc',  -- classify_channel() 결과
  sale_qty         INTEGER     NOT NULL DEFAULT 0,      -- 판매 수량
  sale_amt         BIGINT      NOT NULL DEFAULT 0,      -- 판매 금액 (원)
  return_qty       INTEGER     NOT NULL DEFAULT 0,      -- 반품 수량
  return_amt       BIGINT      NOT NULL DEFAULT 0,      -- 반품 금액 (원)
  avg_discount_rate NUMERIC(5,2),                       -- 평균 할인율
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT own_sales_daily_uq
    UNIQUE (sale_date, brand_code, shop_name)
);

CREATE INDEX own_sales_date_brand_idx ON own_sales_daily(sale_date DESC, brand_code);
CREATE INDEX own_sales_channel_idx    ON own_sales_daily(channel_type, sale_date DESC);

COMMENT ON TABLE  own_sales_daily             IS 'Snowflake SW_SALEINFO 일별 집계 (원본 3,072만행 직접 적재 금지)';
COMMENT ON COLUMN own_sales_daily.channel_type IS 'classify_channel(SHOPNM) — musinsa_online/flagship/dept_duty_free/etc';

-- Rollback:
-- DROP TABLE IF EXISTS own_sales_daily;
