"""Cooperative funding/DART maintenance. No scheduler or external service access.

Permanent lock inodes are never deleted. A durable marker survives an installer
crash and remains until a verifier accepts the complete installed/rollback set.
Only enrolled entrypoints are covered; arbitrary direct imports are not fenced.
"""
import atexit
import fcntl
import json
import os
import stat
import time
import uuid
from pathlib import Path


class MaintenanceBlocked(RuntimeError):
    pass


def validate_owned(info, directory=False):
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if not kind(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise MaintenanceBlocked('Maintenance state must be private, owned and of the expected type')
    if not directory and info.st_nlink != 1:
        raise MaintenanceBlocked('Maintenance files cannot have multiple hard links')


def validate_file(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    validate_owned(info)
    return True


def state_dir(root):
    directory = Path(root) / '.maintenance'
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        pass
    else:
        sync_directory(Path(root))
    validate_owned(directory.lstat(), directory=True)
    return directory


def lock_file(directory, name):
    validate_owned(directory.lstat(), directory=True)
    validate_file(directory / name)
    fd = os.open(directory / name, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        validate_owned(os.fstat(fd))
        return os.fdopen(fd, 'a+')
    except Exception:
        os.close(fd)
        raise


def sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable_marker(directory, payload):
    validate_owned(directory.lstat(), directory=True)
    validate_file(directory / 'funding-dart.json')
    temporary = directory / ('marker-' + uuid.uuid4().hex)
    try:
        with temporary.open('x') as stream:
            temporary.chmod(0o600)
            json.dump(payload, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, directory / 'funding-dart.json')
        sync_directory(directory)
    finally:
        if temporary.exists():
            temporary.unlink()


def acquire_reader(root):
    directory = state_dir(root)
    marker = directory / 'funding-dart.json'
    if validate_file(marker):
        return None
    lock = lock_file(directory, 'funding-dart.lock')
    try:
        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        return None
    # Close the marker/check-to-lock race; installer owns exclusive before writes.
    if validate_file(marker):
        lock.close()
        return None
    return lock


_leases = {}


def enter_cli(root, label):
    key = str(Path(root).resolve())
    if key in _leases:
        return True
    lease = acquire_reader(root)
    if lease is None:
        print(f'{label} deferred: funding/DART maintenance; no jobs claimed')
        return False
    _leases[key] = lease
    atexit.register(lease.close)
    return True


class Maintenance:
    """Installer/recovery owner; call verified_finish only after full verification.

    enrollment_ok checks exact enrolled-source hashes before each source/SDK move.
    legacy_readers returns known pre-guard reader identities; they drain naturally.
    These callbacks are required: a flock alone cannot fence old/direct readers.
    """
    def __init__(self, root, enrollment_ok, legacy_readers, token=None):
        self.directory = state_dir(root)
        self.enrollment_ok = enrollment_ok
        self.legacy_readers = legacy_readers
        self.token = token or uuid.uuid4().hex
        self.control = self.exclusive = None

    def begin(self, timeout=30, recover=False, control=None):
        self.control = control if control is not None else lock_file(self.directory, 'installer.lock')
        try:
            owned = os.fstat(self.control.fileno())
            validate_owned(owned)
            expected = (self.directory / 'installer.lock').lstat()
            if (owned.st_dev, owned.st_ino) != (expected.st_dev, expected.st_ino):
                raise MaintenanceBlocked('Control handle is not the permanent installer lock')
            fcntl.flock(self.control, fcntl.LOCK_EX | fcntl.LOCK_NB)
            marker = self.directory / 'funding-dart.json'
            if validate_file(marker):
                current = json.loads(marker.read_text())
                if not recover or current.get('token') != self.token:
                    raise MaintenanceBlocked('Existing maintenance requires its recovery token')
            elif recover:
                raise MaintenanceBlocked('Recovery marker absent')
            if not self.enrollment_ok():
                raise MaintenanceBlocked('Entry guard enrollment incomplete or changed')
            durable_marker(self.directory, {'token': self.token, 'state': 'draining'})
            self.exclusive = lock_file(self.directory, 'funding-dart.lock')
            deadline = time.monotonic() + timeout
            while True:
                if not self.enrollment_ok():
                    raise MaintenanceBlocked('Entry guard changed while draining')
                try:
                    fcntl.flock(self.exclusive, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    if not self.legacy_readers():
                        break
                except BlockingIOError:
                    pass
                if time.monotonic() >= deadline:
                    raise MaintenanceBlocked('Readers did not drain within deadline')
                time.sleep(0.01)
            self.assert_safe()
            durable_marker(self.directory, {'token': self.token, 'state': 'maintenance'})
            return self
        except Exception:
            self.close()
            raise

    def assert_safe(self):
        if self.exclusive is None or self.control is None:
            raise MaintenanceBlocked('Maintenance ownership missing')
        validate_owned(self.directory.lstat(), directory=True)
        if not validate_file(self.directory / 'funding-dart.json'):
            raise MaintenanceBlocked('Maintenance marker missing')
        current = json.loads((self.directory / 'funding-dart.json').read_text())
        if current.get('token') != self.token or not self.enrollment_ok() or self.legacy_readers():
            raise MaintenanceBlocked('Maintenance proof changed')

    def verified_finish(self, verify):
        self.assert_safe()
        if not verify():
            raise MaintenanceBlocked('Install/rollback verification failed; marker retained')
        (self.directory / 'funding-dart.json').unlink()
        sync_directory(self.directory)
        self.close()

    def close(self):
        for name in ['exclusive', 'control']:
            handle = getattr(self, name)
            if handle is not None:
                handle.close()
                setattr(self, name, None)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()  # Fail closed: exiting does not clear the persistent marker.
