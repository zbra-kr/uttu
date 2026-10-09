"""Read-only review lifecycle evidence; no credentials, signals, or job launches."""
import hashlib
import json
import os
import re
import subprocess
import time

PREFIX = '[REVIEW_LIFECYCLE] '


def valid_id(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{32}', value) is not None


def process_identity(pid, runner=subprocess.run):
    if type(pid) is not int or pid <= 0:
        return {'state': 'unknown'}
    try:
        result = runner(['/bin/ps', '-p', str(pid), '-o', 'lstart=,comm='],
                        capture_output=True, text=True, timeout=5,
                        env={'LC_ALL': 'C', 'PATH': '/usr/bin:/bin'})
    except (OSError, subprocess.TimeoutExpired):
        return {'state': 'unknown'}
    if result.returncode == 1 and not result.stdout.strip() and not result.stderr.strip():
        return {'state': 'missing'}
    if result.returncode != 0:
        return {'state': 'unknown'}
    match = re.fullmatch(r'([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d\d:\d\d:\d\d \d{4})\s+(/[^\r\n]+)',
                         result.stdout.strip())
    if not match:
        return {'state': 'unknown'}
    return {'state': 'present', 'start': match[1], 'executable': match[2]}


def same_process(expected, actual):
    if (not isinstance(expected, dict) or expected.get('state') != 'present'
            or not isinstance(expected.get('start'), str) or not expected['start']
            or not isinstance(expected.get('executable'), str)
            or not expected['executable'].startswith('/')):
        return 'unknown'
    if actual.get('state') == 'missing':
        return 'gone'
    if actual.get('state') != 'present':
        return 'unknown'
    if (expected.get('start'), expected.get('executable')) != (actual.get('start'), actual.get('executable')):
        return 'reused'
    return 'present'


class ReviewObservation:
    """Only a correlated owned exit proves success/failure. Absence proves neither."""
    def __init__(self, daily_id, probe=process_identity, grace_seconds=60, clock=time.monotonic):
        self.daily_id = daily_id
        self.probe = probe
        self.grace_seconds = grace_seconds
        self.clock = clock
        self.absent_since = {}
        self.log_snapshot = None

    def break_continuity(self):
        self.absent_since.clear()
        self.log_snapshot = None

    def observe(self, path, now=None):
        if not valid_id(self.daily_id):
            self.break_continuity()
            return None, 'run_identity_unavailable'
        try:
            with path.open('r', errors='replace') as stream:
                opened = os.fstat(stream.fileno())
                text = stream.read()
                after = os.fstat(stream.fileno())
            current_stat = path.stat()
            identity = (opened.st_dev, opened.st_ino)
            if (identity != (current_stat.st_dev, current_stat.st_ino)
                    or after.st_size < opened.st_size):
                self.break_continuity()
                return None, 'log_changed_during_read'
        except FileNotFoundError:
            self.break_continuity()
            return None, 'log_not_yet_available'
        except OSError:
            self.break_continuity()
            return None, 'log_access_unconfirmed'
        if self.log_snapshot is not None:
            old_identity, length, digest, modified = self.log_snapshot
            if (identity != old_identity or len(text) < length
                    or hashlib.sha256(text[:length].encode()).digest() != digest
                    or (len(text) == length and after.st_mtime_ns != modified)):
                self.absent_since.clear()
        self.log_snapshot = (identity, len(text), hashlib.sha256(text.encode()).digest(), after.st_mtime_ns)
        lines = text.splitlines()
        current = None
        terminal = None
        for line in lines:
            if not line.startswith(PREFIX):
                continue
            try:
                record = json.loads(line[len(PREFIX):])
            except ValueError:
                continue  # Partial writes are not exit evidence.
            if not isinstance(record, dict) or record.get('daily_id') != self.daily_id:
                continue
            if not valid_id(record.get('collector_id')):
                continue
            if record.get('event') == 'launcher_started':
                current, terminal = record, None
            elif current and record.get('collector_id') == current['collector_id']:
                if record.get('event') in {'process_exited', 'skipped', 'launch_failed'}:
                    terminal = record
        if current is None:
            self.absent_since.clear()
            return None, 'current_launch_unconfirmed'
        if terminal:
            code = terminal.get('exit_code')
            if type(code) is not int or not -128 <= code <= 255:
                return None, 'exit_code_unconfirmed'
            if terminal['event'] == 'skipped' and code == 0:
                return 'skipped', 'current_lock_skip'
            if terminal['event'] == 'launch_failed' and code != 0:
                return 'blocked', 'current_launch_failed'
            if terminal['event'] == 'process_exited':
                return ('completed' if code == 0 else 'failed'), 'owned_launcher_exit'
            return None, 'exit_event_unconfirmed'
        # Never identify a process by PID alone, or infer failure from elapsed time.
        role = 'launcher'
        pid = current.get(role + '_pid')
        expected = current.get(role + '_identity')
        try:
            actual = self.probe(pid)
        except Exception:
            self.absent_since.clear()
            return None, 'process_access_unconfirmed'
        status = same_process(expected, actual)
        # Sample after the probe, never reuse the monitor loop's pre-job wall time.
        now = self.clock() if now is None else now
        key = (current['collector_id'], role)
        if status not in {'gone', 'reused'}:
            self.absent_since.pop(key, None)
            return None, 'current_process_' + status
        self.absent_since.setdefault(key, now)
        if now < self.absent_since[key]:
            self.absent_since[key] = now
        if now - self.absent_since[key] < self.grace_seconds:
            return None, 'awaiting_exit_log'
        # Re-read on every poll during grace. Missing/reused PID lacks an exit code;
        # report unknown, not failed/successful, and do not stop any collector.
        return 'unknown', 'process_identity_lost_without_exit'
