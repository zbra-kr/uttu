-- 01403_get_company_top100_trend.sql
-- fetchCompanyTop100Trend 대체 — 기간별 TOP100 진입 상품 수 추이
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE OR REPLACE FUNCTION get_company_top100_trend(p_brand_names text[], p_from_date date)
RETURNS TABLE(snapshot_date date, top100_count int)
LANGUAGE sql SECURITY INVOKER STABLE
AS $$
  SELECT snapshot_date,
         COUNT(*) FILTER (WHERE rank_position <= 100)::int AS top100_count
  FROM ranking_snapshots
  WHERE brand_name     = ANY(p_brand_names)
    AND category_code  = '000'
    AND gender_filter  = 'A'
    AND age_filter     = 'AGE_BAND_ALL'
    AND snapshot_date >= p_from_date
  GROUP BY snapshot_date
  ORDER BY snapshot_date;
$$;

-- Rollback:
-- DROP FUNCTION IF EXISTS get_company_top100_trend(text[], date);
