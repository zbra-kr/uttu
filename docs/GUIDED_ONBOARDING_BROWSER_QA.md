# Guided onboarding QA attempt

Date: 2026-10-01
Original attempt source: /workspace/scratch/87057dbc2ae4/uttu-onboarding-tour/viewer
Current integrated source: /workspace/scratch/87057dbc2ae4/uttu-onboarding-v3/viewer
Integration checkpoint: 2026-10-02 (100 local onboarding tests pass; no new browser run)

## Verified

- Independent QA run at that checkpoint: 72 tests pass. Final implementation later added seven executable lifecycle regressions, bringing the suite to 79 passing tests. Neither count establishes browser behavior.
- Actual Next.js 14.2.35 dev process starts successfully on 3117 with synthetic local Supabase environment values.
- Source-only safety review: overlay practice controls modify local React state; no AI chat, note, mention delivery or bookmark mutation calls in TourOverlay.
- Source-only review: mobile bookmarks tab defaults to bookmarks and has real saved-bookmarks target; mobile ranking lacks note-entry and is handled by fallback guidance.
- No tracked feature file changes by QA; all fixture/harness files are outside repository.
- No real credentials or production API calls used.

## Browser execution blocked

1. Direct Chromium through Playwright exits before page creation: `socket() failed: Operation not permitted (1)` from Chromium process singleton. Approval escalation did not alter the runtime restriction.
2. Supported cloud CUA browser attempted `http://127.0.0.1:3117` and returned `net::ERR_BLOCKED_BY_CLIENT`.
3. Shell execution processes are isolated per call. A separately executed curl cannot reach the still-running Next dev process. The mocks, Next server and browser need a supported shared network namespace for the harness.

Both temporary Next and Supabase mock server sessions were stopped after confirming the limitation.

## Unverified

All browser-runtime claims: auto-start, desktop/mobile appearance, route changes, pointer inertness, Ctrl/Cmd-K suppression, focus trap, Escape/focus restoration, skip original-route restoration, browser Back exit, rapid navigation, refresh persistence, missing-target fallback, reduced motion, Help replay, existing-account suppression and account switching.

No screenshots were produced. Do not claim visual or end-to-end browser verification.

## Prepared artifacts

- qa.cjs: Playwright fixture harness covering the main desktop/mobile six-step walkthrough, snapshots and assertions (not successfully executed)
- mock.cjs: synthetic Supabase auth/read server fixture
- next.log: successful Next dev startup log

Onboarding tests include source-string assertions for modal and navigation behavior; passing them does not replace runtime browser evidence.

## Permitted next verification route

A Vercel branch Preview in the existing UTTU project can provide a browser-reachable test URL after separate publication approval. No preview was published as part of this implementation. Keep the current Production deployment unchanged. Use the existing repository/Node 24 build flow and verify the exact preview commit before testing.

A visual-only manual replay can be inspected without applying the new schema; the app will accurately report that progress cannot be saved. Full first-login/cross-device persistence verification requires migration 01509 in an approved test Supabase project plus test accounts created before and after its fixed cutoff. Reusing the production database for that test is not automatically authorized. Keep Teams and Microsoft-only UI gates at their existing settings.

After a permitted preview is available, run the prepared synthetic harness where app/mocks/browser share a supported network environment, or use the supported browser with authorized test accounts. Verify all listed runtime behaviors and capture real screenshots before calling visual QA complete.

## Integrated mandatory-setup cases still needing real browser coverage

- Finish required Teams connection before any automatic guide appears; the setup page never mounts the guide
- Revoke/disconnect during guide and verify the existing gate wins whether the API response or the route redirect arrives first
- Preserve product/memo/ranking source returns after Skip, reload and setup re-entry
- Change authenticated accounts during a delayed state read/save; the old account's blocker/progress must not affect the new account
- Check standard mobile-ranking fallback and source-linked compact mobile-ranking memo behavior separately

The prior socket/localhost denials were not bypassed or retried through alternate routes. A newly authorized, browser-reachable Preview is still the supported next validation route. This document records the historical blocker without asserting that every future environment is unavailable.

## Fresh remote-base attempt — 2026-10-02 05:38 UTC

The exact f3a0ba0-based viewer source was copied to an isolated local QA directory without `.env`, `.next`, dependencies or incremental state. Next dev started at `http://127.0.0.1:3117` with synthetic local Supabase values; the required-Teams flag was disabled only for that local process. A new supported cloud-browser tab attempted `/login` and returned `net::ERR_BLOCKED_BY_CLIENT` before any page loaded. Existing production tabs were untouched. No alternate host, browser bypass or tunnel was attempted; local test processes were stopped. The failed tab could not be cleaned up because the browser URL policy also blocked that action.

No tour screen, screenshot or runtime interaction was verified. The next step is an explicitly authorized browser-reachable Preview for the exact remote-based patch; full enrollment/persistence checks additionally require an approved database installation of 01509 and authorized test accounts. Production was not changed.
