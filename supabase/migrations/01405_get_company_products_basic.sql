-- 01405_get_company_products_basic.sql
-- 랭킹 집계 없는 회사의 상품 현황 — products 테이블 기반 (ranking_snapshots 불필요)
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE OR REPLACE FUNCTION get_company_products_basic(p_brand_names text[])
RETURNS json
LANGUAGE sql SECURITY INVOKER STABLE
AS $$
  WITH product_base AS (
    SELECT
      b.name AS brand_name,
      p.musinsa_no,
      p.name,
      p.category_d2_name,
      p.gender,
      p.review_count,
      p.satisfaction_score
    FROM products p
    JOIN brands b ON p.brand_id = b.id
    WHERE b.name = ANY(p_brand_names)
      AND p.name != '(stub)'
      AND p.detail_fetched_at IS NOT NULL
  ),
  by_brand AS (
    SELECT
      brand_name,
      COUNT(*)::int                                AS product_count,
      ROUND(AVG(satisfaction_score)::numeric, 1)   AS avg_score,
      COALESCE(SUM(review_count), 0)::int          AS total_reviews
    FROM product_base
    GROUP BY brand_name
    ORDER BY product_count DESC
  ),
  by_category AS (
    SELECT
      category_d2_name AS name,
      COUNT(*)::int    AS count
    FROM product_base
    WHERE category_d2_name IS NOT NULL
    GROUP BY category_d2_name
    ORDER BY count DESC
    LIMIT 12
  ),
  top_products AS (
    SELECT
      musinsa_no,
      name,
      brand_name,
      category_d2_name,
      review_count,
      satisfaction_score
    FROM product_base
    WHERE review_count > 0
    ORDER BY review_count DESC
    LIMIT 15
  )
  SELECT json_build_object(
    'total_count',   (SELECT COUNT(*)::int FROM product_base),
    'by_brand',      COALESCE((SELECT json_agg(row_to_json(b) ORDER BY b.product_count DESC) FROM by_brand b), '[]'::json),
    'by_category',   COALESCE((SELECT json_agg(row_to_json(c) ORDER BY c.count DESC)         FROM by_category c), '[]'::json),
    'top_products',  COALESCE((SELECT json_agg(row_to_json(p) ORDER BY p.review_count DESC)  FROM top_products p), '[]'::json)
  );
$$;

-- Rollback:
-- DROP FUNCTION IF EXISTS get_company_products_basic(text[]);
