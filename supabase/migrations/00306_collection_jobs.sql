-- 00306_collection_jobs.sql
-- 수집 작업 실시간 상태 추적 테이블
-- Viewer 대시보드에서 Supabase Realtime으로 실시간 수집현황 표시
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

CREATE TABLE IF NOT EXISTS collection_jobs (
  id           bigserial    PRIMARY KEY,
  script       text         NOT NULL,          -- e.g. 'musinsa_ranking'
  label        text         NOT NULL,          -- 화면 표시용, e.g. '상품 랭킹'
  status       text         NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running','done','error')),
  rows_done    integer      NOT NULL DEFAULT 0,
  target       integer,                        -- 예상 총 행 수 (NULL 허용)
  error_msg    text,
  started_at   timestamptz  NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  collection_jobs              IS '데이터 수집 작업 실시간 상태 — Viewer 대시보드 Realtime 구독 대상';
COMMENT ON COLUMN collection_jobs.script       IS '스크래퍼 식별자 (musinsa_ranking, musinsa_review 등)';
COMMENT ON COLUMN collection_jobs.label        IS '대시보드 표시용 한국어 레이블';
COMMENT ON COLUMN collection_jobs.rows_done    IS '현재까지 처리된 행 수 (진행률 계산용)';
COMMENT ON COLUMN collection_jobs.target       IS '예상 총 처리 행 수 (NULL = 미정)';

-- Viewer Realtime 구독 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE collection_jobs;

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_collection_jobs_updated_at
  BEFORE UPDATE ON collection_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 7일 초과 완료/오류 레코드 자동 정리 함수 (pg_cron에서 주기 호출 권장)
CREATE OR REPLACE FUNCTION cleanup_old_jobs() RETURNS void LANGUAGE sql AS $$
  DELETE FROM collection_jobs
  WHERE status IN ('done','error')
    AND finished_at < now() - INTERVAL '7 days';
$$;

-- RLS: 읽기는 인증 사용자 허용, 쓰기는 service_role만
ALTER TABLE collection_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collection_jobs_select"
  ON collection_jobs FOR SELECT
  TO authenticated
  USING (true);

-- Rollback:
-- DROP TRIGGER IF EXISTS trg_collection_jobs_updated_at ON collection_jobs;
-- DROP FUNCTION IF EXISTS cleanup_old_jobs();
-- ALTER PUBLICATION supabase_realtime DROP TABLE collection_jobs;
-- DROP TABLE IF EXISTS collection_jobs;
