-- DART corp_code 매핑 포기 플래그
-- 자동·수동 매핑이 불가능한 회사를 목록에서 숨기기 위해 사용
-- corp_code는 여전히 NULL (완료가 아닌 포기이므로)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS dart_skip boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN companies.dart_skip IS
  'DART corp_code 매핑 포기 플래그. true = 매핑 불가 회사로 판단, 기본 목록에서 제외. corp_code는 NULL 유지.';
