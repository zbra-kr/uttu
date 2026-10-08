# Review alert selection correctness

Base: a77b1790c4e0643693706226171484b6a374e9c8. Separate local candidate.

The CS alert review panel retained previous rows/count when the next product read failed and allowed an old product-header response to replace the current selected alert's header and product link. It also rendered old evidence for a new selection until passive effects ran. A scoped hook now owns separate product and review receipts. Alert ID/product ID and a selection epoch identify a selection; rating/page/page size/retry identify a review receipt. The epoch prevents A-to-B-to-A reuse. A render-current scope guard and effect cleanup ignore superseded responses; review cleanup passes AbortSignal. Product brief reads use the existing helper, which has no abort API; their late responses are ignored rather than claiming network cancellation.

Separate retries for product and reviews retain successful independent data. Missing product briefs are unavailable, not fabricated headers/links. Review errors display retry rather than empty content or prior rows/count; genuine empty success is distinct. Totals are unavailable until an exact current receipt arrives. Existing recent ordering, 20-row pagination, rating tabs, query scope, client, route authentication and database authorization are retained; id tie-break ordering and exact count validation are requested through existing query options. There are no additional data/schema/security changes.

The panel truthfully describes current saved product reviews. There is deliberately no date filtering or claim of a historic evidence snapshot: the detector's recent cutoff is target_date minus seven days inclusive without an upper bound, and different alert types have different source scopes. Historic evidence retrieval requires a separately reviewed source/window contract.

Seven deterministic offline tests execute the real hook under React 19 and render the real alert component in a transient test-only module, covering late A after B, first B render hiding ready A, B failure after A success, retries, same-product different alerts and A-B-A, rating/page scope and stable/exact-count options, abort/clear, zero versus failure, and current product links. Frozen performance baseline sources remain unchanged; their loader is extended only to resolve the new hook module. Browser navigation/layout and live database acceptance are not performed.

No publication/deployment/production modification is included. Rollback is a source reversal in an isolated reviewed integration; no database or schedule reversal required.

Final checks: all 21 existing Viewer CI commands (lint, nineteen regression commands, production build) and explicit TypeScript checking passed, using exact locked dependencies with sanitized placeholder settings and external networking blocked.
