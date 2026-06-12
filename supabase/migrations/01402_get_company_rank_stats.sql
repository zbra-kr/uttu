-- 01402_get_company_rank_stats.sql
-- fetchCompanyRankStats 대체 — 브랜드 목록의 최신 순위 통계 집계
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE OR REPLACE FUNCTION get_company_rank_stats(p_brand_names text[])
RETURNS json
LANGUAGE sql SECURITY INVOKER STABLE
AS $$
  WITH latest_per_brand AS (
    SELECT brand_name, MAX(snapshot_date) AS snapshot_date
    FROM ranking_snapshots
    WHERE brand_name = ANY(p_brand_names)
      AND category_code = '000'
      AND gender_filter = 'A'
      AND age_filter = 'AGE_BAND_ALL'
    GROUP BY brand_name
  ),
  snap AS (
    SELECT rs.brand_name, rs.musinsa_no, rs.rank_position, rs.product_name, rs.category_code
    FROM ranking_snapshots rs
    JOIN latest_per_brand lpb ON rs.brand_name = lpb.brand_name
                              AND rs.snapshot_date = lpb.snapshot_date
    WHERE rs.gender_filter = 'A'
      AND rs.age_filter   = 'AGE_BAND_ALL'
  ),
  all_cat AS (
    SELECT brand_name, musinsa_no, rank_position, product_name
    FROM snap WHERE category_code = '000'
  ),
  agg AS (
    SELECT
      COUNT(*)::int                                          AS sku_count,
      COUNT(*) FILTER (WHERE rank_position <= 100)::int     AS top100_count,
      ROUND(AVG(rank_position))::int                        AS avg_rank,
      MIN(rank_position)::int                               AS best_rank,
      (SELECT product_name FROM all_cat ORDER BY rank_position LIMIT 1) AS best_product_name,
      (SELECT MAX(snapshot_date) FROM latest_per_brand)     AS snapshot_date
    FROM all_cat
  )
  SELECT CASE WHEN a.sku_count = 0 THEN NULL
    ELSE json_build_object(
      'sku_count',         a.sku_count,
      'top100_count',      a.top100_count,
      'avg_rank',          a.avg_rank,
      'best_rank',         a.best_rank,
      'best_product_name', a.best_product_name,
      'snapshot_date',     a.snapshot_date,
      'by_brand', COALESCE((
        SELECT json_agg(row_to_json(x) ORDER BY x.sku_count DESC)
        FROM (
          SELECT brand_name,
                 COUNT(*)::int AS sku_count,
                 COUNT(*) FILTER (WHERE rank_position <= 100)::int AS top100_count
          FROM all_cat GROUP BY brand_name
        ) x
      ), '[]'::json),
      'by_category', COALESCE((
        SELECT json_agg(row_to_json(x) ORDER BY x.sku_count DESC)
        FROM (
          SELECT category_code, COUNT(DISTINCT musinsa_no)::int AS sku_count
          FROM snap WHERE category_code <> '000'
          GROUP BY category_code
        ) x
      ), '[]'::json)
    )
  END
  FROM agg a;
$$;

-- Rollback:
-- DROP FUNCTION IF EXISTS get_company_rank_stats(text[]);
