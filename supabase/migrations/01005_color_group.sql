-- 색상 그룹 기반 리뷰 수집 개편
-- 무신사: 동일 스타일 다른 색상 variants가 리뷰 풀을 공유함
-- goods-detail.musinsa.com/api2/goods/{goodsNo}/curation/other-color 로 그룹 확인
-- color_group_id = curationId (OTHER_COLOR 타입)

-- 1. products: 색상 그룹 ID 추가
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS color_group_id BIGINT;

CREATE INDEX IF NOT EXISTS products_color_group_idx
  ON products(color_group_id)
  WHERE color_group_id IS NOT NULL;

COMMENT ON COLUMN products.color_group_id IS
  '무신사 색상 그룹 ID (curation other-color의 curationId). '
  'NULL = 다른 색상 없는 단독 상품. '
  'goods-detail.musinsa.com/api2/goods/{goodsNo}/curation/other-color 로 수집.';

-- 2. reviews: goods_no 추가 (어느 variant에 달린 리뷰인지)
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS goods_no TEXT;

COMMENT ON COLUMN reviews.goods_no IS
  '리뷰가 실제로 달린 variant의 musinsa goodsNo. '
  'API 응답 item.goods.goodsNo. '
  '같은 그룹이면 어떤 goodsNo로 조회해도 동일 풀이 반환됨.';

-- 3. reviews: color_group_id 추가 (그룹 단위 집계·수집 관리용)
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS color_group_id BIGINT;

CREATE INDEX IF NOT EXISTS reviews_color_group_date_idx
  ON reviews(color_group_id, review_date DESC)
  WHERE color_group_id IS NOT NULL;

COMMENT ON COLUMN reviews.color_group_id IS
  '해당 리뷰가 속한 색상 그룹 ID. products.color_group_id 와 동일값. '
  '그룹 단위 리뷰 집계 및 수집 완전성 체크에 사용.';

-- 4. 기존 리뷰 goods_no 마이그레이션 (products.musinsa_no 역산)
UPDATE reviews r
SET goods_no = p.musinsa_no
FROM products p
WHERE p.id = r.product_id
  AND r.goods_no IS NULL;

-- 5. color_group_id는 step2 스크립트(other-color API 수집) 완료 후 별도 실행:
-- UPDATE reviews r
-- SET color_group_id = p.color_group_id
-- FROM products p
-- WHERE p.musinsa_no = r.goods_no
--   AND p.color_group_id IS NOT NULL
--   AND r.color_group_id IS NULL;
