"""Offline real wrapper, process identity, log correlation and monitor regression."""

import importlib.util
import io
import json
import os
import runpy
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


life = load("offline_life", "review_lifecycle.py")
monitor = load("offline_monitor", "collection_monitor.py")
D, C = "a" * 32, "b" * 32
ID = {"state": "present", "start": "Fri Oct  9 02:00:00 2026", "executable": "/usr/bin/python3"}


def record(event="launcher_started", **kw):
    return dict(event=event, daily_id=D, collector_id=C, **kw)


def start():
    return record(launcher_pid=123, launcher_identity=ID)


def end(code=0, event="process_exited"):
    return record(event, exit_code=code)


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "reviews.log"

    def write(self, *rows):
        self.path.write_text("\n".join(life.PREFIX + json.dumps(r) for r in rows) + "\n")

    def observer(self, actual=ID):
        return life.ReviewObservation(D, probe=lambda _: actual)

    def test_owned_normal_abnormal_signal_exit(self):
        for code, state in [(0, "completed"), (1, "failed"), (-9, "failed"), (255, "failed")]:
            with self.subTest(code=code):
                self.write(start(), end(code))
                self.assertEqual(
                    self.observer().observe(self.path, 0), (state, "owned_launcher_exit")
                )

    def test_lock_skip_and_launch_failure(self):
        for event, code, state in [("skipped", 0, "skipped"), ("launch_failed", 1, "blocked")]:
            self.write(start(), end(code, event))
            self.assertEqual(self.observer().observe(self.path, 0)[0], state)

    def test_old_daily_and_unowned_terminal_ignored(self):
        old = end()
        old["daily_id"] = "c" * 32
        wrong = end()
        wrong["collector_id"] = "d" * 32
        self.write(old, start(), wrong)
        self.assertIsNone(self.observer().observe(self.path, 999999)[0])

    def test_latest_launcher_invalidates_previous_exit(self):
        newer = start()
        newer["collector_id"] = "c" * 32
        self.write(start(), end(), newer)
        self.assertIsNone(self.observer().observe(self.path, 0)[0])

    def test_elapsed_time_does_not_fail_live_process(self):
        self.write(start())
        obs = self.observer()
        for now in [0, 86400, 99999999]:
            self.assertEqual(obs.observe(self.path, now), (None, "current_process_present"))

    def test_missing_reused_or_executable_changed_only_unknown(self):
        for actual in [
            {"state": "missing"},
            dict(ID, start="Fri Oct  9 03:00:00 2026"),
            dict(ID, executable="/usr/bin/other"),
        ]:
            with self.subTest(actual=actual):
                self.write(start())
                obs = self.observer(actual)
                self.assertEqual(obs.observe(self.path, 100), (None, "awaiting_exit_log"))
                self.assertIsNone(obs.observe(self.path, 159)[0])
                self.assertEqual(
                    obs.observe(self.path, 160), ("unknown", "process_identity_lost_without_exit")
                )

    def test_delayed_exit_precedes_absence(self):
        self.write(start())
        obs = self.observer({"state": "missing"})
        self.assertIsNone(obs.observe(self.path, 0)[0])
        self.write(start(), end(2))
        self.assertEqual(obs.observe(self.path, 60)[0], "failed")

    def test_unverified_identity_or_permission_never_settles(self):
        for expected, actual in [
            ({"state": "unknown"}, {"state": "missing"}),
            ({"state": "present"}, {"state": "missing"}),
            (ID, {"state": "unknown"}),
        ]:
            row = start()
            row["launcher_identity"] = expected
            self.write(row)
            obs = self.observer(actual)
            for now in [0, 999999]:
                self.assertIsNone(obs.observe(self.path, now)[0])
        obs = life.ReviewObservation(D, probe=lambda _: (_ for _ in ()).throw(PermissionError()))
        self.assertEqual(obs.observe(self.path, 0)[1], "process_access_unconfirmed")

    def test_log_missing_denied_partial_invalid_exit(self):
        self.assertEqual(self.observer().observe(self.path, 0)[1], "log_not_yet_available")
        denied = NS(open=lambda *_a, **_k: (_ for _ in ()).throw(PermissionError()))
        self.assertEqual(self.observer().observe(denied, 0)[1], "log_access_unconfirmed")
        self.write(start())
        self.path.write_text(self.path.read_text() + life.PREFIX + "{")
        self.assertIsNone(self.observer().observe(self.path, 0)[0])
        for code in [True, "0", 256, None]:
            self.write(start(), end(code))
            self.assertEqual(self.observer().observe(self.path, 0)[1], "exit_code_unconfirmed")

    def test_uncertainty_resets_absence_grace(self):
        self.write(start())
        vals = iter([{"state": "missing"}, {"state": "unknown"}, {"state": "missing"}])
        obs = life.ReviewObservation(D, probe=lambda _: next(vals))
        for now in [0, 60, 120]:
            self.assertIsNone(obs.observe(self.path, now)[0])

    def test_legacy_error_reproduces_original_wait(self):
        logs = Path(self.tmp.name) / "logs"
        logs.mkdir()
        (logs / "reviews_20261009.log").write_text(
            "job_tracker_error\nTraceback\nRuntimeError: fixture\n"
        )
        self.assertIsNone(monitor.log_outcome("reviews", Path(self.tmp.name), "20261009"))

    def test_monitor_exit_and_original_downstream_order(self):
        for outcome in ["failed", "unknown", "skipped", "completed"]:
            with self.subTest(outcome=outcome):
                calls, events, messages = [], [], []

                def runner(cmd, **kw):
                    calls.append(cmd[-1])
                    return NS(returncode=0, stdout="", stderr="")

                result = monitor.run_monitor(
                    self.tmp.name,
                    "20261009",
                    lambda *x: messages.append(x),
                    clock=lambda: 0,
                    sleeper=lambda _: self.fail("unexpected wait"),
                    runner=runner,
                    observe=lambda name, *_: "completed" if name in monitor.SCRAPERS else None,
                    event_sink=events.append,
                    review_observer=NS(observe=lambda *_: (outcome, "fixture_owned_evidence")),
                )
                self.assertEqual(result, 0 if outcome == "completed" else 1)
                self.assertEqual(
                    calls,
                    [
                        "worker.detectors.runner",
                        "worker.agent.news_collector",
                        "worker.agent.briefing_writer",
                    ],
                )
                self.assertEqual(
                    [e for e in events if e.get("stage") == "reviews"][0]["outcome"], outcome
                )
                if outcome == "unknown":
                    self.assertTrue(any("상태 미확인" in x[0] for x in messages))
                    self.assertFalse(any("reviews 실패" in x[0] for x in messages))


class IdentityTests(unittest.TestCase):
    def test_safe_ps_results_and_arguments(self):
        for code, out, err, state in [
            (0, "Fri Oct  9 02:00:00 2026 /usr/bin/python3\n", "", "present"),
            (1, "", "", "missing"),
            (1, "", "denied", "unknown"),
            (0, "Fri Oct  9 02:00:00 2026 Python\n", "", "unknown"),
            (0, "", "", "unknown"),
        ]:

            def runner(argv, **kw):
                self.assertEqual(argv, ["/bin/ps", "-p", "123", "-o", "lstart=,comm="])
                self.assertEqual(kw["timeout"], 5)
                return NS(returncode=code, stdout=out, stderr=err)

            self.assertEqual(life.process_identity(123, runner)["state"], state)
        for exc in [PermissionError(), subprocess.TimeoutExpired("ps", 5)]:
            self.assertEqual(
                life.process_identity(123, lambda *_a, **_k: (_ for _ in ()).throw(exc)),
                {"state": "unknown"},
            )
        self.assertEqual(life.process_identity(True), {"state": "unknown"})


class WrapperTests(unittest.TestCase):
    def invoke(self, code=0, locked=False, error=None):
        out = io.StringIO()
        calls = []

        def call(cmd):
            calls.append(cmd)
            if error:
                raise error
            return code

        def flock(*_):
            if locked:
                raise BlockingIOError()

        with (
            patch.dict(sys.modules, {"review_lifecycle": life}),
            patch.dict(os.environ, {"UTTU_DAILY_RUN_ID": D}),
            patch.object(sys, "argv", ["with_collection_lock.py", "python3", "-m", "worker.main"]),
            patch.object(Path, "mkdir"),
            patch.object(Path, "open", return_value=io.StringIO()),
            patch("fcntl.flock", side_effect=flock),
            patch("subprocess.call", side_effect=call),
            patch.object(life, "process_identity", return_value=ID),
            patch("os.write", side_effect=lambda _fd, data: out.write(data.decode())),
            patch("sys.stdout", NS(fileno=lambda: 1)),
        ):
            with self.assertRaises(SystemExit) as result:
                runpy.run_path(str(ROOT / "scripts" / "with_collection_lock.py"))
        rows = [
            json.loads(line[len(life.PREFIX) :])
            for line in out.getvalue().splitlines()
            if line.startswith(life.PREFIX)
        ]
        return result.exception.code, rows, calls

    def test_real_wrapper_normal_abnormal_signal(self):
        for code in [0, 1, -9]:
            result, rows, calls = self.invoke(code)
            self.assertEqual(result, code)
            self.assertEqual([r["event"] for r in rows], ["launcher_started", "process_exited"])
            self.assertEqual(rows[-1]["exit_code"], code)
            self.assertEqual(rows[0]["collector_id"], rows[-1]["collector_id"])
            self.assertEqual(calls, [["python3", "-m", "worker.main"]])

    def test_real_lock_skip_never_launches(self):
        code, rows, calls = self.invoke(locked=True)
        self.assertEqual((code, calls), (0, []))
        self.assertEqual(rows[-1]["event"], "skipped")

    def test_real_launch_error_no_retry(self):
        code, rows, calls = self.invoke(error=FileNotFoundError())
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(rows[-1]["event"], "launch_failed")


if __name__ == "__main__":
    unittest.main()
