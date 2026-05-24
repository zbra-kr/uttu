-- 00305_remark_columns.sql
-- brands, companies 테이블에 메모(remark) 컬럼 추가
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

ALTER TABLE brands    ADD COLUMN IF NOT EXISTS remark TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS remark TEXT;

COMMENT ON COLUMN brands.remark    IS '브랜드-회사 매핑 관련 메모 (관리자 입력)';
COMMENT ON COLUMN companies.remark IS '회사 관련 메모 (관리자 입력)';

-- Rollback:
-- ALTER TABLE brands    DROP COLUMN IF EXISTS remark;
-- ALTER TABLE companies DROP COLUMN IF EXISTS remark;
