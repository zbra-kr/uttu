# Ranking collection accounting

This isolated source candidate changes accounting and run-level visibility only.
It has not been published or activated. No crawler, production write, schema or
permission change is part of preparation.

`collection_jobs.rows_done` records ranking snapshot row submissions whose upsert
`execute()` returned successfully. This is an acknowledgement count, not a count
of newly inserted or unique persisted rows: repeated cohorts/runs, conflict
updates and duplicate input can overlap. No independent database read-back is
performed. Stub product, thumbnail, brand and product enrichment writes are not
included in this ranking-row count.

The old tracker target of 273 represented cohorts, not rows. Ranking now leaves
that optional target NULL and keeps cohort_target/cohorts_attempted/
cohorts_completed in the existing structured log summary. A completed cohort
means its existing collector body returned without exception; it does not prove
that the source was exhaustive or every source row was mapped. `done` retains its
existing execution-status meaning, and warnings disclose empty or unresolved
observations rather than inventing a new status/schema.

Every successful snapshot batch immediately increases rows_acknowledged. If a
later snapshot batch raises, its submitted length becomes rows_outcome_unknown:
the server may or may not have committed before the exception. The original
exception propagates, main records the known acknowledged count using the
existing progress method, then records error. If enrichment fails after snapshot
writes, those acknowledgements are likewise retained, while the cohort remains
uncompleted. Tracker writes remain best effort under its existing implementation;
this patch does not guarantee that job metadata reached the database.
Cancellation now uses the same existing progress/error methods, records the known
acknowledged rows and an explicit cancellation error when those writes succeed,
and always re-raises the original asyncio.CancelledError. It does not mark done
or invent a new status. If best-effort metadata writes fail, the job may remain
running with stale counts; cancellation still propagates, and no finalization
success is claimed. The run summary explicitly reports outcome=cancelled.

Fetch retries still use the existing BaseScraper retry rules. A retry does not
increment counts until snapshot execute returns successfully. Snapshot writes
receive no new automatic retry. BotBlockedError still stops without retry.
Each new run resets its counters; reruns are not claimed to create distinct rows.

One `ranking_run_incomplete_observations` warning summarizes the run when there
are empty source cohorts, responses with no ranked items, rows still missing a
product ID after stub insertion and a second lookup, an uncertain snapshot batch,
or a run error. No per-cohort warning or subscriber notification is added. The
warning contains counts rather than product IDs. Run summaries include those
counts directly in the message as well as structured extras: the checked-in
ranking launcher redirects the module's stderr without a custom sink, and the
installed Loguru default format does not render kwargs-only extras. No deployed
sink configuration was inspected. Tests verify actual installed Loguru rendering
with both its default format and worker/main.py's message-only format. Existing successful info events
retain rows/total_rows for compatibility and add explicit acknowledgement basis.
An empty response is an observation, not proof of a source outage or data loss.

All MULTICOLUMN modules, existing rank filtering, 500-row batching, source rate
limits/headers, retry policy, mapping and enrichment behavior remain in place.
There is no 101/300 cap, new pagination, inferred Top300 expectation, retry of
snapshot writes, or repair/backfill. Offline reproduction of unresolved mapping
loss does not establish that any particular live observation used that path.

Regression tests execute the actual collector/main/BaseScraper bodies after AST
selection removes SDK/environment imports. HTTP, DB and logger are offline mocks.
They cover 101/301/601 rows, multiple modules, fetch retry, no retry on bot block,
273-cohort main accounting, unresolved mapping and all-empty/unranked summaries,
first/later snapshot failures, failed enrichment, later source failure and rerun
reset. Cancellation tests use real collector/BaseScraper/JobTracker bodies and
mocked HTTP/DB: after 101 acknowledged rows the second fetch is cancelled, HTTP
context cleanup and semaphore release are checked, terminal error metadata is
verified when writes succeed, and failed metadata writes leave explicitly stale
state while cancellation propagates. Actual rendered run-warning text is checked. These tests establish code accounting behavior, not real transport or
production persistence. Independent review is required before publication or
activation; protected live review-recovery edits must be preserved at activation.
