# Local monitor observability candidate

Base: ad0d17ef33c2b0f9d080c3ffb1f3fa5eec3d110f. No live edits, publication,
DB access, forced jobs, scheduling changes or deployment.

Three deterministic regressions reproduced against the base: an appended new
ranking start retained old completion; a full-collection restart retained old
ALL DONE; a review retry retained a previous recovery-lock skip. Parse recognized
starts and settlements in order, retaining only the latest attempt state. A latest
review recovery skip remains skipped and never claims collection completion.

Each monitor invocation emits allowlisted JSON metadata with unique monitor run
ID, daily token and timezone-aware UTC recording time. Owned downstream stages
emit start, process exit code and settlement records. External log settlement is
explicitly marker observation, not exact collector completion time or process
health. No captured child output, arguments, keys, paths or model content enter
these new records. Existing notification/error behavior remains unchanged.

Settled dependencies, optional news failure, full-collection six-hour force-pass,
review-recovery skips, timeout policy and one owned attempt per stage are retained.
Telemetry sink errors cannot trigger retries or prevent normal stage execution.

Limits: monitor_run_id identifies this monitor, not a collector/DB attempt. Legacy
logs without a recognized newer start cannot establish cross-run identity; they
retain compatibility and are labeled identity unavailable. Concurrent monitors
have distinct IDs but are not serialized; no ownership lease is introduced.
Already-settled stages remain settled within the invocation. New start markers
cannot prove older in-flight writers have stopped. Stage exit zero/marker outcome
is not content acceptance, source completeness, DB receipt or persisted artifact
verification; every new event explicitly says content acceptance unverified.
Detailed source failures inside successful processes remain outside this bounded
monitor change. Legacy historical records cannot acquire exact timestamps.


Reviewed evidence corrections: policy force-pass uses policy_timeout; a failed
launch uses launch_error. A runner-confirmed exit remains owned_process when a
later notification raises OSError; the separate post_exit_error records that
failure without inventing a launch failure. Existing outcome policy is retained.
This is observation telemetry and pre-settlement stale-log parsing, not complete
collector-attempt isolation. Post-settlement restarts remain ambiguous.

Independent source installation assessment: this monitor imports only standard
library modules before main, and loads its function code at invocation startup.
It does not reload its source during monitoring. Atomic replacement of this script
therefore changes future invocations, not code already loaded by the running
monitor. Tests are offline-only. Neither file depends on funding persistence,
viewer deployment, migrations or schedule changes. Original live review-recovery
skip handling is included in the reviewed base and candidate. The live script's
only difference from that base at assessment was an extra blank import line.
