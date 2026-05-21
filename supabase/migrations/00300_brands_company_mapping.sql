-- 브랜드-회사 매핑 수동 관리 컬럼
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS company_skip      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS company_confirmed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN brands.company_skip      IS '브랜드-회사 매핑 건너뜀';
COMMENT ON COLUMN brands.company_confirmed IS '브랜드-회사 매핑 수동 확인 완료';
