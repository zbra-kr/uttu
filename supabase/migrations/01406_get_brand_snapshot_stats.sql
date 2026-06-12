-- 01406_get_brand_snapshot_stats.sql
-- fetchBrandSnapshot 대체 — 특정 날짜 이전 최신 스냅샷의 브랜드별 집계 지표
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE OR REPLACE FUNCTION get_brand_snapshot_stats(
  p_category_code text,
  p_gender_filter text,
  p_age_filter    text,
  p_before_date   date DEFAULT '9999-12-31'
)
RETURNS TABLE(
  snapshot_date      date,
  brand_name         text,
  sku_count          int,
  top100_count       int,
  avg_rank           int,
  best_rank          int,
  avg_discount       int,
  avg_price          int,
  min_price          int,
  max_price          int,
  avg_review_score   int,
  total_review_count int
)
LANGUAGE sql SECURITY INVOKER STABLE
AS $$
  WITH latest AS (
    SELECT MAX(snapshot_date) AS d
    FROM ranking_snapshots
    WHERE category_code = p_category_code
      AND gender_filter = p_gender_filter
      AND age_filter    = p_age_filter
      AND snapshot_date <= p_before_date
  )
  SELECT
    l.d                                                            AS snapshot_date,
    rs.brand_name,
    COUNT(*)::int                                                  AS sku_count,
    COUNT(*) FILTER (WHERE rs.rank_position <= 100)::int           AS top100_count,
    ROUND(AVG(rs.rank_position))::int                             AS avg_rank,
    MIN(rs.rank_position)::int                                    AS best_rank,
    ROUND(AVG(rs.discount_rate) FILTER (WHERE rs.discount_rate > 0))::int AS avg_discount,
    ROUND(AVG(rs.final_price)   FILTER (WHERE rs.final_price   > 0))::int AS avg_price,
    MIN(rs.final_price)         FILTER (WHERE rs.final_price   > 0)       AS min_price,
    MAX(rs.final_price)         FILTER (WHERE rs.final_price   > 0)       AS max_price,
    ROUND(AVG(rs.review_score))::int                              AS avg_review_score,
    COALESCE(SUM(rs.review_count), 0)::int                        AS total_review_count
  FROM ranking_snapshots rs, latest l
  WHERE rs.category_code = p_category_code
    AND rs.gender_filter = p_gender_filter
    AND rs.age_filter    = p_age_filter
    AND rs.snapshot_date = l.d
  GROUP BY l.d, rs.brand_name;
$$;

-- Rollback:
-- DROP FUNCTION IF EXISTS get_brand_snapshot_stats(text, text, text, date);
