-- 00006_reviews.sql
-- 자사 브랜드 상품 리뷰 (개인정보 보호 준수)
-- 수집 대상: CO(커버낫)/LE(리)/WA(와키윌리) 상품만
-- 금지: 닉네임, 사용자 ID — 절대 수집·저장 금지
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE reviews (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  musinsa_review_id   TEXT        UNIQUE NOT NULL,      -- 중복 방지 키 (닉네임·사용자ID 금지)
  rating              SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text         TEXT        NOT NULL DEFAULT '',  -- 본문 (빈 리뷰 허용)
  review_date         DATE        NOT NULL,
  helpful_count       INTEGER     NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 핵심 인덱스 (docs/skills/02-supabase.md 인덱스 전략 준수)
CREATE INDEX reviews_product_date_idx ON reviews(product_id, review_date DESC);

CREATE INDEX reviews_low_rating_idx
  ON reviews(product_id, rating)
  WHERE rating <= 2;

CREATE INDEX reviews_high_rating_idx
  ON reviews(product_id, rating)
  WHERE rating >= 4;

COMMENT ON TABLE  reviews                    IS '자사 브랜드 상품 리뷰 — 닉네임·사용자ID 저장 절대 금지';
COMMENT ON COLUMN reviews.musinsa_review_id  IS '중복 방지 UNIQUE 키 — upsert ignore_duplicates=true 활용';

-- Rollback:
-- DROP TABLE IF EXISTS reviews;
