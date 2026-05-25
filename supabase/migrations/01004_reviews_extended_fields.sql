-- 리뷰 수집 필드 확장: 구매옵션, 체형정보, 만족도 항목, 체험단 여부
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS purchase_option  TEXT,
  ADD COLUMN IF NOT EXISTS member_height    SMALLINT,
  ADD COLUMN IF NOT EXISTS member_weight    SMALLINT,
  ADD COLUMN IF NOT EXISTS member_gender    TEXT,
  ADD COLUMN IF NOT EXISTS satisfactions    JSONB,
  ADD COLUMN IF NOT EXISTS is_experience    BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN reviews.purchase_option IS '구매 당시 선택 옵션 (예: WS, M/BLACK). API goodsOption 필드';
COMMENT ON COLUMN reviews.member_height   IS '작성자 키(cm). userProfileInfo.userHeight — 체형 통계 목적';
COMMENT ON COLUMN reviews.member_weight   IS '작성자 몸무게(kg). userProfileInfo.userWeight — 체형 통계 목적';
COMMENT ON COLUMN reviews.member_gender   IS '작성자 성별 (남성/여성). userProfileInfo.reviewSex — 닉네임/ID는 수집 금지';
COMMENT ON COLUMN reviews.satisfactions   IS '[{"attribute":"사이즈","answer":"정사이즈"}, ...] 형태. reviewSurveySatisfaction.questions 정규화';
COMMENT ON COLUMN reviews.is_experience   IS '체험단 리뷰 여부. specialtyCodes 비어있으면 false';
