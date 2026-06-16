-- 01411_get_brand_snapshot_stats_v2.sql
-- 브랜드 랭킹 그리드 컬럼 빈값 문제 해결
-- 원인: '000'(전체) 카테고리나 'A'(전체성별), 'AGE_BAND_ALL'(전체연령) 필터일 때
--       해당 단일 조합만 쿼리하므로 200개 브랜드 중 48개만 데이터 반환됨.
--       나머지 152개 브랜드는 다른 category/gender/age 조합에서만 상품이 랭킹됨.
-- 해결: '전체' 값일 때 필터를 확장 적용 + DISTINCT ON product_id로 중복 방지

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
    -- '전체' 값일 때 해당 축을 확장해서 최신 날짜 탐색
    SELECT MAX(snapshot_date) AS d
    FROM ranking_snapshots
    WHERE (p_category_code = '000' OR category_code = p_category_code)
      AND (p_gender_filter  = 'A'             OR gender_filter = p_gender_filter)
      AND (p_age_filter     = 'AGE_BAND_ALL'  OR age_filter   = p_age_filter)
      AND snapshot_date <= p_before_date
  ),
  best_per_product AS (
    -- 동일 product_id가 여러 필터 조합에 중복 등장하는 경우 최고 순위 행만 사용
    SELECT DISTINCT ON (rs.product_id)
      rs.product_id,
      rs.brand_name,
      rs.rank_position,
      rs.discount_rate,
      rs.final_price,
      rs.review_score,
      rs.review_count
    FROM ranking_snapshots rs
    JOIN latest l ON rs.snapshot_date = l.d
    WHERE (p_category_code = '000' OR rs.category_code = p_category_code)
      AND (p_gender_filter  = 'A'             OR rs.gender_filter = p_gender_filter)
      AND (p_age_filter     = 'AGE_BAND_ALL'  OR rs.age_filter   = p_age_filter)
    ORDER BY rs.product_id, rs.rank_position ASC
  )
  SELECT
    l.d                                                                      AS snapshot_date,
    bpp.brand_name,
    COUNT(*)::int                                                            AS sku_count,
    COUNT(*) FILTER (WHERE bpp.rank_position <= 100)::int                   AS top100_count,
    ROUND(AVG(bpp.rank_position))::int                                      AS avg_rank,
    MIN(bpp.rank_position)::int                                             AS best_rank,
    ROUND(AVG(bpp.discount_rate) FILTER (WHERE bpp.discount_rate > 0))::int AS avg_discount,
    ROUND(AVG(bpp.final_price)   FILTER (WHERE bpp.final_price   > 0))::int AS avg_price,
    MIN(bpp.final_price)         FILTER (WHERE bpp.final_price   > 0)       AS min_price,
    MAX(bpp.final_price)         FILTER (WHERE bpp.final_price   > 0)       AS max_price,
    ROUND(AVG(bpp.review_score))::int                                       AS avg_review_score,
    COALESCE(SUM(bpp.review_count), 0)::int                                 AS total_review_count
  FROM best_per_product bpp
  CROSS JOIN latest l
  GROUP BY l.d, bpp.brand_name;
$$;

-- Rollback:
-- DROP FUNCTION IF EXISTS get_brand_snapshot_stats(text, text, text, date);
-- (이전 버전은 01406_get_brand_snapshot_stats.sql에서 재생성)
