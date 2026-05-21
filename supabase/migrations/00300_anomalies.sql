-- 이상탐지 결과 테이블
-- module: product_planning | cs | finance
-- severity: high | medium | low
-- anomaly_type: rank_spike | rank_drop_own | new_entrant_top10 | sold_out |
--               promo_heavy_discount | price_drop |
--               review_rating_drop | review_negative_surge | review_count_surge

CREATE TABLE IF NOT EXISTS anomalies (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at    timestamptz NOT NULL DEFAULT now(),
  detection_date date        NOT NULL DEFAULT CURRENT_DATE,
  module         text        NOT NULL,
  severity       text        NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  anomaly_type   text        NOT NULL,
  entity_type    text,                  -- 'product' | 'brand'
  entity_id      uuid,
  entity_name    text,
  description    text,
  meta           jsonb,
  is_read        boolean     NOT NULL DEFAULT false,

  -- 같은 날 같은 탐지는 1건만
  UNIQUE (detection_date, anomaly_type, entity_id)
);

CREATE INDEX IF NOT EXISTS anomalies_date_idx    ON anomalies (detection_date DESC);
CREATE INDEX IF NOT EXISTS anomalies_module_idx  ON anomalies (module, detection_date DESC);
CREATE INDEX IF NOT EXISTS anomalies_unread_idx  ON anomalies (is_read, detected_at DESC) WHERE is_read = false;

COMMENT ON TABLE anomalies IS '이상탐지 결과. run_detect.sh 실행 후 upsert됨.';
