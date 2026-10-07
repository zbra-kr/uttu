# Reviewed worker handoff

This change packages the reviewed funding source failure gate, rank observation
policy, briefing publication checks, collection monitor outcomes, and cooperative
funding/DART maintenance tooling. It is prepared on canonical main
`a77b1790c4e0643693706226171484b6a374e9c8`; newer viewer files are preserved.
Preparing this branch does not publish or deploy it.

## Scope and local customization

Rank observations remain low severity; stock/price behavior and unrelated
notifications retain their existing behavior. Briefing completion requires the
requested confirmed publications. Source discovery failures fail the funding job
before the destructive write phase. Successful funding still retains the existing
deletion and partial-write risks; this change does not provide atomic publication
or complete data preservation.

The collection monitor includes the reviewed Mac customization for a review run
skipped because another review/recovery collector holds its lock. It records
`skipped` rather than completed and sends a distinct status. Existing settlement
gates remain permissive: failure/timeout can still allow downstream work; full
collection retains its six-hour force-pass policy and news remains optional.
This branch does not copy unrelated local scraper, viewer, review-wrapper, or
recovery edits. Those remain separately backed up and uncommitted on the host.

## Observed production acceptance

The October 7, 2026 16:50 KST scheduled funding poll logged
`poll_pending_no_jobs`, then `funding_poll_done`, and completed at 16:50:04.
It processed zero pending jobs. This establishes ordinary startup and empty-queue
polling only, not acceptance of a populated funding job, real DART documents,
successful publication, or notification delivery.

At preparation time, natural rank/detection and briefing acceptance under the
updated files is pending. The unchanged daily cron is `0 2 * * *` in the host's
KST timezone: its next run is October 8 at 02:00 KST (October 7 at 17:00 UTC).
Rank collection starts within that pipeline; detection follows ranking/brand
settlement. Briefing follows detection/full collection settlement and the news
attempt, so it has no fixed clock time. Funding cron remains every five minutes.
The notification dispatcher cron remains disabled. No forced production test,
schedule edit, service restart, or deployment is part of this handoff.

## Maintenance contract and recovery

`worker/utils/maintenance_guard.py` uses Unix `fcntl` locks. The enrolled module
CLI entrypoints are `python -m worker.main` in funding/funding-poll mode and
`python -m worker.scrapers.dart_scraper`. They acquire a shared lease before
application/SDK imports. During maintenance, funding exits zero without claiming
a job; DART exits 75. Wrapper log markers are not proof of completed collection.

Direct imported calls to `main()`, `run_job`, `poll_pending`, DART functions,
embedded/notebook/dynamic SDK imports, and other hosts are outside this fence.
Known process-name inspection is conservative, not exhaustive. Inspect all
potential SDK readers before any future cutover. Unsupported operating systems
are outside this Unix maintenance implementation.

Windows compatibility is a publication review item: these enrolled CLI modules
import the `fcntl` helper before application imports, so they currently fail on
Windows. This branch preserves the reviewed Mac implementation rather than
silently weakening the guard on another platform. Do not publish it as a
cross-platform worker update without a separately reviewed portability decision.

`maintenance_installer.py` is an inactive standard-library engine, with no CLI or
scheduler operations. A caller must supply a separately reviewed, environment-
specific exact manifest. No host manifest, backup, token, credentials, wheel,
virtual environment, or runtime `.maintenance` state is included in this branch.
The permanent installer control lock spans enrollment through finish; the durable
marker precedes code/SDK moves, natural readers drain, and the marker clears only
after full verification. Failed or interrupted verification retains the marker.
Process-crash containment is tested; power-loss/global multi-file atomicity is
not promised. Never delete/recreate permanent locks or blindly remove a marker.

For an unfinished matching-token installation, the engine can recover a verified
guarded rollback using its private journal and exact backup manifest. The completed
October 7 cutover has journal phase `complete`; reversing it requires a fresh
reviewed reverse manifest and maintenance enrollment. The unfinished-installation
`recover_rollback` method is not a completed-deployment rollback command. Never
copy old unguarded source or SDK trees into the live application while readers run.
Private receipts identify the original source, guarded rollback, SDK backups,
effective manifest and journal; retain them outside version control.

## Offline verification and publication

Use a Python environment with project development dependencies installed:

```sh
python -B scripts/run_reviewed_worker_offline.py
```

The runner clears inherited credentials, disables dotenv reads and pytest plugin
autoload, uses a temporary home, and blocks network/DNS, subprocess execution and
real model/client factories. Tests use synthetic dependencies, documents and
private maintenance roots; process-crash fixtures fork only their own test child.
It does not install dependencies, invoke a production job, or enable maintenance.
Guard fixtures and installer imports resolve relative to this repository.

The guard entrypoint fixture uses the accepted dictionary poll result; its
pre-cutover integer mock has been updated to match the final runtime contract.
The reviewed guard and installer implementation are otherwise unchanged.

Local verification on Python 3.14.4 passed 247 tests and 78 subtests. A separate
network-blocked check of the actual DART SDK 0.4.17 passed exception/status mapping,
mocked filing search and five adapter boundary cases. These SDK checks use
synthetic responses, not live DART data. Python's event-loop policy API emits a
3.16 removal deprecation notice; the SDK emits two existing extraction syntax
warnings. Neither is a production acceptance claim.

Before later publication, recheck current main and integrate any intervening
changes in an isolated branch; run the offline checks and inspect the final paths.
Exclude unrelated dirty host edits and all private deployment materials. Publish
only after explicit approval; do not push the older host branch, overwrite newer
viewer work, merge main, or redeploy Production as part of local preparation.
