# AI daily usage settlement candidate

Local source candidate only, based on c6caa9d53c0fffa440ac7a49f37222f411f4cc42.
No publication, activation, model call, production account access, database data,
schema, quota or grant modification is part of this investigation.

The baseline actual chat route and MCP registered ask_uttu helper were executed
with synthetic DB/provider responses. Two non-first-turn chat requests read
99,000 daily tokens at admission and again at settlement. Completed usages of 800
and 900 produced a final 99,900 instead of 100,700 with the old absolute upserts.
The MCP helper reproduced the same loss. Both admission and settlement read pairs
used barriers; no network or paid inference was involved. Baseline source and the
proof harness are preserved in the reviewer package. These are code reproductions,
not evidence of a particular live undercount.

The existing unique keys are AI (user_id,usage_date) and MCP (usage_date). All
counters are non-null INTEGER columns. Existing service-role callers already
SELECT and INSERT/UPDATE these tables; mcp_usage_daily grants these explicitly.
No new permission is requested. Source schema compatibility is inspected; live
catalog constraints, grants, triggers and transport behavior are not verified.

Settlement reads the exact counter tuple and conditionally UPDATEs the key and
all old counter values, requesting a returned row. One exact new-tuple receipt
acknowledges this invocation's increment. A zero-row receipt means its conditional
write did not match under the existing schema/permissions; reread and retry up to
five logical settlement attempts. These are not wire-request or elapsed-time
bounds: the locked SDK may retry GETs internally. Missing rows use INSERT, not UPSERT; unique violation 23505
indicates that insert did not commit and permits a reread/CAS retry. Other errors,
transport throws or malformed/absent successful-write receipts are unknown and
are never blindly retried. Read failures and exhausted confirmed conflicts return
unrecorded. Six lockstep requests require six rounds: with five logical attempts,
five are recorded and one returns contention/unrecorded. Completed usage is not
guaranteed to be recorded; the caller warning does not provide durable recovery. Negative/fractional/non-numeric counters and INTEGER overflow fail
without an unsafe write. Positive token deltas retain the existing session_count
+1/message_count +2 and MCP call_count +1 meanings; they are not redefined as
unique sessions or requests. Zero-token caller behavior is unchanged.

This depends on the current unique keys, non-null integer counters, ordinary
INSERT/UPDATE semantics and matching service-role SELECT/UPDATE visibility. It
is not protection against another writer still doing blind absolute UPSERTs,
manual resets/deletions, or triggers that rewrite/suppress returned counters.
Mixed deployments and existing in-flight old settlement code must be accounted
for at later reviewed rollout. Any schema or permission mismatch stops review;
no repair is included in this slice.

The helper returns recorded/unrecorded/unknown with fixed reasons. Chat and MCP
log only table context/status/reason, without user IDs, content, tokens, URLs or
raw DB errors, while preserving completed model answers. MCP awaits settlement before returning instead of fire-and-forget. An independent
review reproduced a never-resolving settlement read/write withholding the answer
past virtual 300001ms after the old inference timer was cleared. Both callers now
use a 2000ms settlement deadline across all reads/retries/writes. MCP caps it by
the remaining original 25000ms inference-and-settlement budget, keeps the original
timer through settlement, and clears it in finally. Chat passes req.signal for
settlement cancellation; the existing maxDuration300/provider behavior is not
redesigned. Every real query builder receives abortSignal before execution
(before maybeSingle for reads). An explicit promise race returns by the deadline
even if synthetic transport ignores abort. Normal event-loop scheduling still
applies; this is not a wall-clock guarantee during a blocked event loop.

Before a write is dispatched, deadline/cancellation is unrecorded; after dispatch
it is unknown, even if a late acknowledgement arrives. Confirmed zero-row/23505
conflicts reset the uncertain-write state before a retry. No ambiguous timeout is
replayed. Completed provider answers retain the existing chat done/MCP content
contract with a sanitized status/reason warning. No fire-and-forget is reintroduced.
Timers and external abort listeners are removed on completion. Late responses
have handlers attached and cannot initiate another write or change a returned
unknown result. Actual-SDK synthetic-fetch tests verify abort reaches read/PATCH
transport options; no live cancellation or database outcome is claimed. A helper result is not
proof of all usage being recorded. There is no durable event ID, reconciliation
ledger, cross-invocation idempotency, or automatic replay of uncertain writes;
those would require a separately reviewed design. Reinvoking the helper with the
same usage can count twice and is explicitly not the recovery plan. Usage unknown
because a provider stream failed before reporting tokens remains outside scope.

Admission remains a soft preflight, not reservation. In the fixed synthetic race
both admitted requests finish and 100,700 is correctly recorded despite the
100,000 daily limit. In-flight overshoot and provider budget enforcement are NOT
fixed. Signup defaults remain 500,000 monthly/100,000 daily. Authentication,
session ownership, service-role boundaries and quota admission code are unchanged.

Regression tests use actual chat/MCP/helper source with mock provider and DB:
concurrent existing/missing rows, all-counter conditions, account/date filters,
confirmed conflict retries, bounded exhaustion, denied reads/writes, commit-then-
throw, missing/wrong receipts, invalid/overflow counters, sanitized caller warnings
and unchanged signup defaults. Additional tests use the actual locked Supabase SDK
with a synthetic fetch implementation to verify emitted CAS filters, receipt
handling and absence of PATCH retry after a simulated commit-then-transport error.
They do not prove actual PostgreSQL/PostgREST
execution. Existing auth/session regressions and required Viewer checks are run
against the final source with external network blocked and placeholder settings.

PostgreSQL rechecks UPDATE conditions after a concurrent committed row update:
https://www.postgresql.org/docs/17/transaction-iso.html
Supabase UPDATE uses filters and explicit select() to return affected rows:
https://supabase.com/docs/reference/javascript/update

Independent review is required before publication or activation. Existing live
Mac source, review recovery, ranking candidates and aggregate DB approval state
are preserved. Rollback, if later authorized, is a source reversal on then-current
main that preserves other work; it does not erase recorded usage or replay unknown
increments. Reverting would restore the original concurrent lost-update risk.

Final local validation: 43 accounting tests and 21 pre-existing session-access
regressions passed together. All 21 required Viewer CI commands and explicit
nonincremental TypeScript checking passed under Node 24.15.0 with external network
blocked. Existing lint warnings remain; no new lint errors were introduced.
