-- 01404_get_company_product_dist.sql
-- fetchCompanyProductDist 대체 — 성별×연령, 가격대, 할인율, 리뷰 분포
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE OR REPLACE FUNCTION get_company_product_dist(p_brand_names text[])
RETURNS json
LANGUAGE sql SECURITY INVOKER STABLE
AS $$
  WITH latest_per_brand AS (
    SELECT brand_name, MAX(snapshot_date) AS snapshot_date
    FROM ranking_snapshots
    WHERE brand_name = ANY(p_brand_names)
      AND category_code = '000'
      AND gender_filter = 'A'
      AND age_filter    = 'AGE_BAND_ALL'
    GROUP BY brand_name
  ),
  -- 모든 gender×age 조합 수집 (필터 없음)
  snap AS (
    SELECT rs.gender_filter, rs.age_filter, rs.category_code, rs.musinsa_no,
           rs.final_price, rs.discount_rate, rs.review_score, rs.rank_position
    FROM ranking_snapshots rs
    JOIN latest_per_brand lpb ON rs.brand_name     = lpb.brand_name
                              AND rs.snapshot_date = lpb.snapshot_date
  ),
  gender_age_agg AS (
    SELECT gender_filter, age_filter, COUNT(DISTINCT musinsa_no)::int AS sku_count
    FROM snap
    GROUP BY gender_filter, age_filter
  ),
  -- category='000' 기준 musinsa_no 중복 제거 (첫 번째 rank 행 사용)
  base_dedup AS (
    SELECT DISTINCT ON (musinsa_no) musinsa_no, final_price, discount_rate, review_score
    FROM snap WHERE category_code = '000'
    ORDER BY musinsa_no, rank_position
  ),
  price_agg AS (
    SELECT
      COUNT(*) FILTER (WHERE final_price IS NOT NULL AND final_price >= 0      AND final_price <  30000)::int AS p0,
      COUNT(*) FILTER (WHERE final_price IS NOT NULL AND final_price >= 30000  AND final_price <  50000)::int AS p1,
      COUNT(*) FILTER (WHERE final_price IS NOT NULL AND final_price >= 50000  AND final_price < 100000)::int AS p2,
      COUNT(*) FILTER (WHERE final_price IS NOT NULL AND final_price >= 100000 AND final_price < 200000)::int AS p3,
      COUNT(*) FILTER (WHERE final_price IS NOT NULL AND final_price >= 200000 AND final_price < 300000)::int AS p4,
      COUNT(*) FILTER (WHERE final_price IS NOT NULL AND final_price >= 300000 AND final_price < 500000)::int AS p5,
      COUNT(*) FILTER (WHERE final_price IS NOT NULL AND final_price >= 500000)::int                        AS p6
    FROM base_dedup
  ),
  discount_agg AS (
    SELECT
      COUNT(*) FILTER (WHERE COALESCE(discount_rate, 0) >= 0  AND COALESCE(discount_rate, 0) < 1)::int AS d0,
      COUNT(*) FILTER (WHERE discount_rate >= 1  AND discount_rate <  10)::int AS d1,
      COUNT(*) FILTER (WHERE discount_rate >= 10 AND discount_rate <  20)::int AS d2,
      COUNT(*) FILTER (WHERE discount_rate >= 20 AND discount_rate <  30)::int AS d3,
      COUNT(*) FILTER (WHERE discount_rate >= 30 AND discount_rate <  40)::int AS d4,
      COUNT(*) FILTER (WHERE discount_rate >= 40 AND discount_rate <  50)::int AS d5,
      COUNT(*) FILTER (WHERE discount_rate >= 50 AND discount_rate < 101)::int AS d6
    FROM base_dedup
  ),
  review_agg AS (
    SELECT
      COUNT(*) FILTER (WHERE review_score >= 1  AND review_score <  40)::int AS r0,
      COUNT(*) FILTER (WHERE review_score >= 40 AND review_score <  60)::int AS r1,
      COUNT(*) FILTER (WHERE review_score >= 60 AND review_score <  70)::int AS r2,
      COUNT(*) FILTER (WHERE review_score >= 70 AND review_score <  80)::int AS r3,
      COUNT(*) FILTER (WHERE review_score >= 80 AND review_score <  90)::int AS r4,
      COUNT(*) FILTER (WHERE review_score >= 90 AND review_score < 101)::int AS r5
    FROM base_dedup
  )
  SELECT json_build_object(
    'genderAge', COALESCE((
      SELECT json_agg(row_to_json(g)) FROM gender_age_agg g
    ), '[]'::json),
    'priceBuckets', json_build_array(
      json_build_object('label', '~3만',   'count', p.p0),
      json_build_object('label', '3~5만',  'count', p.p1),
      json_build_object('label', '5~10만', 'count', p.p2),
      json_build_object('label', '10~20만','count', p.p3),
      json_build_object('label', '20~30만','count', p.p4),
      json_build_object('label', '30~50만','count', p.p5),
      json_build_object('label', '50만+',  'count', p.p6)
    ),
    'discountBuckets', json_build_array(
      json_build_object('label', '무할인', 'count', d.d0),
      json_build_object('label', '1~10%', 'count', d.d1),
      json_build_object('label', '10~20%','count', d.d2),
      json_build_object('label', '20~30%','count', d.d3),
      json_build_object('label', '30~40%','count', d.d4),
      json_build_object('label', '40~50%','count', d.d5),
      json_build_object('label', '50%+',  'count', d.d6)
    ),
    'reviewBuckets', json_build_array(
      json_build_object('label', '~40',   'count', r.r0),
      json_build_object('label', '40~60', 'count', r.r1),
      json_build_object('label', '60~70', 'count', r.r2),
      json_build_object('label', '70~80', 'count', r.r3),
      json_build_object('label', '80~90', 'count', r.r4),
      json_build_object('label', '90+',   'count', r.r5)
    )
  )
  FROM price_agg p, discount_agg d, review_agg r;
$$;

-- Rollback:
-- DROP FUNCTION IF EXISTS get_company_product_dist(text[]);
