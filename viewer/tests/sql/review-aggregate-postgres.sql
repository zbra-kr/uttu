-- Disposable PostgreSQL database ONLY. Not production; never run in Supabase SQL Editor.
-- psql -v ON_ERROR_STOP=1 -d uttu_review_aggregate_fixture -f viewer/tests/sql/review-aggregate-postgres.sql
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'uttu_review_aggregate_fixture' THEN
    RAISE EXCEPTION 'Disposable fixture database required';
  END IF;
  IF to_regclass('public.reviews') IS NOT NULL THEN
    RAISE EXCEPTION 'Fixture requires absent reviews table';
  END IF;
  IF to_regprocedure('public.get_review_stats_v1(date)') IS NOT NULL THEN
    RAISE EXCEPTION 'Fixture requires absent aggregate routine';
  END IF;
  IF EXISTS (SELECT FROM pg_roles
      WHERE rolname IN ('authenticated', 'anon') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Fixture roles must be NOSUPERUSER and NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
CREATE TABLE public.reviews(rating smallint, has_image boolean, review_date date);
INSERT INTO public.reviews VALUES
 (5,true,'2026-10-08'),(4,false,'2026-10-07'),(3,true,'2026-10-06'),
 (2,false,'2026-10-07'),(1,true,'2026-10-05'),(5,false,'2026-09-01');
\ir ../../../supabase/migrations/01413_get_review_stats_v1.sql
DO $$ DECLARE x record; BEGIN
 SELECT * INTO x FROM public.get_review_stats_v1('2026-10-07');
 IF ROW(x.rating_5,x.rating_4,x.rating_3,x.rating_2,x.rating_1,x.image_count)
     IS DISTINCT FROM ROW(1::bigint,1::bigint,0::bigint,1::bigint,0::bigint,1::bigint) THEN
   RAISE EXCEPTION 'Inclusive cutoff mismatch';
 END IF;
 SELECT * INTO x FROM public.get_review_stats_v1(NULL);
 IF ROW(x.rating_5,x.rating_4,x.rating_3,x.rating_2,x.rating_1,x.image_count)
     IS DISTINCT FROM ROW(2::bigint,1::bigint,1::bigint,1::bigint,1::bigint,3::bigint) THEN
   RAISE EXCEPTION 'All-time mismatch';
 END IF;
 SELECT * INTO x FROM public.get_review_stats_v1('2026-10-09');
 IF ROW(x.rating_5,x.rating_4,x.rating_3,x.rating_2,x.rating_1,x.image_count)
     IS DISTINCT FROM ROW(0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint) THEN
   RAISE EXCEPTION 'Empty mismatch';
 END IF;
 IF has_function_privilege('anon','public.get_review_stats_v1(date)','EXECUTE') OR
    NOT has_function_privilege('authenticated','public.get_review_stats_v1(date)','EXECUTE') THEN
   RAISE EXCEPTION 'Routine ACL mismatch';
 END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.get_review_stats_v1(date)'::regprocedure) THEN
   RAISE EXCEPTION 'Routine must be invoker';
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.reviews TO authenticated;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_visible_reviews ON public.reviews FOR SELECT TO authenticated USING (rating >= 3);
SET LOCAL ROLE authenticated;
DO $$ DECLARE x record; BEGIN
 SELECT * INTO x FROM public.get_review_stats_v1(NULL);
 IF ROW(x.rating_5,x.rating_4,x.rating_3,x.rating_2,x.rating_1,x.image_count)
     IS DISTINCT FROM ROW(2::bigint,1::bigint,1::bigint,0::bigint,0::bigint,2::bigint) THEN
   RAISE EXCEPTION 'Caller RLS not respected';
 END IF;
END $$;
RESET ROLE;
REVOKE SELECT ON public.reviews FROM authenticated;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
   PERFORM * FROM public.get_review_stats_v1(NULL);
   RAISE EXCEPTION 'Missing table access must fail';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
   PERFORM * FROM public.get_review_stats_v1(NULL);
   RAISE EXCEPTION 'Anonymous routine execution must fail';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
