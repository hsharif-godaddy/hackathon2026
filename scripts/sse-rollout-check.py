#!/usr/bin/env python3
"""SSE-vs-WebSocket transport rollout health check.

Cross-checks the server side (Loki, via the Grafana datasource proxy) and the
client side (airobuilde ESSP Elastic) and prints one consolidated report with a
verdict, so a rollout check is a single command.

Usage:
    GRAFANA_API_TOKEN=... python3 scripts/sse-rollout-check.py [--minutes 30]

Auth:
    Loki   -> $GRAFANA_API_TOKEN (Grafana service-account token)
    Elastic-> $ELASTIC_API_KEY, else <repo-root>/.elastic

Notes / hard-won constraints baked in:
    * Loki has a ~30s query timeout; every query here is single-pass. Keep
      --minutes small (<=180).
    * Transport success EXCLUDES business (4xx) and upstream (502/503/504)
      status codes -- those hit both transports and otherwise make low-volume
      SSE look worse from credit-exhaustion noise.
    * Client logs are warn+ only (ClientLogBuffer), so the Elastic side measures
      failures and reach (isTLA), NOT a success rate.
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

LOKI_PROXY = "https://grafana.monitoring.gd3p.tools/api/datasources/proxy/650/loki/api/v1/query_range"
ES_URL = "https://b3b066ca9c614dc685a0d2387b359fec.us-west-2.aws.found.io:443"
ES_INDEX = "logs-gdelastic.katana.app-prod-ecs"
ENV = "prod"

# Terminal events (component-prefixed as they appear in prod).
WS_C, WS_E = "ai-lib.websocket.message.assembly.complete", "ai-lib.websocket.agent.error"
SSE_C, SSE_E = "sse.execution.complete", "sse.execution.error"
OUTCOMES_RE = r'"event":"(sse\.execution\.(complete|error)|ai-lib\.websocket\.(message\.assembly\.complete|agent\.error))"'
ERR_RE = r'"event":"(sse\.execution\.error|ai-lib\.websocket\.agent\.error)"'
SSE_TRANSPORT_RE = r'"event":"(sse\.subscriber\.|sse\.execution\.(no_subscriber|getFinalResult))'
# New diagnostic events landed 2026-06-19 (#5253 / #5249) — see the error-trend
# review doc. Each is a single cheap line-filter count.
#  - pre_stream paywall: pre-stream BMS-capacity 402 block (was invisible on SSE)
#  - getFinalResult.failed = GENUINE result-fetch failure (aborts now split out to
#    getFinalResult.aborted, so .failed is trustworthy)
#  - "No matching discriminator" = malformed upstream stream chunk (proxy leaks a
#    Bedrock exception envelope). Classified STREAM_TYPE_VALIDATION/502 on the wire;
#    counted here by the raw string because it is reliable regardless of whether the
#    log-side statusCode/errorType fix has deployed yet.
DIAG_EVENTS = {
    "pre_stream paywall (402 block)": '"event":"sse.budget.exceeded.pre_stream"',
    "getFinalResult.failed (GENUINE)": '"event":"sse.execution.getFinalResult.failed"',
    "getFinalResult.aborted (benign)": '"event":"sse.execution.getFinalResult.aborted"',
    "stream type-validation (malformed upstream chunk)": "No matching discriminator",
}


def repo_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _get(token):
    t = os.environ.get(token)
    if not t:
        sys.exit(f"{token} not set")
    return t.strip()


def es_key():
    if os.environ.get("ELASTIC_API_KEY"):
        return os.environ["ELASTIC_API_KEY"].strip()
    path = os.path.join(repo_root(), ".elastic")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    sys.exit("Elastic key not found ($ELASTIC_API_KEY or <repo-root>/.elastic)")


def _http(url, headers, data=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers=headers,
                                 method="POST" if data else "GET")
    try:
        # nosemgrep: dynamic-urllib-use-detected - url is built only from the
        # hardcoded LOKI_PROXY/ES_URL constants + urlencoded params; no untrusted
        # input controls scheme/host, and this is a manually-run ops script.
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
            return json.load(r)
    except Exception as e:  # noqa: BLE001 - report, don't crash the whole run
        return {"_error": str(e)}


def loki(query, start_ns, end_ns, step, token):
    qs = urllib.parse.urlencode({"query": query, "start": start_ns, "end": end_ns, "step": step})
    return _http(f"{LOKI_PROXY}?{qs}", {"Authorization": "Bearer " + token})


def es(body, key):
    return _http(f"{ES_URL}/{ES_INDEX}/_search",
                 {"Authorization": "ApiKey " + key, "Content-Type": "application/json"},
                 data=json.dumps(body).encode())


def main():
    ap = argparse.ArgumentParser(description="SSE vs WS rollout health check")
    ap.add_argument("--minutes", type=int, default=30, help="lookback window (default 30, keep <=180)")
    args = ap.parse_args()
    mins = args.minutes
    rng = f"[{mins}m]"
    gtoken = _get("GRAFANA_API_TOKEN")
    ekey = es_key()

    end_ns = int(time.time() * 1e9)
    start_ns = int((time.time() - mins * 60) * 1e9)
    step = mins * 60  # single bucket = window totals

    print(f"== SSE rollout check : last {mins}m : env={ENV} ==\n")

    # ---- Loki: server side ----
    # Transport success is derived from the count rows below (complete vs blank-status
    # error), NOT a dedicated avg_over_time query: that heavier scan (json + label_format
    # + unwrap) blows the ~30s Loki timeout once SSE does ~9k turns/hr. count_over_time
    # grouped scans survive at any volume, so we reuse them.
    vol = loki(
        f'sum by (event) (count_over_time({{job="airo-agents",env="{ENV}"}} |~ `{OUTCOMES_RE}` '
        f'| json | keep event {rng}))', start_ns, end_ns, step, gtoken)
    counts = {}
    if vol.get("status") == "success":
        for s in vol["data"]["result"]:
            counts[s["metric"]["event"]] = int(sum(float(v[1]) for v in s["values"]))
    sse_turns = counts.get(SSE_C, 0) + counts.get(SSE_E, 0)
    ws_turns = counts.get(WS_C, 0) + counts.get(WS_E, 0)
    share = 100 * sse_turns / max(1, sse_turns + ws_turns)

    errs = loki(
        f'sum by (event, data_statusCode, data_errorType) (count_over_time({{job="airo-agents",env="{ENV}"}} '
        f'|~ `{ERR_RE}` | json | keep event, data_statusCode, data_errorType {rng}))', start_ns, end_ns, step, gtoken)
    err_rows = []
    if errs.get("status") == "success":
        for s in errs["data"]["result"]:
            err_rows.append((s["metric"].get("event"), s["metric"].get("data_statusCode", "(none)"),
                             s["metric"].get("data_errorType", ""),
                             int(sum(float(v[1]) for v in s["values"]))))
    err_rows.sort(key=lambda r: -r[3])

    # Transport-only success per transport: complete / (complete + blank-status errors).
    # Blank status = genuine transport/agent failure; 4xx/5xx (business+infra) are excluded
    # from numerator and denominator alike (they never count for/against the transport).
    # Matches the dashboard's avg(1/0) metric but from counts, so it can't time out.
    def _blank_errors(error_event):
        return sum(n for ev, st, et, n in err_rows if ev == error_event and st == "(none)")
    rates = {}
    for label, complete_event, error_event in (("SSE", SSE_C, SSE_E), ("WebSocket", WS_C, WS_E)):
        complete = counts.get(complete_event, 0)
        denom = complete + _blank_errors(error_event)
        if denom:
            rates[label] = complete / denom

    tspec = loki(
        f'sum by (event) (count_over_time({{job="airo-agents",env="{ENV}"}} |~ `{SSE_TRANSPORT_RE}` '
        f'| json | keep event {rng}))', start_ns, end_ns, step, gtoken)
    tspec_rows = {}
    if tspec.get("status") == "success":
        for s in tspec["data"]["result"]:
            tspec_rows[s["metric"]["event"]] = int(sum(float(v[1]) for v in s["values"]))

    print("-- Loki (server) --")
    if rates:
        for t in ("SSE", "WebSocket"):
            if t in rates:
                print(f"  transport success {t:<10} {rates[t]*100:6.2f}%")
    else:
        print("  success rate: NO DATA (query failed/timeout)")
    print(f"  SSE share of turns: {share:.1f}%  (SSE {sse_turns} / WS {ws_turns} turns)")
    print("  terminal errors by status:")
    for ev, st, et, n in err_rows or [("(none)", "", "", 0)]:
        tag = "TRANSPORT" if st == "(none)" else ("business" if st.startswith("4") else "infra")
        et_s = f" {et}" if et else ""
        print(f"    {ev:<40} {st:<6} {n:<4} [{tag}]{et_s}")
    print("  SSE transport-specific events:")
    for ev in sorted(tspec_rows):
        print(f"    {ev:<46} {tspec_rows[ev]}")
    no_sub = tspec_rows.get("sse.execution.no_subscriber_abort", 0)

    print("  diagnostics (events landed 2026-06-19):")
    for label, filt in DIAG_EVENTS.items():
        d = loki(f'sum(count_over_time({{job="airo-agents",env="{ENV}"}} |= `{filt}` {rng}))',
                 start_ns, end_ns, step, gtoken)
        n = 0
        if d.get("status") == "success" and d["data"]["result"]:
            n = int(sum(float(v[1]) for s in d["data"]["result"] for v in s["values"]))
        print(f"    {label:<52} {n}")

    # ---- Elastic: client side ----
    def sse_agg(extra_filter=None):
        flt = [{"range": {"@timestamp": {"gte": f"now-{mins}m"}}}, {"wildcard": {"event": "client.sse.*"}}]
        return {
            "size": 0,
            "query": {"bool": {"filter": flt}},
            "aggs": {
                "tla": {"terms": {"field": "data.isTLA"}},
                "sessions": {"cardinality": {"field": "data.sessionId"}},
                "ext": {"filter": {"term": {"data.isTLA": False}}, "aggs": {"s": {"cardinality": {"field": "data.sessionId"}}}},
                "hard": {"filter": {"terms": {"event": [
                    "client.sse.connect.failed", "client.sse.send_message.failed",
                    "client.sse.connect.conversationCreate.exhausted"]}},
                    "aggs": {"s": {"cardinality": {"field": "data.sessionId"}}}},
                "reconnect": {"filter": {"bool": {"filter": [
                    {"term": {"event": "client.sse.transport.eventsource.error"}},
                    {"range": {"data.consecutiveErrors": {"gte": 4}}}]}},
                    "aggs": {"s": {"cardinality": {"field": "data.sessionId"}},
                             "worst": {"max": {"field": "data.consecutiveErrors"}}}},
            },
        }

    e = es(sse_agg(), ekey)
    print("\n-- Elastic (client, warn+ only) --")
    if "_error" in e or "aggregations" not in e:
        print("  ELASTIC QUERY FAILED:", json.dumps(e.get("error", e.get("_error", "?")))[:200])
        recon_sessions = hard_sessions = ext_sessions = recon_worst = None
    else:
        a = e["aggregations"]
        tla = {(b.get("key_as_string", str(b["key"]))): b["doc_count"] for b in a["tla"]["buckets"]}
        ext_sessions = a["ext"]["s"]["value"]
        hard_sessions = a["hard"]["s"]["value"]
        recon_sessions = a["reconnect"]["s"]["value"]
        recon_worst = a["reconnect"]["worst"]["value"]
        print(f"  client.sse.* docs: {e['hits']['total']['value']}  isTLA {tla}")
        print(f"  SSE sessions w/ warning: {a['sessions']['value']}  (external: {ext_sessions})")
        print(f"  hard-fail sessions (connect/send/exhausted): {hard_sessions}  <- active-user failures")
        print(f"  reconnect-trouble sessions (consecErr>=4): {recon_sessions}  worst={recon_worst}  "
              f"<- mostly stale/idle/deleted tabs, see note")

    # ---- verdict ----
    print("\n-- verdict --")
    if rates.get("SSE") is not None and rates.get("WebSocket") is not None:
        delta = (rates["SSE"] - rates["WebSocket"]) * 100
        ok = rates["SSE"] >= 0.985 and delta >= -1.0
        print(f"  [{'OK ' if ok else 'WATCH'}] transport success SSE {rates['SSE']*100:.2f}% vs WS "
              f"{rates['WebSocket']*100:.2f}% (Δ {delta:+.2f} pts)")
    elif rates.get("SSE") is not None:
        # WS fully drained post-rollout: no baseline to diff, report SSE absolute.
        ok = rates["SSE"] >= 0.985
        print(f"  [{'OK ' if ok else 'WATCH'}] transport success SSE {rates['SSE']*100:.2f}% "
              f"(WS drained to 0 turns — no baseline to compare)")
    else:
        print("  [WATCH] could not compute success rate (Loki query issue)")
    print(f"  [INFO ] SSE turn-share {share:.1f}% (target 50%; rises as pre-flip WS sessions drain)")
    # Active-user failures are the real client gate. send/connect/exhausted means a user actively tried.
    if hard_sessions is not None:
        flag = "WATCH" if hard_sessions >= 15 else "OK "
        print(f"  [{flag}] active-user SSE failures: {hard_sessions} sessions hit connect/send/exhausted")
    # Reconnect-trouble is mostly orphaned /develop tabs (deleted/idle apps) hammering reconnect -- a client
    # retry-storm cleanup, NOT a rollout reliability gate. Reported for context, not a pass/fail.
    if recon_sessions is not None:
        print(f"  [INFO ] reconnect-trouble: {recon_sessions} sessions (worst consecErr={recon_worst}), "
              f"{no_sub} server no_subscriber_aborts -- dominated by stale/idle/deleted browser tabs")
    print("\n(thresholds are heuristics; success excludes 4xx/5xx business+infra; client side is warn+ only)")


if __name__ == "__main__":
    main()
