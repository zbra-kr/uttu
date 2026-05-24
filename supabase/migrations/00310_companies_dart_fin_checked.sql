-- 00310_companies_dart_fin_checked.sql
-- dart_financials 수집 시도 추적 컬럼 추가
-- collect_financials가 매일 전체 기업 재조회하는 낭비 방지 (313개 × 8 API call/일 = 42분)

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS dart_fin_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN companies.dart_fin_checked_at IS
  '마지막으로 dart_financials 수집을 시도한 시각. NULL=미시도. 7일 내 재시도 생략.';

-- Rollback:
-- ALTER TABLE companies DROP COLUMN IF EXISTS dart_fin_checked_at;
