CREATE OR REPLACE FUNCTION get_mapping_company_list(
  p_limit              int     DEFAULT 50,
  p_offset             int     DEFAULT 0,
  p_search             text    DEFAULT NULL,
  p_show_done          boolean DEFAULT false,
  p_done_only          boolean DEFAULT false,
  p_show_skipped       boolean DEFAULT false,
  p_listed_only        boolean DEFAULT false,
  p_unlisted_only      boolean DEFAULT false,
  p_has_parent         boolean DEFAULT false,
  p_no_parent          boolean DEFAULT false,
  p_has_subs           boolean DEFAULT false,
  p_has_brands         boolean DEFAULT false,
  p_no_brands          boolean DEFAULT false,
  p_has_unconfirmed    boolean DEFAULT false,
  p_has_own_brands     boolean DEFAULT false,
  p_has_skipped_brands boolean DEFAULT false,
  p_no_biz_no          boolean DEFAULT false,
  p_has_remark         boolean DEFAULT false
) RETURNS json LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH filtered AS (
    SELECT
      c.id, c.corp_name, c.business_number, c.corp_code,
      c.dart_skip, c.remark, c.parent_company_id, c.is_listed,
      p.id            AS parent_id,
      p.corp_name     AS parent_corp_name
    FROM companies c
    LEFT JOIN companies p ON p.id = c.parent_company_id
    WHERE
      -- DART 완료 포함 여부
      (p_show_done    OR p_done_only OR c.corp_code IS NULL)
      -- DART 완료 건만
      AND (NOT p_done_only OR c.corp_code IS NOT NULL)
      -- 건너뜀 포함 여부
      AND (p_show_skipped OR NOT c.dart_skip)
      -- 상장사만
      AND (NOT p_listed_only   OR c.is_listed)
      -- 비상장사만
      AND (NOT p_unlisted_only OR NOT c.is_listed)
      -- 모회사 있음
      AND (NOT p_has_parent OR c.parent_company_id IS NOT NULL)
      -- 최상위 회사만 (모회사 없음)
      AND (NOT p_no_parent  OR c.parent_company_id IS NULL)
      -- 사업자번호 없음
      AND (NOT p_no_biz_no  OR c.business_number IS NULL OR c.business_number = '')
      -- 메모 있음
      AND (NOT p_has_remark OR (c.remark IS NOT NULL AND c.remark <> ''))
      -- 자회사 있음
      AND (
        NOT p_has_subs OR EXISTS (
          SELECT 1 FROM companies sub WHERE sub.parent_company_id = c.id
        )
      )
      -- 브랜드 있음
      AND (
        NOT p_has_brands OR EXISTS (
          SELECT 1 FROM brands b WHERE b.company_id = c.id AND b.detail_fetched_at IS NOT NULL
        )
      )
      -- 브랜드 없음
      AND (
        NOT p_no_brands OR NOT EXISTS (
          SELECT 1 FROM brands b WHERE b.company_id = c.id AND b.detail_fetched_at IS NOT NULL
        )
      )
      -- 미확인 브랜드 있음 (confirmed=false, skip=false)
      AND (
        NOT p_has_unconfirmed OR EXISTS (
          SELECT 1 FROM brands b
          WHERE b.company_id = c.id AND b.detail_fetched_at IS NOT NULL
            AND NOT b.company_confirmed AND NOT b.company_skip
        )
      )
      -- 자사 브랜드 있음
      AND (
        NOT p_has_own_brands OR EXISTS (
          SELECT 1 FROM brands b WHERE b.company_id = c.id AND b.is_own
        )
      )
      -- 건너뜀 브랜드 있음
      AND (
        NOT p_has_skipped_brands OR EXISTS (
          SELECT 1 FROM brands b WHERE b.company_id = c.id AND b.company_skip
        )
      )
      -- 검색: 회사명 OR 사업자번호 OR 브랜드명
      AND (
        p_search IS NULL
        OR c.corp_name       ILIKE '%' || p_search || '%'
        OR c.business_number ILIKE '%' || p_search || '%'
        OR EXISTS (
          SELECT 1 FROM brands b
          WHERE b.company_id = c.id
            AND b.detail_fetched_at IS NOT NULL
            AND b.name ILIKE '%' || p_search || '%'
        )
      )
    ORDER BY c.corp_name
  )
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM filtered),
    'rows', COALESCE(
      (SELECT json_agg(row_to_json(r))
       FROM (
         SELECT
           f.id, f.corp_name, f.business_number, f.corp_code,
           f.dart_skip, f.remark, f.parent_company_id, f.is_listed,
           CASE WHEN f.parent_id IS NOT NULL
                THEN json_build_object('id', f.parent_id, 'corp_name', f.parent_corp_name)
                ELSE NULL
           END AS parent
         FROM filtered f
         LIMIT p_limit OFFSET p_offset
       ) r),
      '[]'::json
    )
  );
$$;
