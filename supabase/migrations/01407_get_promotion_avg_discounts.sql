-- 01407_get_promotion_avg_discounts.sql
-- fetchActivePromotions 두 번째 쿼리 대체 — 프로모션별 평균 할인율
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE OR REPLACE FUNCTION get_promotion_avg_discounts(p_promotion_ids uuid[])
RETURNS TABLE(promotion_id uuid, avg_discount_rate int)
LANGUAGE sql SECURITY INVOKER STABLE
AS $$
  SELECT promotion_id,
         ROUND(AVG(discount_rate))::int AS avg_discount_rate
  FROM promotion_items
  WHERE promotion_id = ANY(p_promotion_ids)
    AND discount_rate IS NOT NULL
    AND discount_rate > 0
  GROUP BY promotion_id;
$$;

-- Rollback:
-- DROP FUNCTION IF EXISTS get_promotion_avg_discounts(uuid[]);
