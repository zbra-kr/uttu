# Competitor enrichment request ordering

Base: a77b1790c4e0643693706226171484b6a374e9c8 (verified main). Separate local candidate.

The matching competitor pool reader previously awaited financial enrichment before starting rank enrichment, even though both depend only on the initial pool IDs. Start both independent reads together and join their results before returning rows. Request count and selection/filter/order conditions remain unchanged. No schema, ACL, RLS, caching, or write-path changes.

Eight deterministic offline fixtures verify concurrent request start while both deferred responses remain unresolved, latest-per-company/brand selection, company deduplication, output order, empty pool and absent-company behavior, existing optional PostgREST error handling, and rejected transport/sibling rejection behavior. All 21 existing Viewer CI commands and TypeScript checking passed using exact locked dependencies, sanitized settings, and blocked external network.

No production/browser acceptance or latency measurement performed. Both requests can now start even when the other transport fails; Promise.all observes both rejections. Rollback is the isolated source diff reversal, without DB or schedule changes.
