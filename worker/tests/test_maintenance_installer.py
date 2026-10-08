import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

REVIEW = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location('fixture_installer', REVIEW/'maintenance_installer.py')
engine = importlib.util.module_from_spec(spec); spec.loader.exec_module(engine)


class ReaderTests(unittest.TestCase):
    def run_reader(self, outputs):
        calls = []
        def run(command, **options):
            calls.append((command, options))
            output = outputs.pop(0)
            if isinstance(output, Exception):
                raise output
            return output
        result = engine.ProcessReaders(run)()
        self.assertTrue(all(options['timeout'] == 5 for _, options in calls))
        return result

    def test_safe_identity_only(self):
        result = self.run_reader([SimpleNamespace(returncode=0, stdout='123\n', stderr=''), SimpleNamespace(returncode=0, stdout='123 1 Wed Oct 7 15:00:00 2026 /python\n', stderr='')])
        self.assertEqual(result, [{'pid':123,'ppid':1,'started':'Wed Oct 7 15:00:00 2026'}])

    def test_known_reader_exits_naturally_between_queries(self):
        self.assertEqual(self.run_reader([SimpleNamespace(returncode=0,stdout='123\n',stderr=''),SimpleNamespace(returncode=1,stdout='',stderr='')]), [])

    def test_invalid_failed_truncated_and_timeout_fail_closed(self):
        for output in [SimpleNamespace(returncode=2,stdout='',stderr='denied'),SimpleNamespace(returncode=0,stdout='123',stderr=''),SimpleNamespace(returncode=0,stdout='invalid\n',stderr=''),SimpleNamespace(returncode=1,stdout='123\n',stderr=''),subprocess.TimeoutExpired('fixture',5)]:
            with self.subTest(output=output), self.assertRaises((RuntimeError,subprocess.TimeoutExpired)):
                self.run_reader([output])

    def test_ps_failed_malformed_and_truncated_fail_closed(self):
        for output in [SimpleNamespace(returncode=2,stdout='',stderr=''),SimpleNamespace(returncode=0,stdout='123 1 Wed Oct 7 15:00:00 2026 /python',stderr=''),SimpleNamespace(returncode=0,stdout='123 1 incomplete\n',stderr=''),SimpleNamespace(returncode=0,stdout='',stderr='')]:
            with self.subTest(output=output), self.assertRaises(RuntimeError):
                self.run_reader([SimpleNamespace(returncode=0,stdout='123\n',stderr=''),output])


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name); self.root = self.base/'live'; self.root.mkdir()
        self.site = self.root/'site'; self.site.mkdir(); self.candidate = self.base/'candidate'; self.candidate.mkdir()
        self.guards = []
        for relative, original, guarded in [('worker/utils/maintenance_guard.py',None,b'HELPER=1\n'),('worker/main.py',b'ORIGINAL=1\n',b'GUARDED=1\n'),('worker/scrapers/dart_scraper.py',b'DART=1\n',b'DART_GUARDED=1\n')]:
            live = self.root/relative; live.parent.mkdir(parents=True,exist_ok=True)
            if original is not None:
                live.write_bytes(original)
            stage = self.candidate/('guard-'+Path(relative).name); stage.write_bytes(guarded)
            self.guards.append({'path':relative,'original_sha256':engine.digest(live),'guard_source':str(stage),'guard_sha256':engine.digest(stage)})
        self.sources = []
        for relative, original, final in [('worker/funding/outcomes.py',None,b'OUTCOME=1\n'),('worker/funding/source.py',b'SOURCE=1\n',b'SOURCE=2\n'),('worker/main.py',b'ORIGINAL=1\n',b'GUARDED=1\nFINAL=1\n')]:
            live = self.root/relative; live.parent.mkdir(parents=True,exist_ok=True)
            if original is not None:
                live.write_bytes(original)
            stage = self.candidate/('final-'+Path(relative).name); stage.write_bytes(final)
            rollback = next((g['guard_sha256'] for g in self.guards if g['path']==relative), engine.digest(live))
            self.sources.append({'path':relative,'original_sha256':engine.digest(live),'rollback_sha256':rollback,'final_source':str(stage),'final_sha256':engine.digest(stage),'mode':0o644})
        initializers = {}
        for relative in ['worker/__init__.py','worker/utils/__init__.py','worker/scrapers/__init__.py']:
            path = self.root/relative; path.write_bytes(b''); initializers[relative] = engine.digest(path)
        (self.root/'preserve.py').write_bytes(b'LOCAL=1\n')
        old_sdk = {}; new_sdk = {}
        for name, content in [('dart_fss',b'OLD=1\n'),('dart_fss-0.4.15.dist-info',b'Version: 0.4.15\n')]:
            path = self.site/name; path.mkdir(); (path/'data').write_bytes(content); old_sdk[name] = engine.inventory(path)
        for name, content in [('dart_fss',b'NEW=1\n'),('dart_fss-0.4.17.dist-info',b'Version: 0.4.17\n')]:
            path = self.candidate/name; path.mkdir(); (path/'data').write_bytes(content); new_sdk[name] = {'source':str(path),'manifest':engine.inventory(path)}
        self.config = {'root':str(self.root),'site':str(self.site),'work':str(self.base/'private-backup'),'guards':self.guards,'sources':self.sources,'initializers':initializers,'protected':{'preserve.py':engine.digest(self.root/'preserve.py')},'old_sdk':old_sdk,'new_sdk':new_sdk}
        self.readers = []
        self.installer = engine.Installer(self.config, lambda:self.readers)
        self.addCleanup(lambda:self.installer.close())

    def prepared(self):
        self.installer.prepare(); self.installer.enroll()

    def marker(self): return self.root/'.maintenance/funding-dart.json'

    def recover(self):
        self.installer.close()
        self.installer = engine.Installer(self.config,lambda:self.readers)
        self.installer.start(recover=True,timeout=.03)

    def test_complete_install_exact_manifests_then_resume(self):
        self.prepared(); self.installer.start(); self.installer.install()
        self.assertTrue(self.installer.verify(True)); self.installer.finish()
        self.assertFalse(self.marker().exists())
        self.assertEqual(self.installer.journal['phase'],'complete')

    def test_verified_rollback_keeps_entry_guards_and_original_sdk(self):
        self.prepared(); self.installer.start(); self.installer.install(); self.installer.rollback()
        self.assertTrue(self.installer.verify(False)); self.installer.finish()
        self.assertEqual(engine.digest(self.root/'worker/main.py'),self.guards[1]['guard_sha256'])
        self.assertFalse((self.root/'worker/funding/outcomes.py').exists())

    def test_old_unguarded_reader_drain_timeout_cannot_install(self):
        self.prepared(); self.readers = [{'pid':123}]
        with self.assertRaises(engine.guard.MaintenanceBlocked):
            self.installer.start(timeout=.02)
        self.assertTrue(self.marker().exists())
        self.assertEqual(engine.inventory(self.site/'dart_fss'),self.config['old_sdk']['dart_fss'])

    def test_enumeration_failure_keeps_marker_no_sdk_moves(self):
        self.prepared()
        self.installer.readers = lambda: (_ for _ in ()).throw(RuntimeError('enumeration unavailable'))
        with self.assertRaises(RuntimeError):
            self.installer.start(timeout=.02)
        self.assertTrue(self.marker().exists()); self.assertEqual(engine.inventory(self.site/'dart_fss'),self.config['old_sdk']['dart_fss'])

    def test_partial_guard_rollout_can_be_resumed_but_cannot_start_early(self):
        self.installer.prepare(); original = self.installer.move; count = 0
        def move(a,b):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError('rollout fixture failure')
            original(a,b)
        self.installer.move = move
        with self.assertRaises(OSError):
            self.installer.enroll()
        with self.assertRaises(RuntimeError):
            self.installer.start()
        self.installer.move = original; self.installer.enroll(); self.installer.start(); self.installer.rollback(); self.installer.finish()

    def test_guard_initializer_or_protected_drift_blocks(self):
        self.prepared(); (self.root/'worker/__init__.py').write_bytes(b'UNREVIEWED=1\n')
        with self.assertRaises(engine.guard.MaintenanceBlocked):
            self.installer.start()
        self.assertFalse(self.marker().exists())

    def test_candidate_source_drift_rolls_back_without_resuming_mixed_source(self):
        self.prepared(); self.installer.start()
        stage = Path(self.config['work'])/'final/worker/funding/source.py'; stage.write_bytes(b'UNREVIEWED=1\n')
        with self.assertRaises(RuntimeError):
            self.installer.install()
        self.assertTrue(self.marker().exists()); self.installer.rollback(); self.installer.finish()

    def test_sdk_stage_drift_keeps_marker_until_rollback(self):
        self.prepared(); self.installer.start()
        (Path(self.config['work'])/'sdk-final/dart_fss/data').write_bytes(b'CORRUPT\n')
        with self.assertRaises(RuntimeError):
            self.installer.install()
        self.installer.rollback(); self.installer.finish()

    def test_unknown_source_or_sdk_refuses_rollback_and_keeps_marker(self):
        self.prepared(); self.installer.start(); self.installer.install()
        (self.root/'worker/funding/source.py').write_bytes(b'LOCAL_EDIT=1\n')
        with self.assertRaises(RuntimeError):
            self.installer.rollback()
        self.installer.close(); self.assertTrue(self.marker().exists())

    def test_changed_backup_refuses_rollback(self):
        self.prepared(); self.installer.start(); self.installer.install()
        (Path(self.config['work'])/'sdk-backup/dart_fss/data').write_bytes(b'CORRUPT\n')
        with self.assertRaises(RuntimeError):
            self.installer.rollback()
        self.assertTrue(self.marker().exists())

    def test_invalid_config_or_wrong_recovery_token_refuses(self):
        self.prepared(); self.installer.start(); self.installer.close()
        journal_path = Path(self.config['work'])/'journal.json'; journal = json.loads(journal_path.read_text()); journal['token']='wrong'; journal_path.write_text(json.dumps(journal))
        with self.assertRaises(engine.guard.MaintenanceBlocked):
            self.installer.start(recover=True)
        self.assertTrue(self.marker().exists())

    def test_source_rename_crash_before_receipt_is_recoverable(self):
        self.prepared()
        pid = os.fork()
        if pid == 0:
            self.installer.start()
            def crash(a,b):os.replace(a,b); os._exit(0)
            self.installer.move=crash; self.installer.install(); os._exit(2)
        _,status=os.waitpid(pid,0); self.assertEqual(status,0)
        self.recover(); self.installer.rollback(); self.installer.finish()
        self.assertFalse(self.marker().exists())

    def test_sdk_directory_rename_crash_is_recoverable(self):
        self.prepared()
        pid = os.fork()
        if pid == 0:
            self.installer.start()
            def crash(a,b):
                os.replace(a,b)
                if Path(a)==self.site/'dart_fss':
                    os._exit(0)
            self.installer.move=crash; self.installer.install(); os._exit(2)
        _,status=os.waitpid(pid,0); self.assertEqual(status,0)
        self.recover(); self.installer.rollback(); self.installer.finish()

    def test_unguarded_initialization_and_unsafe_state_refused(self):
        path=self.root/'.maintenance'; path.mkdir(mode=0o777); path.chmod(0o777)
        with self.assertRaises(engine.guard.MaintenanceBlocked):
            self.installer.prepare()
        self.assertEqual(path.stat().st_mode&0o777,0o777)

    def test_marker_fsync_failure_prevents_source_or_sdk_moves(self):
        self.prepared()
        with patch.object(engine.guard,'sync_directory',side_effect=OSError('fsync fixture failure')):
            with self.assertRaises(OSError):
                self.installer.start()
        self.assertEqual(engine.inventory(self.site/'dart_fss'),self.config['old_sdk']['dart_fss'])

    def test_install_failure_automatically_rolls_back_then_resumes(self):
        self.prepared();original=self.installer.move;failed=False
        def move(a,b):
            nonlocal failed
            if not failed and Path(b)==self.root/'worker/funding/source.py':
                failed=True;raise OSError('one fixture installation failure')
            original(a,b)
        self.installer.move=move
        with self.assertRaises(OSError):
            self.installer.apply_prepared()
        self.assertFalse(self.marker().exists());self.assertEqual(self.installer.journal['phase'],'restored_guarded_original')

    def test_failed_auto_rollback_retains_marker_and_releases_owned_locks(self):
        self.prepared();original=self.installer.move;failed=False
        def move(a,b):
            nonlocal failed
            if Path(b)==self.root/'worker/funding/source.py' or (failed and Path(b).parent.name=='retired-new'):
                failed=True;raise OSError('fixture install/rollback failure')
            original(a,b)
        self.installer.move=move
        with self.assertRaises(OSError):
            self.installer.apply_prepared()
        self.assertTrue(self.marker().exists());self.assertIsNone(self.installer.owner)
        self.installer.move=original;self.installer.recover_rollback();self.assertFalse(self.marker().exists())

    def test_final_entrypoint_rename_crash_recovery(self):
        self.prepared();pid=os.fork()
        if pid==0:
            self.installer.start()
            def crash(a,b):
                os.replace(a,b)
                if Path(b)==self.root/'worker/main.py':
                    os._exit(0)
            self.installer.move=crash;self.installer.install();os._exit(2)
        _,status=os.waitpid(pid,0);self.assertEqual(status,0)
        self.installer.recover_rollback();self.assertFalse(self.marker().exists())

    def test_finish_crash_after_marker_removal_reacquires_and_reverifies(self):
        self.prepared();self.installer.start();self.installer.install()
        self.installer.owner.verified_finish(lambda:self.installer.verify(True));self.installer.owner=None
        self.installer.start(recover=True);self.installer.finish();self.assertEqual(self.installer.journal['phase'],'complete')

    def test_process_timeout_after_marker_write_cannot_install(self):
        self.prepared();self.installer.readers=lambda:(_ for _ in ()).throw(subprocess.TimeoutExpired('fixture',5))
        with self.assertRaises(subprocess.TimeoutExpired):
            self.installer.start()
        self.assertTrue(self.marker().exists());self.assertEqual(engine.inventory(self.site/'dart_fss'),self.config['old_sdk']['dart_fss'])

    def test_unrelated_dependency_metadata_drift_blocks(self):
        self.config['dependency_metadata']={};self.prepared()
        extra=self.site/'other.dist-info';extra.mkdir();(extra/'METADATA').write_text('Version: changed\n')
        with self.assertRaises(RuntimeError):
            self.installer.start()
        self.assertFalse(self.marker().exists())

    def test_source_modes_are_part_of_exact_verification(self):
        self.prepared();self.installer.start();self.installer.install()
        (self.root/'worker/funding/source.py').chmod(0o600)
        self.assertFalse(self.installer.verify(True));self.assertTrue(self.marker().exists())
        self.installer.rollback();self.installer.finish()

    def test_two_prepared_installers_cannot_delay_guard_rename_past_cutover(self):
        second_config=dict(self.config);second_config['work']=str(self.base/'second-backup')
        second=engine.Installer(second_config,lambda:[])
        self.addCleanup(second.close)
        self.installer.prepare();second.prepare()
        self.installer.enroll()
        first_inode=os.fstat(self.installer.enrollment_control.fileno()).st_ino
        with self.assertRaises(BlockingIOError):
            second.enroll()
        self.installer.start()
        self.assertEqual(first_inode,os.fstat(self.installer.owner.control.fileno()).st_ino)
        with self.assertRaises(BlockingIOError):
            second.enroll()
        self.installer.install()
        final_hash=engine.digest(self.root/'worker/main.py')
        with self.assertRaises(BlockingIOError):
            second.enroll()
        self.installer.finish()
        with self.assertRaisesRegex(RuntimeError,'Stale enrollment'):
            second.enroll()
        self.assertEqual(engine.digest(self.root/'worker/main.py'),final_hash)
        self.assertFalse(self.marker().exists())

    def test_enrollment_control_transfer_is_released_after_verified_rollback(self):
        self.prepared();self.installer.start();self.installer.install();self.installer.rollback();self.installer.finish()
        lock=engine.guard.lock_file(self.root/'.maintenance','installer.lock')
        try:
            engine.guard.fcntl.flock(lock,engine.guard.fcntl.LOCK_EX|engine.guard.fcntl.LOCK_NB)
        finally:
            lock.close()

    def test_paused_guard_only_rename_holds_control_against_other_cutover(self):
        import threading
        second_config=dict(self.config);second_config['work']=str(self.base/'delayed-backup')
        delayed=engine.Installer(second_config,lambda:[]);self.addCleanup(delayed.close)
        self.installer.prepare();delayed.prepare()
        ready=threading.Event();release=threading.Event();errors=[]
        def move(a,b):
            if Path(b)==self.root/'worker/main.py':
                ready.set()
                if not release.wait(2):
                    raise RuntimeError('fixture interleaving deadline')
            os.replace(a,b)
        delayed.move=move
        def enroll():
            try:
                delayed.enroll()
            except Exception as error:
                errors.append(error)
        thread=threading.Thread(target=enroll);thread.start()
        try:
            self.assertTrue(ready.wait(1))
            with self.assertRaises(BlockingIOError):
                self.installer.enroll()
            self.assertEqual(engine.inventory(self.site/'dart_fss'),self.config['old_sdk']['dart_fss'])
        finally:
            release.set();thread.join(2)
        self.assertFalse(thread.is_alive());self.assertEqual(errors,[])
        delayed.apply_prepared();final_hash=engine.digest(self.root/'worker/main.py')
        with self.assertRaisesRegex(RuntimeError,'Stale enrollment'):
            self.installer.enroll()
        self.assertEqual(engine.digest(self.root/'worker/main.py'),final_hash)
        self.assertFalse(self.marker().exists())

    def test_finish_requires_complete_verified_manifest(self):
        self.prepared(); self.installer.start()
        with self.assertRaises(RuntimeError):
            self.installer.finish()
        self.assertTrue(self.marker().exists())



    def test_missing_backend_prevents_prepare_state_backup_or_source_changes(self):
        before = {
            row["path"]: engine.digest(self.root / row["path"])
            for row in self.guards + self.sources
        }
        with patch.object(engine.guard, "fcntl", None):
            with self.assertRaises(engine.guard.UnsupportedLockingError):
                self.installer.prepare()
        self.assertFalse((self.root / ".maintenance").exists())
        self.assertFalse(Path(self.config["work"]).exists())
        self.assertEqual(
            before, {relative: engine.digest(self.root / relative) for relative in before}
        )


if __name__=='__main__':
    unittest.main(verbosity=2)
