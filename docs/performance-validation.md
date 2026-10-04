# Loading-performance regression validation

## Scope

Immutable performance source baseline: commit `5ec40b4b638f7bfb7beef46429ae629a4011c205`. Release base: main `247ba632795844a34f05512ed3246b9a3ff24f97`, Next15.5.27 and React/ReactDOM19.2.8. The five application files affected by this PR are unchanged between the source baseline and framework release base.

This change combines three independent optimizations:

1. Desktop ranking filter cleanup propagates AbortSignal while retaining stale-result guards and the same queries/joins/limits/rank changes. This does not prove that a database statement was cancelled.
2. Own-product reviews/body-stat reads start when product identity resolves, overlapping independent price/rank histories. They keep the original state/error publication boundary and have an immediate rejection handler. A failure guard prevents new ancillary reads after an already-observed first-wave failure. Reads already started can still be wasted on later failure/navigation.
3. Only ranking/reviews opt into a nullable resolved-viewport hook. Their data subtrees wait for viewport resolution, preventing obsolete desktop work on the initial mobile mount. Existing useIsMobile and all other routes are unchanged. Mobile ranking source links still use compact desktop; the weekly-review entry remains visible. Desktop data start is delayed by one viewport-resolution effect.

No cache/auth/SSO/role/schema/index/telemetry behavior is changed.

## Run locally or in CI

Install the lockfile with `npm ci` in `viewer`, then run `npm run test:performance`.

The performance suite runs serially with strict unhandled-rejection handling. `react-test-renderer` is an exact19.2.8 devDependency and the mount harness explicitly checks React, ReactDOM and renderer versions. It uses React's async `act` and declares the act environment. A Profiler observes the initial pending commit before passive effects, rather than relying on synchronous renderer creation. Test-only immutable `.txt` source fixtures represent the baseline; a hash manifest verifies their exact bytes. Git attributes prevent Windows line-ending conversion of these fixtures; only live-source parser input normalizes CRLF. Current candidate modules always load from live `viewer/src`, including the combined query changes. Tests do not fetch Git history, load credentials or make network requests.

- Abort tests cover unchanged request/result/error shape, aborted lookup preventing followup reads, forwarded signals, and stale state protection even when a request ignores abort
- Detail tests cover own/external/empty/missing products, immediate and delayed failure, early-history failure before detail, error/state parity and navigation cancellation
- Viewport tests use real React19 mounts of complete route/data-view modules and actual query functions. UI-only dependencies, Next navigation and Supabase/service boundaries are inert. Test date is fixed at2026-10-03T12:00:00Z; production date helpers are used
- Shell integration additionally mounts the real ShellClient and MobileShell around the routes, with chrome/auth/onboarding-context services inert; it covers initial responsive ancestor remounting and listener cleanup
- Supplemental tests cover desktop operation parity, all review tabs, modern/legacy source links and note flags, preserved filters, source A→B→A changes, breakpoint cleanup, exact767px media query, and SSR markup without browser globals

The older source-context renderer tests intentionally mock an already-resolved viewport to inspect the selected view. Their assertions are unchanged; the dedicated mount suite covers the new pending branch.

## What the measurements establish

In the controlled real-React harness, mobile ranking with persisted90-day desktop filters constructs94 ranking query dispatches before this change and3 after. Mobile reviews with a persisted dashboard constructs10 queries before and2 after. These are mocked query-builder dispatches, not observed HTTP traffic, database execution counts, production latency or cancellation savings. Shell/auth/private-note traffic is excluded. A separate real-ShellClient/MobileShell-plus-route harness reproduces the extra ancestor remount: ranking185→3 and reviews18→2 mocked route-query dispatches, with unchanged desktop counts. Shell statistics/auth/onboarding context remain inert, so this is still not full-app/browser or backend evidence. Breakpoint switching can still remount the route by design; route-only state-continuity assertions do not certify the full shell or drawer behavior.

Virtual detail scheduling shows that independent work can overlap, not how many milliseconds production will save. StrictMode wrapper and explicit cleanup/remount are tested; react-test-renderer does not establish automatic ReactDOM development StrictEffects replay. Server/initial-client markup branch parity does not establish real hydrateRoot or Next streaming hydration behavior.

## Framework upgrades

This branch integrates the released framework main without rewriting the existing PR history. React, ReactDOM and renderer are19.2.8; all existing runtime lock entries, including top-level react-is19.2.6, remain unchanged. The renderer has a nested test-only react-is19.2.8. The seven focused suites cover83 scenarios. Renderer deprecation may motivate a separate ReactDOM/DOM test-tooling migration; fake hook scheduling is not a substitute for real mount coverage.

## Remaining release gates

Before production publication: exact-commit CI/build/type/lint checks, supported authenticated desktop/mobile browser smoke, actual hydration and layout checks, source-note Close/Back/Forward interactions, and same-input production request/ready-state comparison when supported instrumentation is available. Keep data/role/date scope and cold/warm conditions explicit. Do not label a browser-tool round trip as network latency or infer a speedup factor from this harness.
