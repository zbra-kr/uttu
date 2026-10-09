"""Real local child/process/file boundary regressions; isolated temp lock only."""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch

ROOT = Path(__file__).parents[2]


def load(name, file):
    s = importlib.util.spec_from_file_location(name, ROOT / "scripts" / file)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


life = load("boundary_life", "review_lifecycle.py")
monitor = load("boundary_monitor", "collection_monitor.py")
D, C = "a" * 32, "b" * 32
ID = {"state": "present", "start": "Fri Oct  9 02:00:00 2026", "executable": "/usr/bin/python3"}
START = dict(
    event="launcher_started", daily_id=D, collector_id=C, launcher_pid=123, launcher_identity=ID
)
TEXT = life.PREFIX + json.dumps(START) + "\n"


class ContinuityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.p = Path(self.tmp.name) / "reviews.log"
        self.p.write_text(TEXT)
        self.obs = life.ReviewObservation(D, probe=lambda _: {"state": "missing"})
        self.assertIsNone(self.obs.observe(self.p, 0)[0])

    def recovered(self):
        self.assertEqual(self.obs.observe(self.p, 120), (None, "awaiting_exit_log"))
        self.assertIsNone(self.obs.observe(self.p, 179)[0])
        self.assertEqual(self.obs.observe(self.p, 180)[0], "unknown")

    def test_probe_exception_resets(self):
        self.obs.probe = lambda _: (_ for _ in ()).throw(PermissionError())
        self.assertIsNone(self.obs.observe(self.p, 60)[0])
        self.obs.probe = lambda _: {"state": "missing"}
        self.recovered()

    def test_actual_chmod_denial_resets(self):
        self.p.chmod(0)
        try:
            self.assertEqual(self.obs.observe(self.p, 60), (None, "log_access_unconfirmed"))
        finally:
            self.p.chmod(0o600)
        self.recovered()

    def test_log_missing_resets(self):
        self.p.unlink()
        self.assertEqual(self.obs.observe(self.p, 60)[1], "log_not_yet_available")
        self.p.write_text(TEXT)
        self.recovered()

    def test_atomic_log_replacement_same_content_resets(self):
        other = self.p.with_suffix(".replacement")
        other.write_text(TEXT)
        os.replace(other, self.p)
        self.recovered()

    def test_inplace_truncation_and_delayed_start_resets(self):
        self.p.write_text("partial")
        self.assertEqual(self.obs.observe(self.p, 60)[1], "current_launch_unconfirmed")
        self.p.write_text(TEXT)
        self.recovered()

    def test_same_inode_rewrite_detected(self):
        self.p.write_text("\n" + TEXT)
        self.recovered()

    def test_same_inode_identical_rewrite_resets(self):
        before = self.p.stat().st_mtime_ns
        self.p.write_text(TEXT)
        os.utime(self.p, ns=(before + 1000000000, before + 1000000000))
        self.recovered()

    def test_replacement_during_read_is_uncertain(self):
        original = Path.stat
        seen = [False]

        def stat(path, *a, **kw):
            if path == self.p and not seen[0]:
                seen[0] = True
                other = self.p.with_suffix(".replacement")
                other.write_text(TEXT)
                os.replace(other, self.p)
            return original(path, *a, **kw)

        with patch.object(Path, "stat", stat):
            self.assertEqual(self.obs.observe(self.p, 60)[1], "log_changed_during_read")
        self.recovered()

    def test_delayed_terminal_after_log_replacement(self):
        other = self.p.with_suffix(".replacement")
        other.write_text(
            TEXT
            + life.PREFIX
            + json.dumps(dict(event="process_exited", daily_id=D, collector_id=C, exit_code=1))
            + "\n"
        )
        os.replace(other, self.p)
        self.assertEqual(self.obs.observe(self.p, 120), ("failed", "owned_launcher_exit"))

    def test_sample_monotonic_after_slow_probe_and_clock_regression(self):
        now = [0]

        def probe(_):
            now[0] += 120
            return {"state": "missing"}

        obs = life.ReviewObservation(D, probe=probe, clock=lambda: now[0])
        self.assertIsNone(obs.observe(self.p)[0])
        obs.probe = lambda _: {"state": "missing"}
        now[0] = 150
        self.assertIsNone(obs.observe(self.p)[0])
        now[0] = 180
        self.assertEqual(obs.observe(self.p)[0], "unknown")
        obs = life.ReviewObservation(D, probe=lambda _: {"state": "missing"}, clock=lambda: now[0])
        now[0] = 100
        obs.observe(self.p)
        now[0] = 20
        self.assertIsNone(obs.observe(self.p)[0])
        now[0] = 79
        self.assertIsNone(obs.observe(self.p)[0])
        now[0] = 80
        self.assertEqual(obs.observe(self.p)[0], "unknown")

    def test_slow_detection_does_not_consume_review_grace(self):
        now = [0]
        calls = []
        sleeps = []
        events = []
        observer = life.ReviewObservation(
            D, probe=lambda _: {"state": "missing"}, clock=lambda: now[0]
        )
        logs = Path(self.tmp.name) / "logs"
        logs.mkdir()
        self.p = logs / "reviews_20261009.log"
        self.p.write_text(TEXT)

        def runner(cmd, **kw):
            calls.append(cmd[-1])
            if cmd[-1] == "worker.detectors.runner":
                now[0] += 120
            return NS(returncode=0, stdout="", stderr="")

        def sleep(delay):
            sleeps.append(delay)
            now[0] += delay

        result = monitor.run_monitor(
            self.tmp.name,
            "20261009",
            lambda *_: None,
            clock=lambda: now[0],
            sleeper=sleep,
            runner=runner,
            observe=lambda name, *_: "completed" if name in monitor.SCRAPERS else None,
            event_sink=events.append,
            review_observer=observer,
        )
        self.assertEqual(result, 1)
        self.assertEqual(sleeps, [30, 30])
        self.assertEqual(now[0], 180)
        self.assertEqual(
            [e for e in events if e.get("stage") == "reviews"][0]["outcome"], "unknown"
        )

    def test_unknown_summary_does_not_claim_monitor_interruption(self):
        outcomes = {name: "completed" for name in monitor.ALL_STEPS}
        outcomes["reviews"] = "unknown"
        summary = monitor.outcome_summary(outcomes)
        self.assertIn("수집기 상태 미확인: reviews", summary)
        self.assertNotIn("모니터 중단", summary)
        self.assertIn("실패: 없음", summary)

    def test_wall_clock_jump_does_not_change_review_grace(self):
        now = [0]
        obs = life.ReviewObservation(D, probe=lambda _: {"state": "missing"}, clock=lambda: now[0])
        with patch("time.time", return_value=99999999):
            self.assertIsNone(obs.observe(self.p)[0])
        now[0] = 30
        with patch("time.time", return_value=-99999999):
            self.assertIsNone(obs.observe(self.p)[0])


class RealWrapperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "scripts").mkdir()
        for name in ["with_collection_lock.py", "review_lifecycle.py"]:
            shutil.copyfile(ROOT / "scripts" / name, self.root / "scripts" / name)

    def launch(self, code, stdout=subprocess.PIPE, child=True):
        script = (
            "import os,sys; "
            + ('os.write(1,b"child-without-newline"); ' if child else "")
            + "sys.exit("
            + str(code)
            + ")"
        )
        env = {"PATH": "/usr/bin:/bin", "LC_ALL": "C", "UTTU_DAILY_RUN_ID": D}
        return subprocess.run(
            [
                sys.executable,
                str(self.root / "scripts/with_collection_lock.py"),
                sys.executable,
                "-c",
                script,
            ],
            env=env,
            capture_output=False,
            stdout=stdout,
            stderr=subprocess.PIPE,
            timeout=10,
        )

    def test_actual_child_without_newline_success_and_failure(self):
        for code, state in [(0, "completed"), (7, "failed")]:
            r = self.launch(code)
            self.assertEqual(r.returncode, code)
            log = self.root / "reviews.log"
            log.write_bytes(r.stdout)
            self.assertIn(b"child-without-newline\n[REVIEW_LIFECYCLE] ", r.stdout)
            self.assertEqual(life.ReviewObservation(D).observe(log)[0], state)

    def test_full_stdout_preserves_actual_child_status(self):
        # Regular /dev/full equivalent: real descriptor backed by a regular file,
        # hard zero-byte RLIMIT_FSIZE and ignored SIGXFSZ; every write raises EFBIG.
        import resource
        import signal

        def full():
            signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
            resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))

        for code in [0, 7]:
            with (self.root / "full-output").open("wb") as target:
                r = subprocess.run(
                    [
                        sys.executable,
                        str(self.root / "scripts/with_collection_lock.py"),
                        sys.executable,
                        "-c",
                        "import sys;sys.exit(" + str(code) + ")",
                    ],
                    env={"PATH": "/usr/bin:/bin", "LC_ALL": "C", "UTTU_DAILY_RUN_ID": D},
                    stdout=target,
                    stderr=subprocess.PIPE,
                    preexec_fn=full,
                    timeout=10,
                )
            self.assertEqual(r.returncode, code, r.stderr.decode())
            self.assertNotIn(b"Exception ignored", r.stderr)

    def test_broken_pipe_preserves_actual_child_status(self):
        for code in [0, 7]:
            rd, wr = os.pipe()
            os.close(rd)
            try:
                r = self.launch(code, stdout=wr, child=False)
            finally:
                os.close(wr)
            self.assertEqual(r.returncode, code, r.stderr.decode())


if __name__ == "__main__":
    unittest.main()
