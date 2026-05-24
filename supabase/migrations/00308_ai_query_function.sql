-- 00308_ai_query_function.sql
-- UTTU AI 전용 읽기 전용 SQL 실행 함수
-- 호출: supabase.rpc('exec_ai_query', { query: 'SELECT ...' })
--
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

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
  -- SELECT 전용 안전 검사
  IF NOT (trim(upper(query)) LIKE 'SELECT%' OR trim(upper(query)) LIKE 'WITH%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  IF query ~* '\m(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|GRANT|REVOKE|EXECUTE|COPY|VACUUM)\M' THEN
    RAISE EXCEPTION 'Dangerous keyword detected';
  END IF;

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

COMMENT ON FUNCTION exec_ai_query IS 'UTTU AI 전용 SELECT 실행기. 500행 하드캡, 15초 타임아웃.';
