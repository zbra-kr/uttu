# Local ERP addendum application order and PR27 boundary

All paths below are relative to `/Users/macmini/Documents/Codex/2026-10-12/task-3`.

## Canonical PR26 reconstruction

Start from clean `7e0fef748780cde1e9119ab62abb244011cab671` (PR26). Apply each incremental patch once, in this exact order. Verify hashes before applying. Do not stack full snapshots from earlier numeric/ports/scope/stage candidates: they overlap. Steps 1–5 produce the preserved mapping candidate full-diff hash `31a81cf3fb9c7459016759a45fc01ef52b87ea8b79c370d6732cb2035bcf9156`.

| Step | Patch | SHA256 | Meaning |
|---|---|---|---|
| 1 | `eis-rpc-scope-evidence/rpc-scope-fixed-on-pr26.patch` | `b01cb135b08824220749cf55c3b1f21a15b87665e98c1c90c4678aa694816adf` | Full snapshot on PR26; includes stage1/2, repository, numeric/ports/scope fixes. Do not also apply older full snapshots. |
| 2 | `eis-source-dryrun-evidence/source-dry-run-only.patch` | `c16827be626af5654b8e2fd4fe9c955c5707f1b208cdd71c62f14383bbc7c515` | Source dry-run delta (11 files). |
| 3 | `eis-existing-read-evidence/existing-connection-only.patch` | `fbcb1d160b54a4a5689787dd4144d6b1f9c2c4c569eb5fe97e907ee9ae9e007e` | Existing normal factory connection delta (3 files). |
| 4 | `eis-session-bound-evidence/session-timeout-close-fix.patch` | `e76e24afe8eaa927ac2c2ed556cee77d31649a34c190d7bcf040e45761f3b6c1` | Owned timeout and close failure delta (4 files). |
| 5 | `erp-mapping-evidence/code-match-candidates-only.patch` | `4a24bcc8f359c6e3f78c6b73a2b279a80d0c84f0069b6400c3bb6d0c00db24d5` | Exact code mapping candidate delta (3 files). |
| 6 | `style-market-evidence/style-market-grain-only.patch` | `182e1c7762f15aa219acb712865d4ed29b8f849be93f6ed0f344b7c3b2f6657a` | Style/color grain plus direct/composite P2 delta. |
| 7 | `missing-evidence/missing-evidence-only.patch` | `cb5b7cab8cfe65223081dde11410077b874b9a6d352b69df88b837a36cb026c1` | Calendar proof and missing-evidence delta; wording P2 is fixed by final step. |
| 8 | `wording-evidence/wording-only.patch` | See adjacent `result.json` and `artifact-sha256.json` | Wording P2 and its focused regression test; does not repeat prior deltas. |

The current `wording-candidate` represents all eight steps. Reviewed `style-market-candidate` and `missing-candidate` plus their evidence patches remain unchanged. Original direct/composite mapping candidate likewise remains untouched. Source-view zero boundary remains 140=64+76, upstream completeness unknown, no confirmed mappings/insights.

## Final PR27 integration — verified local candidate

The exact approved remote `https://github.com/zbra-kr/UTTU.git` was read with `git fetch --no-tags ... 78aaccbb1c32138ddc454bbe9b09252fe1ae097b` in a separate local clone. Fetch succeeded without credential configuration or remote write. `pr27-final-candidate` HEAD is that exact commit. The reconstructed final PR26 delta (steps 1–8) applied with `git apply --index` without conflicts. This is equivalent to the documented ordered chain; no intermediate overlapping full snapshots were stacked.

PR26→PR27 changes six paths. All six remain byte-identical to PR27, including `viewer/src/styles/erp-status.css`, `viewer/src/lib/queries.ts`, `viewer/src/lib/review-stats-read-path.ts` and their regression tests/document. The review reader still returns `legacy-counts`; the optional RPC remains uninstalled/unactivated. Existing package scripts and CI workflow remain intact; only ERP test arguments were appended. SQL remains draft files ending NOT-APPLIED.sql. No permissions, installation, schedules, confirmed mappings, source collection, publication or deployment were performed.

## Use one final patch, not the historical chain

For future review/reproduction use only `pr27-final-evidence/final-on-pr27.patch` on clean PR27 `78aaccbb1c32138ddc454bbe9b09252fe1ae097b`. Do not also apply steps 1–8, review-stats-pr26.patch, older full snapshots, or this final patch twice. Historical inputs remain immutable evidence. `changed-files.json` records the final file list and per-file hashes; `input-patches.json` records provenance. Final patch SHA256 and validation exits are in `result.json` and `artifact-sha256.json`.

The integrated tree passed the existing report→ERP command (64 report and 448 ERP tests in its two invocations), review-stat tests (47), performance/navigation tests (90), worker tests (23), full application tsc and lint (existing warnings). A malformed receipt CLI actually exited 1, proving failure propagation. Counts are separate command evidence, not sums used as a substitute for running the integrated tree.

Build was isolated with an empty inherited environment, dummy invalid Supabase URL/key placeholders and a Node network guard. First build compiled and typechecked, then failed at page-data collection because the pre-existing admin route eagerly required a service key. A second build with a dummy service-key placeholder completed the entire Next production build, including prerender and route output, exit 0. Twelve outbound connection attempts were blocked before transport. No real secrets or live DB/API requests were used. This validates an offline placeholder build, not authenticated DB-dependent behavior or production deployment. Existing lint warnings remain; real service integration and browser QA are outside this task.

## Wording-only validation

The HTML template now says “동일 코드로 연결되지 않은 색상”. It explicitly states that 165 keyless own Covernat products cannot be attributed to these colors and missing/alternate codes prevent proving product absence. The actual offline HTML is regenerated from stored receipts only, and a focused regression test asserts both phrases and absence of “상품 없는 색상”. No source requery, new collection, DB writes, type/full-suite reruns, build, publication or deployment was performed for this wording fix.
