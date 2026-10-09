# Combined diagnostics and individual-cancellation review

Base: `c6caa9d53c0fffa440ac7a49f37222f411f4cc42`.
The two original candidates and their Library archives are preserved, not edited.
This separate nonproduction checkout combines the reviewed source changes by
explicitly reconciling the overlapping result loop, not sequential patch replay.

The diagnostic audience-to-result zip and detail iterator order are retained.
Summary/detail outcome guards accept Exception or asyncio.CancelledError, while
the existing retry selector remains Exception-only. Cancelled summaries cannot
enter detail generation; cancelled pages cannot enter publication. Safe logging
helpers recognize the fixed CancelledError name and take BaseException input
without introducing a BaseException catch or suppressing whole-run cancellation.
Other diagnostics, fixed DART response classifications, XML exception boundaries,
ZIP directory opening, and Python 3.12 AST compatibility remain intact.

## Validation

Seven related test modules cover diagnostics, cancellation, publication, CLI,
evidence, status tracking, and the combined boundaries. There are 66 unique tests,
including 13 combined-boundary tests with 216 subtest combinations of six outcomes
across three audiences: success, summary error/cancel, detail error/cancel, and
publication error. They check requested audience mapping, old-row preservation,
list-only publication, zero/partial error status, safe diagnostics, notification
gate, and existing exception retry counts. Duplicate audiences and returned
CancelledError objects are also covered.

Real Loguru 0.7.3 tests are included, not skipped. No model/database/network calls
or credential loading occur. The existing Mac pure-Python httpx/Loguru dependencies
are reused for Python 3.12.13; Python 3.14.4 uses the worker virtualenv. No packages
are installed. Supported versions are tested explicitly and results are included
in the review archive; git diff --check passes.

## Limits that remain

Whole-run cancellation propagates at asynchronous suspension points. A cancel
request cannot immediately preempt synchronous upsert operations; confirmed rows
may already exist before cancellation is delivered. Cancellation during tracking
after publication also does not roll back committed rows. Tests deliberately
demonstrate these boundaries. This is not a guarantee that every cancellation
prevents every write. Lost publication responses remain unconfirmed and are not
retried automatically. Existing whole-run cancellation job-tracking behavior is
preserved rather than introducing a new finalization/rollback policy.

Default fixed message logs are tested safe; diagnose=True exception traceback
logging can expose arbitrary caller locals. Only controlled diagnose=False,
backtrace=False traceback logging is claimed safe. ZIP directory opening is not
CRC or provider-data completeness verification. No live DB preservation/completeness
claim follows from these controlled-storage tests.

The copied diagnostics component note describes that component's original review;
this note and verification.json describe the combined candidate. Neither original
candidate nor this combined candidate is activated, published, or deployed here.
