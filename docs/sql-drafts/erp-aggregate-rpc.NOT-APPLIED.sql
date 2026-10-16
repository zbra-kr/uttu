-- UNINSTALLED CONTRACT DRAFT. NOT an authorization/exposure approval.
-- Requires revised private aggregate storage/validation draft.
-- SECURITY INVOKER deliberately preserves private-table/RLS denial for cookie callers.
-- DO NOT grant private tables to authenticated to make this work.
-- A reviewed per-requester capability boundary is still REQUIRED before activation.
BEGIN;
CREATE FUNCTION public.uttu_erp_aggregate_read_v1(p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE k text;scope jsonb;payload jsonb;result text;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to-p_from<>13 THEN RAISE EXCEPTION 'AGGREGATE_SCOPE_INVALID'; END IF;
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'AGGREGATE_ACCESS_DENIED'; END IF;
 k:=format('["CO","%s","%s","central-vat-ex-transfer-ex-float-null-audit-v1"]',p_from,p_to);
 scope:=jsonb_build_object('brand','CO','from',p_from,'to',p_to,'aggregate','daily');
SELECT g.snapshot INTO payload FROM uttu_erp_private.heads h JOIN uttu_erp_private.generations g ON g.run_id=h.run_id AND g.scope_key=h.scope_key WHERE h.scope_key=k AND g.brand='CO' AND g.period_from=p_from AND g.period_to=p_to LIMIT 1;
 RETURN jsonb_build_object('version',1,'scope',scope,'status','ok','snapshot',payload);
END $$;
REVOKE ALL ON FUNCTION public.uttu_erp_aggregate_read_v1(date,date) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.uttu_erp_aggregate_publish_v1(p_from date,p_to date,p_run text,p_hash text,p_snapshot jsonb,p_payload text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE k text;scope jsonb;payload jsonb;result text;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to-p_from<>13 THEN RAISE EXCEPTION 'AGGREGATE_SCOPE_INVALID'; END IF;
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'AGGREGATE_ACCESS_DENIED'; END IF;
 k:=format('["CO","%s","%s","central-vat-ex-transfer-ex-float-null-audit-v1"]',p_from,p_to);
 scope:=jsonb_build_object('brand','CO','from',p_from,'to',p_to,'aggregate','daily');
IF p_snapshot->'scope' IS DISTINCT FROM scope THEN RAISE EXCEPTION 'AGGREGATE_SCOPE_INVALID'; END IF;
 result:=uttu_erp_private.publish(p_run,k,p_hash,p_snapshot,p_payload);
 RETURN jsonb_build_object('version',1,'scope',scope,'status',result);
END $$;
REVOKE ALL ON FUNCTION public.uttu_erp_aggregate_publish_v1(date,date,text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.uttu_erp_aggregate_refresh_v1(p_from date,p_to date,p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE k text;scope jsonb;payload jsonb;result text;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to-p_from<>13 THEN RAISE EXCEPTION 'AGGREGATE_SCOPE_INVALID'; END IF;
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'AGGREGATE_ACCESS_DENIED'; END IF;
 k:=format('["CO","%s","%s","central-vat-ex-transfer-ex-float-null-audit-v1"]',p_from,p_to);
 scope:=jsonb_build_object('brand','CO','from',p_from,'to',p_to,'aggregate','daily');
IF p_status IS NULL OR p_status NOT IN ('pending','failed','ok') THEN RAISE EXCEPTION 'AGGREGATE_STATUS_INVALID'; END IF;
 PERFORM uttu_erp_private.record_refresh(k,p_status);
 RETURN jsonb_build_object('version',1,'scope',scope,'status','recorded','refreshStatus',p_status);
END $$;
REVOKE ALL ON FUNCTION public.uttu_erp_aggregate_refresh_v1(date,date,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.uttu_erp_aggregate_status_v1(p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE k text;scope jsonb;payload jsonb;result text;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to-p_from<>13 THEN RAISE EXCEPTION 'AGGREGATE_SCOPE_INVALID'; END IF;
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'AGGREGATE_ACCESS_DENIED'; END IF;
 k:=format('["CO","%s","%s","central-vat-ex-transfer-ex-float-null-audit-v1"]',p_from,p_to);
 scope:=jsonb_build_object('brand','CO','from',p_from,'to',p_to,'aggregate','daily');
SELECT status INTO result FROM uttu_erp_private.refresh_status WHERE scope_key=k;
 RETURN jsonb_build_object('version',1,'scope',scope,'status','ok','refreshStatus',coalesce(result,'unknown'));
END $$;
REVOKE ALL ON FUNCTION public.uttu_erp_aggregate_status_v1(date,date) FROM PUBLIC,anon,authenticated,service_role;
-- No GRANT, policy, role, key, schema exposure setting, schedule, or installation.
COMMIT;
