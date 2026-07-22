-- ============================================================
-- UTTU — In-App Guide System
-- Migration: 01500_help_articles.sql
-- Version: 1.0  Date: 2026-06-17
--
-- 테이블:
--   1. help_articles        — 가이드 아티클 (Tiptap JSON 본문)
--   2. help_article_versions — 수정 이력
--
-- ⚠️  자동 적용 금지 — 정호철이 Supabase SQL Editor에서 수동 적용.
-- ⚠️  전체 파일을 한 번에 실행.
-- ============================================================


-- ─── 1. help_articles 테이블 ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.help_articles (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text        NOT NULL UNIQUE,
  title         text        NOT NULL,
  page_path     text,
  category      text,
  sort_order    integer     NOT NULL DEFAULT 0,
  content       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_published  boolean     NOT NULL DEFAULT false,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  search_text   tsvector    GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(title, '') || ' ' || coalesce(category, '')
    )
  ) STORED
);

COMMENT ON TABLE  public.help_articles            IS '인앱 가이드 아티클';
COMMENT ON COLUMN public.help_articles.slug       IS '고유 URL 슬러그 (예: ranking-overview)';
COMMENT ON COLUMN public.help_articles.page_path  IS '연결된 앱 경로 (예: /ranking). NULL이면 전역 가이드';
COMMENT ON COLUMN public.help_articles.content    IS 'Tiptap JSON (ProseMirror doc format)';
COMMENT ON COLUMN public.help_articles.search_text IS '제목+카테고리 기반 FTS 벡터 (simple config)';


-- ─── 2. help_article_versions 테이블 ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.help_article_versions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id     uuid        NOT NULL REFERENCES public.help_articles(id) ON DELETE CASCADE,
  version_number integer     NOT NULL,
  title          text        NOT NULL,
  content        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  note           text,
  created_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, version_number)
);

COMMENT ON TABLE public.help_article_versions IS 'help_articles 수정 이력';


-- ─── 3. 인덱스 ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_help_articles_page_path
  ON public.help_articles (page_path)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS idx_help_articles_search
  ON public.help_articles USING GIN (search_text);

CREATE INDEX IF NOT EXISTS idx_help_articles_category_sort
  ON public.help_articles (category, sort_order)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS idx_help_article_versions_article
  ON public.help_article_versions (article_id, version_number DESC);


-- ─── 4. updated_at 자동 갱신 트리거 ─────────────────────────────────────────

-- touch_updated_at()은 다른 마이그레이션에서 이미 정의됐을 수 있으므로 OR REPLACE 사용
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS help_articles_touch ON public.help_articles;
CREATE TRIGGER help_articles_touch
  BEFORE UPDATE ON public.help_articles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ─── 5. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.help_articles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_article_versions ENABLE ROW LEVEL SECURITY;

-- help_articles: 로그인 사용자 = 공개 아티클 읽기, 관리자 = 전체
CREATE POLICY "help_articles: select"
  ON public.help_articles FOR SELECT
  TO authenticated
  USING (is_published = true OR public.is_admin());

CREATE POLICY "help_articles: insert admin"
  ON public.help_articles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "help_articles: update admin"
  ON public.help_articles FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "help_articles: delete admin"
  ON public.help_articles FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- help_article_versions: 해당 아티클이 보이는 경우 읽기 가능, 쓰기는 관리자만
CREATE POLICY "help_versions: select"
  ON public.help_article_versions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.help_articles a
      WHERE a.id = article_id
        AND (a.is_published = true OR public.is_admin())
    )
  );

CREATE POLICY "help_versions: insert admin"
  ON public.help_article_versions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "help_versions: delete admin"
  ON public.help_article_versions FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ============================================================
-- Storage 버킷 (help_assets) — 아래 SQL은 별도로 적용
-- ============================================================
-- ※ storage.buckets INSERT는 테이블 마이그레이션과 분리해서 실행하세요.
-- ※ SQL Editor에서 직접 실행:
--
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--   'help_assets', 'help_assets', false, 5242880,
--   ARRAY['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']
-- )
-- ON CONFLICT (id) DO NOTHING;
--
-- CREATE POLICY "help_assets: select authenticated"
--   ON storage.objects FOR SELECT TO authenticated
--   USING (bucket_id = 'help_assets');
--
-- CREATE POLICY "help_assets: insert admin"
--   ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'help_assets' AND public.is_admin());
--
-- CREATE POLICY "help_assets: delete admin"
--   ON storage.objects FOR DELETE TO authenticated
--   USING (bucket_id = 'help_assets' AND public.is_admin());


-- ============================================================
-- 검증 SQL (적용 후 실행)
-- ============================================================
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name IN ('help_articles', 'help_article_versions')
--  ORDER BY table_name, ordinal_position;
--
-- SELECT tablename, policyname FROM pg_policies
--  WHERE tablename IN ('help_articles', 'help_article_versions')
--  ORDER BY tablename, policyname;
