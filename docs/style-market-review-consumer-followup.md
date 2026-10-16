# Style / color review consumer follow-up

Apply only AFTER final48-file PR27 delta `pr27-final-evidence/final-on-pr27.patch`, SHA256 b40a328aa4503f57e235285d335ddf3d85090b84481b623314f60680878cf841, on exact PR27 78aaccbb1c32138ddc454bbe9b09252fe1ae097b. This follow-up is a separate four-file delta. Do not reapply old eight input patches or replace the preserved final48-file patch. Final48 sources and all historical evidence remain unchanged.

## Two different consumers

`inspectProductCrosswalk` consumes APPROVED style-only evidence for one product per ERP style. Its duplicate/style conflict checks protect downstream per-product comparison against duplicating style revenue. They are intentional safeguards and remain byte-identical. All25 real products remain unconfirmed; no fields/proofs/statuses were written or fabricated.

New `inspectStyleMarketReviewOnly` / `readStyleMarketReviewOnly` consumes the existing style/color evidence as an explicit review-only view. Each style owns one sales object. All product/color children and their separate recorded market endpoints remain present; there is no first-product choice, copied child revenue, allocation, rank aggregation, accepted crosswalk or confirmation port. Child observations are REVIEW EVIDENCE, not an approved joined market signal: each child has blocked-unconfirmed or blocked-conflict status, usableMarketSignal=null and insightEligible=false. Style usableComparison=null, confirmedMappings=0 and insightRows remain empty. Thus the representation supports one-to-many review without weakening confirmed crosswalk protection.

The asynchronous reader requires authorization before loading and verifies the same session after loading. It snapshots loaded evidence before the authorization await, so an external mutation cannot swap the loaded object. Failures return fixed withheld codes without private errors. The detached projection exposes no underlying client/write capability. The pure inspector is a validation/projection helper; calling it does not authenticate a source or approve a mapping. This path remains opt-in code with no app route, scheduler, RPC factory or publisher wiring. The existing production defaults are unchanged.

## Scope and validation

New5 regression tests cover two child products with one sales instance and independent endpoints; unconfirmed/conflict signal blocking; legacy confirmed duplicate rejection; authorization/load/session/invalid-input failure propagation; evidence snapshotting/no promotion ports. Targeted strict TypeScript compilation includes negative assertions that a review child is not a CrosswalkEvidence and that the view has no publisher. Scoped lint passed.

Existing stored receipts only were evaluated through the actual new consumer:10styles,25children,25blocked usable signals,confirmed0,insights0,allocationNONE. This is offline recorded evidence, not a new authenticated query or fresh business proof. The unresolved brand/code/grain approval requirements in mapping-definition-evidence remain intact. No full-suite/build rerun is claimed or needed for this isolated addition; the prior full build evidence belongs to the unchanged48-file base.

Apply `style-review-consumer-evidence/style-review-consumer-only.patch` after the pinned final patch. Keep original CI and ERP commands; the new test argument is appended. Per-file hashes, patch hash and checks are in adjacent result/changed-files/artifact-sha256 JSON. No real data requery, mapping confirmation/storage, DB installation/permissions, publication or deployment occurred.
