# Disabled Teams release and activation checklist

## Release invariant

Publishing the Teams feature is separate from authorizing external delivery.
Keep `TEAMS_MENTIONS_ENABLED=false` on Vercel while preparing this release.
The optional Teams connection and Graph calls remain unavailable without both
that exact true flag and valid server-only settings. Ordinary Microsoft login,
Microsoft-only Auth hooks, admin fallback and display-name normalization remain
independent. Never copy a frozen base over newer changes: integrate the reviewed
patch on the publisher's exact current main SHA and rerun checks.

The notification-only `01506` release and Teams `01505` use separate tables and
function namespaces. They have been tested in either installation order. If
`01506` is already installed, apply only the exact `01505` transaction. Do not
run a blanket database/configuration push or reinstall/reset `01506` to make
migration-number ordering look sequential.

## Disabled publication sequence

1. Finish and verify the separate notification-only audit commit. Record its
   SHA and confirm its 11 source files match its reviewed manifest. The existing
   main CI remains Node24; its separate notification checks stay present.
2. Verify Teams remains false in the production deployment scope, the canonical
   app URL is correct, and neither server secret is exposed as `NEXT_PUBLIC_*`.
   Empty Teams credentials are compatible with disabled staging. Do not read or
   print their values. Preview builds must also remain disabled unless separately
   approved, with no production token/key sharing.
3. Run the read-only Teams schema preflight. Check the prerequisite columns,
   current RLS and absence of partial `uttu_teams_*` objects. Read back the
   notification dispatch control, function hashes/ACLs, cutoff and ledger counts.
   Record an existing cutoff unchanged; do not supply, backdate or reset one.
4. After the specific schema/access approval, install only
   `01505_teams_delegated_mentions.sql` in one transaction. Verify all 15 function
   bodies/search paths, the 11 authenticated actor-bound RPC grants, private
   helpers, three private RLS tables and two immutability triggers. Re-read the
   existing notification and Auth objects and verify their hashes/ACLs unchanged.
   Installing this SQL neither creates Microsoft grants nor sends messages.
5. Apply the Teams source patch atop the verified notification audit SHA. Preserve
   all notification paths byte-for-byte, the current name/auth files and all CI
   steps. Add Teams tests without replacing the existing workflow. Do not commit
   node_modules, build output, fixture records, secret material or local reports.
6. Run the local checks below against the exact final tree, then let the single
   publisher create the approved atomic commit. Verify the remote SHA and its
   CI/Vercel deployment, including `TEAMS_MENTIONS_ENABLED=false` in the resulting
   deployment. The SQL must precede Viewer because in-app mention creation now
   uses a Teams-namespaced RPC even while external delivery is off.
7. Verify signed-out connection requests are rejected; signed-in connection status
   is unavailable and connect does not redirect to Microsoft while disabled.
   Ordinary Microsoft login, admin fallback and normalized mention labels must
   remain intact. Do not manufacture a recipient notification in production as
   an unapproved test: use mocked checks until a named test is authorized.

## Mixed-version and cutoff behavior

Old browser tabs submit `{note_id}` only. That exact legacy shape creates only
an in-app notification after ownership checks. It never gains Teams consent.
Full reviewed body/recipient matching remains mandatory for new-format requests.
Malformed, foreign-owner, cross-origin and partial legacy requests fail closed.

The Edge database cutoff applies to the scheduled notification dispatcher, not
to delegated Graph requests. Keep the two gates distinct. Teams sends only from
an explicit fresh author submission, uses a five-minute freshness window and
retains terminal skipped records for submissions made with Teams off. Those
records cannot later be upgraded to sends. Before the first Teams activation,
verify the disabled Viewer has been live for at least six minutes and wait at
least six minutes after the old dispatcher has verifiably stopped and drained.
This avoids the old transport's final five-minute note window at cutover. Do not
replay requests or old inbox rows to test activation. All pre-cutover notification
rows and their metadata must remain untouched by the Edge queue.

The Edge dispatcher excludes `event_type='mention'` for Teams at claim and
pre-send stages. Leave that suppression intact even with delegated Teams off.
Telegram follows its separately reviewed admin/subscription rules; changing it
is not part of this release. Installing pg_cron/pg_net or publishing a Python
filter does not prove the Mac dispatcher is stopped.

## Local test matrix

Run these from the final integrated tree with Node24 and the locked dependencies:

```sh
cd viewer
npm run test:auth
npm run test:teams
npx tsc --noEmit --incremental false
npm run lint
TEAMS_MENTIONS_ENABLED=false npm run build
cd ..
UTTU_PGLITE_MODULE=/path/to/@electric-sql/pglite node supabase/tests/run_teams_delegated_mentions.cjs
UTTU_PGLITE_MODULE=/path/to/@electric-sql/pglite node supabase/tests/run_notification_dispatch.cjs
node --experimental-strip-types --test supabase/tests/notification-dispatch.test.mjs
deno check supabase/functions/notification-dispatch/index.ts
deno lint supabase/functions/notification-dispatch
```

Required cases: old note-only shape is in-app-only with Teams both off and on;
no actor/foreign note/malformed input/cross-origin fails; full new request checks
body and recipients; unavailable/unchecked/stale/oversize sends nothing; fresh
individual mentions use exact immutable Microsoft IDs; no self/team-wide DM;
opt-out/disconnect/edit during chat creation prevents the message; one saved
submission survives repeated clicks and uncertain inserts; unknown provider
outcomes are not retried; token rotation/disconnect epochs cannot be replayed.

For combined SQL installation, test `01506→01505` and `01505→01506`, preserving
peer function bodies, ACLs/search paths, disabled controls and existing Auth hooks.
Verify pre-cutover rows remain unchanged, no Teams mention enters the webhook
ledger, non-mention post-cutover rows remain eligible, pause/resume cannot change
the cutoff and a disabled Teams ledger entry cannot become pending on replay.
Local contract tests use fixtures and mocked network only. They do not prove live
OAuth, hosted concurrent requests, visual browser behavior or provider delivery.

## Remaining activation gates

- User-controlled secure entry of the existing app confidential credential and
  a dedicated 32-byte standard-base64 encryption key into Vercel. No chat, logs,
  repository, browser-side variables or agent copying of secret values. A new
  Entra credential needs its specific approval and secure handoff
- Entra Web callback and the exact delegated scopes from the main feature guide
  must be configured/verified, followed by each sender's explicit Teams consent
- Verified stop of every Mac dispatcher launch path and no in-flight process;
  preserve unrelated collectors/jobs. Record real shutdown evidence, not a guess
- The scheduler's independent secret/Vault setup and any Telegram credential are
  separate from Teams. Do not enable its flag, DB control or job merely because
  the Teams Viewer was published. Its first approved activation sets its cutoff
- Explicit Teams activation after the above checks and the cutover interval
- One named recipient and exact message approved before any real delivery test;
  confirm the displayed Teams sender, correct recipient/content and no duplicate
  from the same submission. Real-user consent and live delivery remain untested
  until those steps are performed

## Stop without erasing evidence

Keep or return the Teams flag to false to stop new delegated requests. Disconnect
continues to be available for owning users; an already-started message may finish.
Do not restart the old dispatcher as a fallback. Preserve the Edge cutoff and
both delivery ledgers. A Viewer rollback must keep its required SQL available.
The Teams schema rollback deletes encrypted grants and delivery history; it is
not a routine switch and must not be run after any use without separate review
and the applicable deletion approval. Prefer fix-forward while disabled.
