-- DRAFT ONLY. Not a migration; not executed. Review RLS/plan/privileges before use.
-- One RPC, two branches: summary product pages and one product's evidence pages.
CREATE FUNCTION public.get_ranking_discovery_page_v3(
  p_scope jsonb, p_after uuid DEFAULT NULL, p_product uuid DEFAULT NULL,
  p_evidence_after uuid DEFAULT NULL, p_limit integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_from date; v_to date; v_categories text[]; v_genders text[]; v_ages text[];
  v_own boolean; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication-required' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_scope) IS DISTINCT FROM 'object'
     OR p_scope->>'version' IS DISTINCT FROM '2'
     OR jsonb_typeof(p_scope->'version') IS DISTINCT FROM 'number'
     OR p_scope->>'storeCode' IS DISTINCT FROM 'musinsa'
     OR jsonb_typeof(p_scope->'ownOnly') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_scope->'categories') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_scope->'genders') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_scope->'ages') IS DISTINCT FROM 'array'
     OR p_scope->>'fromDate' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
     OR p_scope->>'toDate' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
     OR p_scope->>'fromDate' IS NULL OR p_scope->>'toDate' IS NULL
  THEN RAISE EXCEPTION 'invalid-request'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_scope) AS keys(key) WHERE key NOT IN
    ('version','storeCode','fromDate','toDate','categories','genders','ages','ownOnly','pageSize'))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_scope->'categories') AS items(value) WHERE jsonb_typeof(value) <> 'string')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_scope->'genders') AS items(value) WHERE jsonb_typeof(value) <> 'string')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_scope->'ages') AS items(value) WHERE jsonb_typeof(value) <> 'string')
  THEN RAISE EXCEPTION 'invalid-request'; END IF;
  IF jsonb_typeof(p_scope->'pageSize') IS DISTINCT FROM 'number' OR p_scope->>'pageSize' !~ '^[1-9][0-9]{0,2}$' OR (p_scope->>'pageSize')::integer > 100 THEN RAISE EXCEPTION 'invalid-request'; END IF;
  p_limit := coalesce(p_limit,CASE WHEN p_product IS NULL THEN (p_scope->>'pageSize')::integer ELSE 100 END);
  v_from := (p_scope->>'fromDate')::date; v_to := (p_scope->>'toDate')::date;
  v_own := (p_scope->>'ownOnly')::boolean;
  SELECT array_agg(DISTINCT value ORDER BY value) INTO v_categories FROM jsonb_array_elements_text(p_scope->'categories');
  SELECT array_agg(DISTINCT value ORDER BY value) INTO v_genders FROM jsonb_array_elements_text(p_scope->'genders');
  SELECT array_agg(DISTINCT value ORDER BY value) INTO v_ages FROM jsonb_array_elements_text(p_scope->'ages');
  IF v_to < v_from OR v_to-v_from > 30 OR
     coalesce(cardinality(v_categories),0) NOT BETWEEN 1 AND 13 OR
     coalesce(cardinality(v_genders),0) NOT BETWEEN 1 AND 3 OR
     coalesce(cardinality(v_ages),0) NOT BETWEEN 1 AND 7 OR
     NOT v_categories <@ ARRAY['000','001','002','003','004','017','026','100','101','102','103','104','106']::text[] OR
     NOT v_genders <@ ARRAY['A','M','F']::text[] OR
     NOT v_ages <@ ARRAY['AGE_BAND_ALL','AGE_BAND_MINOR','AGE_BAND_20','AGE_BAND_25','AGE_BAND_30','AGE_BAND_35','AGE_BAND_40']::text[] OR
     p_limit IS NULL OR p_limit < 1 OR p_limit > (CASE WHEN p_product IS NULL THEN 100 ELSE 500 END) OR
     (p_product IS NULL AND p_evidence_after IS NOT NULL) OR (p_product IS NOT NULL AND p_after IS NOT NULL)
  THEN RAISE EXCEPTION 'invalid-request'; END IF;

  IF p_product IS NULL THEN
    WITH scoped AS MATERIALIZED (
      SELECT rs.product_id, rs.snapshot_date, rs.category_code, rs.gender_filter, rs.age_filter
      FROM public.ranking_snapshots rs JOIN public.products p ON p.id=rs.product_id
      WHERE rs.store_code='musinsa' AND rs.snapshot_date BETWEEN v_from AND v_to
        AND rs.category_code=ANY(v_categories) AND rs.gender_filter=ANY(v_genders) AND rs.age_filter=ANY(v_ages)
        AND (NOT v_own OR p.is_own)
    ), grouped AS MATERIALIZED (
      SELECT product_id, count(*)::integer AS observations,
        count(DISTINCT snapshot_date)::integer AS days,
        count(DISTINCT (category_code,gender_filter,age_filter))::integer AS cohorts,
        max(snapshot_date) AS latest
      FROM scoped GROUP BY product_id
    ), candidates AS (
      SELECT * FROM grouped WHERE p_after IS NULL OR product_id>p_after ORDER BY product_id LIMIT p_limit+1
    ), page AS (
      SELECT c.*, p.musinsa_no, p.name, p.is_own, b.name AS brand
      FROM (SELECT * FROM candidates ORDER BY product_id LIMIT p_limit) c
      JOIN public.products p ON p.id=c.product_id LEFT JOIN public.brands b ON b.id=p.brand_id
    )
    SELECT jsonb_build_object('version',3,'mode','products','scope',p_scope,
      'sourceCompleteness','unknown','paginationConsistency','keyset-best-effort',
      'ownClassification','current-product-master',
      'totalProducts',(SELECT count(*) FROM grouped),'matchingObservations',(SELECT count(*) FROM scoped),
      'remainingCount',(SELECT count(*) FROM grouped WHERE p_after IS NULL OR product_id>p_after),
      'hasMore',(SELECT count(*)>p_limit FROM candidates),
      'nextId',CASE WHEN (SELECT count(*)>p_limit FROM candidates) THEN (SELECT product_id FROM page ORDER BY product_id DESC LIMIT 1) ELSE NULL END,
      'products',coalesce((SELECT jsonb_agg(jsonb_build_object('productId',product_id,'musinsaNo',musinsa_no,
        'name',name,'brand',brand,'own',is_own,'observationCount',observations,'observedDays',days,
        'observedCohorts',cohorts,'latestObservedDate',latest) ORDER BY product_id) FROM page),'[]'::jsonb)
    ) INTO v_result;
  ELSE
    WITH scoped AS MATERIALIZED (
      SELECT rs.id,rs.snapshot_date,rs.category_code,rs.gender_filter,rs.age_filter,rs.rank_position
      FROM public.ranking_snapshots rs JOIN public.products p ON p.id=rs.product_id
      WHERE rs.product_id=p_product AND rs.store_code='musinsa' AND rs.snapshot_date BETWEEN v_from AND v_to
        AND rs.category_code=ANY(v_categories) AND rs.gender_filter=ANY(v_genders) AND rs.age_filter=ANY(v_ages)
        AND (NOT v_own OR p.is_own)
    ), candidates AS (
      SELECT * FROM scoped WHERE p_evidence_after IS NULL OR id>p_evidence_after ORDER BY id LIMIT p_limit+1
    ), page AS (SELECT * FROM candidates ORDER BY id LIMIT p_limit)
    SELECT jsonb_build_object('version',3,'mode','evidence','scope',p_scope,'productId',p_product,
      'sourceCompleteness','unknown','paginationConsistency','keyset-best-effort',
      'ownClassification','current-product-master','totalObservations',(SELECT count(*) FROM scoped),
      'remainingCount',(SELECT count(*) FROM scoped WHERE p_evidence_after IS NULL OR id>p_evidence_after),
      'hasMore',(SELECT count(*)>p_limit FROM candidates),
      'nextId',CASE WHEN (SELECT count(*)>p_limit FROM candidates) THEN (SELECT id FROM page ORDER BY id DESC LIMIT 1) ELSE NULL END,
      'evidence',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'date',snapshot_date,'category',category_code,
        'gender',gender_filter,'age',age_filter,'rank',rank_position,'rankStatus','unknown','changeStatus','not-read') ORDER BY id) FROM page),'[]'::jsonb)
    ) INTO v_result;
  END IF;
  RETURN v_result;
END $$;
-- Draft privilege plan: execute only for existing authenticated sessions, never service_role in viewer.
REVOKE ALL ON FUNCTION public.get_ranking_discovery_page_v3(jsonb,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ranking_discovery_page_v3(jsonb,uuid,uuid,uuid,integer) TO authenticated;
-- Rollback draft:
-- DROP FUNCTION public.get_ranking_discovery_page_v3(jsonb,uuid,uuid,uuid,integer);
