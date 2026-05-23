-- products 테이블에 리뷰 확인 시각 컬럼 추가
-- 리뷰 있는 상품: 매일 확인, 리뷰 없는 상품: 7일마다 확인
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS review_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN products.review_checked_at IS
  '리뷰 API를 마지막으로 확인한 시각. NULL=미확인. 리뷰 없는 상품은 7일 주기, 있는 상품은 매일 갱신.';

CREATE INDEX IF NOT EXISTS products_review_checked_at_idx
  ON products (review_checked_at)
  WHERE is_own = TRUE;
