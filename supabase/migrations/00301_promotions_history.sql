-- promotions 이력 관리 구조 변경
-- 기존: musinsa_event_id UNIQUE → 날짜 무관 단일 행 (매일 덮어씀)
-- 신규: (musinsa_event_id, snapshot_date) UNIQUE → 날짜별 별도 행
--       ended_at: 스크래퍼가 종료 감지 시 채움 (API 미노출 or 기간 만료)

-- 1. 기존 musinsa_event_id 단독 UNIQUE 제거
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_musinsa_event_id_key;

-- 2. 종료일 컬럼 추가 (NULL = 현재 진행중)
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS ended_at DATE;

-- 3. (event_id, snapshot_date) 복합 UNIQUE 추가
ALTER TABLE promotions
  ADD CONSTRAINT promotions_event_date_uq UNIQUE (musinsa_event_id, snapshot_date);

-- 4. 활성 프로모션 빠른 조회 인덱스
CREATE INDEX IF NOT EXISTS promotions_active_idx
  ON promotions (ended_at)
  WHERE ended_at IS NULL;

COMMENT ON COLUMN promotions.ended_at IS
  'NULL = 진행중. 스크래퍼가 API 미노출 감지 시 당일 날짜 기록';
