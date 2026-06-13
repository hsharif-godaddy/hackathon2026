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
        self.assertNotIn("fullstoryUrl", payload)

    def test_langfuse_and_fullstory_sources_are_removed(self):
        self.assertNotIn("langfuse", search_frontend_logs.LOG_SOURCES)
        self.assertNotIn("fullstory", search_frontend_logs.LOG_SOURCES)
        with self.assertRaises(ValueError):
            search_frontend_logs.get_log_source("langfuse")

    def test_direct_evidence_has_no_langfuse_or_fullstory_sources(self):
        loki_sources = ("airo-agents", "airo-preview", "airo-publish", "control-plane")
        with mock.patch.object(search_frontend_logs, "_fetch_loki_all_sources",
                               return_value={k: {"sourceId": k, "complete": True, "index": {}, "rawPages": []}
                                             for k in loki_sources}), \
             mock.patch.object(search_frontend_logs, "_fetch_es_source",
                               return_value={"sourceId": "airo-app-frontend", "complete": True, "index": {}, "rawPages": []}):
            data = search_frontend_logs.fetch_direct_evidence("app123", "24h", 5)
        ids = {s.get("sourceId") for s in data["sources"]}
        self.assertNotIn("langfuse", ids)
        self.assertNotIn("fullstory", ids)

    def test_loki_selector_uses_structured_metadata_and_cluster(self):
        query = search_frontend_logs._loki_selector(
            "data", "app123", "prod",
            cluster="c24",
            service_name_re="airo-(agents|preview-application|publish-application)",
            use_structured_metadata=True,
        )
        self.assertIn('env="prod"', query)
        self.assertIn('plane="data"', query)
        self.assertIn('cluster="c24"', query)
        self.assertIn('service_name=~"airo-(agents|preview-application|publish-application)"', query)
        # structured-metadata: post-pipe label filter, NOT a line-substring match
        self.assertIn('| app_id="app123"', query)
        self.assertNotIn('|=', query)

    def test_loki_selector_legacy_line_match_before_cutover(self):
        query = search_frontend_logs._loki_selector(
            "data", "app123", "prod",
            cluster="c24",
            use_structured_metadata=False,
        )
        self.assertIn('cluster="c24"', query)
        # legacy: JSON-substring line match
        self.assertIn('|= "\\"app_id\\":\\"app123\\""', query)
        self.assertNotIn('| app_id=', query)

    def test_use_structured_metadata_compares_window_start_to_cutover(self):
        cutover = search_frontend_logs.LOKI_STRUCTURED_METADATA_CUTOVER
        after = search_frontend_logs.Window("custom", "2026-06-02T00:00:00Z", "2026-06-02T01:00:00Z", 1)
        before = search_frontend_logs.Window("custom", "2026-05-01T00:00:00Z", "2026-05-01T01:00:00Z", 1)
        self.assertTrue(cutover)
        self.assertTrue(search_frontend_logs._use_structured_metadata(after))
        self.assertFalse(search_frontend_logs._use_structured_metadata(before))

    def test_control_plane_is_a_loki_source(self):
        source = search_frontend_logs.get_log_source("control-plane")
        self.assertEqual(source.backend_type, "loki")
        self.assertIn("detected_level", source.level_fields)

    def test_loki_all_sources_degrades_without_cluster_and_does_not_scan(self):
        window = search_frontend_logs.parse_window("24h")
        env = {k: v for k, v in os.environ.items() if k != "LOKI_CLUSTER"}
        env["LOKI_ENDPOINT"] = "https://loki.example.com"
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(search_frontend_logs, "_http_get_json") as http_mock:
            result = search_frontend_logs._fetch_loki_all_sources("app123", window, None, 5)
        # No unbounded scan was issued.
        http_mock.assert_not_called()
        # All loki sources (incl control-plane) come back shaped + incomplete.
        for sid in ("airo-agents", "airo-preview", "airo-publish", "control-plane"):
            self.assertIn(sid, result)
            self.assertFalse(result[sid]["complete"])

    def test_loki_all_sources_includes_control_plane_when_cluster_set(self):
        window = search_frontend_logs.parse_window("24h")
        captured_queries = []

        def fake_bucket(endpoint, api_key, query, bucket, *a, **k):
            captured_queries.append(query)
            return (bucket.label, [], True)

        env = dict(os.environ)
        env["LOKI_ENDPOINT"] = "https://loki.example.com"
        env["LOKI_CLUSTER"] = "c24"
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(search_frontend_logs, "_fetch_loki_bucket", side_effect=fake_bucket):
            result = search_frontend_logs._fetch_loki_all_sources("app123", window, None, 5)
        for sid in ("airo-agents", "airo-preview", "airo-publish", "control-plane"):
            self.assertIn(sid, result)
        # Both data-plane and control-plane selectors are cluster-scoped.
        self.assertTrue(captured_queries)
        self.assertTrue(all('cluster="c24"' in q for q in captured_queries))
        self.assertTrue(any('plane="data"' in q for q in captured_queries))
        self.assertTrue(any('plane="control"' in q for q in captured_queries))

    def test_loki_agg_query_shape(self):
        q = search_frontend_logs._loki_agg_query("data", "x", "prod", "1h",
                                                 cluster="c24",
                                                 service_name_re="airo-(agents|preview-application|publish-application)")
        self.assertIn("sum by (service_name, detected_level)", q)
        self.assertIn("count_over_time(", q)
        self.assertIn('cluster="c24"', q)
        self.assertIn("[1h]", q)
        self.assertIn('| app_id="x"', q)

    def test_parse_loki_agg(self):
        resp = {"data": {"result": [
            {"metric": {"service_name": "airo-preview-application", "detected_level": "error"}, "value": [0, "1240"]},
            {"metric": {"service_name": "airo-preview-application", "detected_level": "warn"}, "value": [0, "310"]},
        ]}}
        hist = search_frontend_logs._parse_loki_agg(resp)
        self.assertEqual(hist[("airo-preview-application", "error")], 1240)
        self.assertEqual(hist[("airo-preview-application", "warn")], 310)

    def test_collect_aggregation_degrades_without_cluster(self):
        agg = search_frontend_logs._collect_aggregation("x", search_frontend_logs.parse_window("1h"), "prod", None, 5)
        self.assertIn("error", agg)
        self.assertEqual(agg["levelHistogram"], {})

    def test_collect_aggregation_happy_path_and_bundle_carries_aggregation(self):
        window = search_frontend_logs.parse_window("1h")

        data_resp = {"data": {"result": [
            {"metric": {"service_name": "airo-preview-application", "detected_level": "error"}, "value": [0, "12"]},
            {"metric": {"service_name": "airo-agents", "detected_level": "info"}, "value": [0, "100"]},
        ]}}
        control_resp = {"data": {"result": [
            {"metric": {"service_name": "control-plane", "detected_level": "error"}, "value": [0, "3"]},
            {"metric": {"service_name": "control-plane", "detected_level": "info"}, "value": [0, "7"]},
        ]}}

        responses = [data_resp, control_resp]

        def fake_http_get_json(url, headers, params, timeout):
            return responses.pop(0)

        env = dict(os.environ)
        env["LOKI_ENDPOINT"] = "https://loki.example.com"
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(search_frontend_logs, "_http_get_json", side_effect=fake_http_get_json):
            agg = search_frontend_logs._collect_aggregation("x", window, "prod", "c24", 5)

        self.assertNotIn("error", agg)
        self.assertEqual(agg["cluster"], "c24")
        self.assertEqual(agg["windowLabel"], window.label)
        # levelHistogram summed across services + planes
        self.assertEqual(agg["levelHistogram"]["error"], 15)
        self.assertEqual(agg["levelHistogram"]["info"], 107)
        # byService keyed by service_name
        self.assertEqual(agg["byService"]["airo-preview-application"]["error"], 12)
        self.assertEqual(agg["byService"]["airo-agents"]["info"], 100)
        self.assertEqual(agg["byService"]["control-plane"]["error"], 3)
        self.assertEqual(agg["byService"]["control-plane"]["info"], 7)

    def test_fetch_direct_evidence_attaches_aggregation(self):
        loki_sources = ("airo-agents", "airo-preview", "airo-publish", "control-plane")
        with mock.patch.object(search_frontend_logs, "_fetch_loki_all_sources",
                               return_value={k: {"sourceId": k, "complete": True, "index": {}, "rawPages": []}
                                             for k in loki_sources}), \
             mock.patch.object(search_frontend_logs, "_fetch_es_source",
                               return_value={"sourceId": "airo-app-frontend", "complete": True, "index": {}, "rawPages": []}), \
             mock.patch.object(search_frontend_logs, "_collect_aggregation",
                               return_value={"levelHistogram": {"error": 5}, "byService": {}, "windowLabel": "24h", "cluster": "c24"}):
            data = search_frontend_logs.fetch_direct_evidence("app123", "24h", 5)
        self.assertEqual(data["appId"], "app123")
        self.assertEqual(data["timeWindow"], "24h")
        self.assertIn("sources", data)
        self.assertIn("aggregation", data)
        self.assertEqual(data["aggregation"]["levelHistogram"]["error"], 5)

    def test_fetch_log_lines_filters_by_template_substring(self):
        with mock.patch.dict(os.environ, {"LOKI_ENDPOINT": "https://loki", "LOKI_CLUSTER": "c24"}), \
             mock.patch.object(search_frontend_logs, "_http_get_json",
                               return_value={"data": {"result": [
                                   {"stream": {"service_name": "airo-preview-application"},
                                    "values": [["1700000000000000000", "ECONNREFUSED 10.0.0.2"]]}]}}) as m:
            res = search_frontend_logs.fetch_log_lines(
                "x", plane="data", service_name="airo-preview-application",
                contains="ECONNREFUSED", window="1h", env="prod", cluster="c24", limit=50)
        self.assertTrue(res["ok"])
        self.assertEqual(res["lines"][0]["line"], "ECONNREFUSED 10.0.0.2")
        self.assertEqual(res["lines"][0]["service_name"], "airo-preview-application")
        self.assertEqual(res["count"], 1)
        # query was cluster-scoped + had the contains filter
        called_params = m.call_args[0][2]
        query = called_params["query"]
        self.assertIn('cluster="c24"', query)
        self.assertIn('|= "ECONNREFUSED"', query)
        self.assertIn('service_name=~"airo-preview-application"', query)
        self.assertEqual(called_params["direction"], "backward")
        self.assertEqual(called_params["limit"], "50")

    def test_fetch_log_lines_degrades_without_cluster(self):
        with mock.patch.dict(os.environ, {"LOKI_ENDPOINT": "https://loki"}, clear=False):
            res = search_frontend_logs.fetch_log_lines("x", cluster=None, env="prod")
        self.assertFalse(res["ok"])
        self.assertEqual(res["lines"], [])

    def test_console_base_url_allows_only_expected_https_hosts(self):
        self.assertEqual(
            search_frontend_logs.validate_console_base("https://console.airo-builder.godaddy.com/"),
            "https://console.airo-builder.godaddy.com",
        )
        self.assertEqual(
            search_frontend_logs.validate_console_base("https://console.airo-builder.test-godaddy.com"),
            "https://console.airo-builder.test-godaddy.com",
        )
        self.assertEqual(
            search_frontend_logs.validate_console_base("https://console.airo-builder.int.test-gdcorp.tools"),
            "https://console.airo-builder.int.test-gdcorp.tools",
        )
        self.assertEqual(
            search_frontend_logs.validate_console_base("https://console.airo-builder.int.gdcorp.tools"),
            "https://console.airo-builder.int.gdcorp.tools",
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


class TemplateMiningAndDigestTest(unittest.TestCase):
    def test_mine_templates_collapses_variants(self):
        # Names like alice/bob/carol do NOT collapse under the existing
        # signature masker (only IDs/numbers/urls/hex are normalised), so the
        # test lines vary ONLY in digits — which the masker provably collapses
        # to a single "request # failed timeout" signature. Verified against
        # LogSource.signature_for. The drain3 path produces the same single
        # template; the stdlib-masker fallback is what runs here (drain3 not
        # installed locally).
        lines = [
            "request 8842 failed timeout",
            "request 1190 failed timeout",
            "request 3375 failed timeout",
        ]
        templates = search_frontend_logs.mine_templates(lines)
        self.assertEqual(len(templates), 1)
        self.assertEqual(templates[0]["count"], 3)
        self.assertGreaterEqual(len(templates[0]["examples"]), 1)

    def test_build_log_digest_shape(self):
        bundle = {
            "aggregation": {
                "levelHistogram": {"error": 9, "info": 100},
                "byService": {"airo-agents": {"error": 9}},
                "windowLabel": "24h",
                "cluster": "c24",
            },
            "sources": [
                {
                    "sourceId": "airo-agents",
                    "complete": True,
                    "index": {
                        "rareErrorSignatures": [
                            {"signature": "rare blank page signal", "count": 1, "rawRef": "mem:airo-agents:b000"},
                        ],
                    },
                    "rawPages": [
                        {
                            "bucket": "b000",
                            "page": 0,
                            "logs": [
                                {"level": "error", "message": "request 8842 failed timeout"},
                                {"level": "error", "message": "request 1190 failed timeout"},
                                {"level": "warn", "message": "slow upstream 200ms"},
                                {"level": "info", "message": "route loaded /home"},
                            ],
                        },
                    ],
                },
            ],
        }

        digest = search_frontend_logs.build_log_digest(bundle)

        self.assertIn("aggregation", digest)
        self.assertEqual(digest["aggregation"]["levelHistogram"]["error"], 9)

        self.assertIn("templates", digest)
        self.assertTrue(digest["templates"])
        for tmpl in digest["templates"]:
            self.assertIn("template", tmpl)
            self.assertIn("count", tmpl)
            self.assertIn("examples", tmpl)
            self.assertIn("sourceId", tmpl)
        self.assertTrue(any(t["sourceId"] == "airo-agents" for t in digest["templates"]))

        self.assertIn("rareErrors", digest)
        self.assertTrue(any(r.get("sourceId") == "airo-agents" for r in digest["rareErrors"]))
        self.assertTrue(any("blank" in r.get("signature", "") for r in digest["rareErrors"]))

    def test_fetch_direct_evidence_attaches_digest(self):
        loki_sources = ("airo-agents", "airo-preview", "airo-publish", "control-plane")
        with mock.patch.object(search_frontend_logs, "_fetch_loki_all_sources",
                               return_value={k: {"sourceId": k, "complete": True, "index": {}, "rawPages": []}
                                             for k in loki_sources}), \
             mock.patch.object(search_frontend_logs, "_fetch_es_source",
                               return_value={"sourceId": "airo-app-frontend", "complete": True, "index": {}, "rawPages": []}), \
             mock.patch.object(search_frontend_logs, "_collect_aggregation",
                               return_value={"levelHistogram": {"error": 5}, "byService": {}, "windowLabel": "24h", "cluster": "c24"}):
            data = search_frontend_logs.fetch_direct_evidence("app123", "24h", 5)
        self.assertIn("digest", data)
        self.assertIn("aggregation", data["digest"])
        self.assertIn("templates", data["digest"])
        self.assertIn("rareErrors", data["digest"])


class AssertHttpUrlSsrfTest(unittest.TestCase):
    """Pin the SSRF guard at `_assert_http_url`.

    The Lambda image runs Python 3.9 where the cold-start `pip install
    urllib3` is broken (see Dockerfile note + commit 1d098a03e). Production
    therefore takes the `urllib.request.urlopen` fallback path inside
    `_request_via_pool`, which happily honours `file://` URLs unless we
    intercept first. These tests lock the allowlist in place so a future
    edit cannot silently widen it.
    """

    def test_https_url_passes(self):
        # Sanity: the only allowed scheme returns None (no raise).
        self.assertIsNone(
            search_frontend_logs._assert_http_url("https://example.com/v1/foo")
        )

    def test_file_scheme_rejected(self):
        # The original Semgrep concern — local-file exfiltration via urllib.
        with self.assertRaises(ValueError) as ctx:
            search_frontend_logs._assert_http_url("file:///etc/passwd")
        self.assertIn("disallowed scheme", str(ctx.exception))

    def test_plain_http_rejected(self):
        # https-only allowlist: even http://internal.host is refused so a
        # corrupted env var can't downgrade the connection.
        with self.assertRaises(ValueError):
            search_frontend_logs._assert_http_url("http://example.com/")

    def test_ftp_scheme_rejected(self):
        with self.assertRaises(ValueError):
            search_frontend_logs._assert_http_url("ftp://example.com/")

    def test_inline_credentials_rejected(self):
        # `https://attacker:x@host` is a classic confused-deputy vector —
        # the netloc parses cleanly but the userinfo can be interpreted by
        # downstream proxies. Reject before urllib sees it.
        with self.assertRaises(ValueError) as ctx:
            search_frontend_logs._assert_http_url("https://attacker:secret@example.com/")
        self.assertIn("inline credentials", str(ctx.exception))

    def test_empty_netloc_rejected(self):
        # `https:relative` or `https:` parses to a https-scheme URL with no
        # host. urllib treats it as a same-origin relative URL on some
        # platforms; reject explicitly.
        with self.assertRaises(ValueError):
            search_frontend_logs._assert_http_url("https:relative")


if __name__ == "__main__":
    unittest.main()
