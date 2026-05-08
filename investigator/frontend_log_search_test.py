import importlib.util
import argparse
import contextlib
import io
import os
import sys
import tempfile
import unittest
from unittest import mock
from datetime import datetime, timezone
from pathlib import Path


SCRIPT_PATH = Path(__file__).parent / "skills" / "airo-log-investigate" / "search_frontend_logs.py"
SPEC = importlib.util.spec_from_file_location("search_frontend_logs", SCRIPT_PATH)
search_frontend_logs = importlib.util.module_from_spec(SPEC)
sys.modules["search_frontend_logs"] = search_frontend_logs
SPEC.loader.exec_module(search_frontend_logs)


class FrontendLogSearchTest(unittest.TestCase):
    def test_runner_wrapper_prefers_system_openssl_for_python(self):
        wrapper = SCRIPT_PATH.parent / "run_search_frontend_logs.sh"

        content = wrapper.read_text()

        self.assertIn('LD_LIBRARY_PATH="/usr/lib64', content)
        self.assertIn("exec python3", content)
        self.assertIn("search_frontend_logs.py", content)

    def test_default_source_is_registered_airo_app_frontend_contract(self):
        source = search_frontend_logs.get_log_source("airo-app-frontend")

        self.assertEqual(source.name, "airo-app-frontend")
        self.assertEqual(source.console_source, "airo-app")
        self.assertIn("message", source.message_fields)
        self.assertIn("data.message", source.message_fields)
        self.assertIn("statusCode", source.status_fields)
        self.assertIn("http.response.status_code", source.status_fields)
        self.assertNotIn("status", source.level_fields)
        self.assertEqual(source.message_for({"data": {"message": "client exception"}}), "client exception")
        self.assertEqual(source.status_for({"http": {"response": {"status_code": 503}}}), "503")
        self.assertTrue(source.is_error({"level": "warn", "message": "slow route"}))
        self.assertTrue(source.is_error({"message": "GET /foo returned 500"}))

    def test_loki_and_control_plane_sources_are_registered_for_multi_source_evidence(self):
        expected = {
            "airo-app-frontend": "airo-app",
            "airo-agents": "airo-agents",
            "airo-preview": "airo-preview",
            "airo-publish": "airo-publish",
            "control-plane": "control_plane",
        }

        for source_name, console_source in expected.items():
            with self.subTest(source=source_name):
                source = search_frontend_logs.get_log_source(source_name)
                self.assertEqual(source.console_source, console_source)
                self.assertTrue(source.message_fields)
                self.assertTrue(source.level_fields)

    def test_batched_evidence_path_is_scoped_to_all_sources_and_app(self):
        sources = [
            search_frontend_logs.get_log_source("airo-app-frontend"),
            search_frontend_logs.get_log_source("airo-agents"),
            search_frontend_logs.get_log_source("airo-preview"),
        ]

        path = search_frontend_logs.build_investigate_evidence_path(
            sources=sources,
            app_id="app123",
            window="24h",
        )

        self.assertEqual(path, "/api/investigate-evidence")
        payload = search_frontend_logs.build_investigate_evidence_payload(sources, "app123", "24h")
        self.assertEqual(payload["appId"], "app123")
        self.assertEqual(payload["timeWindow"], "24h")
        self.assertEqual(payload["sources"], ["airo-app", "airo-agents", "airo-preview"])

    def test_console_base_url_allows_only_expected_https_hosts(self):
        self.assertEqual(
            search_frontend_logs.validate_console_base("https://console.airo-builder.godaddy.com/"),
            "https://console.airo-builder.godaddy.com",
        )
        self.assertEqual(
            search_frontend_logs.validate_console_base("https://console.airo-builder.test-godaddy.com"),
            "https://console.airo-builder.test-godaddy.com",
        )

        for value in (
            "http://console.airo-builder.godaddy.com",
            "https://evil.example.com",
            "file:///etc/passwd",
            "https://169.254.169.254",
            "https://localhost:8443",
        ):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    search_frontend_logs.validate_console_base(value)

    def test_request_url_builder_rejects_absolute_or_non_api_paths(self):
        base = search_frontend_logs.validate_console_base("https://console.airo-builder.godaddy.com")

        self.assertEqual(
            search_frontend_logs.build_console_url(base, "/api/es-logs?source=airo-app"),
            "https://console.airo-builder.godaddy.com/api/es-logs?source=airo-app",
        )

        for path in ("https://evil.example.com/api/es-logs", "//evil.example.com/x", "/admin", "api/es-logs"):
            with self.subTest(path=path):
                with self.assertRaises(ValueError):
                    search_frontend_logs.build_console_url(base, path)

    def test_console_http_redirects_are_blocked(self):
        handler = search_frontend_logs.NoRedirectHTTPHandler()
        req = search_frontend_logs.urllib.request.Request(
            "https://console.airo-builder.godaddy.com/api/investigate-evidence"
        )

        with self.assertRaises(search_frontend_logs.urllib.error.HTTPError) as ctx:
            handler.redirect_request(
                req=req,
                fp=None,
                code=302,
                msg="Found",
                headers={},
                newurl="https://169.254.169.254/latest/meta-data",
            )

        self.assertEqual(ctx.exception.code, 302)
        ctx.exception.close()

    def test_builds_exhaustive_buckets_for_7_day_window(self):
        now = datetime(2026, 5, 7, 12, 0, tzinfo=timezone.utc)
        window = search_frontend_logs.parse_window("7d", now)

        buckets = search_frontend_logs.build_time_buckets(window, target_bucket_hours=12)

        self.assertEqual(len(buckets), 14)
        self.assertEqual(buckets[0].start, "2026-04-30T12:00:00.000Z")
        self.assertEqual(buckets[-1].end, "2026-05-07T12:00:00.000Z")

    def test_log_paths_are_always_scoped_to_app_source_and_bucket(self):
        bucket = search_frontend_logs.TimeBucket(
            label="b000",
            start="2026-05-07T00:00:00.000Z",
            end="2026-05-07T01:00:00.000Z",
        )

        source = search_frontend_logs.get_log_source("airo-app-frontend")

        path = search_frontend_logs.build_es_logs_path(source, "app123", bucket, size=250, offset=500)

        self.assertIn("source=airo-app", path)
        self.assertIn("appId=app123", path)
        self.assertIn("size=250", path)
        self.assertIn("from=500", path)
        self.assertIn("startTime=2026-05-07T00%3A00%3A00.000Z", path)
        self.assertIn("endTime=2026-05-07T01%3A00%3A00.000Z", path)

    def test_signature_normalization_preserves_unknown_failures(self):
        left = "GET /api/apps/abc123/pages/home returned 500 after 231ms requestId=aa-11"
        right = "GET /api/apps/xyz789/pages/home returned 500 after 999ms requestId=bb-22"

        source = search_frontend_logs.get_log_source("airo-app-frontend")

        self.assertEqual(source.signature_for(left), source.signature_for(right))
        self.assertIn("returned # after #ms", source.signature_for(left))

    def test_future_exceptions_are_recorded_as_incomplete_coverage(self):
        bucket = search_frontend_logs.TimeBucket("b000", "start", "end")

        bucket_logs, page_files, incomplete = search_frontend_logs.collect_bucket_results(
            {"future-token": bucket},
            [search_frontend_logs.BucketFailure("future-token", RuntimeError("malformed response"))],
        )

        self.assertEqual(bucket_logs["b000"], [])
        self.assertEqual(page_files["b000"], [])
        self.assertEqual(incomplete[0]["bucket"], "b000")
        self.assertIn("RuntimeError: malformed response", incomplete[0]["error"])

    def test_batched_evidence_errors_return_diagnostic_without_traceback(self):
        args = argparse.Namespace(
            appId="app123",
            source="airo-app-frontend",
            sources="airo-app-frontend",
            window="24h",
            output_dir="",
            page_size=500,
            bucket_hours=None,
            workers=8,
            timeout=1,
            fail_on_incomplete=False,
            batched_evidence=True,
        )

        with tempfile.TemporaryDirectory() as tmp:
            args.output_dir = tmp
            stderr = io.StringIO()
            with mock.patch.dict(os.environ, {"JOMAX_TOKEN": "token", "CONSOLE_BASE": "https://console.airo-builder.godaddy.com"}):
                with mock.patch.object(search_frontend_logs, "post_json", side_effect=RuntimeError("console 500")):
                    with contextlib.redirect_stderr(stderr):
                        result = search_frontend_logs.run(args)

        self.assertEqual(result, 1)
        self.assertIn("ERROR: batched evidence collection failed: RuntimeError: console 500", stderr.getvalue())

    def test_index_includes_every_bucket_and_rare_error_signatures(self):
        bucket = search_frontend_logs.TimeBucket("b000", "start", "end")
        logs = [
            {"timestamp": "2026-05-07T00:01:00.000Z", "level": "info", "message": "route loaded /home"},
            {"timestamp": "2026-05-07T00:02:00.000Z", "level": "error", "message": "TypeError: Cannot read properties of undefined"},
            {"timestamp": "2026-05-07T00:03:00.000Z", "level": "error", "message": "Rare blank page signal"},
        ]

        index = search_frontend_logs.build_index(
            source=search_frontend_logs.get_log_source("airo-app-frontend"),
            app_id="app123",
            window=search_frontend_logs.Window("1h", "start", "end", 1),
            buckets=[bucket],
            bucket_logs={"b000": logs},
            page_files={"b000": ["/tmp/airo-log-investigate/app123/b000-p000.json"]},
            incomplete=[],
        )

        self.assertEqual(index["coverage"]["bucketCount"], 1)
        self.assertEqual(index["source"]["name"], "airo-app-frontend")
        self.assertEqual(index["source"]["consoleSource"], "airo-app")
        self.assertEqual(index["coverage"]["fetchedLogCount"], 3)
        self.assertEqual(index["buckets"][0]["errorCount"], 2)
        self.assertTrue(any("Rare blank page signal" in row["signature"] for row in index["rareErrorSignatures"]))
        self.assertEqual(index["buckets"][0]["rawRefs"][0], "/tmp/airo-log-investigate/app123/b000-p000.json#$.logs[*]")


if __name__ == "__main__":
    unittest.main()
