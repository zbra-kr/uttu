"""Run worker regression tests with credentials and external operations blocked.

Use a Python environment with the project development dependencies installed.
This runner does not install dependencies or activate application maintenance.
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path


def forbidden(*args, **kwargs):
    raise AssertionError("External client/model operation forbidden in offline tests")


def main():
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="uttu-worker-offline-") as private:
        os.environ.clear()
        os.environ.update({"HOME": private, "TMPDIR": private,
                           "PYTHONDONTWRITEBYTECODE": "1",
                           "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1"})
        sys.dont_write_bytecode = True

        def audit(event, args):
            if event in {"socket.connect", "socket.bind", "socket.getaddrinfo",
                         "socket.sendto", "subprocess.Popen", "os.system"}:
                raise PermissionError("Offline boundary: " + event)
            if event == "open":
                try:
                    parts = Path(os.fsdecode(args[0])).parts
                except TypeError:
                    return
                if any(part.startswith(".env") or part in
                       {".aws", ".secret", ".ssh", ".netrc"} for part in parts):
                    raise PermissionError("Offline boundary: credential file read")

        sys.addaudithook(audit)
        import anthropic
        import dotenv
        import requests

        import supabase
        dotenv.load_dotenv = lambda *args, **kwargs: False
        dotenv.dotenv_values = lambda *args, **kwargs: {}
        requests.sessions.Session.request = forbidden
        requests.sessions.Session.send = forbidden
        supabase.create_client = forbidden
        anthropic.Anthropic = forbidden
        anthropic.AsyncAnthropic = forbidden

        class OfflineLoop(asyncio.SelectorEventLoop):
            def _make_self_pipe(self):
                pass

            def _close_self_pipe(self):
                pass

            def _write_to_self(self):
                pass

        class OfflinePolicy(asyncio.DefaultEventLoopPolicy):
            def new_event_loop(self):
                return OfflineLoop()

        asyncio.set_event_loop_policy(OfflinePolicy())
        sys.path.insert(0, str(root))
        import pytest
        return pytest.main(["-q", "-p", "no:cacheprovider", "-c", os.devnull,
                            str(root / "worker/tests")])


if __name__ == "__main__":
    raise SystemExit(main())
