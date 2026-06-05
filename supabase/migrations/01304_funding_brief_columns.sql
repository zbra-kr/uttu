-- 01304_funding_brief_columns.sql
-- 투자 브리핑 저장 컬럼 추가 (funding Round 5)
-- 적용: SQL Editor 수동 실행

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS funding_brief_md   TEXT,
  ADD COLUMN IF NOT EXISTS funding_brief_at   TIMESTAMPTZ;

COMMENT ON COLUMN companies.funding_brief_md
  IS 'Claude Sonnet이 생성한 투자이력 경영진 브리핑 (마크다운). NULL=미생성.';
COMMENT ON COLUMN companies.funding_brief_at
  IS '마지막 브리핑 생성 시각.';
