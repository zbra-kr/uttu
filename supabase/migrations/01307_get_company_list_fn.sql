-- 회사 목록 페이지네이션 함수 (PostgREST row limit 완전 우회)
-- total + rows를 RETURNS json 단일값으로 반환
-- search/sort/listed_only 모두 DB에서 처리
DROP FUNCTION IF EXISTS get_company_list();
DROP FUNCTION IF EXISTS get_latest_disclosures();

CREATE OR REPLACE FUNCTION get_company_list_page(
  p_limit       int     DEFAULT 50,
  p_offset      int     DEFAULT 0,
  p_search      text    DEFAULT NULL,
  p_sort        text    DEFAULT NULL,   -- 'revenue' | 'op_margin' | 'brand_count' | NULL
  p_listed_only boolean DEFAULT false
)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH filtered AS (
    SELECT DISTINCT c.id
    FROM companies c
    WHERE
      (NOT p_listed_only OR c.is_listed)
      AND (
        p_search IS NULL
        OR c.corp_name ILIKE '%' || p_search || '%'
        OR EXISTS (
          SELECT 1 FROM brands WHERE company_id = c.id AND name ILIKE '%' || p_search || '%'
        )
      )
  ),
  company_agg AS (
    SELECT
      c.id,
      c.corp_name,
      c.is_listed,
      c.corp_code,
      COUNT(b.id)                           AS brand_count,
      COUNT(b.id) FILTER (WHERE b.is_own)   AS own_brand_count,
      (
        SELECT ARRAY(
          SELECT name FROM brands b2
          WHERE b2.company_id = c.id
          ORDER BY b2.is_own DESC, b2.name
          LIMIT 3
        )
      ) AS top_brands
    FROM companies c
    JOIN filtered f ON f.id = c.id
    LEFT JOIN brands b ON b.company_id = c.id AND b.company_id IS NOT NULL
    GROUP BY c.id, c.corp_name, c.is_listed, c.corp_code
  ),
  latest_fin AS (
    SELECT DISTINCT ON (company_id)
      company_id, fiscal_year, revenue, operating_income, net_income,
      total_assets, total_liabilities
    FROM dart_financials
    ORDER BY company_id, fiscal_year DESC
  ),
  latest_disc AS (
    SELECT DISTINCT ON (company_id)
      company_id, rcept_dt::text AS rcept_dt, report_nm
    FROM dart_disclosures
    ORDER BY company_id, rcept_dt DESC
  ),
  enriched AS (
    SELECT
      ca.*,
      lf.fiscal_year,
      lf.revenue,
      lf.operating_income,
      lf.net_income,
      lf.total_assets,
      lf.total_liabilities,
      CASE
        WHEN lf.revenue > 0 AND lf.operating_income IS NOT NULL
        THEN ROUND((lf.operating_income::numeric / lf.revenue) * 100, 1)
      END AS op_margin,
      CASE
        WHEN lf.revenue > 0 AND lf.net_income IS NOT NULL
        THEN ROUND((lf.net_income::numeric / lf.revenue) * 100, 1)
      END AS net_margin,
      ld.rcept_dt  AS latest_disclosure_dt,
      ld.report_nm AS latest_disclosure_nm
    FROM company_agg ca
    LEFT JOIN latest_fin  lf ON lf.company_id = ca.id
    LEFT JOIN latest_disc ld ON ld.company_id = ca.id
  )
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM filtered),
    'rows', COALESCE(
      (
        SELECT json_agg(row_to_json(p))
        FROM (
          SELECT * FROM enriched
          ORDER BY
            CASE p_sort
              WHEN 'revenue'     THEN revenue
              WHEN 'op_margin'   THEN op_margin
              WHEN 'brand_count' THEN brand_count::numeric
            END DESC NULLS LAST,
            CASE WHEN p_sort IS NULL THEN (corp_code IS NOT NULL)::int END DESC,
            CASE WHEN p_sort IS NULL THEN is_listed::int END DESC,
            brand_count DESC,
            corp_name
          LIMIT  p_limit
          OFFSET p_offset
        ) p
      ),
      '[]'::json
    )
  );
$$;
