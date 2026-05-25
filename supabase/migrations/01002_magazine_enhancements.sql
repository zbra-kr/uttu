-- magazine_articles 컬럼 추가 (썸네일, 요약, 원문URL, 2단계 카테고리)
ALTER TABLE public.magazine_articles
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS summary       TEXT,
  ADD COLUMN IF NOT EXISTS landing_url   TEXT,
  ADD COLUMN IF NOT EXISTS sub_category  TEXT;

-- entity_type enum에 magazine 추가 (메모 기능용)
ALTER TYPE public.entity_type ADD VALUE IF NOT EXISTS 'magazine';
