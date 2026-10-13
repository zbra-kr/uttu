# Ranking v3 API/UI connection (local candidate, DB not applied)

Release base: PR18 merge `5c7a69ea1050d447e96ebdb4f7525be46df79188`, tree `f81d64ec52677df04ff206e98ce43c1308548889`; local release head83b05e504d611f49dc25ed162ebeb7545e00caec has identical tree per existing release receipt. ERP six published files, including package.json, remain byte-identical. No inventory candidate is included.

## Planned DB approval scope

Only `public.get_ranking_discovery_page_v3(p_scope jsonb,p_after uuid DEFAULT NULL,p_product uuid DEFAULT NULL,p_evidence_after uuid DEFAULT NULL,p_limit integer DEFAULT NULL)` is proposed. It is STABLE SECURITY INVOKER with search_path=pg_catalog,public,pg_temp and rejects NULL auth.uid. Product-summary and selected-product-evidence branches are one function. Proposed ACL delta is revoking PUBLIC EXECUTE and granting existing authenticated EXECUTE only. No table SELECT grants, RLS changes or indexes are approved.

Before approval, read-only preflight must inspect the exact signature `public.get_ranking_discovery_page_v3(jsonb,uuid,uuid,uuid,integer)`, return type, definition, owner, security mode, volatility, configuration, explicit/default ACL, effective EXECUTE through role membership, and existing authenticated SELECT/RLS behavior. If that exact signature already exists, stop; this proposal does not authorize replacement or deletion. Reconfirm absence inside the approved transaction immediately before CREATE FUNCTION. Creation and the approved function ACL changes must occur together; inspect resulting effective privileges without changing unrelated grants or policies. No SQL or grant is authorized by this document.

On transaction failure, roll back that transaction. After a successful installation, `DROP FUNCTION public.get_ranking_discovery_page_v3(jsonb,uuid,uuid,uuid,integer)` is a rollback option ONLY for the new function demonstrably created by that approved transaction. Record that creation and verify identity/ownership and subsequent changes before considering removal. Do not run an unconditional DROP IF EXISTS against a pre-existing or independently changed function; stop for separate review if provenance is uncertain. Never use CASCADE.

Replacing an existing function requires separate explicit approval and prior backup of pg_get_functiondef, owner, explicit/default and effective ACL, configuration, comments and dependencies, with a reviewed restoration plan. Replacement rollback must restore the backed-up definition/owner/ACL and associated metadata; it must not drop a function that existed before the approved transaction.

The SQL stays under docs/drafts and was copied from the locally PG-verified syntax-fixed candidate. No SQL/grant/provider call was executed for this connection task. Independent real-PG evidence review SHA31c5b890e0c1d7d47c4a645f8be34fa2f2230cf070fc80d66a55e8a351e752b6 is inherited, not repeated.

## API

POST `/api/ranking/discovery` uses existing supabaseServer cookie client and auth.getUser, private/no-store responses, 8KiB request bound, combined cancellation and10-second deadline. Envelope version3:

```
{version:3,mode:'products'|'evidence',scope:<canonical existing version2 filter scope>,productId:null|UUID,cursor:null|string}
```

Product pages use scope.pageSize (default50,max100); evidence pages are100. The only reader is the prepared aggregate RPC. There is no raw .from query, fallback reader, cap increase, per-cohort or per-product N+1 discovery loop. Missing DB function/schema-cache PGRST202/42883 =>503 aggregate-function-unavailable;42501/PGRST301/PGRST302=>403 aggregate-permission-denied;57014/deadline=>504 aggregate-query-timeout;other RPC/transport failure=>503 aggregate-unconnected. Malformed or truncated successful receipts=>502 invalid-receipt. Errors never become empty success. V2 raw-window request bodies are rejected400; that provisional endpoint was not released in PR18.

Continuations bind canonical scope, authenticated account, mode and product. They carry full exact totals, observation totals and expected remaining count after delivered rows. Count/remaining changes produce409 stale-cursor and require restart. Wrong scope/account/product cursor rejects400 before RPC. Markers are read-only continuations, not signed authentication tokens. Unchanged-count rank/label edits or membership changes with unchanged remaining counts remain undetected: SQL/API declare keyset-best-effort, not transactional snapshot isolation. No new signing credential was introduced.

## First-use UI

Desktop and default mobile single-cohort views add a link to `/ranking/discovery`. Existing controls/saved filters stay unchanged. The new page requests product summaries only. It renders product identity, current master labels/own classification, distinct cohorts/days, observations and latest date; no average/best/global rank. Only one opened product mounts the evidence hook; closing/switching/page/scope/account exit cancels it. Evidence is fetched/paged separately and never appended into the summary payload.

Draft own/all/date/axes edits are applied explicitly. Same pending first submit/retry/next is deduplicated; distinct scope replaces prior reads. Applied scope stays visible, and dirty scope disables old-summary navigation until applied. Account changes/logout/unmount hide old data and reject late results. Missing function/permission/timeout errors are explicit unconnected states with retry/admin guidance. Empty success remains no matching stored observation with unknown collection state. Evidence totals differing from the selected summary produce stale and restart summaries rather than repeatedly retrying the obsolete card count.

## Focused verification

`node --test --unhandled-rejections=strict tests/ranking-daily-insights-discovery-v3.test.cjs` is automatically selected by the existing PR18 CI `test:ranking-daily` glob, without changing package.json/ERP release files. It tests26,866-observation one-RPC summaries;100-row evidence pages; no-scan errors; scope/account/product and count/remaining stale handling; SDK request serialization; route abort/deadline; duplicate submits/next/retry; product switching; logout/unmount late receipts; explicit UI missing/permission/timeout; evidence timeout and restart. Actual route, client/hooks and page are exercised with synthetic auth/RPC/HTTP boundaries. This is not live Supabase/PostgREST/auth/RLS or browser acceptance.

Local code connection is complete, but operational readiness still requires separately authorized function/ACL installation, actual provider/schema/permissions/cancellation validation and deployment approval. Until then the new live API, if deployed without DB setup, intentionally reports unconnected rather than reverting to10k raw scans. No build/SQL/deployment/publication was performed by this task.
