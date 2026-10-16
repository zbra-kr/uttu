# ERP source execution and crosswalk calls — local dry-run

Starting point: PR26 7e0fef748780cde1e9119ab62abb244011cab671 plus reviewed b01cb135b08824220749cf55c3b1f21a15b87665e98c1c90c4678aa694816adf. Original eis-rpc-candidate and deployment-readable patch are preserved. No review-statistics or PR19 integration.

## Concrete gaps closed

1. Existing Python central_sales_readonly.execute_central_sales supported detail only. New erp_aggregate_source.execute_central_daily_sales executes the exact reviewed CENTRAL_DAILY_SQL over a supplied already authenticated Snowflake connection. execute_central_style_daily_sales adds bounded selected-style daily counts needed for product comparison (CO, exactly14days, max10 styles, 141-row sentinel). All style/date/brand values are binds. Shared existing timeout/EXPLAIN/scan-budget/projection/close guard is extracted mechanically and reused by both detail and new daily reads. No SDK/client/key/env loader is added. No SET or session configuration mutation.
2. The reviewed daily DTO branch is extracted unchanged into normalizeCentralDailyReceipt, now called by existing readCentralSales and the new dry-run. Raw FLOAT transport and exact count strings retain existing NULL-audit/display/total rules; no precision/currency repair or missing-day zero filling.
3. runAggregateSourceDryRun composes authorized injected read callbacks -> brand daily receipt -> shared DTO -> prepareAggregateGeneration. It then reads existing own products and explicit mapping evidence with readProductCrosswalk, reads max10 verified styles and fixed ranking endpoints, and calls existing compareSalesMarket. No publisher/status port, storage write or schedule is referenced. Scope is copied/pinned across awaits.
4. createExistingProductReadClient accepts an already constructed Supabase reader, compatible with the installed client type. Fixed products projection is id,musinsa_no,erp_style_code,is_own,brand_id, own-only, stable id ordering, limit201 plus exact count. No recommendation from an incomplete/unknown count or >200 page. Fixed ranking_snapshots read is product IDs, previous-week endpoint/end date, musinsa/000/A/AGE_BAND_ALL, limit21. Missing/duplicate/wrong-scope ranks exclude that insight. No joins to product_matches, no inferred confirmed mapping, no private fields.

## Existing schema and verified mapping input

00003_products.sql declares musinsa_no TEXT UNIQUE, optional erp_style_code and brand_id; the ERP index is not unique and is not proof of a brand/style crosswalk. 00004_ranking_snapshots.sql supplies product_id/date/store/category/gender/age/rank. No schema or permissions are added.

reviewedMappings is an explicit caller-supplied array using existing CrosswalkEvidence: productId, musinsaNo, style, brand, brandId, status=confirmed, evidenceRef, version. It must match all current product keys uniquely, with independent reviewed evidence/version. The status string is a claim in the supplied evidence, not authentication or automated validation of the referenced artifact. Do NOT fill it from a competitor match or an ERP style hint. Unreviewed input should be [] until its brand-master/style/product relationship is independently confirmed. Output mapping.unmapped includes known product keys and reason; accepted mappings alone drive style/rank reads and comparison. Missing client/read failures are explicit, not a claim of zero products. Only CO mapping is used in this pilot; other brands are excluded.

## Executable entry points

The connection owner can call execute_central_daily_sales(existing_connection, scope) and execute_central_style_daily_sales(existing_connection, scope, verified_styles). The existing connection must already satisfy the prior 1..10s session timeout and budget guard; the code does not change settings to make it pass. The MDA _snowflake_conn pattern exists but loads env/private key, so it is NOT imported or invoked here. Existing authenticated read authority, caller identity and source connection selection remain external injected dependencies, never fabricated from a cookie admin role.

The transport-free CLI is viewer/scripts/erp-aggregate-dry-run.cjs. Run with existing installed Node/TypeScript:

    node viewer/scripts/erp-aggregate-dry-run.cjs < reviewed-local-receipts.json

Input requires inputKind=recorded-receipts, scope, observedAt, now (epoch milliseconds), daily, optional styleDaily, products/rankings arrays and reviewedMappings. daily/styleDaily are the Python result objects. It reads stdin only and loads an explicit allowlist of pure repo modules; no child process/network/key/client initialization. Its query-shaped adapter operates only on the supplied arrays. Output is always labelled recorded-receipts, sourceAuthenticated=false, productionEvidence=false, writes=0. This is executable DTO/generation/mapping/insight inspection, not evidence that supplied receipts or mapping assertions came from an authenticated source. Invalid/partial daily input exits1 with fixed error and no result. No real data is embedded in fixtures or default screens.

A future approved live read owner can inject readDaily/readStyleDaily using its existing source connection and products via createExistingProductReadClient(existing_reader). No production factory or secret is created. Candidate generation stays local; it is not passed to the inactive publisher. This code does not settle the separately reviewed worker identity/DB publish capability gaps.

## New execution evidence

Python4 tests execute the actual new functions over a synthetic supplied cursor, including exact TS/Python daily SQL equality, immutable bind capture, timeout/budget denial, sentinel and close. Their generated receipt is checked into viewer/tests/fixtures/erp-aggregate-source.synthetic.json for self-contained replay.

New TS7 integration tests consume that actual Python-driver receipt, use the shared normalizer, prepare the real generation hash, invoke fixed product/rank readers and existing mapping/comparison functions. Verified synthetic sample yields previous700.875/current351.75 and rank +20, writes0. Missing proof yields no style/market read and no insight. Incomplete products, wrong brand, NULL audits, missing days, duplicate endpoints, partial source and absent/changed read scope are withheld. Existing authorized server DTO equivalence after extraction is tested directly.

The real offline CLI runs with explicit synthetic labelled inputs both mapped and unmapped: 1 comparison vs0 comparison/1 unmapped; all writes0. Partial-source CLI exit1 verified. Type compilation includes new executor/shared DTO and actual installed Supabase reader compatibility; scoped lint and Python ruff pass. Existing closed RPC/numeric/concurrency/whole ERP suites are not repeated. No full Next build or browser/live source/DB/API is run.

## Remaining exact boundaries

- Read runtime: owner must supply the already authenticated approved Snowflake connection and approved existing products reader plus read identity verifier. None was looked up/created/called live. Existing factory alone does not prove timeout/source access/current source freshness; failure remains fail-closed. Python-to-Node receipt handoff is local data, not a deployed worker process or authenticated IPC service.
- Mapping evidence: actual eligible product count and independently reviewed mappings are unknown. The code accepts an explicit reviewed input path and reports exclusions; it cannot manufacture brand/style provenance. The supplied evidence version/ref requires independent verification before genuine insights.
- Source semantics: fetched-at is execution observation, not upstream business watermark; market/ERP coverage and no-day-zero policy are retained. No source SLA, snapshot meaning, allocation, or causal conclusion is invented.
- Storage/permissions: trusted publisher identity, DB read/write/status capability separation and exact RPC/RLS/EXECUTE approval remain unresolved. No store/refresh-status/SQL install or schedule is attempted. These remain prerequisites to activating any automatic job.
- Actual evidence: no new Snowflake/Supabase live request, genuine comparison, production speed, full deployed/browser acceptance or installed storage-path acceptance in this task. Synthetic execution proves wiring and contracts, not operational readiness.

No keys, env or auth files read; no install, settings, role/ACL/RLS/schema changes, schedule, publish, merge, push or deployment. Migration/cron: none. No new commit; source-only patch is based on the exact reviewed starting patch above.
