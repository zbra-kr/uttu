# EIS fixed RPC transport — local, uninstalled

Base: PR26 7e0fef748780cde1e9119ab62abb244011cab671 plus reviewed 14-file aggregate patch 938d74e98034cc28a7b27c2190a87d5fb91e53e23de4c635cbe40b2d97d6111b.

The previous three-file direct SQL adapter f093ad7ad62ca3e26655bac1a1e346907058d2f0a7929f0ce106b86fdbc8c777 remains preserved in eis-insight-stage1-candidate / eis-repository-adapter-evidence. It is superseded as the proposed transport, not included here. Its query client has no installed production driver. Its PostgreSQL void empty-string acknowledgement is not a PostgREST contract.

The transport contract has four fixed RPC names and parameters; SSR cookies now expose only the two read RPCs while a separate inactive injected worker port owns writes: read(from,to), publish(from,to,run,hash,snapshot,payload), refresh(from,to,status), status(from,to). No SQL text or caller-selected RPC name API exists. Each response is an exact JSON object with version=1 and CO/daily/14-day scope. Reads include status=ok and snapshot (explicit null for miss); publish returns published/replayed/older; refresh returns status=recorded plus matching refreshStatus; status returns status=ok plus pending/failed/ok/unknown. No void/scalar/array coercion. Errors do not expose transport messages.

Reused safeguards: validated daily DTO/null/count/total audit, generation hash/run ID verification, before/after authorization pin, runtime stale/last-good/pending/failed behavior, private transactional publish and global generation retention. The private SQL draft now validates payload integrity before publish mutation; the original reviewed input remains preserved outside this candidate. The SSR factory now uses existing configured requester allowlist/current actor/session checks with no authorization callback override, and returns a frozen reader projection. Worker dependencies are injected separately and remain unconfigured. Read/write transport RPC-name types and runtime name guards are also separated. No default role grant, caller identity parameter, page/cron activation or actual trusted publisher implementation was added. A role alone is insufficient.

## Separate security review required before activation

The new SQL file is a CONTRACT DRAFT, not installable production authorization. SECURITY INVOKER plus REVOKE on all four wrappers keeps existing private-schema/table/RLS denial. Cookie users therefore CANNOT currently execute this transport. Do not grant authenticated users private table access to bypass that denial.

Storage approval does not approve public RPC exposure or EXECUTE. Before any activation, security review must decide the exact per-requester read/publish capability boundary, session/role revocation behavior, function owner and any narrowly scoped SECURITY DEFINER alternative, fixed search_path and RLS consequences, explicit EXECUTE and exposed schema. auth.uid()/authenticated alone in this draft are insufficient brand/write authorization. No capability table/policy/role/grant is created here.

The revised private publish validates mandatory JSON types/keys, CO14-day scope, unique bounded dates, integer audit counts, NULL holds, finite source/approximate amounts, compensated totals, display numeric value, payload SHA256 and run-ID relationship before mutation. Exact JSON.stringify UTF-8 bytes are sent as p_payload: JSONB must equal that parsed text and SHA256 must match its bytes. SQL does not pretend jsonb::text matches JavaScript serialization. A trusted source publisher capability is STILL REQUIRED IN ADDITION to integrity checks. A fabricated but internally consistent amount passes these checks; this does not establish source authenticity. Read/publish capability separation remains unresolved and ordinary authenticated cookie users must not gain publish/refresh access.

The private refresh function still returns void internally; the wrapper uses PERFORM and returns its own explicit JSON acknowledgement. Adapter never interprets PostgreSQL void. Read and status are separate requests; runtime conservatively treats status errors/pending/failed as stale; no cross-request snapshot atomicity claim.

## Verification

Offline fake PostgREST transport tests check contract and actual existing aggregate runtime composition. The actual SSR dependency is type-checked against the installed client; the SSR factory runs only with synthetic mocked client/actor/binding in tests, never the actual cookie/env client. npm test:erp-insights runs the new tests with the existing suite. Full app tsc --noEmit and scoped lint pass. The initial SQL checks were static only. The input-validation revision executes the actual validator body with only its namespace changed to pg_temp in the existing dedicated synthetic PG15 cluster inside BEGIN/ROLLBACK. No storage/publish/wrapper installation, roles, grants, production RPC/auth/RLS/ACL/concurrency, full Next build or production readiness claim. No installation, credentials/env access or change, permission change, push or deploy.

Migration: none applied. Draft dependency order for review only: existing erp-brand-aggregate.NOT-APPLIED.sql then erp-aggregate-rpc.NOT-APPLIED.sql; security approval remains prerequisite. Cron: none. Candidate base commit as above; changes delivered as local patch without commit.

## Input-validation revision (2026-10-15)

Independent review source: eis-rpc-review-20261015/independent-review-results.json. Database integrity is strengthened; authorization remains blocked. SECURITY INVOKER and REVOKE stay unchanged. No roles, grants, policies or RPC activation.

36 synthetic cases: 32 malformed cases rejected; 4 accepted (normal, all-null, partial-null hold, internally consistent fabricated amount). Tests execute the actual SQL validator body, not a JavaScript reimplementation. Private publish/wrappers/auth/RLS/ACL are not tested. The previous 427-test run is historical; only changed RPC contract and validator cases were rerun.

The original input-validation revision rejected overflow/underflow DTOs and used float8->numeric display rounding. The numeric-boundary revision below supersedes that limitation.

## Numeric-boundary revision (2026-10-15)

Actual prepareAggregateGeneration / centralAmountDisplay / centralDisplayTotal output is JSON.stringify serialized, then passed to the actual SQL validator body in session-temp namespace. Baseline 64 cases exposed 22 false rejections: JSONB expansion made valid number transport exceed a string-only length bound; direct float casts/division raised instead of producing the JS overflow/underflow display hold; float8->numeric rounded significant digits before million-unit rounding. Examples: Number.MIN_VALUE (5e-324), 1e309 string, Number.MAX_VALUE, and 49999.99999999999 (below 0.05 million) were rejected.

Corrections: enforce 100-character bound only on string transport; classify out-of-range strings as their existing DTO NUMBER_OVERFLOW / NUMBER_UNDERFLOW holds, preserving sourceValue; handle zero mantissas independently of huge exponents; use shortest round-trip float text (function-local extra_float_digits=3) before decimal display rounding; suppress scaled subnormal underflow as zero display without changing stored approximateValue; perform null-first total validation and ordered Neumaier operations, converting actual total overflow into NUMBER_OVERFLOW hold. No change to DTO serialization or application source amounts.

After correction, all 64 cases match (61 valid accepted, 3 altered amount/total/reason cases rejected); 8 additional half-min-subnormal/max-finite transition, negative-minimum, signed cancellation and NULL-before/after-overflow cases also match. 1e22 + 1e6 - 1e22 preserves 1e6; intermediate MAX+MAX remains an overflow hold even if a later return would cancel it. Numeric amount equality remains enforced independently of rounded millionsText. JSON.stringify loses numeric -0 sign but preserves its display string; neither source nor approximate value is replaced by rounded display. No claim of exhaustive proof over all binary64/locale strings or actual Snowflake source values.

Evidence folders: eis-rpc-numeric-evidence and eis-rpc-numeric-edge-evidence. Baseline and corrected results are both preserved. PG15.19 dedicated synthetic cluster only; validator body identical except pg_temp namespace; transaction rolled back and server stopped. Existing 427/general suites and concurrency tests were not repeated.

## Remaining work by category — activation remains BLOCKED

| Category | Item | Current state / completion requirement |
|---|---|---|
| Implementation | Trusted source publisher authentication at DB boundary | Missing. Internally consistent fabricated amounts can hash correctly. Data integrity NEVER replaces trusted publisher authentication. Implement only after exact principal/capability design is approved. |
| Implementation | Read vs publish vs refresh capability enforcement | Local ports are now structurally/type/runtime separated, with missing injected worker capability denied. Actual trusted worker verifier and DB enforcement remain missing; authenticated JWT alone does not define a secure DB boundary. No ordinary cookie user may receive publish/refresh. |
| Approval | Principal/brand/operation matrix, read and write separation | Unapproved; do not invent roles, binding records, capability grants, or copy existing reader identities into publishers. |
| Approval | Function exposure, owner, EXECUTE, RLS consequences | Unapproved. Existing REVOKE and SECURITY INVOKER/private schema denial remain; no definer conversion or table-access workaround. Storage approval is separate. |
| Actual evidence | Updated full storage/publish/RPC transaction integration | Not run: only validator session-temp SQL executed. Older concurrency result covers the earlier SQL signature, not this revised five-argument publish contract. |
| Actual evidence | Real SSR session, principal revocation, effective ACL/RLS | Not verified; fake RPC and synthetic validator do not establish access security. |
| Actual evidence | Target deployed PostgreSQL/runtime and complete numeric/locale domain | Unknown. Tested local PG15.19 + installed Node actual serializer; 72 selected cases are evidence, not exhaustive equivalence. MillionsText numeric value is checked; canonical locale comma grouping and signed-zero typography are not DB guarantees. |
| Actual evidence | Trusted EIS source/market mapping/freshness and production speed | Prior mapping/source gaps remain; no live connections or production timing performed here. |
| Actual evidence | Production build/browser/deployed behavior | Not performed for these revisions; no deployment readiness claim. |

Migration/cron/permissions/deployment: none applied. No package installation or credential/env lookup.

## Read-only cookie / injected worker ports revision (2026-10-15)

Research: erp-existing-job-auth-research-20261015/research-results.json confirms an existing worker-key architecture pattern but no approved ERP publisher principal, source capability or RPC rights. No key is read/injected and no service client is constructed. Generic requireAdmin/cookie admin identity is never publication proof.

- AggregateReader contains load/lastGood/refreshStatus only; readBrandAggregate accepts this narrow port. AggregatePublisher is separate and refreshBrandAggregate accepts only its publication methods. The old all-purpose RPC factory is now private.
- createSsrAggregateRpcRepository takes no caller authorization override. It uses existing getUser/own-profile role resolver plus independently configured requester IDs, before/after pin and a 60-second boundary; returns a frozen object with only three read methods, never its client or full repository.
- createInjectedWorkerAggregatePublisher returns a frozen refresh(input,observedAt,timer) port only. Explicit injected-worker transport and trusted-erp-source-publisher capability are required; absent/malformed/denied capability fails before source/RPC. Both publish and refresh-status authorizations must resolve to the same pin, rechecked around calls and source. The source callback receives validated CO14-day scope; resulting state must match that scope, then undergo existing audited generation validation before fixed publish. No arbitrary snapshot/status method escapes.
- The kind tags and callbacks are dependency-injection contracts, NOT cryptographic identity or proof of approval. No production factory constructs a trusted capability. Supplying an intentionally fabricated test capability proves local control flow only. Existing worker service-role use does not confer new ERP rights; SQL still rejects/revokes the relevant operations.

Minimum validation: 8 synthetic port tests cover absent/reader-cookie/admin-only/denied/partial/changed capability, no publication for invalid or failed source, fixed injected source path, existing read DTO/status and actual readBrandAggregate fresh result, and malformed read responses. Nine @ts-expect-error checks enforce read/write separation and no SSR authorization override; changed source modules compile transitively and scoped lint passes. Previous contract test source is preserved in eis-rpc-ports-evidence/previous-contract.test.cjs.txt; its all-purpose-repository fixture is replaced by port-specific tests, with read validation retained and write flow tested only via injected source refresh. No numeric/input/concurrency/general suite rerun.

Remaining implementation: production worker identity verifier, source-authenticated job capability and DB principal/brand/operation enforcement. Remaining approval: exact worker/read principal matrix, RPC/RLS/EXECUTE/exposure and scheduling. Missing actual evidence: full installed RPC/auth/ACL acceptance, actual worker/source wiring and operational timings. No changes to SQL, rights, schedules, roles, routes or keys in this revision. Activation remains BLOCKED.

## Scope-mutation P2 correction (2026-10-15)

Independent review: eis-rpc-ports-review-20261015/independent-review-results.json reproduced a source callback mutating the shared Oct1..14 scope to Oct2..15 and triggering a publish for the altered period. That old candidate is superseded by this correction.

The worker port now captures one original validated scope key and a frozen primitive-field scope at entry. Authorization and source callbacks receive fresh defensive copies with Readonly scope types. A changed callback copy is rejected; returned source DTO is detached with structuredClone immediately after its await, before later authorization awaits, and checked against the original key. Repository authorization verifies the actual write scope both before and after asynchronous capability checks. The final write guard checks original dates and publish snapshot scope, hands transport a detached/frozen argument object and frozen snapshot scope, and never reads a mutable callback scope to choose a write period.

Four narrowly scoped regressions pass: source-copy period mutation => publish0 and pending/failed only for original scope; auth-copy mutation => no source/write; caller input mutation during initial auth await => all callbacks/writes remain original; retained source DTO mutation during later auth => detached original DTO/scope published. Two readonly callback type-error checks and modified-source compilation pass; scoped lint and diff checks pass. Test is appended to the existing ERP command without replacing prior checks. Existing SSR-port tests, numeric/input suites, general427 and concurrency tests were not repeated. No SQL, key, permissions, operational connections or deployment changed. Activation remains BLOCKED for the previously documented publisher authentication and DB capability/approval gaps.
