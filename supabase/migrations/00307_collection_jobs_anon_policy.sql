-- 00307_collection_jobs_anon_policy.sql
-- collection_jobs: anon(비로그인) 클라이언트도 읽을 수 있도록 정책 추가
-- Viewer supabaseBrowser()는 anon 키를 사용하므로 Realtime 이벤트 수신에 필요
-- 적용: SQL Editor 수동 실행

CREATE POLICY "collection_jobs_select_anon"
  ON collection_jobs FOR SELECT
  TO anon
  USING (true);

-- Rollback:
-- DROP POLICY IF EXISTS "collection_jobs_select_anon" ON collection_jobs;
