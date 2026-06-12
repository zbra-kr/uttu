-- 01405_get_company_brand_trend.sql
-- fetchCompanyBrandTrend 대체 — 날짜×브랜드별 TOP100 진입 수 추이
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE OR REPLACE FUNCTION get_company_brand_trend(p_brand_names text[], p_from_date date)
RETURNS TABLE(snapshot_date date, brand_name text, top100_count int)
LANGUAGE sql SECURITY INVOKER STABLE
AS $$
  SELECT snapshot_date,
         brand_name,
         COUNT(*) FILTER (WHERE rank_position <= 100)::int AS top100_count
  FROM ranking_snapshots
  WHERE brand_name     = ANY(p_brand_names)
    AND category_code  = '000'
    AND gender_filter  = 'A'
    AND age_filter     = 'AGE_BAND_ALL'
    AND snapshot_date >= p_from_date
  GROUP BY snapshot_date, brand_name
  ORDER BY snapshot_date, brand_name;
$$;

-- Rollback:
-- DROP FUNCTION IF EXISTS get_company_brand_trend(text[], date);
