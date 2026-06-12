-- 01408_ai_readonly_role.sql
-- AI 전용 read-only 역할(uttu_ai_readonly) 생성 및 exec_ai_query 함수 보강
--
-- 목적: writable CTE·문자열 분리 우회 시도를 DB 권한 레벨에서 원천 차단
--   1) uttu_ai_readonly 역할 생성 — public 테이블 SELECT만, 개인정보 테이블 REVOKE
--   2) GRANT uttu_ai_readonly TO postgres  ← SET LOCAL ROLE 권한 확보 (필수)
--   3) RLS 정책에 uttu_ai_readonly 추가   ← TO anon/authenticated 전용 정책 우회 방지
--   4) exec_ai_query EXECUTE 전 SET LOCAL ROLE uttu_ai_readonly 적용
--   5) 정규식에 INTO·NEXTVAL·SETVAL 추가 (다층 방어 강화)
--
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)
-- 순서: 00308_ai_query_function.sql 이후 (독립 실행 가능)

-- ─── 1. uttu_ai_readonly 역할 생성 + postgres 멤버십 ──────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'uttu_ai_readonly') THEN
    CREATE ROLE uttu_ai_readonly NOLOGIN;
  END IF;
END $$;

-- Supabase의 postgres는 진짜 superuser가 아님.
-- SET LOCAL ROLE은 현재 role이 대상 role의 멤버여야만 동작.
-- exec_ai_query는 SECURITY DEFINER → 함수 소유자(postgres)로 실행되므로
-- 이 한 줄 없으면 "permission denied to set role" 런타임 에러.
GRANT uttu_ai_readonly TO postgres;

GRANT USAGE ON SCHEMA public TO uttu_ai_readonly;

-- 현재 public 스키마의 모든 테이블 SELECT 허용
-- (신규 테이블 추가 시 이 파일 REVOKE 섹션 검토 필요)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO uttu_ai_readonly;

-- ─── 2. 개인정보·운영 테이블 SELECT REVOKE ────────────────────────────────────
-- GRANT보다 REVOKE가 항상 우선(PostgreSQL deny 원칙).
-- 마이그레이션 확인 테이블 (확정 존재)
REVOKE SELECT ON TABLE
  -- 사용자 프로필·메모·북마크·히스토리
  public.profiles,
  public.user_notes,
  public.user_bookmarks,
  public.user_view_history,
  public.user_saved_filters,
  public.user_notification_subscriptions,
  public.user_notifications,
  -- AI 시스템 내부 테이블
  public.ai_messages,
  public.ai_sessions,
  public.ai_user_quotas,
  public.ai_usage_daily,
  public.ai_allowed_models,
  -- 운영·설정 테이블
  public.anomaly_notes,
  public.detector_rules
FROM uttu_ai_readonly;

-- 마이그레이션 외 존재 가능 테이블 (조건부 REVOKE)
DO $$ BEGIN
  REVOKE SELECT ON TABLE public.user_subscriptions FROM uttu_ai_readonly;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  REVOKE SELECT ON TABLE public.user_mention_configs FROM uttu_ai_readonly;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ─── 3. RLS 정책에 uttu_ai_readonly 추가 ─────────────────────────────────────
-- 문제: SET LOCAL ROLE 전환 시 RLS도 새 role 기준으로 적용됨.
-- 00099_rls.sql 정책들이 모두 "TO anon"으로 한정 →
-- uttu_ai_readonly는 해당 정책이 없어 에러 없이 조용히 0행 반환.
-- 해결: GRANT가 살아있는 테이블에만 uttu_ai_readonly SELECT 정책 추가.
-- (REVOKE한 14개 테이블에는 추가하지 않음)

-- 00099_rls.sql 대상 13개 테이블 (기존 TO anon 정책과 동일한 USING 조건)
DO $$
DECLARE
  t text;
  pname text;
  tables text[] := ARRAY[
    'companies', 'brands', 'products', 'ranking_snapshots',
    'promotions', 'reviews', 'review_analysis',
    'own_sales_daily', 'own_inventory',
    'dart_disclosures', 'dart_financials',
    'brand_ranking_snapshots', 'promotion_items'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    pname := 'ai_readonly select ' || t;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = pname
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO uttu_ai_readonly USING (true)',
        pname, t
      );
    END IF;
  END LOOP;
END $$;

-- collection_jobs (00307 anon 정책과 동일 조건)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'collection_jobs' AND policyname = 'ai_readonly select collection_jobs'
  ) THEN
    CREATE POLICY "ai_readonly select collection_jobs"
      ON public.collection_jobs FOR SELECT TO uttu_ai_readonly USING (true);
  END IF;
END $$;

-- daily_briefings (01300 — authenticated 전용이었으나 AI 조회 허용)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'daily_briefings' AND policyname = 'ai_readonly select daily_briefings'
  ) THEN
    CREATE POLICY "ai_readonly select daily_briefings"
      ON public.daily_briefings FOR SELECT TO uttu_ai_readonly USING (true);
  END IF;
END $$;

-- external_news (01301 — authenticated 전용이었으나 AI 조회 허용)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'external_news' AND policyname = 'ai_readonly select external_news'
  ) THEN
    CREATE POLICY "ai_readonly select external_news"
      ON public.external_news FOR SELECT TO uttu_ai_readonly USING (true);
  END IF;
END $$;

-- funding_rounds (01303 — anon·authenticated 정책과 동일 조건)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'funding_rounds' AND policyname = 'ai_readonly select funding_rounds'
  ) THEN
    CREATE POLICY "ai_readonly select funding_rounds"
      ON public.funding_rounds FOR SELECT TO uttu_ai_readonly USING (true);
  END IF;
END $$;

-- funding_collection_jobs (01303 — SELECT 정책만, INSERT 정책은 추가하지 않음)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'funding_collection_jobs' AND policyname = 'ai_readonly select funding_collection_jobs'
  ) THEN
    CREATE POLICY "ai_readonly select funding_collection_jobs"
      ON public.funding_collection_jobs FOR SELECT TO uttu_ai_readonly USING (true);
  END IF;
END $$;

-- ─── 4. exec_ai_query 함수 보강 ──────────────────────────────────────────────
-- 변경점 요약:
--   a) EXECUTE 전 SET LOCAL ROLE uttu_ai_readonly → DB 권한 레벨 쓰기·개인정보 차단
--   b) 정규식에 INTO·NEXTVAL·SETVAL 추가
--      - INTO    : SELECT INTO table (테이블 생성 DDL) 차단
--      - NEXTVAL : 시퀀스 전진 부작용 차단
--      - SETVAL  : 시퀀스 직접 조작 차단
--   c) 500행 캡·15초 타임아웃·SECURITY DEFINER 유지 (동작 변경 없음)
--
-- SET LOCAL 동작 보장:
--   PostgREST RPC 호출은 트랜잭션 단위.
--   함수 반환(또는 예외) 후 트랜잭션 종료 시 role 자동 복원.
--   호출자(authenticated·service_role)의 세션은 영향받지 않음.

CREATE OR REPLACE FUNCTION exec_ai_query(query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
DECLARE
  result jsonb;
BEGIN
  -- 1차 방어: SELECT/WITH 시작 여부 확인
  IF NOT (trim(upper(query)) LIKE 'SELECT%' OR trim(upper(query)) LIKE 'WITH%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- 2차 방어: 위험 키워드 차단 (role 제한과 다층 방어)
  --   INTO    : SELECT INTO table DDL (테이블 생성) 차단
  --   NEXTVAL : 시퀀스 전진 부작용 차단
  --   SETVAL  : 시퀀스 직접 조작 차단
  IF query ~* '\m(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|GRANT|REVOKE|EXECUTE|COPY|VACUUM|INTO|NEXTVAL|SETVAL)\M' THEN
    RAISE EXCEPTION 'Dangerous keyword detected';
  END IF;

  -- 3차 방어: DB 권한 레벨 — uttu_ai_readonly 역할로 EXECUTE
  --   해당 역할은 개인정보 14개 테이블에 SELECT 없음 + RLS 정책도 없음.
  --   writable CTE·문자열 분리로 2차 방어를 우회해도 권한 오류로 차단됨.
  --   SET LOCAL: 현재 트랜잭션 종료 시 자동 복원 (PostgREST는 RPC 단위 트랜잭션).
  SET LOCAL ROLE uttu_ai_readonly;

  -- 실행 (500행 하드캡)
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb)
     FROM (SELECT * FROM (%s) _ai_q LIMIT 500) t',
    query
  ) INTO result;

  RETURN COALESCE(result, '[]'::jsonb);

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Query failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION exec_ai_query(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION exec_ai_query(text) TO authenticated, service_role;

COMMENT ON FUNCTION exec_ai_query IS
  'UTTU AI 전용 SELECT 실행기. 500행 하드캡·15초 타임아웃.'
  ' uttu_ai_readonly 역할로 실행하여 개인정보 테이블 접근 및 쓰기 차단.';

-- ─── 검증 쿼리 (적용 후 SQL Editor에서 순서대로 실행) ────────────────────────
--
-- a) 역할 존재 확인
--    SELECT rolname FROM pg_roles WHERE rolname = 'uttu_ai_readonly';
--    → 1행 반환
--
-- b) profiles 차단 확인
--    SELECT exec_ai_query('SELECT id FROM profiles LIMIT 1');
--    → "Query failed: permission denied for table profiles"
--
-- c) 정상 조회 확인 — 빈 배열이면 RLS 0행 문제(함정2 잔존 신호)
--    SELECT exec_ai_query('SELECT brand_name FROM ranking_snapshots LIMIT 1');
--    → [{"brand_name":"..."}] 형태의 실제 1행 반환 (빈 [] 는 실패)
--
-- d) INTO 차단 확인
--    SELECT exec_ai_query('SELECT 1 INTO dummy');
--    → "Dangerous keyword detected"
--
-- e) 함정1 검증 — role 전환 자체가 되는지
--    SELECT exec_ai_query('SELECT 1');
--    → [{"?column?":1}] 반환. "permission denied to set role" 나오면
--       GRANT uttu_ai_readonly TO postgres 누락
--
-- f) 함정2 검증 — c)에서 빈 배열이 나오면 아래로 확인
--    SELECT policyname, roles FROM pg_policies
--    WHERE tablename = 'ranking_snapshots';
--    → 'uttu_ai_readonly' 포함 행이 있어야 함
