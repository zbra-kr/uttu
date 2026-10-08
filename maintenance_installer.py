"""Inactive installer engine. No CLI, cron operations or application imports.

The caller supplies reviewed source/SDK manifests. Tests use only private roots.
Process-crash containment is tested; this does not promise power-loss atomicity.
"""
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location('installer_guard', Path(__file__).parent/'worker/utils/maintenance_guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def digest(path):
    path = Path(path)
    if not path.exists():
        if path.is_symlink():
            raise RuntimeError('Unexpected symlink')
        return None
    if path.is_symlink() or not path.is_file():
        raise RuntimeError('Expected regular source')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory(path):
    path = Path(path)
    if not path.exists():
        if path.is_symlink():
            raise RuntimeError('Unexpected SDK symlink')
        return None
    if path.is_symlink() or not path.is_dir():
        raise RuntimeError('Expected SDK directory')
    result = {'.': {'kind': 'directory', 'mode': path.stat().st_mode & 0o777}}
    for item in sorted(path.rglob('*')):
        if item.is_symlink():
            raise RuntimeError('SDK symlink refused')
        if '__pycache__' in item.parts or item.suffix == '.pyc':
            continue
        if item.is_file():
            result[str(item.relative_to(path))] = {'sha256': digest(item), 'mode': item.stat().st_mode & 0o777}
        elif item.is_dir():
            result[str(item.relative_to(path))] = {'kind': 'directory', 'mode': item.stat().st_mode & 0o777}
        else:
            raise RuntimeError('SDK special file refused')
    return result


def flush_tree(path):
    path = Path(path)
    files = [path] if path.is_file() else [p for p in path.rglob('*') if p.is_file()]
    for item in files:
        with item.open('rb') as stream:
            os.fsync(stream.fileno())
    if path.is_dir():
        for directory in sorted([p for p in path.rglob('*') if p.is_dir()], reverse=True):
            guard.sync_directory(directory)
        guard.sync_directory(path)
    guard.sync_directory(path.parent)


class ProcessReaders:
    """Known launches only. Bounded commands, safe identities, no raw argv output."""
    pattern = r'run_funding_poll\.sh|worker\.main.*funding|worker\.funding\.orchestrator|worker\.scrapers\.dart_scraper|run_dart\.sh|worker\.dart\.fss_client|worker\.funding\.audit_source'

    def __init__(self, run=subprocess.run):
        self.run = run

    def __call__(self):
        query = self.run(['/usr/bin/pgrep', '-f', self.pattern], capture_output=True, text=True, timeout=5)
        if query.returncode not in (0, 1) or query.stderr:
            raise RuntimeError('Reader enumeration failed; no changes permitted')
        output = query.stdout
        if len(output) > 65536 or (output and not output.endswith('\n')):
            raise RuntimeError('Reader enumeration is incomplete')
        if query.returncode == 1:
            if output:
                raise RuntimeError('Inconsistent empty-reader result')
            return []
        tokens = output.splitlines()
        if not tokens or any(not re.fullmatch(r'[1-9][0-9]*', token) for token in tokens):
            raise RuntimeError('Invalid reader identity output')
        pids = sorted(set(tokens) - {str(os.getpid())})
        if not pids:
            return []
        status = self.run(['/bin/ps', '-p', ','.join(pids), '-o', 'pid=,ppid=,lstart=,comm='], capture_output=True, text=True, timeout=5)
        if status.returncode not in (0, 1) or status.stderr:
            raise RuntimeError('Reader status unavailable')
        if len(status.stdout) > 65536 or (status.stdout and not status.stdout.endswith('\n')):
            raise RuntimeError('Reader status incomplete')
        if not status.stdout:
            if status.returncode != 1:
                raise RuntimeError('Reader status unexpectedly empty')
            return []  # All matched processes exited naturally before ps.
        if status.returncode != 0:
            raise RuntimeError('Inconsistent reader status')
        readers = []
        for line in status.stdout.splitlines():
            fields = line.split(None, 7)
            if len(fields) != 8 or fields[0] not in pids or not fields[1].isdigit():
                raise RuntimeError('Malformed reader status')
            if not re.fullmatch(r'[A-Z][a-z]{2} [A-Z][a-z]{2} [0-9]{1,2} [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}', ' '.join(fields[2:7])):
                raise RuntimeError('Malformed reader start identity')
            readers.append({'pid': int(fields[0]), 'ppid': int(fields[1]), 'started': ' '.join(fields[2:7])})
        return readers


class Installer:
    def __init__(self, config, readers=None, move=os.replace):
        self.c = config
        self.root, self.site, self.work = map(Path, [config['root'], config['site'], config['work']])
        self.readers = readers if readers is not None else ProcessReaders()
        self.move = move
        self.owner = None
        self.enrollment_control = None

    def save(self):
        temporary = self.work/'journal.tmp'
        with temporary.open('w') as stream:
            temporary.chmod(0o600)
            json.dump(self.journal, stream, indent=2)
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, self.work/'journal.json')
        guard.sync_directory(self.work)

    def load(self):
        guard.validate_owned(self.work.lstat(), directory=True)
        guard.validate_file(self.work/'journal.json')
        self.journal = json.loads((self.work/'journal.json').read_text())
        if self.journal['config'] != self.c:
            raise RuntimeError('Recovery config differs from backup manifest')

    def protected(self):
        if 'dependency_metadata' in self.c:
            ignored = set(self.c['old_sdk']) | set(self.c['new_sdk'])
            actual = {str(path.relative_to(self.site)):digest(path) for path in self.site.glob('*.dist-info/METADATA') if path.parent.name not in ignored}
            if actual != self.c['dependency_metadata']:
                raise RuntimeError('Unrelated dependency metadata changed')
        for relative, expected in self.c['protected'].items():
            if digest(self.root/relative) != expected:
                raise RuntimeError('Protected source changed')

    def enrollment_ok(self):
        for row in self.c['guards']:
            accepted = [row['guard_sha256']]
            if row['path'] == 'worker/main.py':
                accepted.append(next(r['final_sha256'] for r in self.c['sources'] if r['path'] == row['path']))
            if digest(self.root/row['path']) not in accepted:
                return False
        for relative, expected in self.c['initializers'].items():
            if digest(self.root/relative) != expected:
                return False
        return True

    def prepare(self):
        if self.work.exists():
            raise RuntimeError('Backup path exists')
        self.protected()
        for row in self.c['guards']:
            if digest(self.root/row['path']) != row['original_sha256'] or digest(row['guard_source']) != row['guard_sha256']:
                raise RuntimeError('Guard rollout baseline/candidate drift')
        for row in self.c['sources']:
            if digest(self.root/row['path']) != row['original_sha256'] or digest(row['final_source']) != row['final_sha256']:
                raise RuntimeError('Funding baseline/candidate drift')
        for relative, expected in self.c['initializers'].items():
            if digest(self.root/relative) != expected:
                raise RuntimeError('Package initializer changed')
        if self.root.stat().st_dev != self.work.parent.stat().st_dev or self.site.stat().st_dev != self.work.parent.stat().st_dev:
            raise RuntimeError('Atomic moves require the same filesystem')
        guard.state_dir(self.root)  # Validates existing state; never chmods it.
        self.work.mkdir(mode=0o700)
        self.journal = {'config': self.c, 'token': uuid.uuid4().hex, 'phase': 'preparing', 'intent': None, 'moves': [], 'sdk_original': {}, 'sdk_final': {}}
        for row in self.c['guards']:
            self.stage(row['guard_source'], 'guards'/Path(row['path']), row['guard_sha256'])
            if row['original_sha256'] is not None:
                self.stage(self.root/row['path'], 'enrollment-original'/Path(row['path']), row['original_sha256'])
        for row in self.c['sources']:
            self.stage(row['final_source'], 'final'/Path(row['path']), row['final_sha256'])
            baseline = next((g['guard_source'] for g in self.c['guards'] if g['path'] == row['path']), self.root/row['path'])
            if row['rollback_sha256'] is not None:
                self.stage(baseline, 'rollback'/Path(row['path']), row['rollback_sha256'])
        for name in self.c['old_sdk']:
            expected = inventory(self.site/name)
            if expected is None or expected != self.c['old_sdk'][name]:
                raise RuntimeError('Old SDK differs from exact manifest')
            self.copy_sdk(self.site/name, self.work/'sdk-backup'/name)
            self.journal['sdk_original'][name] = expected
        for name, row in self.c['new_sdk'].items():
            if inventory(row['source']) != row['manifest']:
                raise RuntimeError('SDK candidate differs from exact manifest')
            self.copy_sdk(row['source'], self.work/'sdk-final'/name)
            self.journal['sdk_final'][name] = row['manifest']
        flush_tree(self.work)
        self.journal['phase'] = 'prepared'; self.save()

    def stage(self, source, relative, expected):
        target = self.work/relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        if digest(target) != expected:
            raise RuntimeError('Staged source hash mismatch')
        flush_tree(target)

    def copy_sdk(self, source, target):
        shutil.copytree(source, target, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        if inventory(source) != inventory(target):
            raise RuntimeError('SDK backup/stage mismatch')
        flush_tree(target)

    def enroll(self):
        if self.enrollment_control is not None or self.owner is not None:
            raise RuntimeError('This installer already owns enrollment/maintenance')
        directory = guard.state_dir(self.root)
        control = guard.lock_file(directory, 'installer.lock')
        try:
            guard.fcntl.flock(control, guard.fcntl.LOCK_EX | guard.fcntl.LOCK_NB)
        except Exception:
            control.close()
            raise
        self.enrollment_control = control
        try:
            self.load()
            if self.journal['phase'] != 'prepared':
                raise RuntimeError('Enrollment requires prepared state')
            # Revalidate under control ownership: another installer may have finished.
            for row in self.c['sources']:
                if digest(self.root/row['path']) not in {row['original_sha256'], row['rollback_sha256']}:
                    raise RuntimeError('Stale enrollment funding baseline')
            for name, expected in self.c['old_sdk'].items():
                if inventory(self.site/name) != expected:
                    raise RuntimeError('Stale enrollment SDK baseline')
            for relative, expected in self.c['initializers'].items():
                if digest(self.root/relative) != expected:
                    raise RuntimeError('Enrollment initializer changed')
            # Enrollment itself changes no funding logic/SDK. Old jobs may drain later.
            for row in self.c['guards']:
                self.protected()
                current = digest(self.root/row['path'])
                if current == row['guard_sha256']:
                    continue  # A process crash may have completed this exact rename.
                if current != row['original_sha256'] or digest(self.work/'guards'/row['path']) != row['guard_sha256']:
                    raise RuntimeError('Enrollment source drift')
                self.journal['intent'] = 'enroll:'+row['path']; self.save()
                self.move(self.work/'guards'/row['path'], self.root/row['path'])
                guard.sync_directory((self.root/row['path']).parent)
            if not self.enrollment_ok():
                raise RuntimeError('Enrollment incomplete')
            self.journal['phase'] = 'enrolled'; self.journal['intent'] = None; self.save()
        except Exception:
            self.close()
            raise
        # Keep the same control inode/handle exclusively owned until finish.

    def start(self, recover=False, timeout=30):
        self.load()
        if self.journal['phase'] not in {'enrolled', 'installing', 'installed', 'rolling_back', 'rolled_back'}:
            raise RuntimeError('Enrollment/recovery phase invalid')
        self.protected()
        self.owner = guard.Maintenance(self.root, self.enrollment_ok, self.readers, self.journal['token'])
        marker = self.root/'.maintenance/funding-dart.json'
        if recover and not marker.exists():
            if self.journal['phase'] not in {'installed', 'rolled_back'}:
                raise RuntimeError('Missing marker with unverified journal phase')
            recover = False  # Crash after verified marker removal: acquire anew and reverify.
        control, self.enrollment_control = self.enrollment_control, None
        self.owner.begin(timeout=timeout, recover=recover, control=control)

    def safe_move(self, source, target, label):
        self.owner.assert_safe(); self.protected()
        self.journal['intent'] = label; self.save()
        self.move(source, target)
        guard.sync_directory(Path(target).parent)
        guard.sync_directory(Path(source).parent)
        self.journal['moves'].append(label); self.journal['intent'] = None; self.save()

    def verify(self, final):
        self.owner.assert_safe(); self.protected()
        for row in self.c['sources']:
            expected = row['final_sha256'] if final else row['rollback_sha256']
            path = self.root/row['path']
            if digest(path) != expected:
                return False
            if expected is not None and path.stat().st_mode & 0o777 != row['mode']:
                return False
        expected_sdk = self.journal['sdk_final'] if final else self.journal['sdk_original']
        for name in set(self.journal['sdk_original']) | set(self.journal['sdk_final']):
            if inventory(self.site/name) != expected_sdk.get(name):
                return False
        return True

    def install(self):
        self.load()
        if self.journal['phase'] != 'enrolled' or not self.verify(final=False):
            raise RuntimeError('Install baseline changed')
        self.journal['phase'] = 'installing'; self.save()
        for row in self.c['sources']:
            if row['path'] == 'worker/main.py':
                continue
            if digest(self.root/row['path']) != row['rollback_sha256']:
                raise RuntimeError('Source changed immediately before replacement')
            stage = self.work/'final'/row['path']
            if digest(stage) != row['final_sha256']:
                raise RuntimeError('Final source stage changed')
            stage.chmod(row['mode'])
            self.safe_move(stage, self.root/row['path'], 'source:'+row['path'])
        for name in self.journal['sdk_original']:
            if inventory(self.site/name) != self.journal['sdk_original'][name]:
                raise RuntimeError('Old SDK changed immediately before replacement')
            target = self.work/'retired-old'/name; target.parent.mkdir(exist_ok=True)
            self.safe_move(self.site/name, target, 'old-sdk:'+name)
        for name in self.journal['sdk_final']:
            if inventory(self.site/name) is not None:
                raise RuntimeError('Unexpected active SDK target')
            if inventory(self.work/'sdk-final'/name) != self.journal['sdk_final'][name]:
                raise RuntimeError('Final SDK stage changed')
            self.safe_move(self.work/'sdk-final'/name, self.site/name, 'new-sdk:'+name)
        row = next(r for r in self.c['sources'] if r['path'] == 'worker/main.py')
        if digest(self.root/row['path']) != row['rollback_sha256']:
            raise RuntimeError('Entry source changed immediately before replacement')
        stage = self.work/'final'/row['path']
        if digest(stage) != row['final_sha256']:
            raise RuntimeError('Final entrypoint stage changed')
        stage.chmod(row['mode'])
        self.safe_move(stage, self.root/row['path'], 'source:'+row['path'])
        if not self.verify(final=True):
            raise RuntimeError('Final verification failed')
        self.journal['phase'] = 'installed'; self.save()

    def rollback(self):
        self.load(); self.owner.assert_safe(); self.protected()
        # Classify the actual files, including a rename interrupted before receipt.
        for row in self.c['sources']:
            if digest(self.root/row['path']) not in {row['rollback_sha256'], row['final_sha256']}:
                raise RuntimeError('Unknown source state; rollback refused')
            if row['rollback_sha256'] is not None and digest(self.work/'rollback'/row['path']) != row['rollback_sha256']:
                raise RuntimeError('Rollback source backup changed')
        for name in set(self.journal['sdk_original']) | set(self.journal['sdk_final']):
            actual = inventory(self.site/name)
            if actual is not None and actual not in [self.journal['sdk_original'].get(name), self.journal['sdk_final'].get(name)]:
                raise RuntimeError('Unknown SDK state; rollback refused')
        for name, manifest in self.journal['sdk_original'].items():
            if inventory(self.work/'sdk-backup'/name) != manifest:
                raise RuntimeError('Rollback SDK backup changed')
        self.journal['phase'] = 'rolling_back'; self.save()
        for row in self.c['sources']:
            current = self.root/row['path']
            if digest(current) == row['rollback_sha256']:
                continue
            if row['rollback_sha256'] is None:
                destination = self.work/'retired-new'/('source-'+uuid.uuid4().hex)
                destination.parent.mkdir(exist_ok=True)
                self.safe_move(current, destination, 'remove-new:'+row['path'])
            else:
                temporary = self.work/('restore-'+uuid.uuid4().hex)
                shutil.copy2(self.work/'rollback'/row['path'], temporary); temporary.chmod(row['mode']); flush_tree(temporary)
                self.safe_move(temporary, current, 'restore:'+row['path'])
        for name in set(self.journal['sdk_original']) | set(self.journal['sdk_final']):
            actual, expected = inventory(self.site/name), self.journal['sdk_original'].get(name)
            if actual == expected:
                continue
            if actual is not None:
                destination = self.work/'retired-new'/('sdk-'+uuid.uuid4().hex); destination.parent.mkdir(exist_ok=True)
                self.safe_move(self.site/name, destination, 'retire-sdk:'+name)
            if expected is not None:
                temporary = self.work/('restore-sdk-'+uuid.uuid4().hex)
                self.copy_sdk(self.work/'sdk-backup'/name, temporary)
                self.safe_move(temporary, self.site/name, 'restore-sdk:'+name)
        if not self.verify(final=False):
            raise RuntimeError('Rollback verification failed')
        self.journal['phase'] = 'rolled_back'; self.save()

    def finish(self):
        self.load()
        if self.journal['phase'] not in {'installed', 'rolled_back'}:
            raise RuntimeError('No verified outcome to resume')
        final = self.journal['phase'] == 'installed'
        self.owner.verified_finish(lambda: self.verify(final))
        self.owner = None
        self.journal['phase'] = 'complete' if final else 'restored_guarded_original'; self.save()

    def apply_prepared(self, timeout=30):
        self.start(timeout=timeout)
        try:
            self.install()
        except Exception:
            try:
                self.rollback()
                self.finish()
            finally:
                self.close()  # Failed rollback retains the durable marker.
            raise
        try:
            self.finish()
        finally:
            self.close()

    def recover_rollback(self, timeout=30):
        self.start(recover=True, timeout=timeout)
        try:
            self.rollback()
            self.finish()
        finally:
            self.close()

    def close(self):
        if self.owner is not None:
            self.owner.close(); self.owner = None
        if self.enrollment_control is not None:
            self.enrollment_control.close(); self.enrollment_control = None
