# Review statistics adapter on PR26 — local, inactive

Base: 7e0fef748780cde1e9119ab62abb244011cab671 (PR26), tree b18466d06fc24a8b217c61a5c9413b7684acaf96. The available local release checkout HEAD f81a3fb2142bdeeaf1737e56accc1b7200b3a831 has the same tree; it is not evidence of a newer operating source. No network refresh or production deployment observation was performed.

Search before work found only the original aggregate, PostgreSQL-test, and production-numbering candidates from 2026-10-07/task. No PR26 integration was present. Source provenance: uttu-review-aggregate-production-numbering-candidate-20261008, HEAD 3a8a456516d57fe7f79dd0c91020946c8a65cd0f plus reviewed staged numbering changes, staged diff SHA256 81c17f0dbb0134e3e19cf32f88761489892f279872494a337f6ce4872099b082. Its aggregate adapter is byte-identical across all three prior candidates.

## Minimal integration and installation boundary

The reviewed fetchReviewStats aggregate body is reused unchanged except the private name fetchReviewStatsAggregate. PR26's original body is preserved unchanged except private name fetchReviewStatsLegacy. Public fetchReviewStats(days=30, signal?) and ReviewStats types stay the same. Only its selection wrapper and one import are added to queries.ts; current hook, shell, CS and all other query code remain PR26 bytes. No old whole-file queries.ts overwrite.

review-stats-read-path.ts returns legacy-counts. Therefore the default public reader still performs the existing six head/count requests even when get_review_stats_v1 does not exist. It does not probe the RPC. No environment variable, secret, caller argument, cookie, URL parameter, new route or automatic detector enables the aggregate. The aggregate path is integrated locally but INACTIVE.

A future change of that source-controlled return value to aggregate-rpc requires separate source review AFTER exact routine creation/ACL application and actual caller/PostgREST acceptance are separately approved and complete. The prior SQL proposal is 01510_get_review_stats_v1.sql, SHA256 6df12941c0ab1d631f44035e561621668dd5140336f30f751b5057d73e729c78. It is not copied into this integration or installed here. Filename numbering is not a production applied-version claim. Fresh target/signature/collision/ledger/default/inherited ACL and caller RLS checks are still needed; historical October8 catalog evidence is not fresh acceptance or authorization.

If explicitly selected, the aggregate path uses one RPC and the reviewed exact one-row/six-safe-count receipt contract, cutoff, signal, cancellation, zero/error behavior. RPC failure does NOT fall back to six counts or manufacture zeros. Existing useReviewStats exposes error/retry; shell review metrics become null while unrelated fields remain. Test fixtures are test-only and never imported by production code. No synthetic production data is supplied.

The inactive gate can be kept on legacy indefinitely. Any future reversal of a selected path should be a separately reviewed source change back to legacy-counts, preserving later work. No database removal/ACL change is part of that source choice.

## Narrow verification

Six NEW integration tests exercise: real default gate with a missing RPC; explicitly selected reused aggregate through unchanged public DTO/date/signal; selected missing RPC with no fallback; actual PR26 useReviewStats error -> genuine-zero retry; actual signout abort plus late selected-RPC response; actual shell nullable review metrics. All are intercepted synthetic clients behind the existing offline network guard. The existing test:review-stats glob discovers this new test file; package.json and old tests are unchanged. No old33/adapter8/PostgreSQL/performance/concurrency/full-CI test rerun.

Targeted TypeScript compilation checks both reader implementations plus actual PR26 hook/shell and unchanged public signature. Scoped lint passes on queries.ts and selector. Diff and byte comparisons confirm reviewed aggregate and original legacy bodies unchanged, all other query source unchanged, hook/shell call sites and package/lockfile unchanged. Full Next build, browser, actual data/API/DB and real PostgREST/auth/RLS are not executed. Historical PG17.11 execution receipt is preserved; it does not validate this new selector on a deployed app.

## Remaining work

- Implementation: local PR26 integration complete, optional RPC path inactive. No new RPC conversion implementation needed. Future source selection remains separate, conditional work.
- Approval: exact DB routine + narrow ACL application and target/version handling; actual acceptance actions; adapter selection/release. No approval inferred from local tests or prior ordinary release.
- Actual evidence: fresh target/catalog/signature/ACL/RLS checks, approved app-token allowed/denied acceptance, PostgREST visibility/schema cache, deployed browser behavior and measured latency/cost. One request is not a production performance measurement.

Migration: none in this patch, none applied. Cron/keys/roles/permissions: none. ERP aggregate and PR19 candidates are preserved and not included. No push, merge, deployment, installation, operational source write or actual data transfer. No new commit; local patch is based on the exact PR26 commit above.
