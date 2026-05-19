-- 00014_magazine.sql
-- 무신사 매거진 기사 수집
-- API: content.musinsa.com/api2/content/musinsa-content/v1/contents
--   .relatedGoodsList[] → musinsa_no (Playwright 불필요)
-- 총 누적 기사: ~120,754건 (2026-05-20 기준), 신규 ~20건/일
-- 수집 주기: 매일 증분 (published_at 기준 신규 기사만)
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE magazine_articles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id      TEXT        NOT NULL UNIQUE,              -- 정수 ID (string, e.g. "154844")
  cms_index       TEXT,                                     -- snowflake cmsIndex (신규 형식)
  title           TEXT        NOT NULL,
  category        TEXT,                                     -- contentsType1DepthLabel (트렌드/쇼핑, 스타일/코디 등)
  brand_names     TEXT[]      NOT NULL DEFAULT '{}',        -- brandNameList
  view_count      INTEGER     NOT NULL DEFAULT 0,
  comment_count   INTEGER     NOT NULL DEFAULT 0,
  published_at    TIMESTAMPTZ NOT NULL,                     -- displayStartDate
  collected_at    DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX magazine_articles_published_idx  ON magazine_articles(published_at DESC);
CREATE INDEX magazine_articles_collected_idx  ON magazine_articles(collected_at DESC);
CREATE INDEX magazine_articles_category_idx   ON magazine_articles(category, published_at DESC);

COMMENT ON TABLE  magazine_articles               IS '무신사 매거진 기사 — 신규 기사 매일 증분 수집';
COMMENT ON COLUMN magazine_articles.article_id    IS '정수 ID (string) — UNIQUE 중복 방지';
COMMENT ON COLUMN magazine_articles.cms_index     IS 'snowflake cmsIndex — 신규 기사 형식 (landingUrl의 ID)';
COMMENT ON COLUMN magazine_articles.brand_names   IS 'brandNameList — 기사에 등장한 브랜드명 배열';

-- Rollback:
-- DROP TABLE IF EXISTS magazine_article_products;
-- DROP TABLE IF EXISTS magazine_articles;


CREATE TABLE magazine_article_products (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id      TEXT        NOT NULL REFERENCES magazine_articles(article_id) ON DELETE CASCADE,
  product_id      UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  musinsa_no      TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT magazine_article_products_uq UNIQUE (article_id, musinsa_no)
);

CREATE INDEX mag_article_products_article_idx  ON magazine_article_products(article_id);
CREATE INDEX mag_article_products_product_idx  ON magazine_article_products(product_id);
CREATE INDEX mag_article_products_no_idx       ON magazine_article_products(musinsa_no);

COMMENT ON TABLE  magazine_article_products           IS '매거진 기사 × 상품 연결 — relatedGoodsList 기반';
COMMENT ON COLUMN magazine_article_products.article_id IS 'magazine_articles.article_id ON DELETE CASCADE';

-- Rollback:
-- DROP TABLE IF EXISTS magazine_article_products;
