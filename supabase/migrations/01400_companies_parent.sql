-- 회사 자회사 관계 — 단순 부모-자식 self-relation
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

ALTER TABLE companies
  ADD COLUMN parent_company_id UUID
    REFERENCES companies(id)
    ON DELETE SET NULL;

CREATE INDEX companies_parent_idx
  ON companies(parent_company_id)
  WHERE parent_company_id IS NOT NULL;

COMMENT ON COLUMN companies.parent_company_id IS
  '모회사 ID. NULL이면 최상위 회사. 자회사 트리는 재귀 CTE로 조회.';

-- 자기 자신 참조 방지
ALTER TABLE companies
  ADD CONSTRAINT companies_no_self_parent
    CHECK (id != parent_company_id);

-- ── group_brands: 루트 회사부터 재귀로 전체 브랜드 조회 ──────────────────────
CREATE OR REPLACE FUNCTION group_brands(root_company_id UUID)
RETURNS TABLE (
  brand_id    UUID,
  brand_name  TEXT,
  company_id  UUID,
  company_name TEXT,
  depth       INT
) AS $$
  WITH RECURSIVE company_tree AS (
    SELECT id, corp_name AS name, parent_company_id, 0 AS depth
    FROM companies
    WHERE id = root_company_id

    UNION ALL

    SELECT c.id, c.corp_name, c.parent_company_id, ct.depth + 1
    FROM companies c
    JOIN company_tree ct ON c.parent_company_id = ct.id
  )
  SELECT
    b.id          AS brand_id,
    b.name        AS brand_name,
    ct.id         AS company_id,
    ct.name       AS company_name,
    ct.depth
  FROM brands b
  JOIN company_tree ct ON b.company_id = ct.id
  ORDER BY ct.depth, b.name;
$$ LANGUAGE SQL STABLE;

-- ── 검증 쿼리 (적용 후 실행) ─────────────────────────────────────────────────
-- SELECT id, corp_name, parent_company_id FROM companies LIMIT 5;
--
-- 데이터 입력 예시 (피스피스스튜디오 → 월스):
-- UPDATE companies
--   SET parent_company_id = (SELECT id FROM companies WHERE corp_name ILIKE '%피스피스%')
-- WHERE corp_name ILIKE '%월스%';
--
-- 재귀 조회 테스트:
-- SELECT * FROM group_brands(
--   (SELECT id FROM companies WHERE corp_name ILIKE '%피스피스%')
-- );
