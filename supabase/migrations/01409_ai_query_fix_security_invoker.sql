-- 01409_ai_query_fix_security_invoker.sql
--
-- 원인: PostgreSQL에서 SECURITY DEFINER 함수 내 SET LOCAL ROLE 금지
--       → 01408에서 exec_ai_query 호출 시 "cannot set parameter 'role' within
--         security-definer function" 런타임 에러
--
-- 해결:
--   1) SECURITY DEFINER 제거 → SECURITY INVOKER (기본값)
--   2) authenticated / service_role 에 uttu_ai_readonly 멤버십 부여
--      WITH INHERIT FALSE: 자동 권한 상속 없이 SET ROLE 전용 허용 (PG 16+)

GRANT uttu_ai_readonly TO authenticated WITH INHERIT FALSE;
GRANT uttu_ai_readonly TO service_role WITH INHERIT FALSE;

CREATE OR REPLACE FUNCTION exec_ai_query(query text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
SET statement_timeout = '15s'
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT (trim(upper(query)) LIKE 'SELECT%' OR trim(upper(query)) LIKE 'WITH%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  IF query ~* '\m(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|GRANT|REVOKE|EXECUTE|COPY|VACUUM|INTO|NEXTVAL|SETVAL)\M' THEN
    RAISE EXCEPTION 'Dangerous keyword detected';
  END IF;

  SET LOCAL ROLE uttu_ai_readonly;

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
  ' uttu_ai_readonly 역할로 전환하여 개인정보 테이블 접근 및 쓰기 차단.'
  ' SECURITY INVOKER: SET LOCAL ROLE uttu_ai_readonly (DEFINER에서 불가).';
