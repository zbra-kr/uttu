# Offline failure diagnostics candidate

Base: `c6caa9d53c0fffa440ac7a49f37222f411f4cc42`.
Candidate: `/Users/macmini/Documents/Codex/2026-10-07/task/uttu-failure-diagnostics-candidate-20261009`.
The two target source files matched the running checkout byte-for-byte before editing.
No live source, process, schedule, database, publication, or deployment changes.

## Observed failures (2026-10-09 KST)

- DART failed at 02:00:10 with `zipfile.BadZipFile`: `dart_scraper.run` first calls
  `resolve_corp_codes`, which downloads then parses the ZIP before mapping writes.
  This attempt did not reach company detail/disclosure/financial collection.
  Job tracking writes are distinct; no database before/after comparison was done.
  Response contents were not retained, so the underlying provider cause is unknown.
- Briefing failed at 02:52:53 with exit 1. The monitor retained `insight_pages_failed`,
  one `briefing_upserted`, and incomplete-run/CLI markers, but not the exception
  type or audience. Failed detail groups are skipped before publication; complete
  audiences can publish independently. This is partial completion, not run success.
  The full-success notification gate is retained. No model/API retry was performed
  by the agent to diagnose either failure.

## Changed files

- `worker/dart/fetcher.py`: ZIP container validation; bounded JSON/XML envelope
  classification; fixed safe errors for empty, unexpected, invalid-ZIP, HTTP, and
  transport failures. No provider message/status value, URL, payload, or key in
  exception text. Invalid responses fail rather than becoming an empty success.
  HTTP error chaining is suppressed to prevent request URL traceback disclosure.
  Valid ZIP bytes pass through unchanged. Both existing binary download callers
  receive the guard. JSON endpoints, request rate, and parsing policy are unchanged.
- `worker/agent/briefing_writer.py`: allowlisted error kind/stage/audience in the
  rendered message, including the CLI fallback; sanitized job error summaries.
  Removes generated headline from the success log. Publication order, atomic
  audience upsert, failure status, full-success notification gate, and the existing
  one summary retry are retained; no new retries or success masking.
- `worker/tests/test_briefing_evidence.py`: offline loader includes pure diagnostic
  helpers without importing the worker's credential-loading module.
- `worker/tests/test_briefing_status.py`: validates sanitized job diagnostics rather
  than retaining exception message text.
- `worker/tests/test_failure_diagnostics.py`: response classifications, HTTP/transport
  sanitization and single attempts, real DART orchestration and mapping-write gate,
  real default Loguru output, partial/zero/publication failures, old-revision
  preservation, failure exit, unknown-metadata allowlist, and notification gate.
- This review note.

## Validation

`PYTHONDONTWRITEBYTECODE=1 /Users/macmini/projects/uttu/worker/.venv/bin/python3 -m unittest worker.tests.test_failure_diagnostics worker.tests.test_briefing_publication worker.tests.test_briefing_cli worker.tests.test_briefing_evidence worker.tests.test_briefing_status -q`

Result: 47 tests passed on Python 3.12.13 and 3.14.4; `git diff --check` passed. All tests use synthetic inputs,
mock clients/storage, or extracted real function bodies. No real requests, model
calls, credential loading, or database operations. Python 3.12 reused the installed
pure-Python httpx/Loguru dependencies; no package installation was performed.

Revision 2 addresses independent review findings: unknown and utf-32 XML encoding
errors become `unexpected_xml`, raised outside the parser handler so no original
cause/context remains. Binary HTTP failures likewise discard their original
context. Opening the ZIP directory replaces `is_zipfile` alone: a forged 22-byte
EOCD is rejected safely, while real populated and empty ZIPs pass unchanged.
Extracted DART function ASTs use future annotations so Client annotations do not
require live SDK imports on Python 3.12. Real Loguru 0.7.3 message logging and
traceback logging with `diagnose=False, backtrace=False` reject synthetic sensitive
text in captured output; formatted exception traceback and cause/context are checked.

## Limits / review

The exact historical DART response and briefing exception remain unknown; these
changes improve future diagnostics, not a retrospective root-cause proof. The
guard opens the ZIP directory, not provider data completeness or each entry
CRC/meaning. Unsupported response formats fail closed with a generic classification.
Database preservation claims follow code paths and offline storage tests, not a
live-state comparison. Existing ambiguous publication-response handling and
summary retry remain unchanged. Broader funding deletion/partial-write risks are
outside this candidate. No GitHub publication, deployment, migration, or activation.

Do not use Loguru `diagnose=True` exception logging for sensitive requests: it can
print arbitrary caller/frame locals (including keys/payloads) even for a sanitized
exception. This candidate logs only fixed message text; it does not change global
production logger configuration or claim uncontrolled diagnostic tracebacks are safe.
