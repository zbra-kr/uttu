# Notification-only Supabase migration

## Scope and safe initial state

This candidate moves only `worker.notifications.dispatcher` from the Mac mini to
Supabase Cron + an Edge Function. It does not move collectors, browser automation,
Snowflake/AI batches, or change Auth hooks, login policies, names or quotas. The
optional author-sent Teams mention feature remains a separate Vercel request flow.

The cloud dispatcher preserves current subscription and recipient rules:

- Teams: existing non-mention event types and an enabled Teams subscription plus
  a configured webhook; mention events are always excluded
- Telegram: existing enabled subscription, DB `role='admin'`, configured chat ID
  and configured bot credential; Telegram mentions retain that existing behavior
- Existing inbox rows/preferences are not erased, rewritten or backfilled
- All pre-cutover notifications are excluded from sending, including rows with
  null legacy timestamps. They stay in the inbox with their original metadata
- Historical non-null legacy timestamps are not replayed. The old worker wrote
  them for success, failure and skips, so they are **not proof of delivery**

Three independent controls start inactive: the function environment flag, the
single database control row, and the separately prepared Cron job. Publishing
code does not create or activate any production scheduler.

The live read-only inventory on 2026-10-01 found 12,631 pending non-mention Teams
rows and 12,632 pending Telegram rows. These are historical null-timestamp counts,
not permission to send those messages. The migration **must not drain that old
backlog**. Two Teams recipients and no administrator Telegram recipients were
configured at that read; actual channel readiness still needs the gated checks.

`dispatch_created_after` starts null and is set to the database clock only on the
first authorized DB-control activation, after the recorded Mac stop proof. It
cannot be supplied, backdated, advanced or cleared by an ordinary control update.
Claim creation, pending-claim selection and the immediate pre-send check all
require notification `created_at >= dispatch_created_after`. Earlier rows receive
no delivery ledger row, fake sent timestamp, delete or notification update.
Pausing and resuming retains the original cutoff; later queued work remains
eligible. Notifications created during disabled staging before first activation
are also excluded from external delivery and remain available in the inbox.
Any later historical replay needs a separately approved, bounded plan; do not
reset/reinstall the cutoff to emulate one.

## Bounded delivery and honest outcomes

A call atomically leases at most 20 notification/channel rows, using row locks
and `SKIP LOCKED`. At most three provider sends overlap. Each provider request has
an eight-second timeout; DB requests have five-second timeouts. No new message
starts after the 60-second soft budget. Unstarted claims are released or become
reclaimable after two minutes. This is a bounded migration, not an unmodified
400-message Python loop. Capacity/backlog age must be checked before activation;
a five-minute schedule permits at most 240 notification/channel claims per hour
(5,760 per day), before timeouts, database latency and skipped recipients. If both
channels are configured, both share the same 20-row batch. A claim is not necessarily
a sent message. Historical rows cannot consume this capacity, but a sustained
post-cutover arrival rate above it will grow the new queue. Monitor new-queue age
and volume; no five-minute delivery SLA is claimed. Changing batch/cadence requires
a separate capacity review, not automatic draining or retrying the old queue.

Current subscription, DB admin role, target and legacy processing marker are
checked again immediately before the attempt. A database kill switch prevents
new attempts; an already-started HTTP call can finish.

- `accepted`: definite provider acceptance; a Telegram message ID is required.
  A Teams webhook HTTP success is acceptance, not proof of end-user delivery/read
- `skipped`: no current recipient/subscription/role eligibility; no sent timestamp
- `failed`: definite rejection or invalid local target; no sent timestamp
- `unknown`: network timeout, HTTP 5xx/408, unreadable Telegram success, uncertain
  persistence or an expired attempted lease; **never automatically replayed**

Only accepted attempts set the existing sent timestamp. No failure/skip is
fabricated as sent. A later positive response can resolve its exact original
unknown claim without making a second provider request. This is not an external
exactly-once guarantee. Provider rate-limit deadlines are recorded for review,
not silently retried. Legacy admin dashboard pending counters use null timestamps
and are not the new retry queue; use the delivery ledger/status query for accurate
pending/skipped/failed/unknown counts.

## Explicit permissions and secret setup before live deployment

The migration adds two RLS-protected tables with no direct API-role access and
four narrow service-role-only RPCs. The private helper and control trigger are not API-callable.
The four RPCs and private helper are security-definer with an empty search path
and verify the Auth role is `service_role`; the control trigger is security-invoker. Existing profile/table/API grants are not widened.
All changes require reviewed production approval before installation. Live preflight
found `pg_cron` and `pg_net` absent and Vault present. Installing/enabling those two
extensions is an additional security/configuration approval, not an implicit step
of the prepared Cron script. No extension is auto-installed by this migration.

The function uses independent, constant-time internal-secret authentication.
Only this function has `verify_jwt=false`; an absent/wrong secret always returns
401 before DB access. A public API key or ordinary user session is insufficient.
No request body can select recipients or override limits. The project URL is pinned.
This endpoint configuration and its new persistent credential need explicit approval.

Required production settings:

| Setting | Handling |
| --- | --- |
| `NOTIFICATION_DISPATCH_ENABLED` | Exact `false` while staging; never enable before Mac stop proof |
| `NOTIFICATION_DISPATCH_SECRET` | Dedicated random secret, at least 32 characters, user-controlled secure entry |
| Vault name `uttu_notification_dispatch_secret` | The exact same secret, entered securely; never put its value in migration text/chat |
| `NOTIFICATION_TEAMS_ALLOWED_HOSTS` | Comma-separated exact HTTPS webhook hostnames from a sanitized live inventory; no full webhook URLs |
| `TELEGRAM_BOT_TOKEN` | Existing bot credential, user-entered through secure secret setup if Telegram is used |
| `SUPABASE_URL` and privileged API key | Platform-injected inside Edge; do not export/copy them into the repository |

Only configured channels are claimed. Missing/invalid credentials or an empty
Teams allowlist leaves that channel's backlog untouched and reports configuration
blocking. Webhook redirects, non-HTTPS targets, ports other than 443, userinfo,
fragments and non-allowlisted hosts are rejected. No secret URL, token, message
body or provider error body is logged or returned. Notification links use the
verified canonical `https://uttu.bcave.ai` origin; Telegram text is HTML-escaped.

Primary references checked 2026-10-01:
[Edge authentication](https://supabase.com/docs/guides/functions/auth),
[secrets](https://supabase.com/docs/guides/functions/secrets),
[Cron/Edge scheduling](https://supabase.com/docs/guides/functions/schedule-functions),
[limits](https://supabase.com/docs/guides/functions/limits).
The Pro worker limit is 400s, but request-idle timeout is 150s; CPU 2s and memory 256MB.
The candidate deliberately stays well below those limits. One five-minute tick is
8,640–8,928 invocations/month before other activity; Pro includes 2M invocations,
then $2/M. Shared usage, DB load and egress still matter. No paid upgrade is implied.
[Pricing](https://supabase.com/docs/guides/functions/pricing)

## Mac inventory and cutover: do not assume the runtime scheduler

The repo documents `/Users/macmini/projects/uttu/scripts/run_dispatcher.sh` and a
five-minute cron, but the actual Mac schedule must be verified by its operator.
Do not read/share `.env`, bot tokens, webhook values, full process environments or
an unredacted crontab. These are manual Mac commands, not executed by the migration:

```sh
cd /Users/macmini/projects/uttu
git rev-parse HEAD
git status --short
# Report presence/line numbers, not full cron commands that may contain secrets
crontab -l 2>/dev/null | awk '/^[[:space:]]*#/ {next} /run_dispatcher[.]sh|worker[.]notifications[.]dispatcher/ {print "Dispatcher entry at line " NR}'
# Labels only; check matching launchd jobs/other wrappers locally as needed
launchctl list | awk '$3 ~ /uttu|dispatcher/ {print $3}'
pgrep -fl '[w]orker.notifications.dispatcher|[r]un_dispatcher.sh'
```

1. Identify **all** actual dispatcher launch paths (cron, launchd, wrappers/manual
   loops). A grep returning no match alone is not proof of absence
2. With the cloud schedule/function/database controls still off, back up the Mac
   schedule locally with restrictive permissions. Use `crontab -e` to disable
   **only** verified dispatcher entries; do not remove other jobs. If launchd owns
   it, stop only the verified label. Do not kill all Python or collector processes
3. Let any active dispatcher finish normally, then confirm no active dispatcher
   and no scheduler/manual loop able to restart it. Waiting five minutes alone is
   insufficient. Record the verification time; collectors may keep enqueueing
4. If a run was killed/crashed during a send, its pending outcome can be uncertain.
   Do not blindly replay that backlog. The first-activation cutoff excludes all
   pre-cutover rows, including these uncertain outcomes, without altering the
   inbox. Any later historical review/replay needs separate explicit approval
5. Install only the exact 01506 SQL atomically; do not run a blanket `supabase db push`, `config push` or reset against production. Deploy only `notification-dispatch` to the verified project with its disabled flag, and verify
   unauthorized calls fail and an authenticated disabled call sends nothing
6. After separate secret/permission approval, prepare the disabled Cron job using
   `supabase/operations/01506_notification_dispatch_cron_disabled.sql`. Verify its
   exact name, five-minute schedule and `active=false`; no other jobs change
7. Only after Mac stop proof, verified secret configuration and explicit rollout
   authorization, record the actual verified shutdown timestamp in
   `legacy_stopped_at` and set `enabled=true` in one reviewed transaction. Do not
   supply `dispatch_created_after`: the trigger assigns it from the DB clock.
   Read back both timestamps, and confirm historical rows are reported as
   `excluded_history`, not an active backlog. Then set the function flag true and
   activate that one Cron job. The supplied stop timestamp must be the operator's
   actual verification time, not a fabricated past value
8. A real test requires an approved recipient/message. Verify one provider result,
   accurate ledger/legacy timestamp, no duplicate after repeated invocation, and
   continued delivery of other eligible alerts. Keep author-Teams mentions off
   until their own separate consent/configuration/test gates also pass

The scheduler's successful `net.http_post` only proves enqueueing. Check the Edge
HTTP result and delivery ledger too. Monitor backlog age, failed/unknown outcomes,
configuration blocking and duplicate claims. The read-only status SQL returns
counts/timestamps only, no private targets or content. It distinguishes
`held_before_activation` / `excluded_history` from post-cutover `backlog`; the
legacy admin dashboard's null-marker count includes excluded history and must
not be interpreted as the cloud send queue.

## Stop and rollback

Deactivate only the new Cron job, set DB control `enabled=false`, and turn the
function flag off. Already-started requests can finish and safely record their
outcome. Do not restart the old Mac worker against failed/unknown rows: it ignores
this ledger and could resend them. Prefer fix-forward while preserving history.
The schema rollback refuses to run if enabled or any delivery history exists;
it only removes a never-used disabled installation. No inbox rows are deleted.

## Local checks

```sh
node --experimental-strip-types --test supabase/tests/notification-dispatch.test.mjs
UTTU_PGLITE_MODULE=/path/to/@electric-sql/pglite node supabase/tests/run_notification_dispatch.cjs
deno check supabase/functions/notification-dispatch/index.ts
```

All provider calls are mocked; local SQL uses real PostgreSQL semantics via
PGlite. Hosted runtime, actual scheduler, live concurrency and real delivery still
require the gated production checks above. No production credentials are in tests.
