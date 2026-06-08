-- 회사별 최신 공시 1건씩 반환 (RETURNS json — PostgREST row limit 우회)
CREATE OR REPLACE FUNCTION get_latest_disclosures()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT DISTINCT ON (company_id) company_id, rcept_dt, report_nm
    FROM dart_disclosures
    ORDER BY company_id, rcept_dt DESC
  ) t;
$$;
