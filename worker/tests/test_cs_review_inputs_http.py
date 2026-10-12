"""Actual installed PostgREST SDK with a synthetic HTTP transport only."""

import unittest
from types import SimpleNamespace

import httpx
from postgrest import SyncPostgrestClient

from worker.agent import _cs_review_inputs as cs
from worker.tests.test_cs_review_inputs import DAY, row


class SDKHTTPTests(unittest.TestCase):
    def run_reader(self, callback):
        calls = []

        def handle(request):
            calls.append(request)
            self.assertEqual(request.url.host, "offline-cs.invalid")
            self.assertEqual(request.method, "GET")
            self.assertEqual(request.url.path, "/reviews")
            return callback(request, len(calls))

        with httpx.Client(transport=httpx.MockTransport(handle)) as http:
            with SyncPostgrestClient("https://offline-cs.invalid", http_client=http) as sdk:
                db = SimpleNamespace(table=sdk.from_)
                try:
                    return cs.read_cs_review_inputs(db, DAY), calls
                finally:
                    self.calls = calls

    def test_real_sdk_encodes_join_written_dates_cutoff_exact_count_and_ranges(self):
        def response(request, call):
            params = request.url.params
            self.assertIn("products!inner(is_own,name,brands(slug))", params["select"])
            self.assertEqual(params["products.is_own"], "eq.True")
            self.assertEqual(params.get_list("review_date"), ["gte.2026-10-05", "lte.2026-10-10"])
            self.assertTrue(params["created_at"].startswith("lte."))
            self.assertEqual(params["order"], "id.asc")
            self.assertEqual(params["limit"], "250")
            self.assertEqual(params["offset"], str((call - 1) * 250))
            self.assertIn("count=exact", request.headers["Prefer"])
            data = [row(n) for n in range(1, 251)] if call == 1 else [row(251)]
            return httpx.Response(
                206,
                json=data,
                headers={"Content-Range": f"{(call - 1) * 250}-{250 if call == 2 else 249}/251"},
            )

        result, calls = self.run_reader(response)
        self.assertEqual(result["review_summary_yesterday"]["count"], 251)
        self.assertEqual(len(calls), 2)

    def test_real_sdk_true_zero_is_complete(self):
        result, calls = self.run_reader(
            lambda *_: httpx.Response(200, json=[], headers={"Content-Range": "*/0"})
        )
        self.assertEqual(result["review_summary_yesterday"]["count"], 0)
        self.assertEqual(len(calls), 1)

    def test_real_sdk_http_errors_transport_and_malformed_or_partial_responses_abort(self):
        for mode in [
            "404-array",
            "404-empty",
            "empty-success",
            "503",
            "500",
            "transport",
            "wrong-range",
            "missing-count",
            "null",
            "partial",
            "changed-count",
        ]:

            def response(request, call):
                if mode == "transport":
                    raise httpx.ConnectError("synthetic-private", request=request)
                if mode == "404-array":
                    return httpx.Response(404, json=[])
                if mode == "404-empty":
                    return httpx.Response(404, content=b"")
                if mode == "empty-success":
                    return httpx.Response(200, content=b"", headers={"Content-Range": "*/0"})
                if mode == "503":
                    return httpx.Response(503, json={"message": "synthetic-private"})
                if mode == "500":
                    return httpx.Response(500, json={"message": "synthetic-private"})
                if mode == "wrong-range":
                    return httpx.Response(200, json=[row()], headers={"Content-Range": "5-5/1"})
                if mode == "missing-count":
                    return httpx.Response(200, json=[])
                if mode == "null":
                    return httpx.Response(200, content=b"null", headers={"Content-Range": "*/0"})
                if mode == "partial":
                    return httpx.Response(206, json=[row(1)], headers={"Content-Range": "0-0/251"})
                if call == 1:
                    return httpx.Response(
                        206,
                        json=[row(n) for n in range(1, 251)],
                        headers={"Content-Range": "0-249/251"},
                    )
                return httpx.Response(
                    206, json=[row(251), row(252)], headers={"Content-Range": "250-251/252"}
                )

            with self.subTest(mode=mode), self.assertRaises(cs.CSReviewInputError):
                self.run_reader(response)
            self.assertEqual(len(self.calls), 2 if mode == "changed-count" else 1)
