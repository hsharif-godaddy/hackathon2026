#!/usr/bin/env python3
"""
Fetch and index all available airo-app logs for one app/time window.

The script is optimized for the Lambda investigator pattern:
- raw logs are exhaustively paginated to /tmp, bucket by bucket;
- Claude receives a compact index first, not raw JSON dumps;
- failed buckets are split smaller before being marked incomplete.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from urllib.parse import urlparse
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# urllib3 powers the direct-evidence HTTP path: connection pool keeps TLS
# warm across the 50+ requests a single Loki/Langfuse/ES collection makes,
# native Retry handles 429/5xx with exponential backoff + jitter, and the
# `decode_content=True` flag auto-inflates gzip responses. Stdlib urllib
# offers none of these. Import is module-scoped so test environments without
# urllib3 (unlikely on Lambda — installed in Dockerfile) fall back to a
# stdlib code path. The fallback only handles the happy case; it does not
# retry. Production always has urllib3.
try:  # pragma: no cover — import-time branching
    import urllib3
    from urllib3.util.retry import Retry
    _URLLIB3_AVAILABLE = True
except ImportError:  # pragma: no cover
    urllib3 = None  # type: ignore[assignment]
    Retry = None  # type: ignore[assignment]
    _URLLIB3_AVAILABLE = False


CONSOLE_BASE = "https://console.airo-builder.godaddy.com"
ALLOWED_CONSOLE_HOSTS = {
    "console.airo-builder.godaddy.com",
    "console.airo-builder.test-godaddy.com",
}
DEFAULT_OUTPUT_DIR = "/tmp/airo-log-investigate"


class NoRedirectHTTPHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)


CONSOLE_OPENER = urllib.request.build_opener(NoRedirectHTTPHandler)


def field_value(data: dict[str, Any], path: str) -> Any:
    current: Any = data
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


@dataclass(frozen=True)
class LogSource:
    name: str
    console_source: str
    description: str
    message_fields: tuple[str, ...]
    level_fields: tuple[str, ...]
    status_fields: tuple[str, ...]
    error_terms: tuple[str, ...]
    # backend_type matches debug-console's EvidenceSourceConfig.backendType
    # (loki | elasticsearch | langfuse | fullstory). Surfaced in the index
    # so phase prompts and downstream consumers see the same shape they
    # get from /api/investigate-evidence.
    backend_type: str = "elasticsearch"

    def message_for(self, log: dict[str, Any]) -> str:
        for key in self.message_fields:
            value = field_value(log, key)
            if value:
                return str(value)
        return json.dumps(log, sort_keys=True)[:500]

    def level_for(self, log: dict[str, Any]) -> str:
        for key in self.level_fields:
            value = field_value(log, key)
            if value:
                return compact_text(value, 32).lower()
        return "unknown"

    def status_for(self, log: dict[str, Any]) -> str | None:
        for key in self.status_fields:
            value = field_value(log, key)
            if isinstance(value, int):
                return str(value)
            if isinstance(value, str) and re.match(r"^\d{3}$", value):
                return value
        match = re.search(r"\b([45]\d{2})\b", self.message_for(log))
        return match.group(1) if match else None

    def signature_for(self, message: Any) -> str:
        text = "" if message is None else str(message)
        text = re.sub(r"https?://\S+", "<url>", text)
        text = re.sub(r"\b[a-f0-9]{8,}\b", "<hex>", text, flags=re.I)
        text = re.sub(r"\b[0-9a-f]{2,}(?:-[0-9a-f]{2,})+\b", "<id>", text, flags=re.I)
        text = re.sub(r"/[A-Za-z0-9_-]{6,}(?=/|$)", "/<id>", text)
        text = re.sub(r"\b\d+(ms|s)\b", r"#\1", text)
        text = re.sub(r"\b\d+\b", "#", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:240]

    def is_error(self, log: dict[str, Any]) -> bool:
        level = self.level_for(log)
        message = self.message_for(log).lower()
        code = self.status_for(log)
        return (
            level in {"error", "fatal", "warn", "warning"}
            or bool(code and code.startswith(("4", "5")))
            or any(term in message for term in self.error_terms)
        )


LOG_SOURCES = {
    "airo-app-frontend": LogSource(
        name="airo-app-frontend",
        console_source="airo-app",
        description="Airo app frontend/browser-facing runtime logs from the console es-logs API. Mirrors sre-airo-feedback-tool UI mapping: data.appId app scope, message field, lowercase level.",
        message_fields=("message", "data.message", "error.message", "error", "event", "msg"),
        level_fields=("level", "severity"),
        status_fields=("statusCode", "httpStatus", "responseStatus", "http.response.status_code", "status"),
        error_terms=("error", "exception", "failed", "typeerror", "referenceerror", "blank"),
        backend_type="elasticsearch",
    ),
    "airo-agents": LogSource(
        name="airo-agents",
        console_source="airo-agents",
        description="Airo agent service logs from the console evidence API Loki collector.",
        message_fields=("message", "msg", "log", "event", "type"),
        level_fields=("level", "detected_level", "severity"),
        status_fields=("status", "statusCode", "http.status_code", "http.response.status_code"),
        error_terms=("error", "exception", "failed", "timeout", "agent", "tool"),
        backend_type="loki",
    ),
    "airo-preview": LogSource(
        name="airo-preview",
        console_source="airo-preview",
        description="Preview application container logs from the console evidence API Loki collector.",
        message_fields=("msg", "message", "log", "type", "path"),
        level_fields=("level", "detected_level", "severity"),
        status_fields=("status", "statusCode", "http.status_code", "http.response.status_code"),
        error_terms=("error", "exception", "failed", "timeout", "500", "blank"),
        backend_type="loki",
    ),
    "airo-publish": LogSource(
        name="airo-publish",
        console_source="airo-publish",
        description="Published application container logs from the console evidence API Loki collector.",
        message_fields=("msg", "message", "log", "type", "path"),
        level_fields=("level", "detected_level", "severity"),
        status_fields=("status", "statusCode", "http.status_code", "http.response.status_code"),
        error_terms=("error", "exception", "failed", "timeout", "500", "blank"),
        backend_type="loki",
    ),
    "control-plane": LogSource(
        name="control-plane",
        console_source="control_plane",
        description="Control plane hosting activity logs from the console evidence API ES collector.",
        message_fields=("message", "log", "event", "msg"),
        level_fields=("level", "log.level", "severity"),
        status_fields=("status", "statusCode", "http.status_code", "http.response.status_code"),
        error_terms=("error", "exception", "failed", "timeout", "deploy", "publish"),
        backend_type="elasticsearch",
    ),

    "langfuse": LogSource(
        name="langfuse",
        console_source="langfuse",
        description="EB Langfuse traces and observations filtered by metadata.business_data_appId through the console evidence API.",
        message_fields=("message", "name", "event", "statusMessage", "output", "input"),
        level_fields=("level", "severity"),
        status_fields=("status", "statusCode", "http.status_code", "http.response.status_code"),
        error_terms=("error", "exception", "failed", "timeout", "tool", "generation"),
        backend_type="langfuse",
    ),

    "fullstory": LogSource(
        name="fullstory",
        console_source="fullstory",
        description="FullStory session replays discovered via hosted MCP server (build_segment + get_sessions + get_session_events) scoped to /develop/{appId}.",
        message_fields=("message", "event", "line"),
        level_fields=("level",),
        status_fields=("status",),
        error_terms=("rage", "dead-click", "error-click", "console-error", "feedback", "exception"),
        backend_type="fullstory",
    ),
}


def get_log_source(name: str) -> LogSource:
    try:
        return LOG_SOURCES[name]
    except KeyError as err:
        available = ", ".join(sorted(LOG_SOURCES))
        raise ValueError(f"Unknown log source {name!r}. Available: {available}") from err


@dataclass(frozen=True)
class Window:
    label: str
    start: str
    end: str
    hours: int


@dataclass(frozen=True)
class TimeBucket:
    label: str
    start: str
    end: str


def to_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def parse_window(raw: str | None, now: datetime | None = None) -> Window:
    now = now or datetime.now(timezone.utc)
    value = (raw or "24h").strip()
    match = re.match(r"^(\d+)([hd])$", value, re.I)
    if match:
        amount = int(match.group(1))
        hours = amount * 24 if match.group(2).lower() == "d" else amount
        return Window(value, to_iso(now - timedelta(hours=hours)), to_iso(now), hours)

    range_match = re.match(r"^([^,]+),([^,]+)$", value)
    if range_match:
        start = parse_iso(range_match.group(1).strip())
        end = parse_iso(range_match.group(2).strip())
        hours = max(1, int((end - start).total_seconds() // 3600))
        return Window("custom", to_iso(start), to_iso(end), hours)

    return parse_window("24h", now)


def build_time_buckets(window: Window, target_bucket_hours: int | None = None) -> list[TimeBucket]:
    start = parse_iso(window.start)
    end = parse_iso(window.end)
    if target_bucket_hours is None:
        if window.hours <= 24:
            target_bucket_hours = 1
        elif window.hours <= 72:
            target_bucket_hours = 3
        else:
            target_bucket_hours = 6

    buckets: list[TimeBucket] = []
    current = start
    index = 0
    step = timedelta(hours=max(1, target_bucket_hours))
    while current < end:
        nxt = min(current + step, end)
        buckets.append(TimeBucket(f"b{index:03d}", to_iso(current), to_iso(nxt)))
        current = nxt
        index += 1
    return buckets


def build_es_logs_path(source: LogSource, app_id: str, bucket: TimeBucket, size: int, offset: int, query: str | None = None) -> str:
    params = {
        "source": source.console_source,
        "size": str(size),
        "from": str(offset),
        "appId": app_id,
        "startTime": bucket.start,
        "endTime": bucket.end,
    }
    if query:
        params["query"] = query
    return f"/api/es-logs?{urllib.parse.urlencode(params)}"


def build_investigate_evidence_path(*, sources: list[LogSource], app_id: str, window: str) -> str:
    # The source/app/window contract is carried in the POST body; keep the path
    # fixed so the URL allowlist can remain simple and SSRF-resistant.
    return "/api/investigate-evidence"


def build_investigate_evidence_payload(
    sources: list[LogSource],
    app_id: str,
    window: str,
    *,
    fullstory_url: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "appId": app_id,
        "timeWindow": window,
        "sources": [source.console_source for source in sources],
    }
    if fullstory_url:
        payload["fullstoryUrl"] = fullstory_url
    return payload


def safe_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", value).strip("_").lower()


def compact_text(value: Any, limit: int = 160) -> str:
    text = "" if value is None else str(value)
    text = re.sub(r"\s+", " ", text).replace("|", " ").strip()
    return text[:limit]


def validate_console_base(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https":
        raise ValueError("CONSOLE_BASE must use https")
    if parsed.username or parsed.password:
        raise ValueError("CONSOLE_BASE must not include credentials")
    if parsed.hostname not in ALLOWED_CONSOLE_HOSTS:
        raise ValueError(f"CONSOLE_BASE host is not allowed: {parsed.hostname}")
    if parsed.path not in ("", "/") or parsed.params or parsed.query or parsed.fragment:
        raise ValueError("CONSOLE_BASE must be an origin only")
    if parsed.port is not None and parsed.port != 443:
        raise ValueError("CONSOLE_BASE must use the default https port")
    return f"https://{parsed.hostname}"


def build_console_url(base_url: str, path: str) -> str:
    if not path.startswith("/api/"):
        raise ValueError("console request path must start with /api/")
    parsed_path = urlparse(path)
    if parsed_path.scheme or parsed_path.netloc:
        raise ValueError("console request path must be relative")
    return f"{base_url}{path}"


def extract_logs(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, dict):
        logs = data.get("logs") or data.get("items") or data.get("results") or data.get("data")
        if isinstance(logs, list):
            return [item for item in logs if isinstance(item, dict)]
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    return []


def request_json(base_url: str, token: str, path: str, timeout: int) -> Any:
    req = urllib.request.Request(
        build_console_url(base_url, path),
        headers={"Authorization": f"Bearer {token}"},
    )
    # nosemgrep: godaddy.python.security.packages.ssrf, python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
    # URL is constrained by validate_console_base() and build_console_url(): only approved HTTPS console hosts and relative /api/ paths. CONSOLE_OPENER blocks redirects.
    with CONSOLE_OPENER.open(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json(base_url: str, token: str, path: str, payload: dict[str, Any], timeout: int) -> Any:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        build_console_url(base_url, path),
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    # nosemgrep: godaddy.python.security.packages.ssrf, python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
    # URL is constrained by validate_console_base() and build_console_url(): only approved HTTPS console hosts and relative /api/ paths. CONSOLE_OPENER blocks redirects.
    with CONSOLE_OPENER.open(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def split_bucket(bucket: TimeBucket) -> tuple[TimeBucket, TimeBucket] | None:
    start = parse_iso(bucket.start)
    end = parse_iso(bucket.end)
    seconds = int((end - start).total_seconds())
    if seconds <= 300:
        return None
    mid = start + timedelta(seconds=seconds // 2)
    return (
        TimeBucket(f"{bucket.label}a", bucket.start, to_iso(mid)),
        TimeBucket(f"{bucket.label}b", to_iso(mid), bucket.end),
    )


def fetch_bucket(
    source: LogSource,
    app_id: str,
    bucket: TimeBucket,
    base_url: str,
    token: str,
    out_dir: Path,
    page_size: int,
    timeout: int,
) -> tuple[list[dict[str, Any]], list[str], list[dict[str, Any]]]:
    offset = 0
    logs: list[dict[str, Any]] = []
    files: list[str] = []
    incomplete: list[dict[str, Any]] = []

    while True:
        path = build_es_logs_path(source, app_id, bucket, page_size, offset)
        page_index = offset // page_size
        output_file = out_dir / f"{bucket.label}-p{page_index:04d}.json"
        started = time.time()
        try:
            data = request_json(base_url, token, path, timeout)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as err:
            split = split_bucket(bucket)
            if split:
                # Pages already collected from this bucket before the failing
                # offset must be preserved — discarding them on recursive
                # split would silently drop everything from page 0..N-1
                # whenever page N hits a transient error.
                left_logs, left_files, left_incomplete = fetch_bucket(source, app_id, split[0], base_url, token, out_dir, page_size, timeout)
                right_logs, right_files, right_incomplete = fetch_bucket(source, app_id, split[1], base_url, token, out_dir, page_size, timeout)
                return logs + left_logs + right_logs, files + left_files + right_files, left_incomplete + right_incomplete
            incomplete.append({
                "bucket": bucket.label,
                "start": bucket.start,
                "end": bucket.end,
                "offset": offset,
                "error": compact_text(f"{type(err).__name__}: {err}", 240),
            })
            return logs, files, incomplete

        page_logs = extract_logs(data)
        output_file.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        files.append(str(output_file))
        logs.extend(page_logs)

        if len(page_logs) < page_size:
            break
        offset += page_size

        # Keep Lambda progress visible in stderr without adding model context.
        if offset % (page_size * 10) == 0:
            elapsed_ms = int((time.time() - started) * 1000)
            print(f"progress bucket={bucket.label} offset={offset} elapsedMs={elapsed_ms}", file=sys.stderr)

    return logs, files, incomplete


def build_index(
    source: LogSource,
    app_id: str,
    window: Window,
    buckets: list[TimeBucket],
    bucket_logs: dict[str, list[dict[str, Any]]],
    page_files: dict[str, list[str]],
    incomplete: list[dict[str, Any]],
) -> dict[str, Any]:
    total_logs = sum(len(logs) for logs in bucket_logs.values())
    level_counts: Counter[str] = Counter()
    status_counts: Counter[str] = Counter()
    signature_counts: Counter[str] = Counter()
    signature_refs: dict[str, str] = {}
    rare_errors: list[dict[str, Any]] = []
    bucket_rows: list[dict[str, Any]] = []

    for bucket in buckets:
        logs = bucket_logs.get(bucket.label, [])
        bucket_error_count = 0
        bucket_signature_counts: Counter[str] = Counter()
        for idx, log in enumerate(logs):
            level = source.level_for(log)
            level_counts[level] += 1
            code = source.status_for(log)
            if code:
                status_counts[code] += 1
            signature = source.signature_for(source.message_for(log))
            signature_counts[signature] += 1
            bucket_signature_counts[signature] += 1
            if signature not in signature_refs:
                signature_refs[signature] = f"{(page_files.get(bucket.label) or [''])[0]}#$.logs[{idx}]"
            if source.is_error(log):
                bucket_error_count += 1

        raw_refs = [f"{path}#$.logs[*]" for path in page_files.get(bucket.label, [])]
        bucket_rows.append({
            "bucket": bucket.label,
            "start": bucket.start,
            "end": bucket.end,
            "logCount": len(logs),
            "errorCount": bucket_error_count,
            "topSignatures": [
                {"signature": sig, "count": count, "rawRef": signature_refs.get(sig, "")}
                for sig, count in bucket_signature_counts.most_common(8)
            ],
            "rawRefs": raw_refs,
        })

    for signature, count in signature_counts.items():
        lower = signature.lower()
        if count <= 3 and any(term in lower for term in ("error", "exception", "failed", "typeerror", "referenceerror", "blank", " 4#", " 5#")):
            rare_errors.append({"signature": signature, "count": count, "rawRef": signature_refs.get(signature, "")})

    # Shape mirrors debug-console buildEvidenceIndex (evidence.ts) so phase
    # prompts can rely on the same fields whether the run came from the
    # console proxy or direct mode. Extras (statusCounts, buckets[],
    # bucketCount) are additive — console doesn't emit them but Claude
    # ignores fields it doesn't reference.
    return {
        "appId": app_id,
        "source": {
            "id": source.name,
            "name": source.name,
            "consoleSource": source.console_source,
            "backendType": source.backend_type,
            "description": source.description,
        },
        "window": {"label": window.label, "start": window.start, "end": window.end},
        "coverage": {
            "complete": len(incomplete) == 0,
            "bucketCount": len(buckets),
            "fetchedLogCount": total_logs,
            "incompleteBucketCount": len(incomplete),
            "incomplete": incomplete,
        },
        "diagnostics": {"truncated": False},
        "levelCounts": dict(level_counts.most_common()),
        "statusCounts": dict(status_counts.most_common()),
        "topSignatures": [
            {"signature": sig, "count": count, "rawRef": signature_refs.get(sig, "")}
            for sig, count in signature_counts.most_common(25)
        ],
        "rareErrorSignatures": rare_errors[:50],
        "buckets": bucket_rows,
    }


def render_toon(index: dict[str, Any], index_path: Path) -> str:
    lines = [
        "# airo_log_index",
        f"appId: {index['appId']}",
        f"source: {index['source']['name']} | console={index['source']['consoleSource']}",
        f"window: {index['window']['label']} | {index['window']['start']} -> {index['window']['end']}",
        f"indexFile: {index_path}",
        f"coverage: buckets={index['coverage']['bucketCount']} logs={index['coverage']['fetchedLogCount']} incomplete={index['coverage']['incompleteBucketCount']}",
        "",
        "buckets{bucket,start,end,logs,errors,rawRefs}:",
    ]
    for bucket in index["buckets"]:
        lines.append(
            f"  {bucket['bucket']}|{bucket['start']}|{bucket['end']}|{bucket['logCount']}|{bucket['errorCount']}|{len(bucket['rawRefs'])}"
        )
    lines.append("")
    lines.append("topSignatures{count,signature,rawRef}:")
    for row in index["topSignatures"][:15]:
        lines.append(f"  {row['count']}|{compact_text(row['signature'], 180)}|{row['rawRef']}")
    lines.append("")
    lines.append("rareErrorSignatures{count,signature,rawRef}:")
    for row in index["rareErrorSignatures"][:20]:
        lines.append(f"  {row['count']}|{compact_text(row['signature'], 180)}|{row['rawRef']}")
    if index["coverage"]["incomplete"]:
        lines.append("")
        lines.append("incomplete{bucket,start,end,offset,error}:")
        for row in index["coverage"]["incomplete"]:
            lines.append(f"  {row['bucket']}|{row['start']}|{row['end']}|{row['offset']}|{row['error']}")
    return "\n".join(lines)


def write_batched_evidence(data: dict[str, Any], out_dir: Path) -> list[Path]:
    index_paths: list[Path] = []
    sources = data.get("sources") if isinstance(data, dict) else None
    if not isinstance(sources, list):
        raise ValueError("Evidence response is missing sources[]")

    for source_result in sources:
        if not isinstance(source_result, dict):
            continue
        source_id = str(source_result.get("sourceId") or "unknown")
        source_dir = out_dir / safe_name(source_id)
        source_dir.mkdir(parents=True, exist_ok=True)

        raw_pages = source_result.get("rawPages") or []
        if isinstance(raw_pages, list):
            for page in raw_pages:
                if not isinstance(page, dict):
                    continue
                bucket = safe_name(str(page.get("bucket") or "b000")) or "b000"
                page_num = int(page.get("page") or 0)
                page_path = source_dir / f"{bucket}-p{page_num:04d}.json"
                page_path.write_text(json.dumps({"logs": page.get("logs") or []}, separators=(",", ":")), encoding="utf-8")

        index = source_result.get("index")
        if isinstance(index, dict):
            index_path = source_dir / "index.json"
            index_path.write_text(json.dumps(index, indent=2), encoding="utf-8")
            index_paths.append(index_path)

    bundle_path = out_dir / "evidence.json"
    bundle_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return index_paths


def render_batched_toon(data: dict[str, Any], index_paths: list[Path]) -> str:
    lines = [
        "# airo_evidence_bundle",
        f"appId: {data.get('appId', '')}",
        f"timeWindow: {data.get('timeWindow', '')}",
        f"complete: {data.get('complete', False)}",
        "sources{source,complete,logs,incomplete,indexFile}:",
    ]
    path_by_source = {path.parent.name: path for path in index_paths}
    for source in data.get("sources", []):
        if not isinstance(source, dict):
            continue
        index = source.get("index") if isinstance(source.get("index"), dict) else {}
        coverage = index.get("coverage", {}) if isinstance(index, dict) else {}
        source_id = str(source.get("sourceId") or index.get("source", {}).get("id", "unknown"))
        index_path = path_by_source.get(safe_name(source_id), "")
        lines.append(
            f"  {source_id}|{source.get('complete', False)}|{coverage.get('fetchedLogCount', 0)}|{coverage.get('incompleteBucketCount', 0)}|{index_path}"
        )
        for row in (index.get("rareErrorSignatures", []) if isinstance(index, dict) else [])[:5]:
            if isinstance(row, dict):
                lines.append(f"    rare|{row.get('count', 0)}|{compact_text(row.get('signature', ''), 160)}|{row.get('rawRef', '')}")
    return "\n".join(lines)


class BucketFailure:
    def __init__(self, future: Any, error: BaseException):
        self.future = future
        self.error = error


def collect_bucket_results(
    future_by_bucket: dict[Any, TimeBucket],
    completed_futures: Any,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, list[str]], list[dict[str, Any]]]:
    bucket_logs: dict[str, list[dict[str, Any]]] = {}
    page_files: dict[str, list[str]] = {}
    incomplete: list[dict[str, Any]] = []

    for future in completed_futures:
        bucket = future_by_bucket[future.future if isinstance(future, BucketFailure) else future]
        try:
            if isinstance(future, BucketFailure):
                raise future.error
            logs, files, failures = future.result()
        except Exception as err:  # noqa: BLE001 - preserve coverage if a worker crashes unexpectedly.
            bucket_logs[bucket.label] = []
            page_files[bucket.label] = []
            incomplete.append({
                "bucket": bucket.label,
                "start": bucket.start,
                "end": bucket.end,
                "offset": 0,
                "error": compact_text(f"{type(err).__name__}: {err}", 240),
            })
            continue
        bucket_logs[bucket.label] = logs
        page_files[bucket.label] = files
        incomplete.extend(failures)

    return bucket_logs, page_files, incomplete


# ---------------------------------------------------------------------------
# Direct evidence mode — bypasses debug-console; queries Loki / Langfuse / ES
# directly using credentials loaded from Secrets Manager by the Lambda handler.
# Activated when INVESTIGATION_DIRECT_MODE=true (source=feedback path only).
# Queries are identical to what debug-console's /api/investigate-evidence does.
# All sources fetched in parallel via ThreadPoolExecutor.
# ---------------------------------------------------------------------------

import base64 as _base64  # stdlib — imported here to avoid top-level name clash

_ES_PAGE_SIZE = 1000
# search_after has no result_window cap (unlike from+size, which dies past
# index.max_result_window default 10K). Still cap pages to bound memory and
# Lambda wall time on pathological queries — 50 pages × 1000 = 50K hits per
# source is ~50× the realistic per-app daily volume but well within RSS.
_ES_MAX_PAGES = 50
_FULLSTORY_MAX_SESSIONS = 3
_FULLSTORY_LIST_LIMIT = 10
_FULLSTORY_MAX_EVENT_LINES = 1000
_FULLSTORY_MCP_URL_DEFAULT = 'https://api.fullstory.com/mcp/fullstory'
_FULLSTORY_PAIN_PATTERN = re.compile(
    r'rage[-_ ]?click|dead[-_ ]?click|error[-_ ]?click|console-error|feedback|exception|uncaught|\berror\b',
    re.IGNORECASE,
)
_LANGFUSE_PAGE_SIZE = 100
_LANGFUSE_MAX_PAGES = 200
_LANGFUSE_DETAIL_BATCH = 20
_LANGFUSE_MAX_ELAPSED_S = 4 * 60  # 4-minute wall-clock budget, matching console
# Memory cap for accumulated trace bodies. Each trace can carry massive
# input/output strings (tool args, model completions); without this cap a
# noisy app will OOM the Lambda. 50 MiB is well above typical (a few KB per
# trace × few hundred traces) and far below /tmp + RSS headroom.
_LANGFUSE_MAX_DETAIL_BYTES = 50 * 1024 * 1024


# Pool size accommodates the worst-case concurrency burst: outer pool of 6
# (one per source) wraps an inner Loki pool of 8 + Langfuse detail pool of
# 20. Cap at 32 to leave headroom on Lambda's ENI without artificially
# serialising calls on hot hosts (Loki, ES). `maxsize` is per-host; the
# pool itself can hold an unbounded number of host connection pools.
_HTTP_POOL_MAXSIZE = 32

# Retry policy: 5 total tries with exponential backoff (urllib3 sleeps
# `backoff_factor * (2 ** retry_index)` seconds). 0.5 → 0.5s, 1s, 2s, 4s,
# 8s. respect_retry_after_header so 429 responses with Retry-After are
# honoured directly. Only retry idempotent verbs and explicit status codes.
_HTTP_RETRIES_TOTAL = 5
_HTTP_RETRIES_BACKOFF = 0.5
_HTTP_RETRY_STATUSES = frozenset((429, 500, 502, 503, 504))

# Module-level singletons. Built lazily on first use because
# _URLLIB3_AVAILABLE is checked once and the pool/retry config is identical
# across calls. Pool keeps TCP+TLS warm across the bursty bucket fan-out;
# without it every Loki bucket pays a fresh handshake (~80–90% of latency).
_HTTP: Any = None
_HTTP_RETRY: Any = None


# Allowlisted schemes for direct-mode HTTP. urllib's stdlib `urlopen` accepts
# `file://`, `ftp://`, etc. by default — a dynamic URL flowing into it can
# read arbitrary local files (Semgrep flags this as
# python.lang.security.audit.dynamic-urllib-use-detected). Every URL in this
# module is built from CDK-set env vars (LOKI_ENDPOINT,
# EB_LANGFUSE_BASE_URL, *_ES_ENDPOINT, FULLSTORY_MCP_URL) which are
# `https://` by configuration, but defense-in-depth: enforce scheme +
# netloc before handing the URL to urlopen so a corrupted env var cannot
# turn into a `file:///etc/passwd` read.
_DIRECT_HTTP_ALLOWED_SCHEMES = frozenset(("https",))


def _assert_http_url(url: str) -> None:
    """Raise on any URL that wouldn't pass an SSRF / scheme check.

    Constraints:
    - Scheme must be in the allowlist (https only — no http, file, ftp, ...)
    - netloc must be present (rules out `https:relative` or empty hosts)
    - No embedded credentials (rules out `https://attacker:x@host`)
    """
    parsed = urlparse(url)
    if parsed.scheme not in _DIRECT_HTTP_ALLOWED_SCHEMES:
        raise ValueError(
            f"Refusing to call URL with disallowed scheme {parsed.scheme!r}: {url}"
        )
    if not parsed.netloc:
        raise ValueError(f"Refusing to call URL with empty netloc: {url}")
    if parsed.username or parsed.password:
        raise ValueError("Refusing to call URL containing inline credentials")


def _get_http_pool() -> Any:
    """Lazy build the urllib3 PoolManager. Returns None if urllib3 missing."""
    global _HTTP, _HTTP_RETRY
    if not _URLLIB3_AVAILABLE:
        return None
    if _HTTP is not None:
        return _HTTP
    import certifi
    _HTTP_RETRY = Retry(
        total=_HTTP_RETRIES_TOTAL,
        connect=_HTTP_RETRIES_TOTAL,
        read=_HTTP_RETRIES_TOTAL,
        status=_HTTP_RETRIES_TOTAL,
        backoff_factor=_HTTP_RETRIES_BACKOFF,
        backoff_jitter=0.25,
        status_forcelist=list(_HTTP_RETRY_STATUSES),
        # GET/POST: GET is idempotent so always safe; POST is included
        # because Loki/ES/Langfuse query endpoints we POST to are read-only
        # by API contract. A retry never re-creates a write side effect.
        allowed_methods=frozenset(("GET", "POST")),
        respect_retry_after_header=True,
        raise_on_status=False,  # surface non-retryable failures via response, not exception
    )
    _HTTP = urllib3.PoolManager(
        maxsize=_HTTP_POOL_MAXSIZE,
        retries=_HTTP_RETRY,
        cert_reqs="CERT_REQUIRED",
        ca_certs=certifi.where(),
        # urllib3 supports gzip out of the box when the server sets
        # Content-Encoding; setting Accept-Encoding here makes it explicit
        # so servers that don't inspect the absence-of-header still send
        # compressed bodies.
        headers={"Accept-Encoding": "gzip, deflate"},
    )
    return _HTTP


def _request_via_pool(method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: int) -> Any:
    # Defense in depth: enforce https + non-empty netloc + no inline creds
    # for both transport branches. URL today is built from CDK env vars
    # (LOKI_ENDPOINT, EB_LANGFUSE_BASE_URL, *_ES_ENDPOINT) — but Semgrep
    # can't tell that, and a future caller could pass a tainted URL. The
    # check is O(microseconds) compared to the network round-trip.
    _assert_http_url(url)
    pool = _get_http_pool()
    if pool is None:
        # Fallback: stdlib urllib without retry/pool/gzip. Production has
        # urllib3 baked into the Dockerfile; this branch only matters for
        # local syntax-level test runs that don't `pip install` deps.
        # _assert_http_url above blocks file:// and any non-https scheme,
        # so urllib cannot be tricked into a local-file read or routed
        # through a credential-stuffed host. Semgrep can't trace through
        # the assertion (covered by AssertHttpUrlSsrfTest), so suppress
        # both the SSRF and dynamic-urllib-use rules at the call site.
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        # nosemgrep: godaddy.python.security.packages.ssrf
        req = urllib.request.Request(url, data=body, headers={**headers, **({"Content-Type": "application/json"} if body is not None else {})}, method=method)  # nosemgrep
        try:
            # noqa: S310 (Bandit) + nosemgrep below (Semgrep) — separate
            # tool suppressions; both required because both run in CI.
            # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
            # nosemgrep: godaddy.python.security.packages.ssrf
            with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310  # nosemgrep
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as err:
            raise RuntimeError(f"HTTP {err.code} from {url}: {err.read()[:200].decode(errors='replace')}") from err

    merged_headers = {**headers}
    if body is not None and "Content-Type" not in merged_headers:
        merged_headers["Content-Type"] = "application/json"
    try:
        resp = pool.request(method, url, body=body, headers=merged_headers, timeout=timeout, decode_content=True)
    except urllib3.exceptions.MaxRetryError as err:
        raise RuntimeError(f"HTTP retries exhausted for {url}: {err.reason}") from err
    except urllib3.exceptions.HTTPError as err:
        raise RuntimeError(f"HTTP error from {url}: {err}") from err
    if resp.status >= 400:
        # raise_on_status=False so we surface terminal failures here. Trim
        # body to keep stack-trace strings sane.
        body_preview = resp.data[:200].decode(errors="replace") if resp.data else ""
        raise RuntimeError(f"HTTP {resp.status} from {url}: {body_preview}")
    if not resp.data:
        return {}
    try:
        return json.loads(resp.data.decode("utf-8"))
    except json.JSONDecodeError as err:
        raise RuntimeError(f"Non-JSON response from {url}: {resp.data[:200].decode(errors='replace')}") from err


def _http_get_json(url: str, headers: dict[str, str], params: dict[str, str], timeout: int) -> Any:
    full_url = url + ("?" + urllib.parse.urlencode(params) if params else "")
    return _request_via_pool("GET", full_url, headers, None, timeout)


def _http_post_json(url: str, headers: dict[str, str], body: dict[str, Any], timeout: int) -> Any:
    data = json.dumps(body).encode()
    return _request_via_pool("POST", url, headers, data, timeout)


def _build_source_result(
    source_id: str,
    raw_pages: list[dict[str, Any]],
    complete: bool,
    incomplete: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Builds a source result in the format write_batched_evidence expects."""
    total_logs = sum(len(p.get("logs", [])) for p in raw_pages)
    return {
        "sourceId": source_id,
        "complete": complete,
        "index": {
            "source": {"id": source_id},
            "coverage": {
                "fetchedLogCount": total_logs,
                "incompleteBucketCount": len(incomplete or []),
                "incomplete": incomplete or [],
            },
            "rareErrorSignatures": [],
            "topSignatures": [],
            "buckets": [],
        },
        "rawPages": raw_pages,
    }


# ---- Loki ---------------------------------------------------------------

def _loki_env() -> str:
    return "prod" if (os.environ.get("ENVIRONMENT_NAME", "dev") == "prod") else "dev"


def _loki_merged_query(app_id: str) -> str:
    """Exact same merged Loki query as console's buildMergedLokiQuery (no cluster — Lambda doesn't resolve it)."""
    job_pattern = "airo-agents|airo-preview-application|airo-publish-application"
    env = _loki_env()
    return f'{{job=~"({job_pattern})",env="{env}"}} |= "\\"app_id\\":\\"{app_id}\\""'


# Loki API caps a single response at the `limit` query param (max 5000 in
# our cluster). Without continuation a noisy bucket silently drops every log
# past 5000. We page using direction=backward + shrinking `end` to the
# oldest ts_ns we've seen, capped at _LOKI_MAX_PAGES iterations per bucket
# to bound worst-case wall time. 5 pages × 5000 lines = 25K lines / bucket
# / source, which is far above realistic per-bucket volume but still
# bounded if the query becomes pathological.
_LOKI_BUCKET_LIMIT = 5000
_LOKI_MAX_PAGES = 5


def _fetch_loki_bucket(
    endpoint: str,
    api_key: str,
    query: str,
    bucket: "TimeBucket",
    per_bucket_timeout: int,
) -> tuple[str, list[dict[str, Any]], bool]:
    """Fetch one time bucket from Loki, paginating past the per-call limit.

    Returns (bucket_label, logs, ok). `ok` is True only when the bucket was
    fully drained (or the cap was reached cleanly); a transport error mid-
    pagination still returns whatever was collected so far with ok=False.
    """
    start_ns = int(parse_iso(bucket.start).timestamp() * 1_000_000_000)
    end_ns_initial = int(parse_iso(bucket.end).timestamp() * 1_000_000_000)
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    job_to_source = {
        "airo-agents": "airo-agents",
        "airo-preview-application": "airo-preview",
        "airo-publish-application": "airo-publish",
    }

    logs: list[dict[str, Any]] = []
    end_ns = end_ns_initial
    pages = 0
    try:
        while pages < _LOKI_MAX_PAGES:
            resp = _http_get_json(
                f"{endpoint}/loki/api/v1/query_range",
                headers,
                {"query": query, "start": str(start_ns), "end": str(end_ns),
                 "limit": str(_LOKI_BUCKET_LIMIT), "direction": "backward"},
                per_bucket_timeout,
            )
            page_lines = 0
            oldest_ts_ns: int | None = None
            for stream in resp.get("data", {}).get("result", []):
                stream_labels = stream.get("stream", {})
                job = stream_labels.get("job", "")
                for ts_str, line in stream.get("values", []):
                    page_lines += 1
                    try:
                        ts_ns = int(ts_str)
                    except (TypeError, ValueError):
                        ts_ns = end_ns
                    if oldest_ts_ns is None or ts_ns < oldest_ts_ns:
                        oldest_ts_ns = ts_ns
                    try:
                        parsed = json.loads(line)
                    except json.JSONDecodeError:
                        parsed = {"raw": line}
                    parsed["_loki_stream_job"] = job
                    parsed["_source_id"] = job_to_source.get(job, job)
                    logs.append(parsed)
            pages += 1
            # Done when this page didn't fill the limit (no more data) or we
            # somehow got an empty page (defensive — Loki shouldn't return 0
            # rows mid-pagination but if it does we'd otherwise loop forever).
            if page_lines < _LOKI_BUCKET_LIMIT or oldest_ts_ns is None:
                return bucket.label, logs, True
            # direction=backward: each subsequent page asks for entries
            # strictly older than the oldest we've seen. -1ns avoids re-
            # fetching the boundary entry. If this drops below start_ns, the
            # range is exhausted.
            next_end = oldest_ts_ns - 1
            if next_end <= start_ns:
                return bucket.label, logs, True
            end_ns = next_end
        # Hit page cap. Still mark ok=True — we've fetched _LOKI_MAX_PAGES *
        # _LOKI_BUCKET_LIMIT lines; calling this "incomplete" would spam the
        # warning section without being actionable. The caller may surface
        # via topSignatures if truncation matters.
        print(f"[direct] loki bucket {bucket.label} hit page cap ({_LOKI_MAX_PAGES} pages × {_LOKI_BUCKET_LIMIT})", file=sys.stderr)
        return bucket.label, logs, True
    except Exception as err:  # noqa: BLE001
        print(f"[direct] loki bucket {bucket.label} failed at page {pages}: {err}", file=sys.stderr)
        # Return what we collected — partial > nothing. Marking ok=False so
        # the bucket is recorded as incomplete in the index.
        return bucket.label, logs, False


def _fetch_loki_all_sources(
    app_id: str,
    window: "Window",
    bucket_hours: int | None,
    timeout: int,
) -> dict[str, dict[str, Any]]:
    """
    Fetches merged Loki logs for airo-agents / airo-preview / airo-publish
    using time-bucketed queries (same as console). Returns a dict of
    sourceId -> source_result, parallelised across buckets.
    """
    endpoint = os.environ.get("LOKI_ENDPOINT", "").rstrip("/")
    api_key = os.environ.get("LOKI_API_KEY", "")
    source_ids = ["airo-agents", "airo-preview", "airo-publish"]

    if not endpoint:
        empty = _build_source_result("", [], False, [{"bucket": "all", "start": window.start, "end": window.end, "error": "LOKI_ENDPOINT not set"}])
        return {sid: {**empty, "sourceId": sid} for sid in source_ids}

    buckets = build_time_buckets(window, bucket_hours)
    query = _loki_merged_query(app_id)
    per_bucket_timeout = max(10, timeout // max(len(buckets), 1))

    # Fetch all buckets in parallel
    all_pages_by_source: dict[str, list[dict[str, Any]]] = {sid: [] for sid in source_ids}
    incomplete_by_source: dict[str, list[dict[str, Any]]] = {sid: [] for sid in source_ids}

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(buckets), 8)) as pool:
        futures = {
            pool.submit(_fetch_loki_bucket, endpoint, api_key, query, bucket, per_bucket_timeout): bucket
            for bucket in buckets
        }
        for future in concurrent.futures.as_completed(futures):
            bucket = futures[future]
            try:
                label, logs, ok = future.result()
            except Exception as err:  # noqa: BLE001
                label, logs, ok = bucket.label, [], False
                print(f"[direct] loki bucket {label} unexpected error: {err}", file=sys.stderr)

            # Split merged logs by job → source
            job_to_source = {
                "airo-agents": "airo-agents",
                "airo-preview-application": "airo-preview",
                "airo-publish-application": "airo-publish",
            }
            if logs:
                by_source: dict[str, list[dict[str, Any]]] = {sid: [] for sid in source_ids}
                for log in logs:
                    sid = log.get("_source_id", "airo-agents")
                    if sid in by_source:
                        by_source[sid].append(log)
                for sid, source_logs in by_source.items():
                    if source_logs:
                        all_pages_by_source[sid].append({"bucket": label, "page": 0, "logs": source_logs})
            if not ok:
                for sid in source_ids:
                    incomplete_by_source[sid].append({
                        "bucket": label,
                        "start": bucket.start,
                        "end": bucket.end,
                        "error": "fetch failed",
                    })

    # Build rich index (topSignatures, rareErrorSignatures, buckets) for each
    # Loki source — same analysis as build_index — so Claude gets error signals
    # in the toon without reading raw pages first.
    results: dict[str, dict[str, Any]] = {}
    for sid in source_ids:
        pages = all_pages_by_source[sid]
        incomplete = incomplete_by_source[sid]
        # Reconstruct bucket_logs dict keyed by bucket label
        bucket_logs_map: dict[str, list[dict[str, Any]]] = {}
        for page in pages:
            bucket_label = page.get("bucket", "b000")
            bucket_logs_map.setdefault(bucket_label, []).extend(page.get("logs", []))
        # Build time-bucket list matching what we fetched
        fetched_buckets = build_time_buckets(window, bucket_hours)
        try:
            source_obj = get_log_source(sid)
            rich_index = build_index(
                source_obj, app_id, window, fetched_buckets,
                bucket_logs_map, {}, incomplete,
            )
        except Exception:  # noqa: BLE001 — fall back to minimal index if analysis fails
            backend = LOG_SOURCES[sid].backend_type if sid in LOG_SOURCES else "loki"
            rich_index = {
                "source": {"id": sid, "name": sid, "consoleSource": sid, "backendType": backend},
                "coverage": {
                    "complete": len(incomplete) == 0,
                    "fetchedLogCount": sum(len(v) for v in bucket_logs_map.values()),
                    "incompleteBucketCount": len(incomplete),
                    "incomplete": incomplete,
                },
                "diagnostics": {"truncated": False},
                "rareErrorSignatures": [],
                "topSignatures": [],
                "buckets": [],
            }
        results[sid] = {
            "sourceId": sid,
            "complete": len(incomplete) == 0,
            "index": rich_index,
            "rawPages": pages,
        }
    return results


# ---- EB Langfuse --------------------------------------------------------

def _fetch_langfuse_trace_detail(base_url: str, auth_header: str, trace_id: str, timeout: int) -> dict[str, Any] | None:
    try:
        return _http_get_json(f"{base_url}/api/public/traces/{trace_id}", {"Authorization": auth_header}, {}, timeout)
    except Exception:  # noqa: BLE001
        return None


def _fetch_langfuse_all(app_id: str, window: "Window", timeout: int) -> dict[str, Any]:
    """Full pagination of Langfuse EB traces matching appId, with per-trace detail fetch."""
    base_url = os.environ.get("EB_LANGFUSE_BASE_URL", "").rstrip("/")
    pub_key = os.environ.get("EB_LANGFUSE_PUBLIC_KEY", "")
    sec_key = os.environ.get("EB_LANGFUSE_SECRET_KEY", "")

    if not base_url or not pub_key or not sec_key:
        return _build_source_result("langfuse", [], False, [{"bucket": "all", "start": window.start, "end": window.end, "error": "EB_LANGFUSE_* vars not set"}])

    auth_header = "Basic " + _base64.b64encode(f"{pub_key}:{sec_key}".encode()).decode()
    headers = {"Authorization": auth_header}
    # Exact filter format from debug-console buildAppIdFilter
    app_id_filter = json.dumps([{
        "type": "stringObject",
        "column": "metadata",
        "key": "business_data_appId",
        "operator": "=",
        "value": app_id,
    }])

    page = 1
    total_pages = 1
    all_trace_ids: list[str] = []
    incomplete: list[dict[str, Any]] = []
    budget_start = time.time()

    while page <= total_pages and page <= _LANGFUSE_MAX_PAGES:
        if time.time() - budget_start > _LANGFUSE_MAX_ELAPSED_S:
            incomplete.append({"bucket": f"p{page:03d}", "start": window.start, "end": window.end, "error": f"4-minute budget exceeded after {page - 1} pages"})
            break
        try:
            resp = _http_get_json(
                f"{base_url}/api/public/traces",
                headers,
                {
                    "page": str(page),
                    "limit": str(_LANGFUSE_PAGE_SIZE),
                    "filter": app_id_filter,
                    "fromTimestamp": window.start,
                    "toTimestamp": window.end,
                },
                timeout,
            )
            data = resp.get("data", [])
            all_trace_ids.extend(t["id"] for t in data if isinstance(t, dict) and isinstance(t.get("id"), str))
            meta_pages = resp.get("meta", {}).get("totalPages", 1)
            total_pages = min(int(meta_pages), _LANGFUSE_MAX_PAGES)
            page += 1
        except Exception as err:  # noqa: BLE001
            incomplete.append({"bucket": f"p{page:03d}", "start": window.start, "end": window.end, "error": str(err)})
            break

    # Fetch trace details in parallel batches of 20 (exact same as console).
    # Stop accumulating once total serialized size exceeds the memory cap to
    # bound RSS on noisy apps. Outstanding futures still complete (their
    # results are just dropped) so we don't tear down the pool mid-flight.
    details: list[dict[str, Any]] = []
    accumulated_bytes = 0
    truncated = False
    with concurrent.futures.ThreadPoolExecutor(max_workers=_LANGFUSE_DETAIL_BATCH) as pool:
        for offset in range(0, len(all_trace_ids), _LANGFUSE_DETAIL_BATCH):
            if truncated:
                break
            batch = all_trace_ids[offset:offset + _LANGFUSE_DETAIL_BATCH]
            futures = [pool.submit(_fetch_langfuse_trace_detail, base_url, auth_header, tid, timeout) for tid in batch]
            for f in concurrent.futures.as_completed(futures):
                result = f.result()
                if not result:
                    continue
                if accumulated_bytes >= _LANGFUSE_MAX_DETAIL_BYTES:
                    if not truncated:
                        truncated = True
                        incomplete.append({
                            "bucket": "details",
                            "start": window.start,
                            "end": window.end,
                            "error": f"detail accumulation hit {_LANGFUSE_MAX_DETAIL_BYTES // (1024 * 1024)} MiB cap; remaining traces skipped",
                        })
                    continue
                # Approximate serialized size — json.dumps once per trace is
                # cheaper than rebuilding the whole list later just to size
                # it. This is bookkeeping only; the trace itself is stored
                # as the original dict so JSON roundtrip cost stays a one-off.
                try:
                    accumulated_bytes += len(json.dumps(result, separators=(",", ":")))
                except (TypeError, ValueError):
                    accumulated_bytes += 4096  # conservative fallback
                details.append(result)

    raw_pages = [{"bucket": "langfuse", "page": 0, "logs": details}] if details else []
    return _build_source_result("langfuse", raw_pages, len(incomplete) == 0, incomplete or None)


# ---- Elasticsearch ------------------------------------------------------

def _es_app_id_query(app_id: str, app_id_field: str) -> dict[str, Any]:
    """Builds exact same bool.should query as console's buildAppIdQuery for pipe-separated fields."""
    fields = app_id_field.split("|")
    if len(fields) == 1:
        return {"term": {fields[0]: app_id}}
    return {"bool": {"should": [{"term": {f: app_id}} for f in fields], "minimum_should_match": 1}}


def _fetch_es_paginated(
    endpoint: str,
    api_key: str,
    index: str,
    app_id_query: dict[str, Any],
    timestamp_field: str,
    start_iso: str,
    end_iso: str,
    source_id: str,
    timeout: int,
) -> dict[str, Any]:
    """Paginated ES fetch using search_after with a `_doc` tiebreaker.

    `from + size` is capped at `index.max_result_window` (default 10K) and
    silently 400s past it. `search_after` has no such cap — the cluster
    streams results in O(size) per page regardless of depth. Sort by
    timestamp asc with `_doc` asc as the tiebreaker so two hits sharing a
    timestamp still produce a stable ordering for cursor advance.
    """
    headers = {"Authorization": f"ApiKey {api_key}"}
    incomplete: list[dict[str, Any]] = []
    raw_pages: list[dict[str, Any]] = []
    page = 0
    last_sort: list[Any] | None = None

    while page < _ES_MAX_PAGES:
        es_query: dict[str, Any] = {
            "size": _ES_PAGE_SIZE,
            "sort": [{timestamp_field: {"order": "asc"}}, {"_doc": {"order": "asc"}}],
            "query": {"bool": {"must": [
                {"range": {timestamp_field: {"gte": start_iso, "lte": end_iso}}},
                app_id_query,
            ]}},
        }
        if last_sort is not None:
            es_query["search_after"] = last_sort
        try:
            resp = _http_post_json(
                f"{endpoint}/{index}/_search?ignore_unavailable=true&expand_wildcards=open",
                headers,
                es_query,
                timeout,
            )
        except Exception as err:  # noqa: BLE001
            incomplete.append({"bucket": f"es-p{page}", "start": start_iso, "end": end_iso, "error": str(err)})
            break

        hits = resp.get("hits", {}).get("hits", [])
        if not isinstance(hits, list):
            incomplete.append({"bucket": f"es-p{page}", "start": start_iso, "end": end_iso, "error": "hits.hits not array"})
            break
        page_logs = [h.get("_source", {}) for h in hits if isinstance(h, dict)]
        if page_logs:
            raw_pages.append({"bucket": f"es-p{page}", "page": page, "logs": page_logs})
        page += 1

        if len(hits) < _ES_PAGE_SIZE:
            break
        # Advance cursor to the last hit's sort tuple. If the last hit is
        # missing `sort` (shouldn't happen with explicit sort, but defend
        # anyway), terminate cleanly rather than infinite-loop.
        tail = hits[-1] if hits else None
        next_sort = tail.get("sort") if isinstance(tail, dict) else None
        if not isinstance(next_sort, list) or not next_sort:
            incomplete.append({"bucket": f"es-p{page}", "start": start_iso, "end": end_iso, "error": "missing sort tiebreaker on last hit"})
            break
        last_sort = next_sort

    if page >= _ES_MAX_PAGES:
        incomplete.append({"bucket": f"es-p{_ES_MAX_PAGES}", "start": start_iso, "end": end_iso, "error": f"hit page cap ({_ES_MAX_PAGES} × {_ES_PAGE_SIZE})"})

    return _build_source_result(source_id, raw_pages, len(incomplete) == 0, incomplete or None)


def _fetch_es_source(
    app_id: str,
    endpoint_env: str,
    api_key_env: str,
    index: str,
    app_id_field: str,
    source_id: str,
    start_iso: str,
    end_iso: str,
    timeout: int,
) -> dict[str, Any]:
    endpoint = os.environ.get(endpoint_env, "").rstrip("/")
    api_key = os.environ.get(api_key_env, "")
    if not endpoint or not api_key:
        return _build_source_result(source_id, [], False, [{"bucket": "all", "start": start_iso, "end": end_iso, "error": f"{endpoint_env} or {api_key_env} not set"}])
    app_id_query = _es_app_id_query(app_id, app_id_field)
    return _fetch_es_paginated(endpoint, api_key, index, app_id_query, "@timestamp", start_iso, end_iso, source_id, timeout)


def _es_control_plane_index() -> str:
    env = "prod" if (os.environ.get("ENVIRONMENT_NAME", "dev") == "prod") else "dev"
    if env == "prod":
        return "pagely-mgmt-worker-hosting-activity-prod,pagely-mgmt-worker-airo-activity-prod"
    return "pagely-mgmt-worker-hosting-activity-dev,pagely-mgmt-worker-airo-activity-dev"


# ---- FullStory MCP -------------------------------------------------------

def _fullstory_mcp_call(auth_header: str, mcp_url: str, tool_name: str, args: dict[str, Any], timeout: int) -> Any:
    """
    Calls a FullStory MCP tool via JSON-RPC 2.0.
    Handles both application/json and text/event-stream responses (same as console).
    Routes through the urllib3 pool so retries (429/5xx) and connection
    reuse apply to FullStory just like Loki/ES/Langfuse.
    """
    # mcp_url comes from FULLSTORY_MCP_URL env var (CDK-set, defaults to
    # api.fullstory.com). Defense-in-depth: block file:// + any non-https
    # scheme + inline creds before either transport branch even sees it.
    _assert_http_url(mcp_url)
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool_name, "arguments": args}}).encode()
    pool = _get_http_pool()
    headers = {
        "Authorization": auth_header,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if pool is None:
        # Stdlib fallback (test envs without urllib3 installed). Production
        # always has urllib3 — see Dockerfile.
        # _assert_http_url above already enforced scheme + netloc + creds.
        # Semgrep can't trace through the assertion (covered by
        # AssertHttpUrlSsrfTest); suppress both rules at the call site.
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        # nosemgrep: godaddy.python.security.packages.ssrf
        req = urllib.request.Request(mcp_url, data=body, headers=headers, method="POST")  # nosemgrep
        try:
            # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
            # nosemgrep: godaddy.python.security.packages.ssrf
            with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310  # nosemgrep
                raw = resp.read().decode()
        except urllib.error.HTTPError as err:
            raise RuntimeError(f"FullStory MCP HTTP {err.code}: {err.read()[:200].decode(errors='replace')}") from err
    else:
        try:
            resp = pool.request("POST", mcp_url, body=body, headers=headers, timeout=timeout, decode_content=True)
        except urllib3.exceptions.MaxRetryError as err:
            raise RuntimeError(f"FullStory MCP retries exhausted: {err.reason}") from err
        except urllib3.exceptions.HTTPError as err:
            raise RuntimeError(f"FullStory MCP transport error: {err}") from err
        if resp.status >= 400:
            preview = resp.data[:200].decode(errors="replace") if resp.data else ""
            raise RuntimeError(f"FullStory MCP HTTP {resp.status}: {preview}")
        raw = resp.data.decode("utf-8") if resp.data else ""

    # Handle SSE format: extract last data: line containing the JSON-RPC response
    text = raw
    if "data:" in raw:
        for line in reversed(raw.splitlines()):
            stripped = line.strip()
            if stripped.startswith("data:"):
                text = stripped[5:].strip()
                break

    try:
        rpc = json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError(f"FullStory MCP non-JSON response: {text[:200]}")

    if rpc.get("error"):
        err_obj = rpc["error"]
        raise RuntimeError(f"FullStory MCP tool {tool_name} failed: {err_obj.get('message', err_obj)}")

    # Extract text content from result
    content = rpc.get("result", {}).get("content", [])
    text_item = next((c for c in content if isinstance(c, dict) and c.get("type") == "text"), None)
    if not text_item:
        raise RuntimeError(f"FullStory MCP tool {tool_name} returned no text content")

    raw_text = text_item["text"]
    # Try JSON parse first (build_segment + get_sessions return JSON strings)
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        return raw_text  # get_session_events returns plain transcript text


def _parse_fullstory_url(url: str) -> dict[str, Any] | None:
    """Exact port of parseFullstorySessionUrl from console's fullstory-mcp-client.ts."""
    import re as _re
    try:
        from urllib.parse import urlparse as _urlparse, unquote as _unquote
        parsed = _urlparse(url)
        pathname = _unquote(parsed.path)
        match = _re.search(r'/(?:client-session|session)/([^/:?#]+):([^/:?#]+)(?::(\d+))?', pathname)
        if not match:
            return None
        device_id, session_id, anchor_raw = match.group(1), match.group(2), match.group(3)
        uuid_pat = _re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', _re.IGNORECASE)
        kind = 'uuid' if (uuid_pat.match(device_id) or uuid_pat.match(session_id)) else 'numeric'
        anchor_ms = int(anchor_raw) if anchor_raw and len(anchor_raw) >= 10 else None
        return {"deviceId": device_id, "sessionId": session_id, "kind": kind, "anchorEpochMs": anchor_ms}
    except Exception:  # noqa: BLE001
        return None


def _parse_event_line_offset(line: str, prev_offset: int) -> int:
    import re as _re
    abs_match = _re.match(r'^\s*\[(\d+):(\d{1,2})\]', line)
    if abs_match:
        return int(abs_match.group(1)) * 60 + int(abs_match.group(2))
    rel_match = _re.search(r'\(\+(\d+)s\)', line)
    if rel_match:
        return prev_offset + int(rel_match.group(1))
    return prev_offset


def _normalize_fullstory_events(session: dict[str, Any], events_text: str) -> list[dict[str, Any]]:
    """Port of normalizeFullstorySessionEvents — same event-line parsing, timestamp logic."""
    lines = [l.rstrip() for l in events_text.split('\n') if l.strip() and not l.startswith('#') and not l.startswith('<<<') and not l.startswith('>>>')]
    # Compute max offset to determine session start
    max_offset = 0
    cursor = 0
    for line in lines:
        cursor = _parse_event_line_offset(line, cursor)
        if cursor > max_offset:
            max_offset = cursor
    anchor_ms = session.get("anchorEpochMs")
    session_start_ms = (anchor_ms - max_offset * 1000) if anchor_ms else 0

    logs: list[dict[str, Any]] = []
    offset = 0
    for line in lines:
        offset = _parse_event_line_offset(line, offset)
        level = 'error' if _FULLSTORY_PAIN_PATTERN.search(line) else 'info'
        if level != 'error' and len(logs) >= _FULLSTORY_MAX_EVENT_LINES:
            continue
        ts = datetime.fromtimestamp((session_start_ms + offset * 1000) / 1000, tz=timezone.utc).isoformat()
        kind_match = re.search(r'\b(navigate|click|element-seen|rage-click|dead-click|error-click|console-error|feedback|page-view)\b', line, re.IGNORECASE)
        logs.append({
            "id": f"{session.get('sessionId', 'x')}-{offset}-{len(logs)}",
            "timestamp": ts,
            "level": level,
            "message": line.strip()[:500],
            "event": kind_match.group(1).lower() if kind_match else None,
            "sourceId": "fullstory",
            "raw": {
                "device_id": session.get("deviceId"),
                "session_id": session.get("sessionId"),
                "session_url": session.get("sessionUrl"),
                "offset_seconds": offset,
                "line": line.strip(),
            },
        })
    return logs


def _fetch_fullstory_all(app_id: str, window: "Window", fullstory_url: str | None, timeout: int) -> dict[str, Any]:
    """
    Exact port of collectFullstoryEvidence from console — same MCP tool sequence,
    same session limit, same UUID/numeric URL handling, same event transcript parsing.
    """
    api_key = os.environ.get("FULLSTORY_API_KEY", "")
    mcp_url = os.environ.get("FULLSTORY_MCP_URL", _FULLSTORY_MCP_URL_DEFAULT)
    window_start = window.start
    window_end = window.end

    if not api_key:
        return _build_source_result("fullstory", [], False, [{"bucket": "all", "start": window_start, "end": window_end, "error": "FULLSTORY_API_KEY not set"}])

    auth_header = f"Basic {api_key}"
    sessions: list[dict[str, Any]] = []
    incomplete: list[dict[str, Any]] = []
    notes: list[str] = []
    complete = True
    fell_back = False

    if fullstory_url:
        parsed = _parse_fullstory_url(fullstory_url)
        if not parsed:
            incomplete.append({"bucket": "url", "start": window_start, "end": window_end, "error": f"unparseable FullStory URL: {fullstory_url}"})
            complete = False
        elif parsed["kind"] == "uuid":
            notes.append(f"FullStory URL uses UUID client-session IDs (not resolvable via API); fell back to segment discovery for appId {app_id}")
            fell_back = True
        else:
            sessions.append({**parsed, "sessionUrl": fullstory_url})

    if not fullstory_url or fell_back:
        # FullStory segments query "users who visited ... in the last N days"
        # — N is anchored to *now*, not to the window's span. If the user
        # asks for a window that's 12h wide but starting 5 days ago, the
        # segment must look back 5+ days (else it misses the target). Cap
        # at 7 days to match FullStory retention defaults.
        now = datetime.now(timezone.utc)
        elapsed_ms = max(0, int((now - parse_iso(window.start)).total_seconds() * 1000))
        lookback_days = min(7, max(1, -(-elapsed_ms // (24 * 3600 * 1000))))  # ceiling div
        segment_query = f"users who visited a page containing /develop/{app_id} in the last {lookback_days} days"
        try:
            segment_name = f"airo-investigate-{app_id}-{int(time.time() * 1000)}"
            segment = _fullstory_mcp_call(auth_header, mcp_url, "build_segment", {"query": segment_query, "name": segment_name}, timeout)
            if not isinstance(segment, dict) or not segment.get("segment_id"):
                raise RuntimeError("build_segment returned no segment_id")
            session_list = _fullstory_mcp_call(auth_header, mcp_url, "get_sessions", {"segment_id": segment["segment_id"], "limit": _FULLSTORY_LIST_LIMIT}, timeout)
            # `get_sessions` should return a dict with a `sessions` array,
            # but the MCP wrapper has a transcript-string fallthrough. Guard
            # explicitly so a future protocol shift doesn't surface as
            # AttributeError("'str' object has no attribute 'get'").
            if not isinstance(session_list, dict):
                raise RuntimeError(f"get_sessions returned non-dict: {type(session_list).__name__}")
            sessions_field = session_list.get("sessions", [])
            found = sessions_field if isinstance(sessions_field, list) else []
            picked = found[:_FULLSTORY_MAX_SESSIONS]
            sessions.extend(picked)
            if len(found) > len(picked):
                notes.append(f"segment matched {len(found)} sessions; fetched the {len(picked)} most recent")
        except Exception as err:  # noqa: BLE001
            complete = False
            incomplete.append({"bucket": "discovery", "start": window_start, "end": window_end, "error": str(err)})

    if not sessions and complete:
        incomplete.append({"bucket": "discovery", "start": window_start, "end": window_end, "error": f"no FullStory sessions found for appId {app_id}"})
        complete = False

    # Fetch session events in parallel (same as console's Promise.all)
    raw_pages: list[dict[str, Any]] = []
    def _get_events(idx_session: tuple[int, dict[str, Any]]) -> tuple[int, dict[str, Any], list[dict[str, Any]], str | None]:
        idx, session = idx_session
        try:
            # FullStory MCP rejects numeric device_id/session_id values
            # ("expected string for device_id, got number:5.229e+15"). The
            # `get_sessions` API returns these IDs as integers — coerce to
            # string before forwarding so large numerics don't render in
            # scientific notation either.
            device_id_raw = session.get("deviceId") or session.get("device_id")
            session_id_raw = session.get("sessionId") or session.get("session_id")
            events_resp = _fullstory_mcp_call(
                auth_header, mcp_url, "get_session_events",
                {"device_id": str(device_id_raw) if device_id_raw is not None else None,
                 "session_id": str(session_id_raw) if session_id_raw is not None else None},
                timeout,
            )
            # `_fullstory_mcp_call` may return either a dict (JSON-RPC result)
            # or the raw transcript string. Hoist the type check once so we
            # don't risk calling `.get()` on a string further down.
            is_dict = isinstance(events_resp, dict)
            events_text = events_resp.get("events", "") if is_dict else (events_resp if isinstance(events_resp, str) else "")
            if not events_text:
                return idx, session, [], "empty events"
            resp_session_url = events_resp.get("session_url") if is_dict else None
            session_url = session.get("sessionUrl") or session.get("session_url") or resp_session_url
            merged = {**session, "sessionUrl": session_url}
            return idx, merged, _normalize_fullstory_events(merged, events_text), None
        except Exception as err:  # noqa: BLE001
            return idx, session, [], str(err)

    with concurrent.futures.ThreadPoolExecutor(max_workers=_FULLSTORY_MAX_SESSIONS) as pool:
        for idx, session, logs, error in pool.map(_get_events, enumerate(sessions)):
            bucket = f"s{str(idx + 1).zfill(2)}-{session.get('sessionId') or session.get('session_id', 'x')}"
            if error:
                complete = False
                incomplete.append({"bucket": bucket, "start": window_start, "end": window_end, "error": error})
            else:
                raw_pages.append({"page": idx, "bucket": bucket, "logs": logs})

    return _build_source_result("fullstory", raw_pages, complete, incomplete or None)


def _enrich_source_index(
    source_result: dict[str, Any],
    app_id: str,
    window: "Window",
) -> dict[str, Any]:
    """Mirror debug-console buildEvidenceIndex on a direct-mode source result.

    Loki sources are already enriched by `_fetch_loki_all_sources` because
    they're bucket-fetched. Langfuse/ES/FullStory take a flat path through
    `_build_source_result` that leaves `topSignatures`/`rareErrorSignatures`
    empty — Claude then has to fall back to scanning raw pages, burning
    turns. Re-running `build_index()` here produces the same shape every
    source has when the console proxy serves them, so phase-0/1 prompts
    can rely on `topSignatures + rawRefs` as the working surface.
    """
    source_id = source_result.get("sourceId") or ""
    if not source_id or source_id not in LOG_SOURCES:
        return source_result
    raw_pages = source_result.get("rawPages") or []
    if not raw_pages:
        # Nothing to index — preserve the empty-but-shaped index, just make
        # sure the source.id field is populated so downstream code can rely
        # on it.
        idx = source_result.get("index") or {}
        idx.setdefault("source", {}).setdefault("id", source_id)
        return source_result

    # Reconstruct bucket_logs / page_files maps in the shape build_index
    # expects. Non-Loki sources don't have time buckets so we synthesise a
    # single window-spanning bucket — that matches what the console returns
    # for non-bucketed sources.
    bucket_logs: dict[str, list[dict[str, Any]]] = {}
    page_files: dict[str, list[str]] = {}
    for page in raw_pages:
        bucket_label = str(page.get("bucket") or "all")
        bucket_logs.setdefault(bucket_label, []).extend(page.get("logs") or [])
        # Direct-mode pages don't carry a file path (they live in memory),
        # so emit a stable in-memory ref like `mem:<source>:<bucket>` that
        # the toon renderer can echo back to Claude.
        page_files.setdefault(bucket_label, []).append(f"mem:{source_id}:{bucket_label}")

    if not bucket_logs:
        return source_result

    bucket_list = [
        TimeBucket(label, window.start, window.end)
        for label in bucket_logs.keys()
    ]
    incomplete = source_result.get("index", {}).get("coverage", {}).get("incomplete") or []

    try:
        rich_index = build_index(
            LOG_SOURCES[source_id], app_id, window, bucket_list,
            bucket_logs, page_files, incomplete,
        )
    except Exception as err:  # noqa: BLE001 — fall back silently; caller still has rawPages
        print(f"[direct] index enrichment failed for {source_id}: {err}", file=sys.stderr)
        return source_result

    # Preserve the existing `complete` + `rawPages` from the source_result;
    # only the `index` shape is replaced.
    enriched = {**source_result, "index": rich_index}
    return enriched


def fetch_direct_evidence(app_id: str, window_label: str, fullstory_url: str | None, timeout: int) -> dict[str, Any]:
    """
    Builds an evidence bundle by querying Loki / EB Langfuse / ES directly.
    Exact same queries as debug-console /api/investigate-evidence.
    All sources fetched in parallel. Returns the same structure as the console
    endpoint so write_batched_evidence processes it unchanged.
    """
    window = parse_window(window_label)
    start_iso = window.start
    end_iso = window.end
    # 3h buckets: smaller than the console default to avoid Loki 502s on high-volume apps.
    # Same total log coverage — just more, smaller requests.
    bucket_hours = 3

    # Dispatch all independent sources in parallel (6 workers — one per source group)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        loki_future = pool.submit(_fetch_loki_all_sources, app_id, window, bucket_hours, timeout)
        langfuse_future = pool.submit(_fetch_langfuse_all, app_id, window, timeout)
        es_airo_future = pool.submit(
            _fetch_es_source, app_id,
            "AIRO_BUILDER_ES_ENDPOINT", "AIRO_BUILDER_ES_API_KEY",
            "logs-*", "data.appId", "airo-app-frontend",
            start_iso, end_iso, timeout,
        )
        es_cp_future = pool.submit(
            _fetch_es_source, app_id,
            "CONTROL_PLANE_ES_ENDPOINT", "CONTROL_PLANE_ES_API_KEY",
            _es_control_plane_index(), "app_id|appId_str", "control-plane",
            start_iso, end_iso, timeout,
        )
        fullstory_future = pool.submit(_fetch_fullstory_all, app_id, window, fullstory_url, timeout)

        loki_by_source = loki_future.result()
        langfuse_result = langfuse_future.result()
        es_airo_result = es_airo_future.result()
        es_cp_result = es_cp_future.result()
        fullstory_result = fullstory_future.result()

    # Loki sources are already bucket-indexed inside _fetch_loki_all_sources.
    # The remaining sources go through _build_source_result → empty index;
    # mirror console's buildEvidenceIndex so all 7 sources hand Claude the
    # same { topSignatures, rareErrorSignatures, levelCounts, rawRefs }
    # surface. Without this, phase-1 prompts make Claude fetch raw pages
    # for Langfuse/ES/FullStory, which is the path that burns turns.
    langfuse_result = _enrich_source_index(langfuse_result, app_id, window)
    es_airo_result = _enrich_source_index(es_airo_result, app_id, window)
    es_cp_result = _enrich_source_index(es_cp_result, app_id, window)
    fullstory_result = _enrich_source_index(fullstory_result, app_id, window)

    sources = [
        loki_by_source["airo-agents"],
        loki_by_source["airo-preview"],
        loki_by_source["airo-publish"],
        langfuse_result,
        es_airo_result,
        es_cp_result,
        fullstory_result,
    ]

    return {
        "appId": app_id,
        "timeWindow": window_label,
        "complete": all(s.get("complete", False) for s in sources),
        "sources": sources,
    }


def run(args: argparse.Namespace) -> int:
    direct_mode = os.environ.get("INVESTIGATION_DIRECT_MODE") == "true"

    if not direct_mode:
        token = os.environ.get("JOMAX_TOKEN")
        if not token:
            print("ERROR: JOMAX_TOKEN is required", file=sys.stderr)
            return 2

    window = parse_window(args.window)
    out_dir = Path(args.output_dir) / safe_name(args.appId)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.batched_evidence:
        if direct_mode:
            # feedback-source path: query Loki / Langfuse / ES directly
            try:
                data = fetch_direct_evidence(
                    args.appId, window.label, args.fullstory_url or None, args.timeout
                )
            except Exception as err:  # noqa: BLE001
                message = compact_text(f"{type(err).__name__}: {err}", 500)
                diagnostic = {"appId": args.appId, "timeWindow": window.label, "complete": False, "error": message, "sources": []}
                (out_dir / "evidence-error.json").write_text(json.dumps(diagnostic, indent=2), encoding="utf-8")
                print(f"ERROR: direct evidence collection failed: {message}", file=sys.stderr)
                return 1
        else:
            token = os.environ.get("JOMAX_TOKEN", "")
            base_url = validate_console_base(os.environ.get("CONSOLE_BASE", CONSOLE_BASE))
            sources = [get_log_source(name.strip()) for name in args.sources.split(",") if name.strip()]
            path = build_investigate_evidence_path(sources=sources, app_id=args.appId, window=window.label)
            payload = build_investigate_evidence_payload(
                sources, args.appId, window.label, fullstory_url=args.fullstory_url or None
            )
            try:
                data = post_json(base_url, token, path, payload, args.timeout)
            except Exception as err:  # noqa: BLE001 - report console/API failures without a raw traceback.
                message = compact_text(f"{type(err).__name__}: {err}", 500)
                diagnostic = {
                    "appId": args.appId,
                    "timeWindow": window.label,
                    "complete": False,
                    "error": message,
                    "sources": [source.console_source for source in sources],
                }
                (out_dir / "evidence-error.json").write_text(json.dumps(diagnostic, indent=2), encoding="utf-8")
                print(f"ERROR: batched evidence collection failed: {message}", file=sys.stderr)
                return 1

        index_paths = write_batched_evidence(data, out_dir)
        print(render_batched_toon(data, index_paths))
        incomplete = any(
            isinstance(source, dict) and not source.get("complete", False)
            for source in data.get("sources", [])
        )
        return 1 if incomplete and args.fail_on_incomplete else 0

    if direct_mode:
        # Direct mode only supports batched_evidence — non-batched per-source queries
        # are not implemented for the feedback fan-out path.
        print("ERROR: direct mode requires --batched-evidence (default)", file=sys.stderr)
        return 2

    base_url = validate_console_base(os.environ.get("CONSOLE_BASE", CONSOLE_BASE))
    token = os.environ.get("JOMAX_TOKEN", "")

    source = get_log_source(args.source)
    buckets = build_time_buckets(window, args.bucket_hours)

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        future_by_bucket = {
            pool.submit(fetch_bucket, source, args.appId, bucket, base_url, token, out_dir, args.page_size, args.timeout): bucket
            for bucket in buckets
        }
        bucket_logs, page_files, incomplete = collect_bucket_results(
            future_by_bucket,
            concurrent.futures.as_completed(future_by_bucket),
        )

    index = build_index(source, args.appId, window, buckets, bucket_logs, page_files, incomplete)
    index_path = out_dir / "index.json"
    index_path.write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(render_toon(index, index_path))
    return 1 if incomplete and args.fail_on_incomplete else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch and index all bounded airo-app logs for one app.")
    parser.add_argument("--appId", required=True)
    parser.add_argument("--source", default="airo-app-frontend", choices=sorted(LOG_SOURCES))
    parser.add_argument("--sources", default="airo-app-frontend,airo-agents,airo-preview,airo-publish,control-plane,langfuse,fullstory")
    parser.add_argument("--window", default="24h", help="24h, 7d, or startISO,endISO")
    parser.add_argument("--fullstory-url", default=None, help="Optional FullStory session URL forwarded to /api/investigate-evidence for exact session lookup")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--page-size", type=int, default=500)
    parser.add_argument("--bucket-hours", type=int, default=None)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=45)
    parser.add_argument("--fail-on-incomplete", action="store_true")
    parser.add_argument("--batched-evidence", action=argparse.BooleanOptionalAction, default=True)
    return run(parser.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
