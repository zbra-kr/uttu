# Local funding persistence preservation candidate

Base: prepared local handoff commit `35787ae5b1281dc678f6018faba8d83d984fcf53`.
This candidate is separate from the deployed Mac and the handoff branch. It has
not been installed, published, or applied to a database. Existing schedules remain
unchanged. The 16:50 scheduled poll observed an empty queue only; natural updated
ranking/briefing acceptance remains separate, after the October 8 02:00 KST daily
pipeline. Guard scope and completed-cutover reversal requirements are unchanged.

## Reproduced boundaries

Six deterministic tests fail against the base and pass with this candidate:

1. Successful discovery deletes unrelated older funding history.
2. Successful empty discovery deletes all historical rows.
3. Chunk two of a 101-row replacement fails after chunk one commits, but the job
   still publishes a new brief/freshness, reports done and attempts notification.
4. A missing round-write response is counted as a successful chunk.
5. An unverified done response still triggers a completion notification.
6. A successful dry run updates the supplied job to done.

The old sequence was company lookup → unchecked running acknowledgment → source
discovery/gate → merge of fresh observations → brief generation → company-wide
delete → independent upsert chunks with swallowed failures → separate freshness
and brief updates with swallowed failures → unchecked done acknowledgment →
notification attempt. No transaction bound those requests.

## Smallest bounded preservation change

Source discovery and its existing all-source failure gate remain unchanged. Only
fresh observations pass through the existing dedup/confidence/cross-validation
policy. Historical rows are never re-merged, reclassified, filtered, deleted or
overwritten by this collector. A successful empty discovery retains history and
builds its brief from the retained stored rows, rather than falsely reporting that
an empty current search proves no historical funding.

New rows require nonblank `(company_id, source_type, source_ref)` identities. The
whole candidate is validated before any round write. Existing historical null
references remain readable; new missing references fail instead of inventing an
unstable key. Existing schema migration `01303_funding_schema.sql` already defines
the required unique constraint. Its presence must be verified read-only before
any future deployment; this candidate requires no new schema/permission change.

Each chunk inserts with `ignore_duplicates=True`. The first persisted record wins
unchanged when the same identity reappears, even if a later extraction differs.
This prevents overwriting richer history with nulls or downgraded values. It also
means same-source corrections/enrichment are deliberately not applied: an explicit
versioning/correction policy needs separate review. This is observation storage,
not replacement of the company's complete history.

Every chunk requires a typed, identity-consistent response. An empty response is
valid for ignored duplicates only if a subsequent paginated stored-history read
confirms every requested identity. Missing/malformed/foreign/duplicate responses,
missing stored identities and invalid history pages stop publication. History is
read with explicit 100-row ranges and stable ID ordering; repeated IDs fail closed.
It is not assumed to fit PostgREST's default 1,000-row response.

The brief uses the actual persisted history, including unchanged existing records.
An empty/invalid brief fails. Brief text, brief time and collection freshness are
updated in one company-row request, and its returned identity, text and timestamps
must match. Equivalent timestamp encodings are compared as aware datetimes. Only
after that confirmation may the job be marked done. Its returned status/count/error
and returned transition timestamps must match, and only a confirmed done
acknowledgment permits a notification attempt.
A dry run performs no job, round, company or notification writes.

## Partial success, retry and acknowledgments

- Source failure: no round/company/brief/freshness writes; attempt failed status as
  before. Unknown running status stops before source/model calls.
- Round/history/brief failure: preserve all old rows. Already inserted valid new
  chunks may remain. Keep prior company brief/freshness until publication is
  attempted; report failure, attempt failed status and do not notify completion.
- Retry of a partial or ambiguously committed insert: the stable unique keys and
  ignore-on-conflict behavior retain committed rows, insert only missing identities
  and verify the complete requested set. This does not automatically retry failed
  jobs: the poller still reads pending jobs only. Retry/requeue remains an explicit
  operator/user action, and running/done resets clear stale prior error metadata.
  This bounded implementation recomputes discovery and the brief on a data retry;
  it does not introduce a durable source/model result cache.
- Company update acknowledgment failure: the request may already have committed
  all company fields. Report the uncertainty and fail the attempt; do not pretend
  the prior brief/freshness was restored. A user may need the existing force-refresh
  route because an ambiguously committed freshness value can affect the cache.
- Done acknowledgment failure: confirmed company publication remains intact;
  return an error and send no completion notification. Do not overwrite a possibly
  committed done state with failed. The job may need explicit reconciliation.
- Notification error after confirmed done: retain data/job success and log it;
  publication is not retried solely because notification transport failed.

`rounds_found`/job `rounds_found` count the current requested identities confirmed
in storage, including retained conflicts. `rounds_inserted` counts acknowledged new
rows in this attempt; `history_rounds` counts the full stored history used by the
brief. A failed attempt's zero `rounds_found` is not proof of zero committed rows.

## Remaining transaction/ownership requirements

This candidate fixes deletion and false success after partial writes. It does not
provide all-or-nothing visibility: valid early chunks can appear in the viewer
while the job later fails. Pagination is not a transaction snapshot. Other writers
can change rows between verification and publication. Job claims are not exclusive
leases, and repeated manual calls/concurrent workers can attempt duplicate jobs or
notifications. Stable round idempotency is not exactly-once job/notification delivery.
No completed history is silently rolled back to compensate for uncertain receipts.

If strict atomic publication is required, prepare a separate reviewed SQL/RPC
change before activation: a service-role-only transactional publication function
must serialize company/job ownership, validate the expected history version and
all incoming identities, insert immutable new rows, publish brief/freshness and
record completion in one transaction. It must return an idempotent persisted
receipt for a durable job/attempt key so a lost response can be reconciled without
rerunning source/model work. Completion notifications need a transactionally
recorded outbox key if exactly-once enqueue is required. No client-side delete,
compensating restore, direct-write fallback or widened anon/authenticated grants
should be added. That stronger contract is not implemented or claimed here.

No SQL migration, database permission change, live write, forced production/model
call, publication, cron edit or redeploy is included in this local candidate.

## Local verification

The base reproduction logged six failing preservation/acknowledgment/dry-run
regressions while its existing 256 tests and 81 subtests passed. The final candidate
passes 286 tests and 81 subtests on Mac/Python 3.14.4, including a native PostgREST
request-builder check for `resolution=ignore-duplicates` and returned row
representation, without constructing or calling a live database client. Required
`ruff check worker` passes locally. Ubuntu/Python 3.12 CI and live populated-job,
database-transaction, concurrency and notification acceptance have not run.
