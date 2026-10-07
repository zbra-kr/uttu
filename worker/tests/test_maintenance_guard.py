import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).parents[2] / 'worker/utils/maintenance_guard.py'
spec = importlib.util.spec_from_file_location('fixture_guard', SOURCE)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.enrolled = True
        self.legacy = []

    def installer(self, token=None):
        return guard.Maintenance(self.root, lambda: self.enrolled, lambda: self.legacy, token)

    def marker(self):
        return self.root / '.maintenance/funding-dart.json'

    def test_normal_shared_readers_preserve_concurrent_poll_behavior(self):
        first, second = guard.acquire_reader(self.root), guard.acquire_reader(self.root)
        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        first.close(); second.close()

    def test_installer_drains_enrolled_reader_naturally(self):
        lease = guard.acquire_reader(self.root)
        thread = threading.Thread(target=lambda: (time.sleep(.04), lease.close()))
        thread.start()
        maintenance = self.installer().begin(timeout=.5)
        thread.join()
        self.assertIsNone(guard.acquire_reader(self.root))
        maintenance.verified_finish(lambda: True)
        lease = guard.acquire_reader(self.root)
        self.assertIsNotNone(lease); lease.close()

    def test_rollout_old_unguarded_reader_drains_before_install(self):
        self.legacy = [123]
        thread = threading.Thread(target=lambda: (time.sleep(.04), self.legacy.clear()))
        thread.start()
        maintenance = self.installer().begin(timeout=.5)
        thread.join()
        maintenance.verified_finish(lambda: True)

    def test_rollout_old_reader_timeout_prevents_source_changes(self):
        self.legacy = [123]
        with self.assertRaisesRegex(guard.MaintenanceBlocked, 'drain'):
            self.installer().begin(timeout=.02)
        self.assertTrue(self.marker().exists())
        self.assertIsNone(guard.acquire_reader(self.root))

    def test_incomplete_guard_rollout_fails_before_marker_or_install(self):
        self.enrolled = False
        with self.assertRaisesRegex(guard.MaintenanceBlocked, 'enrollment'):
            self.installer().begin()
        self.assertFalse(self.marker().exists())

    def test_guard_rollout_drift_during_drain_fails_closed(self):
        self.legacy = [123]
        thread = threading.Thread(target=lambda: (time.sleep(.02), setattr(self, 'enrolled', False)))
        thread.start()
        with self.assertRaisesRegex(guard.MaintenanceBlocked, 'changed'):
            self.installer().begin(timeout=.2)
        thread.join()
        self.assertTrue(self.marker().exists())

    def test_reader_check_to_lock_race_cannot_enter_maintenance(self):
        original = guard.lock_file
        def race(directory, name):
            handle = original(directory, name)
            if name == 'funding-dart.lock':
                guard.durable_marker(directory, {'token': 'fixture', 'state': 'maintenance'})
            return handle
        with patch.object(guard, 'lock_file', race):
            self.assertIsNone(guard.acquire_reader(self.root))

    def test_new_reader_cannot_enter_exclusive_window_without_marker(self):
        directory = guard.state_dir(self.root)
        lock = guard.lock_file(directory, 'funding-dart.lock')
        guard.fcntl.flock(lock, guard.fcntl.LOCK_EX)
        self.assertIsNone(guard.acquire_reader(self.root)); lock.close()

    def test_installer_contention_is_excluded(self):
        first = self.installer().begin()
        try:
            with self.assertRaises(BlockingIOError):
                self.installer().begin()
        finally:
            first.verified_finish(lambda: True)

    def test_failed_install_keeps_marker_after_owner_releases(self):
        maintenance = self.installer().begin()
        maintenance.close()
        self.assertTrue(self.marker().exists())
        self.assertIsNone(guard.acquire_reader(self.root))

    def test_failed_rollback_verification_cannot_resume(self):
        maintenance = self.installer().begin()
        with self.assertRaisesRegex(guard.MaintenanceBlocked, 'verification'):
            maintenance.verified_finish(lambda: False)
        maintenance.close()
        self.assertTrue(self.marker().exists())

    def test_exception_in_verifier_fails_closed(self):
        maintenance = self.installer().begin()
        with self.assertRaises(ValueError):
            maintenance.verified_finish(lambda: (_ for _ in ()).throw(ValueError('fixture')))
        maintenance.close()
        self.assertTrue(self.marker().exists())

    def test_marker_requires_matching_recovery_token(self):
        maintenance = self.installer().begin(); token = maintenance.token; maintenance.close()
        with self.assertRaises(guard.MaintenanceBlocked):
            self.installer().begin()
        with self.assertRaises(guard.MaintenanceBlocked):
            self.installer('wrong').begin(recover=True)
        recovered = self.installer(token).begin(recover=True)
        recovered.verified_finish(lambda: True)
        self.assertFalse(self.marker().exists())

    def test_changed_guard_before_move_refuses_install(self):
        maintenance = self.installer().begin(); self.enrolled = False
        with self.assertRaises(guard.MaintenanceBlocked):
            maintenance.assert_safe()
        maintenance.close()
        self.assertTrue(self.marker().exists())

    def test_old_reader_appears_before_move_refuses_install(self):
        maintenance = self.installer().begin(); self.legacy = [999]
        with self.assertRaises(guard.MaintenanceBlocked):
            maintenance.assert_safe()
        maintenance.close()

    def test_installer_process_crash_retains_marker_and_releases_locks(self):
        pid = os.fork()
        if pid == 0:
            self.installer('crashed').begin()
            os._exit(0)
        _, status = os.waitpid(pid, 0)
        self.assertEqual(status, 0)
        self.assertIsNone(guard.acquire_reader(self.root))
        recovered = self.installer('crashed').begin(recover=True)
        recovered.verified_finish(lambda: True)

    def test_lock_inode_is_preserved_through_recovery(self):
        lease = guard.acquire_reader(self.root); lease.close()
        path = self.root / '.maintenance/funding-dart.lock'; inode = path.stat().st_ino
        maintenance = self.installer().begin(); maintenance.verified_finish(lambda: True)
        self.assertEqual(path.stat().st_ino, inode)

    def test_cli_contention_defers_without_claiming_a_job(self):
        maintenance = self.installer().begin()
        with patch('builtins.print') as output:
            self.assertFalse(guard.enter_cli(self.root, 'Funding worker'))
            self.assertIn('no jobs claimed', output.call_args.args[0])
        maintenance.verified_finish(lambda: True)

    def test_partial_install_then_hash_verified_rollback_resumes_original(self):
        import hashlib
        source=self.root/'source.py'; source.write_bytes(b'ORIGINAL=1\n')
        original=source.read_bytes(); expected=hashlib.sha256(original).hexdigest()
        maintenance=self.installer().begin()
        source.write_bytes(b'PARTIAL=1\n')
        with self.assertRaises(guard.MaintenanceBlocked):
            maintenance.verified_finish(lambda:hashlib.sha256(source.read_bytes()).hexdigest()==expected)
        self.assertIsNone(guard.acquire_reader(self.root))
        source.write_bytes(original)
        maintenance.verified_finish(lambda:hashlib.sha256(source.read_bytes()).hexdigest()==expected)
        reader=guard.acquire_reader(self.root); self.assertIsNotNone(reader); reader.close()

    def test_existing_world_writable_state_is_refused_without_chmod(self):
        directory=self.root/'.maintenance';directory.mkdir();directory.chmod(0o777)
        with self.assertRaises(guard.MaintenanceBlocked):guard.acquire_reader(self.root)
        self.assertEqual(directory.stat().st_mode&0o777,0o777)

    def test_existing_nonprivate_lock_is_refused_without_replacing_inode(self):
        directory=guard.state_dir(self.root);path=directory/'funding-dart.lock';path.write_text('');path.chmod(0o644);inode=path.stat().st_ino
        with self.assertRaises(guard.MaintenanceBlocked):guard.acquire_reader(self.root)
        self.assertEqual(path.stat().st_ino,inode);self.assertEqual(path.stat().st_mode&0o777,0o644)

    def test_wrong_owner_is_refused(self):
        directory=guard.state_dir(self.root)
        with patch.object(guard.os,'getuid',return_value=directory.stat().st_uid+1):
            with self.assertRaises(guard.MaintenanceBlocked):guard.acquire_reader(self.root)

    def test_nonprivate_marker_is_refused_without_modification(self):
        directory=guard.state_dir(self.root);path=directory/'funding-dart.json';path.write_text('{}');path.chmod(0o644)
        with self.assertRaises(guard.MaintenanceBlocked):guard.acquire_reader(self.root)
        self.assertEqual(path.read_text(),'{}')

    def test_multiple_hardlinked_lock_is_refused(self):
        directory=guard.state_dir(self.root);path=directory/'funding-dart.lock';path.touch(mode=0o600);os.link(path,directory/'alias')
        with self.assertRaises(guard.MaintenanceBlocked):guard.acquire_reader(self.root)

    def test_marker_symlink_fails_closed(self):
        directory = guard.state_dir(self.root)
        outside = self.root/'outside'; outside.write_text('fixture')
        (directory/'funding-dart.json').symlink_to(outside)
        with self.assertRaises(guard.MaintenanceBlocked):
            guard.acquire_reader(self.root)
        with self.assertRaises(guard.MaintenanceBlocked):
            self.installer().begin()


if __name__ == '__main__':
    unittest.main(verbosity=2)
