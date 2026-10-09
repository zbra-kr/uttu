"""Skip scheduled duplicate collectors while review recovery owns the lock."""
import fcntl
import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from review_lifecycle import PREFIX, process_identity, valid_id

daily_id = os.environ.get('UTTU_DAILY_RUN_ID')
daily_id = daily_id if valid_id(daily_id) else None
collector_id = uuid4().hex


def write_evidence(text):
    # Use unbuffered descriptor writes: a failed TextIO flush at interpreter
    # shutdown can replace the child's actual exit status with Python's 120.
    try:
        data = text.encode('utf-8')
        while data:
            written = os.write(sys.stdout.fileno(), data)
            if written <= 0:
                return
            data = data[written:]
    except (OSError, ValueError):
        pass


def emit(event, **fields):
    record = {'event': event, 'daily_id': daily_id, 'collector_id': collector_id}
    record.update(fields)
    # Child stdout may end without a newline. Start each record on a fresh line.
    write_evidence('\n' + PREFIX + json.dumps(record, sort_keys=True) + '\n')


emit('launcher_started', launcher_pid=os.getpid(), launcher_identity=process_identity(os.getpid()))

path = Path(__file__).resolve().parents[1] / ".secret/review-collection.lock"
path.parent.mkdir(exist_ok=True)
with path.open("a+") as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        write_evidence("\nCollection skipped: review recovery/collection is already running\n")
        emit('skipped', exit_code=0)
        sys.exit(0)
    try:
        code = subprocess.call(sys.argv[1:])
    except OSError:
        emit('launch_failed', exit_code=1)
        sys.exit(1)
    emit('process_exited', exit_code=code)
    sys.exit(code)
