-- REVIEW DRAFT ONLY. No migration runner/schedule imports this file.
-- Target proposed: existing UTTU project, private schema. No public grants.
BEGIN;
CREATE SCHEMA uttu_erp_private;
REVOKE ALL ON SCHEMA uttu_erp_private FROM PUBLIC,anon,authenticated;
CREATE TABLE uttu_erp_private.generations (
 run_id text PRIMARY KEY CHECK(run_id ~ '^[a-f0-9]{64}$'),
 scope_key text NOT NULL, payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 brand text NOT NULL CHECK(brand='CO'), period_from date NOT NULL,period_to date NOT NULL,
 observed_at timestamptz NOT NULL,source_watermark timestamptz,
 snapshot jsonb NOT NULL, CHECK(period_to-period_from=13),
 UNIQUE(scope_key,run_id),CHECK(source_watermark IS NULL)
);
CREATE TABLE uttu_erp_private.daily (
 run_id text REFERENCES uttu_erp_private.generations ON DELETE CASCADE,
 sale_date date NOT NULL, audited_row jsonb NOT NULL,PRIMARY KEY(run_id,sale_date)
);
CREATE TABLE uttu_erp_private.heads (
 scope_key text PRIMARY KEY,run_id text NOT NULL,
 FOREIGN KEY(scope_key,run_id) REFERENCES uttu_erp_private.generations(scope_key,run_id)
);
CREATE TABLE uttu_erp_private.refresh_status (scope_key text PRIMARY KEY,status text NOT NULL CHECK(status IN ('pending','failed','ok')),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE uttu_erp_private.refresh_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE uttu_erp_private.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE uttu_erp_private.daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE uttu_erp_private.heads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA uttu_erp_private FROM PUBLIC,anon,authenticated;
-- Existing server-side approved connection only, SECURITY INVOKER. No SECURITY DEFINER.
-- Caller first revalidates audited DTO/hash via publishPreparedGeneration.
-- Input integrity only: this does NOT authenticate the source publisher.
CREATE FUNCTION uttu_erp_private.validate_payload(p_run text,p_scope text,p_hash text,p_snapshot jsonb,p_payload text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET extra_float_digits=3 AS $$
DECLARE d jsonb;a jsonb;m jsonb;t jsonb;s jsonb;f date;z date;dt date;dates date[]:='{}';
 src numeric;present numeric;missing numeric;v double precision;n double precision;sum_v double precision:=0;comp double precision:=0;
 held boolean:=false;expected_scope text;observed text;raw text;source_hold text;scaled double precision;values_v double precision[]:='{}';total_overflow boolean:=false;
BEGIN
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR octet_length(p_payload)>262144 OR p_payload IS NULL
 OR p_payload::jsonb IS DISTINCT FROM p_snapshot
 OR p_snapshot->'version' IS DISTINCT FROM '1'::jsonb
 OR p_snapshot->'definition' IS DISTINCT FROM '"central-vat-ex-transfer-ex-float-null-audit-v1"'::jsonb
 OR p_snapshot->'sourceWatermark' IS DISTINCT FROM 'null'::jsonb
 OR jsonb_typeof(p_snapshot->'observedAt') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_snapshot->'scope') IS DISTINCT FROM 'object'
 OR jsonb_typeof(p_snapshot->'sales') IS DISTINCT FROM 'object'
 OR p_snapshot#>'{sales,kind}' IS DISTINCT FROM '"summary"'::jsonb
 OR p_snapshot->'scope' IS DISTINCT FROM p_snapshot#>'{sales,scope}'
 THEN RAISE EXCEPTION 'AGGREGATE_PAYLOAD_INVALID';END IF;
 s:=p_snapshot->'scope';observed:=p_snapshot->>'observedAt';
 IF s->'brand' IS DISTINCT FROM '"CO"'::jsonb OR s->'aggregate' IS DISTINCT FROM '"daily"'::jsonb
 OR jsonb_typeof(s->'from') IS DISTINCT FROM 'string' OR jsonb_typeof(s->'to') IS DISTINCT FROM 'string'
 OR s->>'from' !~ '^\d{4}-\d{2}-\d{2}$' OR s->>'to' !~ '^\d{4}-\d{2}-\d{2}$'
 OR NOT isfinite(observed::timestamptz) THEN RAISE EXCEPTION 'AGGREGATE_SCOPE_INVALID';END IF;
 f:=(s->>'from')::date;z:=(s->>'to')::date;
 IF z-f<>13 OR s IS DISTINCT FROM jsonb_build_object('brand','CO','from',f,'to',z,'aggregate','daily') THEN RAISE EXCEPTION 'AGGREGATE_SCOPE_INVALID';END IF;
 expected_scope:=format('["CO","%s","%s","central-vat-ex-transfer-ex-float-null-audit-v1"]',f,z);
 IF p_scope IS DISTINCT FROM expected_scope OR p_hash IS NULL OR p_run IS NULL
 OR p_hash !~ '^[a-f0-9]{64}$' OR p_run !~ '^[a-f0-9]{64}$'
 OR p_hash IS DISTINCT FROM encode(sha256(convert_to(p_payload,'UTF8')),'hex')
 OR p_run IS DISTINCT FROM encode(sha256(convert_to(p_scope||'|'||observed||'|'||p_hash,'UTF8')),'hex')
 THEN RAISE EXCEPTION 'AGGREGATE_HASH_INVALID';END IF;
 IF jsonb_typeof(p_snapshot#>'{sales,dailySummary}') IS DISTINCT FROM 'object'
 OR jsonb_typeof(p_snapshot#>'{sales,dailySummary,rows}') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_snapshot#>'{sales,dailySummary,total}') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'AGGREGATE_DAILY_INVALID';END IF;
 IF jsonb_array_length(p_snapshot#>'{sales,dailySummary,rows}')>14 THEN RAISE EXCEPTION 'AGGREGATE_DAILY_INVALID';END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(p_snapshot#>'{sales,dailySummary,rows}') LOOP
  IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR d->'brand' IS DISTINCT FROM '"CO"'::jsonb
  OR jsonb_typeof(d->'saleDate') IS DISTINCT FROM 'string' OR d->>'saleDate' !~ '^\d{4}-\d{2}-\d{2}$'
  OR jsonb_typeof(d->'audit') IS DISTINCT FROM 'object' OR jsonb_typeof(d->'amount') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'AGGREGATE_ROW_INVALID';END IF;
  dt:=(d->>'saleDate')::date;
  IF dt<f OR dt>z OR dt=ANY(dates) OR to_char(dt,'YYYY-MM-DD') IS DISTINCT FROM d->>'saleDate' THEN RAISE EXCEPTION 'AGGREGATE_ROW_INVALID';END IF;dates:=array_append(dates,dt);
  a:=d->'audit';m:=d->'amount';
  IF jsonb_typeof(a->'sourceRows') IS DISTINCT FROM 'string' OR jsonb_typeof(a->'amountRows') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a->'nullAmountRows') IS DISTINCT FROM 'string' OR jsonb_typeof(a->'complete') IS DISTINCT FROM 'boolean'
  OR a->>'sourceRows' !~ '^(0|[1-9][0-9]{0,37})$' OR a->>'amountRows' !~ '^(0|[1-9][0-9]{0,37})$'
  OR a->>'nullAmountRows' !~ '^(0|[1-9][0-9]{0,37})$' THEN RAISE EXCEPTION 'AGGREGATE_AUDIT_INVALID';END IF;
  src:=(a->>'sourceRows')::numeric;present:=(a->>'amountRows')::numeric;missing:=(a->>'nullAmountRows')::numeric;
  IF src<=0 OR present>src OR missing IS DISTINCT FROM src-present OR a->'complete' IS DISTINCT FROM to_jsonb(src=present)
  OR NOT(m?'sourceValue') OR (present=0) IS DISTINCT FROM (m->'sourceValue'='null'::jsonb)
  OR jsonb_typeof(m->'transportType') IS DISTINCT FROM 'string'
  OR m->'sourceType' IS DISTINCT FROM '"FLOAT"'::jsonb OR m->'exactValue' IS DISTINCT FROM 'null'::jsonb
  THEN RAISE EXCEPTION 'AGGREGATE_AUDIT_INVALID';END IF;
  source_hold:=NULL;
  IF present=0 THEN
   IF m->'transportType' IS DISTINCT FROM '"null"'::jsonb OR m->'reason' IS DISTINCT FROM '"NULL_AGGREGATE"'::jsonb THEN RAISE EXCEPTION 'AGGREGATE_AMOUNT_INVALID';END IF;
  ELSE
   IF NOT ((jsonb_typeof(m->'sourceValue')='string' AND m->'transportType'='"numeric-string"'::jsonb)
      OR (jsonb_typeof(m->'sourceValue')='number' AND m->'transportType'='"number"'::jsonb))
   OR (jsonb_typeof(m->'sourceValue')='string' AND length(m->>'sourceValue')>100) OR m->>'sourceValue' !~ '^-?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$'
   THEN RAISE EXCEPTION 'AGGREGATE_AMOUNT_INVALID';END IF;
   raw:=m->>'sourceValue';source_hold:=NULL;
   -- JSON numbers may expand to hundreds of digits in JSONB; only raw strings have the 100-character transport bound.
   -- PostgreSQL raises where JavaScript Number returns +/-Infinity or signed zero.
   IF regexp_replace(split_part(lower(raw),'e',1),'[-.0]','','g')='' THEN v:=0;
   ELSE
    BEGIN
     v:=raw::double precision;
     IF v=0 THEN source_hold:='NUMBER_UNDERFLOW';END IF;
    EXCEPTION WHEN numeric_value_out_of_range THEN
     IF lower(raw) ~ 'e-' THEN source_hold:='NUMBER_UNDERFLOW';ELSE source_hold:='NUMBER_OVERFLOW';END IF;
    END;
   END IF;
   IF source_hold IS NOT NULL AND jsonb_typeof(m->'sourceValue') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'AGGREGATE_AMOUNT_INVALID';END IF;
   IF missing>0 THEN
    IF m->'reason' IS DISTINCT FROM '"SOURCE_NULL_ROWS"'::jsonb THEN RAISE EXCEPTION 'AGGREGATE_AMOUNT_INVALID';END IF;
   ELSIF source_hold IS NOT NULL THEN
    IF m->'reason' IS DISTINCT FROM to_jsonb(source_hold) OR m->'approximateValue' IS DISTINCT FROM 'null'::jsonb
    OR m->'millionsText' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'AGGREGATE_AMOUNT_INVALID';END IF;
   ELSE
    IF jsonb_typeof(m->'approximateValue') IS DISTINCT FROM 'number' OR (m->>'approximateValue')::double precision IS DISTINCT FROM v
    OR m->'reason' IS DISTINCT FROM '"FLOAT_DISPLAY_ONLY"'::jsonb OR jsonb_typeof(m->'millionsText') IS DISTINCT FROM 'string'
    THEN RAISE EXCEPTION 'AGGREGATE_AMOUNT_INVALID';END IF;
    BEGIN scaled:=v/1000000;EXCEPTION WHEN numeric_value_out_of_range THEN scaled:=0;END;
    -- float8->numeric rounds significant digits; float8 shortest round-trip text preserves the JS boundary.
    IF m->>'millionsText' !~ '^-?[0-9,]+\.[0-9]$' OR replace(m->>'millionsText',',','')::numeric IS DISTINCT FROM round(scaled::text::numeric,1) THEN RAISE EXCEPTION 'AGGREGATE_DISPLAY_INVALID';END IF;
   END IF;
  END IF;
  IF missing>0 OR source_hold IS NOT NULL THEN
   held:=true;
   IF m->'approximateValue' IS DISTINCT FROM 'null'::jsonb OR m->'millionsText' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'AGGREGATE_NULL_HOLD_INVALID';END IF;
  ELSE values_v:=array_append(values_v,v);
  END IF;
 END LOOP;
 t:=p_snapshot#>'{sales,dailySummary,total}';
 IF t->'exactValue' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'AGGREGATE_TOTAL_INVALID';END IF;
 IF held THEN
  IF t->'approximateValue' IS DISTINCT FROM 'null'::jsonb OR t->'millionsText' IS DISTINCT FROM 'null'::jsonb
  OR t->'reason' IS DISTINCT FROM '"TOTAL_INCOMPLETE"'::jsonb THEN RAISE EXCEPTION 'AGGREGATE_TOTAL_INVALID';END IF;
 ELSE
  -- Match DTO's null-first check, then its ordered Neumaier operations; SQL overflow becomes an explicit hold.
  BEGIN
   FOREACH v IN ARRAY values_v LOOP
    n:=sum_v+v;
    IF abs(sum_v)>=abs(v) THEN comp:=comp+((sum_v-n)+v);ELSE comp:=comp+((v-n)+sum_v);END IF;sum_v:=n;
   END LOOP;
   v:=sum_v+comp;
  EXCEPTION WHEN numeric_value_out_of_range THEN total_overflow:=true;
  END;
  IF total_overflow THEN
   IF t->'approximateValue' IS DISTINCT FROM 'null'::jsonb OR t->'millionsText' IS DISTINCT FROM 'null'::jsonb
   OR t->'reason' IS DISTINCT FROM '"NUMBER_OVERFLOW"'::jsonb THEN RAISE EXCEPTION 'AGGREGATE_TOTAL_INVALID';END IF;
  ELSE
   IF v::text IN ('NaN','Infinity','-Infinity') OR jsonb_typeof(t->'approximateValue') IS DISTINCT FROM 'number'
   OR (t->>'approximateValue')::double precision IS DISTINCT FROM v OR t->'reason' IS DISTINCT FROM '"FLOAT_DISPLAY_ONLY"'::jsonb
   OR jsonb_typeof(t->'millionsText') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'AGGREGATE_TOTAL_INVALID';END IF;
   BEGIN scaled:=v/1000000;EXCEPTION WHEN numeric_value_out_of_range THEN scaled:=0;END;
   IF t->>'millionsText' !~ '^-?[0-9,]+\.[0-9]$' OR replace(t->>'millionsText',',','')::numeric IS DISTINCT FROM round(scaled::text::numeric,1) THEN RAISE EXCEPTION 'AGGREGATE_DISPLAY_INVALID';END IF;
  END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION uttu_erp_private.validate_payload(text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION uttu_erp_private.publish(p_run text,p_scope text,p_hash text,p_snapshot jsonb,p_payload text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE prior text;stored_hash text;d jsonb;dt date;seen integer:=0;is_older boolean:=false;from_day date;to_day date;observed timestamptz;
BEGIN
 PERFORM uttu_erp_private.validate_payload(p_run,p_scope,p_hash,p_snapshot,p_payload);
 IF p_snapshot->>'version' IS DISTINCT FROM '1' OR p_snapshot->>'definition' IS DISTINCT FROM 'central-vat-ex-transfer-ex-float-null-audit-v1'
 OR p_snapshot#>>'{scope,brand}' IS DISTINCT FROM 'CO' OR p_snapshot#>>'{scope,aggregate}' IS DISTINCT FROM 'daily'
 OR p_snapshot->'scope' IS DISTINCT FROM p_snapshot#>'{sales,scope}'
 OR p_snapshot#>>'{sales,kind}' IS DISTINCT FROM 'summary' THEN RAISE EXCEPTION 'AGGREGATE_INVALID'; END IF;
 from_day:=(p_snapshot#>>'{scope,from}')::date;to_day:=(p_snapshot#>>'{scope,to}')::date;observed:=(p_snapshot->>'observedAt')::timestamptz;
 IF to_day-from_day<>13 OR jsonb_array_length(p_snapshot#>'{sales,dailySummary,rows}')>14 THEN RAISE EXCEPTION 'AGGREGATE_SCOPE_INVALID'; END IF;
 -- Serialize all pilot generation writers: retention is global across period scopes.
 -- Same lock is acquired before any generation/head mutation; transaction failure keeps last-good.
 PERFORM pg_advisory_xact_lock(hashtextextended('uttu_erp_private:CO:global_generation_retention',0));
 SELECT payload_hash INTO stored_hash FROM uttu_erp_private.generations WHERE run_id=p_run;
 IF FOUND THEN IF stored_hash<>p_hash THEN RAISE EXCEPTION 'HASH_CONFLICT'; END IF;RETURN 'replayed';END IF;
 INSERT INTO uttu_erp_private.generations VALUES(p_run,p_scope,p_hash,'CO',from_day,to_day,observed,NULL,p_snapshot);
 FOR d IN SELECT value FROM jsonb_array_elements(p_snapshot#>'{sales,dailySummary,rows}') LOOP
  dt:=(d->>'saleDate')::date;
  IF dt<from_day OR dt>to_day OR d->>'brand'<>'CO' THEN RAISE EXCEPTION 'DAILY_SCOPE_INVALID';END IF;
  INSERT INTO uttu_erp_private.daily VALUES(p_run,dt,d);seen:=seen+1;
 END LOOP;
 SELECT h.run_id INTO prior FROM uttu_erp_private.heads h JOIN uttu_erp_private.generations g ON g.run_id=h.run_id WHERE h.scope_key=p_scope AND g.observed_at>observed;
 is_older:=FOUND;
 IF NOT is_older THEN
 INSERT INTO uttu_erp_private.heads VALUES(p_scope,p_run) ON CONFLICT(scope_key) DO UPDATE SET run_id=excluded.run_id;
 END IF;
 DELETE FROM uttu_erp_private.heads h WHERE h.run_id IN
 (SELECT run_id FROM uttu_erp_private.generations ORDER BY observed_at DESC,run_id DESC OFFSET 7);
 DELETE FROM uttu_erp_private.generations g WHERE g.run_id IN
 (SELECT run_id FROM uttu_erp_private.generations ORDER BY observed_at DESC,run_id DESC OFFSET 7)
 AND NOT EXISTS(SELECT 1 FROM uttu_erp_private.heads h WHERE h.run_id=g.run_id);
 RETURN CASE WHEN is_older THEN 'older' ELSE 'published' END;
END $$;
REVOKE ALL ON FUNCTION uttu_erp_private.publish(text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION uttu_erp_private.record_refresh(p_scope text,p_status text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 INSERT INTO uttu_erp_private.refresh_status(scope_key,status) VALUES(p_scope,p_status) ON CONFLICT(scope_key) DO UPDATE SET status=excluded.status,recorded_at=clock_timestamp();
$$;
REVOKE ALL ON FUNCTION uttu_erp_private.record_refresh(text,text) FROM PUBLIC,anon,authenticated;
-- Intentionally no GRANT, cron, role/key creation or API exposure. Execution separately approved.
COMMIT;
