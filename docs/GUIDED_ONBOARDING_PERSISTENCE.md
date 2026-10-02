# Guided onboarding persistence (version 1)

## Scope and rollout

The six-step tour stores progress per authenticated account, not per browser.
No Auth/profile fields, triggers, roles, or user metadata are changed. The Viewer
uses its existing session-bound Supabase client and public anon key; no service
key is required or allowed.

Review and manually apply `supabase/migrations/01509_guided_onboarding.sql` as a
whole transaction before expecting automatic enrollment. Do not run a blanket
database push or reinstall unrelated migrations. This file is independently
scoped to its own objects; it does not require Teams or notification tables. Number 01509 avoids the existing mandatory Teams setup migration 01507 and source-context migration 01508. The existing middleware guards the onboarding API just like all protected app APIs; no setup allowlist entry is added.
It has not been applied to any hosted database by the local tests.

The first successful installation inserts the version-1 release time once.
Reapplying the migration preserves this cutoff and all saved tour progress.
Only accounts whose authoritative `auth.users.created_at` is at or after this
cutoff are automatically eligible. All accounts created earlier are legacy,
including existing accounts visiting the new UI for the first time. Do not
change/backdate the cutoff to enroll them. Legacy accounts use explicit replay.

Accounts created after SQL installation but before Viewer publication are also
eligible when the new Viewer is available. No users are bulk updated or
backfilled. The first state write creates the owning user's row lazily.

## API contract

`GET /api/me/onboarding` returns one verified-account state:

```json
{
  "userId": "authenticated-user-uuid",
  "eligible": true,
  "status": "pending",
  "step": 0
}
```

- `eligible` is always derived from the fixed release cutoff and Auth-owned
  creation date, never browser flags or mutable metadata
- `status` is `pending`, `completed`, `skipped`, or `legacy`
- `step` is an integer from 0 through 5
- GET is read-only. With no saved row, new accounts return `pending/0` and
  legacy accounts return `legacy/0`
- A legacy account replay remains `eligible: false`, even while its saved
  status is `pending`. It must not become eligible for automatic enrollment

`PATCH /api/me/onboarding` accepts exactly:

```json
{ "status": "pending", "step": 2 }
```

The writable statuses are `pending`, `completed`, and `skipped`. Progress can
move backward or forward within the six steps. Completed/skipped states remain
terminal until explicit replay. A delayed PATCH arriving after completion or
skip returns the already-saved terminal state unchanged. Clients should respect
the state in the response, serialize their own writes, and cancel or ignore
stale reads after account changes. The API never accepts an owner ID.

`POST /api/me/onboarding` accepts exactly:

```json
{ "action": "replay" }
```

Replay resets the current account to `pending/0`. This is the only way to begin
a legacy account or reopen a completed/skipped tour. Both mutations return the
same state shape as GET, and require same-origin JSON requests.

All responses include `Cache-Control: no-store` and `Vary: Cookie`. Missing or
invalid authentication returns 401. Invalid payloads return 400; cross-origin
requests and a legacy PATCH without replay return 403. Missing migration,
database/network failures, or an unexpected/foreign-owner RPC result return
503 with a generic error only. The client must suppress automatic startup when
GET fails, and must not invent eligibility or completion in localStorage.
Explicit manual replay can remain usable in the UI during an outage, but the UI
must not claim the server saved it when a mutation failed.

## Database isolation

- `onboarding_releases` has RLS and no API-role table grants. The immutable
  version-1 cutoff is inserted with `ON CONFLICT DO NOTHING`
- `user_onboarding` has RLS and authenticated SELECT only for
  `user_id = auth.uid()`. No API role can directly insert/update/delete
- `get_my_onboarding()` and
  `save_my_onboarding(p_status, p_step, p_replay)` are security-definer RPCs
  with an empty search path, schema-qualified references, no caller-provided
  user ID, and explicit authenticated-only execute grants
- Each RPC checks the current verified UID and the existence of its Auth row;
  anonymous, missing-user, and service-role calls are rejected
- Account-scoped advisory locking serializes concurrent mutations. Row deletion
  cascades when its owning Auth account is deleted
- A preflight aborts the migration if inherited/default grants leave unexpected
  direct table or RPC access

## Local verification

```sh
cd viewer
node --test tests/onboarding-route.test.cjs
npx tsc --noEmit --incremental false
cd ..
UTTU_PGLITE_MODULE=/path/to/@electric-sql/pglite node supabase/tests/run_guided_onboarding.cjs
```

The route tests use mocked Supabase calls. The SQL suite executes the actual
migration and rollback in an ephemeral PGlite PostgreSQL database. It covers
legacy/new cutoff behavior, account isolation, replay/resume/skip/completion,
input validation, RLS/ACLs, unchanged Auth/profile objects, migration retries,
account deletion, and atomic rollback. It never contacts hosted Supabase.
Live session integration, live concurrent requests, and production application
remain separate verification steps; these local tests do not prove deployment.

## Rollback

Prefer disabling/removing the tour UI before schema removal. The API fails
closed if its migration is absent. Review
`supabase/rollbacks/01509_guided_onboarding.sql` separately before applying it.
It removes only these onboarding RPCs and tables in one transaction, without
CASCADE; unrelated dependencies abort the entire rollback.

Back up the release cutoff and saved progress first. Schema rollback deletes
completion/skip history. Reinstallation without restoring the exact original
cutoff would classify accounts created during the original rollout as legacy.
Do not use dropping/reinstalling the schema as a routine tour-reset mechanism.
There are no cron, OAuth, Auth hook, profile, or external messaging changes.
