# Guided onboarding verification — 2026-10-02

Base: `f3a0ba0d5c786de4b2491348f962224452503289`
Branch: `feat/guided-onboarding-remote-base`

The remote base f3a0ba0 has the same tree (`bfb4b0e123997299688e14ea30f7dac03bdc5311`) as reviewed local source commit 865a8e7. The tour patch is now based on the real remote commit, not the local-only commit ancestry.

## Passed on final source

- Onboarding: 100 Node tests (63 API validation/isolation, 9 pure/source invariants, 14 callback/effect lifecycle regressions, 14 setup/source integration checks)
- PostgreSQL/PGlite: 61 assertions against the actual onboarding migration/rollback SQL; existing mandatory-setup SQL 46 assertions and note-source-context SQL regression also pass
- Existing Auth regression suite: 182 tests
- Existing Teams regression suite: 362 tests
- Existing egress suite: 24 tests
- TypeScript: `tsc --noEmit --incremental false`
- ESLint: pass, existing repository warnings only; no onboarding warning remains
- Optimized Next.js production build: pass with synthetic local Supabase URL/keys; no production credentials or database access
- Exact publisher SQL batches: absent-object preflight, apply, ACL/RLS readback and idempotent cutoff tests pass
- Git whitespace check: pass

Independent review identified and fixed query/hash loss, dismissal during pending navigation, delayed initial-state reads overwriting manual replay, late 428 return-path loss, and setup-blocker leakage across accounts. Middleware-first denial now preserves the original source through a validated return marker. Full-URL navigation tracking also protects pending same-path query changes from racing Skip/Back. Final independent review found no remaining blocker; browser evidence remains absent. The lifecycle regression tests execute the real provider with mocked hooks/router/network; they do not simulate a DOM.

## Not verified

Actual browser rendering, pointer/focus behavior, iOS keyboard behavior, screenshots, real authentication sessions, hosted migration, concurrent live requests, cross-device live resume, preview/production deployment. A fresh supported-browser attempt on 2026-10-02 again returned ERR_BLOCKED_BY_CLIENT for localhost before any page-level verification; see `GUIDED_ONBOARDING_BROWSER_QA.md`.

Do not describe this feature as visually verified or deployed. The production application and database are unchanged.

## Approval/release gates

1. Approve publishing a branch Preview in the existing UTTU Vercel project, keeping Production untouched
2. Perform real desktop/mobile browser checks and capture screenshots on that permitted Preview
3. Approve applying migration 01509 to the selected database; review the immutable installation cutoff first
4. Verify new/legacy account behavior with authorized test accounts in the approved environment
5. Separately approve/coordinate production deployment from the reviewed patch/commit

No new secret, OAuth permission, Auth hook, profile trigger, Teams activation, notification schedule, or authentication gate is required by the tour. The separate Teams source-context publisher remains the only publisher until this patch is explicitly handed off. The tour does not weaken or bypass mandatory Teams setup.
