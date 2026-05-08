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
    ),
    "airo-agents": LogSource(
        name="airo-agents",
        console_source="airo-agents",
        description="Airo agent service logs from the console evidence API Loki collector.",
        message_fields=("message", "msg", "log", "event", "type"),
        level_fields=("level", "detected_level", "severity"),
        status_fields=("status", "statusCode", "http.status_code", "http.response.status_code"),
        error_terms=("error", "exception", "failed", "timeout", "agent", "tool"),
    ),
    "airo-preview": LogSource(
        name="airo-preview",
        console_source="airo-preview",
        description="Preview application container logs from the console evidence API Loki collector.",
        message_fields=("msg", "message", "log", "type", "path"),
        level_fields=("level", "detected_level", "severity"),
        status_fields=("status", "statusCode", "http.status_code", "http.response.status_code"),
        error_terms=("error", "exception", "failed", "timeout", "500", "blank"),
    ),
    "airo-publish": LogSource(
        name="airo-publish",
        console_source="airo-publish",
        description="Published application container logs from the console evidence API Loki collector.",
        message_fields=("msg", "message", "log", "type", "path"),
        level_fields=("level", "detected_level", "severity"),
        status_fields=("status", "statusCode", "http.status_code", "http.response.status_code"),
        error_terms=("error", "exception", "failed", "timeout", "500", "blank"),
    ),
    "control-plane": LogSource(
        name="control-plane",
        console_source="control_plane",
        description="Control plane hosting activity logs from the console evidence API ES collector.",
        message_fields=("message", "log", "event", "msg"),
        level_fields=("level", "log.level", "severity"),
        status_fields=("status", "statusCode", "http.status_code", "http.response.status_code"),
        error_terms=("error", "exception", "failed", "timeout", "deploy", "publish"),
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


def build_investigate_evidence_payload(sources: list[LogSource], app_id: str, window: str) -> dict[str, Any]:
    return {
        "appId": app_id,
        "timeWindow": window,
        "sources": [source.console_source for source in sources],
    }


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
                left_logs, left_files, left_incomplete = fetch_bucket(source, app_id, split[0], base_url, token, out_dir, page_size, timeout)
                right_logs, right_files, right_incomplete = fetch_bucket(source, app_id, split[1], base_url, token, out_dir, page_size, timeout)
                return left_logs + right_logs, left_files + right_files, left_incomplete + right_incomplete
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

    return {
        "appId": app_id,
        "source": {
            "name": source.name,
            "consoleSource": source.console_source,
            "description": source.description,
        },
        "window": {"label": window.label, "start": window.start, "end": window.end},
        "coverage": {
            "bucketCount": len(buckets),
            "fetchedLogCount": total_logs,
            "incompleteBucketCount": len(incomplete),
            "incomplete": incomplete,
        },
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


def run(args: argparse.Namespace) -> int:
    token = os.environ.get("JOMAX_TOKEN")
    if not token:
        print("ERROR: JOMAX_TOKEN is required", file=sys.stderr)
        return 2

    window = parse_window(args.window)
    out_dir = Path(args.output_dir) / safe_name(args.appId)
    out_dir.mkdir(parents=True, exist_ok=True)
    base_url = validate_console_base(os.environ.get("CONSOLE_BASE", CONSOLE_BASE))

    if args.batched_evidence:
        sources = [get_log_source(name.strip()) for name in args.sources.split(",") if name.strip()]
        path = build_investigate_evidence_path(sources=sources, app_id=args.appId, window=window.label)
        payload = build_investigate_evidence_payload(sources, args.appId, window.label)
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
    parser.add_argument("--sources", default="airo-app-frontend,airo-agents,airo-preview,airo-publish,control-plane")
    parser.add_argument("--window", default="24h", help="24h, 7d, or startISO,endISO")
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
