# First-login guided tour

## Scope

Six steps teach the three requested features without executing them:

1. Spotlight the existing UTTU AI entry (desktop top bar / mobile floating button).
2. Open the existing AI panel and show a clearly labeled, static question/answer practice.
3. Navigate to `/ranking` and explain the existing memo surface. Desktop highlights its memo button; the standard mobile ranking uses the labeled practice fallback. Existing source-linked mobile ranking and product/brand/company memo surfaces from commit 865a8e7 are preserved unchanged.
4. Practice choosing `@정호철` from a local-only example candidate.
5. Toggle a local-only sample bookmark.
6. Navigate to `/me` and spotlight the real bookmark section/tab.

All sample panels say **연습** and explicitly disclose no AI token use, no note save/Teams send, or no real bookmark save. The sample component has no network or business-mutation imports. Ordinary page reads and existing page-view logging still work during route navigation.

Teams enablement, Microsoft authentication gates, OAuth permissions, roles, and production credentials are unchanged. Teams copy explains that real sends depend on the existing connection state and the note’s send choice. Mandatory setup is completed before this app-layout tour can run (the existing administrator exemption remains unchanged).

## Interaction and accessibility

- The app-layout provider survives client route transitions.
- A native modal `dialog` blocks underlying pointer and keyboard interactions, including the clear spotlight cutout. Only its own safe proxy/controls are interactive.
- Four translucent backdrop-blur panels leave the actual target visible; no cloned page HTML or duplicate live form is created.
- The dialog has a labeled title/description, initial heading focus, Tab/Shift+Tab cycling, Escape skip, and application shortcut interception.
- Skip and Escape restore the original route (including query/hash). Completion leaves the user at `/me`.
- Tour navigation uses `router.replace`, avoiding six new browser-history entries. Browser Back/Forward closes the tour without reversing the user's navigation. A validated, app-only `uttu_tour_return` marker on guided `/ranking` and `/me` routes preserves the original source through reload or a mandatory-setup redirect; completion removes it.
- Focus returns to the original visible control, or the real Help button if the original control is hidden/unmounted.
- Targets are measured on DOM/viewport/scroll changes. Unavailable targets show a usable, centered explanation; Skip/Next remain available.
- Cards fit the viewport, scroll internally for short screens/virtual keyboards, use 16px practice text input to avoid iOS zoom, and respect reduced motion.
- AI panel open preference is temporarily overridden, never rewritten by the tour.

## Enrollment and persistence

See `GUIDED_ONBOARDING_PERSISTENCE.md` for the exact migration and API contract.

Automatic enrollment is account-scoped and based on Auth-owned `created_at` compared with the immutable migration release timestamp. Accounts that existed before installation do not auto-start. They can select **Help (?) → 시작 가이드 다시 보기**.

New accounts with pending progress resume at their last saved step after reload. Completed/skipped tours do not restart across devices. Legacy users replay only; a refresh does not automatically reopen their manual tour. Ordered writes and terminal-state protection prevent stale progress from reopening a finished tour. Account changes cancel the active tour and ignore stale results.

A temporary sessionStorage dismissal marker is keyed by account and tour version. It only suppresses repeat display after a network failure in the current tab; it never grants eligibility or replaces server account persistence.

If the mandatory Teams gate returns 428, the tour closes, drops queued progress writes, and hands back to the existing setup flow with its original safe return path. It does not mark the tour skipped or completed. Genuine account changes clear that temporary blocker.

If the migration/API is unavailable, the app does not auto-start a tour. Manual replay remains usable. Save failures are disclosed, and the user can always leave the tour. No feature flags or Auth triggers need changing.

## Local verification

Run from `viewer`:

```sh
npm run test:onboarding
npm run test:auth
npm run test:teams
npm run test:egress
npx tsc --noEmit --incremental false
npm run lint
npm run build
```

Run database assertions from the repo root with a local installed PGlite module (see persistence guide):

```sh
node supabase/tests/run_guided_onboarding.cjs
```

Behavioral browser coverage must include desktop/mobile, reduced motion, late/missing targets, skip/Escape/replay, browser Back, route transitions, completion/reload, stale/failed persistence, account boundaries, and a network audit showing no sample AI/Teams/bookmark writes.

## Release sequence

This branch is prepared only; no hosted migration or deployment has been performed.

1. Land and verify the separate Teams source-context release f3a0ba0 first; then approve tour Preview publication, schema migration and release timestamp semantics. Migration 01509 intentionally follows required setup 01507 and source context 01508.
2. Apply migration 01509 atomically through the normal approved database flow.
3. Deploy the Viewer changes without changing any Teams/auth activation gates.
4. Verify with a newly created test account and an existing test account; complete/skip/reload/replay, plus mobile QA.
5. Keep rollback and the exact published commit available. Schema rollback deletes onboarding progress, so preserve an authorized backup before destructive rollback.
