-- 01408_ai_readonly_role.sql
-- AI 전용 read-only 역할(uttu_ai_readonly) 생성 및 exec_ai_query 함수 보강
--
-- 변경 이력:
--   v1: 초안 (트랜잭션 없음, 멱등 불완전 → SQL Editor에서 롤백)
--   v2: 완전 멱등 재작성
--       - BEGIN/COMMIT 단일 트랜잭션 (부분 적용 불가)
--       - 모든 DDL에 IF NOT EXISTS / DROP IF EXISTS / OR REPLACE
--       - REVOKE 루프에 EXCEPTION WHEN undefined_table 핸들러
--       - 정책 루프에 DROP POLICY IF EXISTS + CREATE POLICY
--       - GRANT uttu_ai_readonly TO postgres 포함 (SET LOCAL ROLE 권한 확보)
--       - 신규 테이블 4개 정책 대상 추가
--       - 맨 끝 자기검증 블록 (실패 시 RAISE EXCEPTION → 전체 롤백)
--
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)
--       이 파일 전체를 복사해 SQL Editor에 붙여넣고 1회 실행

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. 역할 생성 (멱등)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'uttu_ai_readonly') THEN
    CREATE ROLE uttu_ai_readonly NOLOGIN;
    RAISE NOTICE 'uttu_ai_readonly 역할 생성됨';
  ELSE
    RAISE NOTICE 'uttu_ai_readonly 역할 이미 존재 — 스킵';
  END IF;
END $$;

-- Supabase postgres는 진짜 superuser가 아님 → 멤버십 없이 SET LOCAL ROLE 불가.
-- "permission denied to set role" 런타임 에러의 원인.
GRANT uttu_ai_readonly TO postgres;

GRANT USAGE ON SCHEMA public TO uttu_ai_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO uttu_ai_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. 개인정보·운영 테이블 SELECT REVOKE (멱등)
--    루프 + EXCEPTION WHEN undefined_table:
--    테이블이 없어도 에러 없이 NOTICE만 출력 → 롤백 없음
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t    text;
  blocked text[] := ARRAY[
    -- 사용자 프로필·메모·북마크·히스토리·알림
    'profiles',
    'user_notes',
    'user_bookmarks',
    'user_view_history',
    'user_saved_filters',
    'user_notification_subscriptions',
    'user_notifications',
    'user_subscriptions',       -- 마이그레이션 外 존재 가능
    'user_mention_configs',     -- 마이그레이션 外 존재 가능
    -- AI 시스템 내부
    'ai_messages',
    'ai_sessions',
    'ai_user_quotas',
    'ai_usage_daily',
    'ai_allowed_models',
    -- 운영·설정
    'anomaly_notes',
    'detector_rules'
  ];
BEGIN
  FOREACH t IN ARRAY blocked LOOP
    BEGIN
      EXECUTE format('REVOKE SELECT ON TABLE public.%I FROM uttu_ai_readonly', t);
    EXCEPTION
      WHEN undefined_table THEN
        RAISE NOTICE 'REVOKE 스킵: 테이블 % 없음', t;
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'REVOKE 스킵: % 권한 없음', t;
    END;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS 정책 — uttu_ai_readonly SELECT 추가 (멱등)
--
--    문제: 00099_rls.sql 정책이 모두 "TO anon" 전용.
--    SET LOCAL ROLE 전환 시 uttu_ai_readonly 는 anon·authenticated 어느 쪽도 아님
--    → 에러 없이 조용히 0행 반환 (AI가 "데이터 없음"으로 오답).
--
--    해결: GRANT가 살아있는 테이블에만 uttu_ai_readonly SELECT 정책 추가.
--    REVOKE된 14개 테이블은 포함하지 않음.
--
--    루프 구조: DROP POLICY IF EXISTS → CREATE POLICY (멱등)
--    존재하지 않는 테이블은 EXCEPTION WHEN undefined_table 으로 스킵
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t     text;
  pname text;
  tables text[] := ARRAY[
    -- 00099_rls.sql (TO anon 전용이었던 13개)
    'companies',
    'brands',
    'products',
    'ranking_snapshots',
    'promotions',
    'reviews',
    'review_analysis',
    'own_sales_daily',
    'own_inventory',
    'dart_disclosures',
    'dart_financials',
    'brand_ranking_snapshots',
    'promotion_items',
    -- 00306/00307 collection_jobs
    'collection_jobs',
    -- 01300 daily_briefings (authenticated 전용이었음)
    'daily_briefings',
    -- 01301 external_news (authenticated 전용이었음)
    'external_news',
    -- 01303 funding
    'funding_rounds',
    'funding_collection_jobs',
    -- 추가 스캔 발견 테이블 (RLS 활성화 확인됨)
    'competitor_brands',
    'product_matches',
    'snap_products',
    'magazine_article_products'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    pname := 'ai_readonly select ' || t;
    BEGIN
      -- 기존 정책 제거 후 재생성 → 완전 멱등
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pname, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO uttu_ai_readonly USING (true)',
        pname, t
      );
    EXCEPTION
      WHEN undefined_table THEN
        RAISE NOTICE '정책 스킵: 테이블 % 없음', t;
      WHEN feature_not_supported THEN
        -- 테이블에 RLS가 비활성화 상태일 때도 POLICY 생성은 가능 (적용 안 될 뿐)
        RAISE NOTICE '정책 스킵: % RLS 비활성화 상태 (정책만 등록됨)', t;
    END;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. exec_ai_query 함수 교체 (CREATE OR REPLACE → 멱등)
--
--    변경점:
--      a) SET LOCAL ROLE uttu_ai_readonly — EXECUTE 전 역할 전환
--      b) 정규식에 INTO·NEXTVAL·SETVAL 추가
--      c) 500행 캡·15초 타임아웃·SECURITY DEFINER 유지
-- ────────────────────────────────────────────────────────────────────────────
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
  -- 1차: SELECT/WITH 시작 확인
  IF NOT (trim(upper(query)) LIKE 'SELECT%' OR trim(upper(query)) LIKE 'WITH%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- 2차: 위험 키워드 차단
  --   INTO    : SELECT INTO table DDL 차단
  --   NEXTVAL : 시퀀스 전진 부작용 차단
  --   SETVAL  : 시퀀스 직접 조작 차단
  IF query ~* '\m(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|GRANT|REVOKE|EXECUTE|COPY|VACUUM|INTO|NEXTVAL|SETVAL)\M' THEN
    RAISE EXCEPTION 'Dangerous keyword detected';
  END IF;

  -- 3차: DB 권한 레벨 — uttu_ai_readonly 역할로 EXECUTE
  --   개인정보 테이블(profiles·user_*·ai_*·anomaly_notes·detector_rules):
  --     REVOKE SELECT + RLS 정책 없음 → 두 겹으로 차단
  --   SET LOCAL: 현재 트랜잭션 종료 시 역할 자동 복원
  --   (PostgREST RPC는 요청 단위 트랜잭션 → 호출자 세션에 영향 없음)
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

-- ────────────────────────────────────────────────────────────────────────────
-- 5. 자기검증 — 실패 시 RAISE EXCEPTION → 전체 트랜잭션 롤백
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_prosrc      text;
  v_policy_cnt  int;
  v_member      boolean;
BEGIN
  -- [1/3] 함수 prosrc에 uttu_ai_readonly 포함 확인
  SELECT prosrc
    INTO v_prosrc
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname = 'exec_ai_query'
     AND n.nspname = 'public';

  IF v_prosrc IS NULL THEN
    RAISE EXCEPTION '❌ [1/3] exec_ai_query 함수를 public 스키마에서 찾을 수 없음';
  END IF;
  IF position('uttu_ai_readonly' IN v_prosrc) = 0 THEN
    RAISE EXCEPTION '❌ [1/3] exec_ai_query prosrc에 uttu_ai_readonly 없음 — CREATE OR REPLACE 실패';
  END IF;
  RAISE NOTICE '✅ [1/3] exec_ai_query prosrc: uttu_ai_readonly 포함 확인';

  -- [2/3] ai_readonly 정책 개수 > 0 확인
  SELECT count(*)
    INTO v_policy_cnt
    FROM pg_policies
   WHERE policyname LIKE 'ai_readonly select%';

  IF v_policy_cnt = 0 THEN
    RAISE EXCEPTION '❌ [2/3] ai_readonly SELECT 정책 0개 — 정책 생성 실패';
  END IF;
  RAISE NOTICE '✅ [2/3] ai_readonly SELECT 정책 %개 적용 확인', v_policy_cnt;

  -- [3/3] postgres → uttu_ai_readonly 멤버십 확인
  SELECT EXISTS (
    SELECT 1
      FROM pg_auth_members am
      JOIN pg_roles r ON r.oid = am.roleid
      JOIN pg_roles m ON m.oid = am.member
     WHERE r.rolname = 'uttu_ai_readonly'
       AND m.rolname = 'postgres'
  ) INTO v_member;

  IF NOT v_member THEN
    RAISE EXCEPTION '❌ [3/3] postgres가 uttu_ai_readonly 멤버 아님 — GRANT TO postgres 실패';
  END IF;
  RAISE NOTICE '✅ [3/3] postgres → uttu_ai_readonly 멤버십 확인';

  RAISE NOTICE '';
  RAISE NOTICE '🎉 자기검증 통과. COMMIT 후 아래 SQL Editor 검증 쿼리(a~f) 실행 권장.';
END $$;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- SQL Editor 검증 쿼리 (COMMIT 이후 별도 실행)
-- ────────────────────────────────────────────────────────────────────────────
--
-- a) 역할 존재
--    SELECT rolname FROM pg_roles WHERE rolname = 'uttu_ai_readonly';
--    → 1행
--
-- b) profiles 차단 (권한 에러 기대)
--    SELECT exec_ai_query('SELECT id FROM profiles LIMIT 1');
--    → "Query failed: permission denied for table profiles"
--
-- c) 정상 조회 — 빈 [] 이면 RLS 0행 문제 잔존
--    SELECT exec_ai_query('SELECT brand_name FROM ranking_snapshots LIMIT 1');
--    → [{"brand_name":"..."}]  ← 실제 데이터 1행 (빈 [] 는 실패)
--
-- d) INTO 차단
--    SELECT exec_ai_query('SELECT 1 INTO dummy');
--    → "Dangerous keyword detected"
--
-- e) 함정1: SET LOCAL ROLE 자체가 되는지
--    SELECT exec_ai_query('SELECT 1');
--    → [{"?column?":1}]
--    "permission denied to set role" 나오면 GRANT TO postgres 미적용
--
-- f) 함정2: RLS 0행 진단 (c에서 빈 결과 시)
--    SELECT policyname, roles
--      FROM pg_policies
--     WHERE tablename = 'ranking_snapshots';
--    → policyname = 'ai_readonly select ranking_snapshots', roles = '{uttu_ai_readonly}' 있어야 함
