-- profiles 확장 — /today 기본 선택 탭 저장
-- default_briefing: 사용자가 마지막으로 선택한 브리핑 탭 기억용
-- 적용 순서: 01300 → 01301 → 01302

-- default_briefing 컬럼 추가
-- 'auto' = 미선택(기본값), 나머지는 사용자가 명시적으로 선택한 탭
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS default_briefing TEXT
    CHECK (default_briefing IN ('executive', 'staff', 'cs', 'auto'))
    DEFAULT 'auto';

COMMENT ON COLUMN profiles.default_briefing IS
  '/today 기본 탭. auto=미선택(executive 탭 기본 표시), 나머지=사용자 선택 기억.';

-- team 컬럼 CHECK 제약은 추가하지 않음 — 실제 팀명(우먼기획팀 등) 자유 텍스트 유지

-- 검증 쿼리
-- SELECT default_briefing FROM profiles LIMIT 5;   -- 모두 'auto' 기대
-- SELECT column_name, column_default FROM information_schema.columns
--   WHERE table_name='profiles' AND column_name='default_briefing';
