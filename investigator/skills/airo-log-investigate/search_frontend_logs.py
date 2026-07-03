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
# warm across the 50+ requests a single Loki/ES collection makes,
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

# drain3 powers Stage-2 template mining: it clusters near-identical log lines
# (varying only in IDs/timestamps/numbers) into a single parameterised
# template, collapsing thousands of noisy lines into a handful of ranked
# patterns. Import is guarded so the test suite runs without it (drain3 is
# NOT installed locally); production has it via the M3.1 image. When absent,
# `mine_templates` falls back to the existing signature masker, which produces
# the same output shape (one entry per masked pattern).
try:  # pragma: no cover — import-time branching
    from drain3 import TemplateMiner
    _DRAIN3_AVAILABLE = True
except ImportError:  # pragma: no cover
    TemplateMiner = None  # type: ignore[assignment,misc]
    _DRAIN3_AVAILABLE = False


CONSOLE_BASE = "https://console.airo-builder.godaddy.com"
ALLOWED_CONSOLE_HOSTS = {
    "console.airo-builder.godaddy.com",
    "console.airo-builder.test-godaddy.com",
    "console.airo-builder.int.test-gdcorp.tools",
    "console.airo-builder.int.gdcorp.tools",
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
    # (loki | elasticsearch). Surfaced in the index
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
        description="Control plane hosting activity logs from the console evidence API Loki collector (plane=control).",
        message_fields=("message", "log", "event", "msg"),
        level_fields=("level", "detected_level", "log.level", "severity"),
        status_fields=("status", "statusCode", "http.status_code", "http.response.status_code"),
        error_terms=("error", "exception", "failed", "timeout", "deploy", "publish"),
        backend_type="loki",
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
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "appId": app_id,
        "timeWindow": window,
        "sources": [source.console_source for source in sources],
    }
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


def render_digest_toon(digest: dict[str, Any]) -> list[str]:
    """Render the Stage-2/3 digest as toon lines: aggregation histograms,
    then ranked templates with counts+examples, then verbatim rare errors.
    Emitted FIRST so the agent reads the distilled signal before raw pages.
    """
    aggregation = digest.get("aggregation") if isinstance(digest.get("aggregation"), dict) else {}
    templates = digest.get("templates") if isinstance(digest.get("templates"), list) else []
    rare_errors = digest.get("rareErrors") if isinstance(digest.get("rareErrors"), list) else []

    lines = ["# airo_log_digest"]
    if aggregation.get("error"):
        lines.append(f"aggregation: soft-fail ({compact_text(aggregation.get('error'), 160)})")
    lines.append(f"window: {aggregation.get('windowLabel', '')} | cluster={aggregation.get('cluster', '')}")

    level_hist = aggregation.get("levelHistogram") if isinstance(aggregation.get("levelHistogram"), dict) else {}
    lines.append("levelHistogram{level,count}:")
    for level, count in sorted(level_hist.items(), key=lambda kv: kv[1], reverse=True):
        lines.append(f"  {level}|{count}")

    by_service = aggregation.get("byService") if isinstance(aggregation.get("byService"), dict) else {}
    lines.append("byService{service,level,count}:")
    for service, levels in by_service.items():
        if not isinstance(levels, dict):
            continue
        for level, count in sorted(levels.items(), key=lambda kv: kv[1], reverse=True):
            lines.append(f"  {service}|{level}|{count}")

    lines.append("templates{count,sourceId,template,example}:")
    for row in templates:
        if not isinstance(row, dict):
            continue
        examples = row.get("examples") if isinstance(row.get("examples"), list) else []
        example = compact_text(examples[0], 160) if examples else ""
        lines.append(
            f"  {row.get('count', 0)}|{row.get('sourceId', '')}|{compact_text(row.get('template', ''), 180)}|{example}"
        )

    lines.append("rareErrors{count,sourceId,signature,rawRef}:")
    for row in rare_errors:
        if not isinstance(row, dict):
            continue
        lines.append(
            f"  {row.get('count', 0)}|{row.get('sourceId', '')}|{compact_text(row.get('signature', ''), 160)}|{row.get('rawRef', '')}"
        )
    lines.append("")
    return lines


def render_batched_toon(data: dict[str, Any], index_paths: list[Path]) -> str:
    lines: list[str] = []
    digest = data.get("digest")
    if isinstance(digest, dict):
        # Digest first: the agent reads the distilled aggregation + templates
        # + rare errors before the per-source detail below.
        lines.extend(render_digest_toon(digest))
    lines.extend([
        "# airo_evidence_bundle",
        f"appId: {data.get('appId', '')}",
        f"timeWindow: {data.get('timeWindow', '')}",
        f"complete: {data.get('complete', False)}",
        "sources{source,complete,logs,incomplete,indexFile}:",
    ])
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
# Direct evidence mode — bypasses debug-console; queries Loki / ES
# directly using credentials loaded from Secrets Manager by the Lambda handler.
# Activated when INVESTIGATION_DIRECT_MODE=true (source=feedback path only).
# Queries are identical to what debug-console's /api/investigate-evidence does.
# All sources fetched in parallel via ThreadPoolExecutor.
# ---------------------------------------------------------------------------

_ES_PAGE_SIZE = 1000
# search_after has no result_window cap (unlike from+size, which dies past
# index.max_result_window default 10K). Still cap pages to bound memory and
# Lambda wall time on pathological queries — 50 pages × 1000 = 50K hits per
# source is ~50× the realistic per-app daily volume but well within RSS.
_ES_MAX_PAGES = 50


# Pool size accommodates the worst-case concurrency burst: outer pool of 4
# (one per source) wraps an inner Loki pool of 8. Cap at 32 to leave
# headroom on Lambda's ENI without artificially serialising calls on hot
# hosts (Loki, ES). `maxsize` is per-host; the pool itself can hold an
# unbounded number of host connection pools.
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
# *_ES_ENDPOINT) which are
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
        # because Loki/ES query endpoints we POST to are read-only by API
        # contract. A retry never re-creates a write side effect.
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
    # (LOKI_ENDPOINT, *_ES_ENDPOINT) — but Semgrep
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


# Structured-metadata rollout boundary. Before this instant, `app_id` is only
# present as a JSON substring on the log line, so windows that start earlier
# must fall back to the legacy `|=` line match. At/after it, `app_id` is
# indexed as structured metadata and queried with the post-pipe `| app_id="…"`
# label filter. Placeholder/configurable — adjust when the real cutover lands.
LOKI_STRUCTURED_METADATA_CUTOVER = "2026-06-01T00:00:00Z"


def _loki_selector(
    plane: str,
    app_id: str,
    env: str,
    *,
    cluster: str | None = None,
    service_name_re: str | None = None,
    use_structured_metadata: bool = True,
) -> str:
    """Build a Loki query for the given plane scoped by cluster + service_name.

    cluster + service_name are the LABELS that prune chunks; without them the
    selector scans every plane stream (~386 GiB/hr in prod). `app_id` is
    structured metadata (a post-pipe label filter), NOT a stream label — it
    does not prune chunks, so it never substitutes for the label scoping. When
    `use_structured_metadata` is False (windows before the cutover) we fall
    back to the legacy JSON line-substring match.
    """
    labels = [f'env="{env}"', f'plane="{plane}"']
    if cluster:
        labels.append(f'cluster="{cluster}"')
    if service_name_re:
        labels.append(f'service_name=~"{service_name_re}"')
    sel = "{" + ",".join(labels) + "}"
    if use_structured_metadata:
        return f'{sel} | app_id="{app_id}"'
    return f'{sel} |= "\\"app_id\\":\\"{app_id}\\""'


# Data-plane service_name stream label → investigator source id. Control-plane
# streams carry plane="control" (no airo-* service_name) and route to
# `control-plane`. Any unrecognised data-plane stream defaults to airo-agents
# so a renamed/extra service never silently drops its lines.
_LOKI_SERVICE_TO_SOURCE = {
    "airo-agents": "airo-agents",
    "airo-preview-application": "airo-preview",
    "airo-publish-application": "airo-publish",
}


def _loki_service_to_source(service_name: str, plane: str = "") -> str:
    if plane == "control":
        return "control-plane"
    return _LOKI_SERVICE_TO_SOURCE.get(service_name, "airo-agents")


def _use_structured_metadata(window: "Window") -> bool:
    """Structured metadata only for windows starting at/after the cutover.

    ISO-8601 UTC strings (`…Z`, millisecond precision) compare correctly as
    plain strings, but parse both sides defensively so a differing precision
    or offset can't flip the comparison.
    """
    try:
        return parse_iso(window.start) >= parse_iso(LOKI_STRUCTURED_METADATA_CUTOVER)
    except (ValueError, TypeError):
        # If the window start is unparseable, prefer the safe legacy match
        # rather than risk an empty structured-metadata result.
        return False


# Loki direct-mode pagination knobs. Loki's /query_range caps a single
# response at the `limit` query param (cluster-side max is _LOKI_BUCKET_LIMIT
# below); without continuation a noisy bucket silently drops every entry
# past that cap. We paginate with direction=backward + shrinking `end` to
# the oldest ts_ns seen so far, bounded by both _LOKI_MAX_PAGES (line
# ceiling = _LOKI_MAX_PAGES × _LOKI_BUCKET_LIMIT lines per bucket for the
# merged 3-job query) and _LOKI_PER_BUCKET_BUDGET_S (wall-clock ceiling
# regardless of page count). The two ceilings together keep one slow or
# pathological bucket from starving Lambda's MAX_RUN_MS even on degraded
# upstream days. Worst-case Loki-section wall-clock is
# `ceil(buckets / max_workers=8) × _LOKI_PER_BUCKET_BUDGET_S` — at 24h /
# 1h buckets that's 3 × 200s = 600s, leaving ≥240s headroom against
# Lambda's 840s MAX_RUN_MS for downstream analysis. Typical bucket
# finishes in 1–2 pages (~15s).
_LOKI_BUCKET_LIMIT = 5000
_LOKI_MAX_PAGES = 12
_LOKI_PER_PAGE_TIMEOUT_S = 45
_LOKI_PER_BUCKET_BUDGET_S = 200


def _fetch_loki_bucket(
    endpoint: str,
    api_key: str,
    query: str,
    bucket: "TimeBucket",
    per_page_timeout: int = _LOKI_PER_PAGE_TIMEOUT_S,
    per_bucket_budget: int = _LOKI_PER_BUCKET_BUDGET_S,
) -> tuple[str, list[dict[str, Any]], bool]:
    """Fetch one time bucket from Loki, paginating past the per-call limit.

    Returns (bucket_label, logs, ok). `ok` is True only when the bucket was
    fully drained; transport errors, the per-bucket time budget being
    exhausted mid-pagination, and the page cap all return ok=False so the
    caller records an incomplete-coverage entry.
    """
    start_ns = int(parse_iso(bucket.start).timestamp() * 1_000_000_000)
    end_ns_initial = int(parse_iso(bucket.end).timestamp() * 1_000_000_000)
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    logs: list[dict[str, Any]] = []
    end_ns = end_ns_initial
    pages = 0
    deadline = time.monotonic() + max(1, per_bucket_budget)
    try:
        while pages < _LOKI_MAX_PAGES:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                print(
                    f"[direct] loki bucket {bucket.label} hit per-bucket budget "
                    f"({per_bucket_budget}s) at page {pages}",
                    file=sys.stderr,
                )
                return bucket.label, logs, False
            page_timeout = max(5, min(per_page_timeout, int(remaining)))
            resp = _http_get_json(
                f"{endpoint}/loki/api/v1/query_range",
                headers,
                {"query": query, "start": str(start_ns), "end": str(end_ns),
                 "limit": str(_LOKI_BUCKET_LIMIT), "direction": "backward"},
                page_timeout,
            )
            page_lines = 0
            oldest_ts_ns: int | None = None
            for stream in resp.get("data", {}).get("result", []):
                stream_labels = stream.get("stream", {})
                # Source splitting keys off the `service_name` stream label
                # (the data-plane discriminator) plus `plane` for control-plane
                # streams, since those have no airo-* service_name. `job` is no
                # longer reliable under the structured-metadata schema.
                service_name = stream_labels.get("service_name", "")
                plane = stream_labels.get("plane", "")
                source_id = _loki_service_to_source(service_name, plane)
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
                    parsed["_loki_service_name"] = service_name
                    parsed["_source_id"] = source_id
                    logs.append(parsed)
            pages += 1
            # Page didn't fill the limit (or returned nothing) → bucket fully
            # drained. The empty-page guard avoids an infinite loop if Loki
            # ever returns 0 rows mid-pagination.
            if page_lines < _LOKI_BUCKET_LIMIT or oldest_ts_ns is None:
                return bucket.label, logs, True
            # direction=backward: ask for entries strictly older than the
            # oldest seen. -1ns avoids re-fetching the boundary entry.
            next_end = oldest_ts_ns - 1
            if next_end <= start_ns:
                return bucket.label, logs, True
            end_ns = next_end
        # Page cap reached with `page_lines == _LOKI_BUCKET_LIMIT` on the
        # last iteration → there's more data we didn't fetch. Return
        # ok=False so the index marks the bucket incomplete and consumers
        # know coverage is truncated.
        print(
            f"[direct] loki bucket {bucket.label} hit page cap "
            f"({_LOKI_MAX_PAGES} pages × {_LOKI_BUCKET_LIMIT})",
            file=sys.stderr,
        )
        return bucket.label, logs, False
    except Exception as err:  # noqa: BLE001
        print(f"[direct] loki bucket {bucket.label} failed at page {pages}: {err}", file=sys.stderr)
        return bucket.label, logs, False


# Data-plane service_name selector. db-init / pre-start are short-lived
# startup containers whose failures often explain a missing app, so they're
# included alongside the three long-lived services.
_LOKI_DATA_PLANE_SERVICE_RE = "airo-(agents|preview-application|publish-application|db-init|pre-start)"


def _fetch_loki_all_sources(
    app_id: str,
    window: "Window",
    bucket_hours: int | None,
    timeout: int,  # noqa: ARG001 — kept for caller-signature parity; Loki uses its own constants
) -> dict[str, dict[str, Any]]:
    """
    Fetches merged Loki logs for the data plane (airo-agents / airo-preview /
    airo-publish, split by service_name) and the control plane
    (plane="control"), using time-bucketed, cluster-scoped queries. Returns a
    dict of sourceId -> source_result (including `control-plane`), parallelised
    across (bucket × plane) fetches.

    cluster + service_name LABELS are mandatory for cost/correctness: without
    `cluster` the data-plane selector scans ~386 GiB/hr instead of ~1.5 GiB/hr.
    When LOKI_CLUSTER is unset we DEGRADE — return empty-but-shaped incomplete
    results for every source — rather than issue an unbounded scan.
    """
    del timeout  # ES still uses it; Loki has its own budget
    endpoint = os.environ.get("LOKI_ENDPOINT", "").rstrip("/")
    api_key = os.environ.get("LOKI_API_KEY", "")
    env = _loki_env()
    cluster = os.environ.get("LOKI_CLUSTER") or None
    source_ids = ["airo-agents", "airo-preview", "airo-publish", "control-plane"]

    def _all_incomplete(reason: str) -> dict[str, dict[str, Any]]:
        empty = _build_source_result(
            "", [], False,
            [{"bucket": "all", "start": window.start, "end": window.end, "error": reason}],
        )
        return {sid: {**empty, "sourceId": sid} for sid in source_ids}

    if not endpoint:
        return _all_incomplete("LOKI_ENDPOINT not set")

    if not cluster:
        # Mandatory label scoping is missing — refuse to run an unbounded scan.
        print(
            "[direct] LOKI_CLUSTER unset — skipping Loki fetch to avoid an "
            "unbounded cross-cluster scan; sources marked incomplete",
            file=sys.stderr,
        )
        return _all_incomplete("LOKI_CLUSTER not set — Loki fetch skipped (would be unbounded)")

    buckets = build_time_buckets(window, bucket_hours)
    use_sm = _use_structured_metadata(window)
    # Two merged queries: data-plane (service_name-scoped) and control-plane
    # (plane="control"). Data-plane is cluster-scoped (mandatory — without it
    # the selector scans ~386 GiB/hr). Control-plane streams have no `cluster`
    # label, so passing cluster here would silently drop all results (verified:
    # mgmt-api-airo-go has no cluster label and is completely excluded when
    # cluster is set, hiding publish-workflow events from investigations).
    data_query = _loki_selector(
        "data", app_id, env,
        cluster=cluster, service_name_re=_LOKI_DATA_PLANE_SERVICE_RE,
        use_structured_metadata=use_sm,
    )
    control_query = _loki_selector(
        "control", app_id, env,
        cluster=None,
        use_structured_metadata=use_sm,
    )
    # Loki uses its own per-page timeout / per-bucket budget (constants
    # above). The shared `timeout` arg drives ES only.

    all_pages_by_source: dict[str, list[dict[str, Any]]] = {sid: [] for sid in source_ids}
    incomplete_by_source: dict[str, list[dict[str, Any]]] = {sid: [] for sid in source_ids}

    # One unit of work per (query, bucket). Source splitting happens after the
    # fetch via each log's `_source_id` (derived from service_name / plane in
    # _fetch_loki_bucket), so the two queries' results merge cleanly.
    fetch_units = [
        (q, bucket)
        for q in (data_query, control_query)
        for bucket in buckets
    ]

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(fetch_units), 8)) as pool:
        futures = {
            pool.submit(_fetch_loki_bucket, endpoint, api_key, query, bucket,
                        _LOKI_PER_PAGE_TIMEOUT_S, _LOKI_PER_BUCKET_BUDGET_S): bucket
            for (query, bucket) in fetch_units
        }
        for future in concurrent.futures.as_completed(futures):
            bucket = futures[future]
            try:
                label, logs, ok = future.result()
            except Exception as err:  # noqa: BLE001
                label, logs, ok = bucket.label, [], False
                print(f"[direct] loki bucket {label} unexpected error: {err}", file=sys.stderr)

            # Split merged logs by service_name/plane → source (tagged upstream
            # as `_source_id`).
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


# ---- Loki Stage-1 aggregation -------------------------------------------
# Server-side level/service histogram via Loki metric queries. Computed with
# `count_over_time` rolled up by `sum by (service_name, detected_level)` so the
# digest is a handful of numbers, NOT a raw-line pull. Same mandatory
# cluster + service_name label scoping as the bucket fetch (without `cluster`
# the data-plane query scans ~386 GiB/hr) — when `cluster` is unset we DEGRADE
# to a shaped soft-fail rather than issue an unbounded scan.

# Instant-query time format. The range fetch (`_fetch_loki_bucket`) builds
# start/end as nanosecond-epoch strings (`int(ts.timestamp() * 1e9)`). Reuse
# that exact format for the instant query's `time` param so both Loki paths
# speak the same dialect.
def _loki_ns(iso: str) -> str:
    return str(int(parse_iso(iso).timestamp() * 1_000_000_000))


def _loki_agg_query(
    plane: str,
    app_id: str,
    env: str,
    window_s: str,
    *,
    cluster: str | None,
    service_name_re: str | None = None,
) -> str:
    """Instant-query LogQL: per (service_name, detected_level) line counts.

    `window_s` is a LogQL duration (e.g. "1h"/"24h") covering the whole
    window. Reuses `_loki_selector` for the inner stream selector so the
    cluster + service_name label scoping (and the structured-metadata vs
    legacy app_id filter) stays identical to the raw-bucket path.
    """
    selector = _loki_selector(
        plane, app_id, env,
        cluster=cluster, service_name_re=service_name_re,
    )
    return (
        f"sum by (service_name, detected_level) "
        f"(count_over_time({selector}[{window_s}]))"
    )


def _parse_loki_agg(resp: Any) -> dict[tuple[str, str], int]:
    """Parse a Loki instant-query metric response into a (service, level) map.

    Reads `resp["data"]["result"][].metric` (service_name / detected_level,
    missing → "unknown") and `value[1]` (string int). Defensive: any missing
    key or unparseable value skips that series rather than throwing.
    """
    out: dict[tuple[str, str], int] = {}
    if not isinstance(resp, dict):
        return out
    result = field_value(resp, "data.result")
    if not isinstance(result, list):
        return out
    for series in result:
        if not isinstance(series, dict):
            continue
        metric = series.get("metric")
        metric = metric if isinstance(metric, dict) else {}
        service_name = str(metric.get("service_name") or "unknown")
        detected_level = str(metric.get("detected_level") or "unknown")
        value = series.get("value")
        if not isinstance(value, (list, tuple)) or len(value) < 2:
            continue
        try:
            count = int(value[1])
        except (TypeError, ValueError):
            continue
        out[(service_name, detected_level)] = out.get((service_name, detected_level), 0) + count
    return out


def _agg_soft_fail(window: "Window", cluster: str | None, reason: str) -> dict[str, Any]:
    return {
        "levelHistogram": {},
        "byService": {},
        "windowLabel": window.label,
        "cluster": cluster,
        "error": reason,
    }


def _collect_aggregation(
    app_id: str,
    window: "Window",
    env: str,
    cluster: str | None,
    timeout: int,
) -> dict[str, Any]:
    """Run the Stage-1 data-plane + control-plane Loki aggregations.

    Returns a compact digest: a level histogram (summed across services) and a
    per-service breakdown. The data-plane sub-query is cluster-scoped (an unset
    cluster soft-fails rather than issue an unbounded scan). The control-plane
    sub-query is intentionally not cluster-scoped — control-plane streams carry
    no cluster label, so adding one silently drops all results. Any error in
    either sub-query returns a shaped soft-fail (`error` key, empty maps) and
    never throws.
    """
    endpoint = os.environ.get("LOKI_ENDPOINT", "").rstrip("/")
    if not endpoint:
        return _agg_soft_fail(window, cluster, "LOKI_ENDPOINT not set")
    if not cluster:
        return _agg_soft_fail(
            window, cluster,
            "LOKI_CLUSTER not set — aggregation skipped (would be unbounded)",
        )

    api_key = os.environ.get("LOKI_API_KEY", "")
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Window span as a LogQL range-vector duration. `window.hours` is always
    # ≥1 (parse_window floors at 1), so this is a valid duration.
    window_s = f"{max(1, window.hours)}h"
    time_ns = _loki_ns(window.end)
    url = f"{endpoint}/loki/api/v1/query"

    data_query = _loki_agg_query(
        "data", app_id, env,
        window_s, cluster=cluster, service_name_re=_LOKI_DATA_PLANE_SERVICE_RE,
    )
    control_query = _loki_agg_query(
        "control", app_id, env, window_s, cluster=None,
    )

    try:
        combined: dict[tuple[str, str], int] = {}
        for query in (data_query, control_query):
            resp = _http_get_json(url, headers, {"query": query, "time": time_ns}, timeout)
            for key, count in _parse_loki_agg(resp).items():
                combined[key] = combined.get(key, 0) + count
    except Exception as err:  # noqa: BLE001 — soft-fail; never break the bundle
        print(f"[direct] loki aggregation failed: {err}", file=sys.stderr)
        return _agg_soft_fail(window, cluster, compact_text(f"{type(err).__name__}: {err}", 240))

    level_histogram: dict[str, int] = {}
    by_service: dict[str, dict[str, int]] = {}
    for (service_name, level), count in combined.items():
        level_histogram[level] = level_histogram.get(level, 0) + count
        service_levels = by_service.setdefault(service_name, {})
        service_levels[level] = service_levels.get(level, 0) + count

    return {
        "levelHistogram": level_histogram,
        "byService": by_service,
        "windowLabel": window.label,
        "cluster": cluster,
    }


# ---- Stage-2/3 template mining + digest ---------------------------------
# Stage 2 mines log templates (drain3 in prod, signature-masker fallback in
# test/local) so a noisy app's thousands of error lines collapse into a
# handful of ranked patterns. Stage 3 combines the Stage-1 aggregation
# histogram, those mined templates, and the verbatim rare-error signatures
# into one compact digest the agent reads FIRST — before any raw page.

# Per-source cap on lines fed to the miner. A pathological app can emit tens
# of thousands of error lines in a window; mining all of them blows memory
# and Lambda wall time for no extra signal (templates converge well before
# 2000 lines). Bound the sample so cost stays predictable.
_TEMPLATE_MINE_MAX_LINES_PER_SOURCE = 2000
# Top-K templates kept across all sources in the digest.
_DIGEST_MAX_TEMPLATES = 15
# Verbatim rare-error lines kept across all sources in the digest.
_DIGEST_MAX_RARE_ERRORS = 50

# Module-level masking source. `LogSource.signature_for` is stateless (pure
# string normalisation), so any registered source's bound method gives the
# identical masking the index already uses. Reuse the frontend source as the
# canonical masker for the drain3-absent fallback path.
_MASKING_SOURCE = LOG_SOURCES["airo-app-frontend"]


def _mask_line(line: str) -> str:
    """Mask one raw line to its signature via the existing index masker.

    Identical normalisation to `build_index`'s `signature_for` (IDs, numbers,
    urls, hex → placeholders), so the fallback template-mining path groups
    lines exactly the way the rest of the pipeline already groups signatures.
    """
    return _MASKING_SOURCE.signature_for(line)


def mine_templates(lines: list[str]) -> list[dict[str, Any]]:
    """Cluster log lines into parameterised templates, ranked by frequency.

    Output shape (both paths identical):
        [{"template": str, "count": int, "examples": list[str]}, ...]
    sorted by count descending. `examples` holds up to 2 verbatim raw lines
    that mapped to the template.

    drain3 path (production): feed each line to the miner, then read back
    `miner.drain.clusters`. We track the first 2 raw lines per cluster id
    ourselves (drain3 stores only the template, not the raw lines).

    Fallback path (test/local — drain3 absent): group lines by `_mask_line`
    (the existing signature masker). Same shape, dependency-free, so the unit
    suite runs without drain3 while production gets true template mining.
    """
    if not lines:
        return []

    if _DRAIN3_AVAILABLE:
        miner = TemplateMiner()
        examples_by_cluster: dict[int, list[str]] = {}
        for line in lines:
            text = "" if line is None else str(line)
            result = miner.add_log_message(text)
            cluster_id = result.get("cluster_id")
            if cluster_id is not None:
                bucket = examples_by_cluster.setdefault(cluster_id, [])
                if len(bucket) < 2:
                    bucket.append(text)
        templates = [
            {
                "template": cluster.get_template(),
                "count": cluster.size,
                "examples": examples_by_cluster.get(cluster.cluster_id, []),
            }
            for cluster in miner.drain.clusters
        ]
        templates.sort(key=lambda t: t["count"], reverse=True)
        return templates

    # Fallback: group by masked signature.
    counts: Counter[str] = Counter()
    examples_by_template: dict[str, list[str]] = {}
    for line in lines:
        text = "" if line is None else str(line)
        masked = _mask_line(text)
        counts[masked] += 1
        bucket = examples_by_template.setdefault(masked, [])
        if len(bucket) < 2:
            bucket.append(text)
    templates = [
        {"template": template, "count": count, "examples": examples_by_template.get(template, [])}
        for template, count in counts.items()
    ]
    templates.sort(key=lambda t: t["count"], reverse=True)
    return templates


def build_log_digest(bundle: dict[str, Any]) -> dict[str, Any]:
    """Combine Stage-1 aggregation + mined templates + rare errors.

    Returns a compact dict the agent reads first:
        {
          "aggregation": <bundle["aggregation"]>,   # Stage-1 histograms
          "templates":  [{template,count,examples,sourceId}, ...],  # Stage-2
          "rareErrors": [{signature,count,rawRef,sourceId}, ...],   # Stage-3
        }

    `templates` are mined from each source's error/warn-leaning raw MESSAGES
    (capped per source), tagged with sourceId, top-K across sources by count.
    `rareErrors` reuses each source's already-computed `rareErrorSignatures`,
    kept verbatim, tagged with sourceId, capped overall.
    """
    sources = bundle.get("sources")
    sources = sources if isinstance(sources, list) else []

    template_rows: list[dict[str, Any]] = []
    rare_errors: list[dict[str, Any]] = []

    for source in sources:
        if not isinstance(source, dict):
            continue
        source_id = str(source.get("sourceId") or "unknown")
        log_source = LOG_SOURCES.get(source_id, _MASKING_SOURCE)

        # Gather error/warn-leaning raw messages, capped per source so a noisy
        # app can't blow memory/time.
        messages: list[str] = []
        raw_pages = source.get("rawPages")
        raw_pages = raw_pages if isinstance(raw_pages, list) else []
        for page in raw_pages:
            if len(messages) >= _TEMPLATE_MINE_MAX_LINES_PER_SOURCE:
                break
            if not isinstance(page, dict):
                continue
            logs = page.get("logs")
            logs = logs if isinstance(logs, list) else []
            for log in logs:
                if len(messages) >= _TEMPLATE_MINE_MAX_LINES_PER_SOURCE:
                    break
                if not isinstance(log, dict):
                    continue
                if log_source.is_error(log):
                    messages.append(log_source.message_for(log))

        for tmpl in mine_templates(messages):
            template_rows.append({**tmpl, "sourceId": source_id})

        # Verbatim rare-error signatures (already count<=3, error-ish).
        index = source.get("index")
        index = index if isinstance(index, dict) else {}
        source_rares = index.get("rareErrorSignatures")
        source_rares = source_rares if isinstance(source_rares, list) else []
        for rare in source_rares:
            if isinstance(rare, dict):
                rare_errors.append({**rare, "sourceId": source_id})

    template_rows.sort(key=lambda t: t.get("count", 0), reverse=True)

    return {
        "aggregation": bundle.get("aggregation", {}),
        "templates": template_rows[:_DIGEST_MAX_TEMPLATES],
        "rareErrors": rare_errors[:_DIGEST_MAX_RARE_ERRORS],
    }


# ---- Stage-4 drill-on-demand raw line fetch -----------------------------
# After reading the digest (Stage-1/2/3), the agent often needs the actual
# raw Loki lines for ONE service/template/window to confirm a hypothesis.
# `fetch_log_lines` is that targeted drill: a single cluster-scoped
# query_range bounded by `limit`, with an optional `|=` line filter for the
# template substring. Cluster-scoped only — an unset cluster soft-fails
# rather than issue an unbounded scan, exactly like the bucket/aggregation
# paths. Never throws; any error returns a shaped soft-fail.


def fetch_log_lines(
    app_id: str,
    *,
    plane: str = "data",
    service_name: str | None = None,
    contains: str | None = None,
    window: str = "1h",
    env: str | None = None,
    cluster: str | None = None,
    limit: int = 100,
    timeout: int = 30,
) -> dict[str, Any]:
    """Pull raw Loki lines for one service/template/window (drill-on-demand).

    `service_name` is an exact service (e.g. "airo-preview-application") that
    fills the `service_name_re` regex slot (an exact name works as a regex);
    None omits it so the query covers every service in the plane+cluster.
    `contains` appends a `|= "<contains>"` line filter (embedded quotes
    escaped). Returns {"ok": True, "lines": [...], "count": n} newest-first,
    capped to `limit`. Data-plane queries are cluster-scoped (an unset cluster
    returns {"ok": False, "error": str, "lines": []} and never issues an
    unbounded scan). Control-plane streams have no cluster label, so cluster
    is omitted for plane="control" regardless of whether one is set.
    """
    env = env or _loki_env()
    cluster = cluster or os.environ.get("LOKI_CLUSTER") or None
    if not cluster and plane != "control":
        # Mandatory label scoping is missing for data-plane — refuse an unbounded scan.
        return {"ok": False, "error": "cluster unavailable", "lines": []}

    try:
        endpoint = os.environ.get("LOKI_ENDPOINT", "").rstrip("/")
        if not endpoint:
            return {"ok": False, "error": "LOKI_ENDPOINT not set", "lines": []}

        win = parse_window(window)
        query = _loki_selector(
            plane, app_id, env,
            cluster=(None if plane == "control" else cluster),
            service_name_re=(service_name or None),
            use_structured_metadata=_use_structured_metadata(win),
        )
        if contains:
            # Append a line-substring filter. Escape embedded double-quotes so
            # the LogQL string literal stays well-formed.
            escaped = contains.replace('"', '\\"')
            query = f'{query} |= "{escaped}"'

        api_key = os.environ.get("LOKI_API_KEY", "")
        headers: dict[str, str] = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        resp = _http_get_json(
            f"{endpoint}/loki/api/v1/query_range",
            headers,
            {
                "query": query,
                "start": _loki_ns(win.start),
                "end": _loki_ns(win.end),
                "limit": str(limit),
                "direction": "backward",
            },
            timeout,
        )

        lines: list[dict[str, Any]] = []
        result = field_value(resp, "data.result")
        result = result if isinstance(result, list) else []
        for stream in result:
            if not isinstance(stream, dict):
                continue
            stream_labels = stream.get("stream")
            stream_labels = stream_labels if isinstance(stream_labels, dict) else {}
            svc = stream_labels.get("service_name")
            for value in stream.get("values", []):
                if not isinstance(value, (list, tuple)) or len(value) < 2:
                    continue
                ts, line = value[0], value[1]
                lines.append({"ts": ts, "line": str(line), "service_name": svc})

        # direction=backward returns each stream newest-first, but multiple
        # streams interleave by stream, not globally. Re-sort by ts descending
        # (ns strings sort lexicographically same as numerically while equal
        # width) then cap to `limit`.
        lines.sort(key=lambda row: str(row.get("ts") or ""), reverse=True)
        lines = lines[:limit]
        return {"ok": True, "lines": lines, "count": len(lines)}
    except Exception as err:  # noqa: BLE001 — soft-fail; never throw
        return {"ok": False, "error": compact_text(f"{type(err).__name__}: {err}", 240), "lines": []}


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


def _enrich_source_index(
    source_result: dict[str, Any],
    app_id: str,
    window: "Window",
) -> dict[str, Any]:
    """Mirror debug-console buildEvidenceIndex on a direct-mode source result.

    Loki sources are already enriched by `_fetch_loki_all_sources` because
    they're bucket-fetched. ES sources take a flat path through
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


def fetch_direct_evidence(app_id: str, window_label: str, timeout: int) -> dict[str, Any]:
    """
    Builds an evidence bundle by querying Loki / ES directly.
    Exact same queries as debug-console /api/investigate-evidence.
    All sources fetched in parallel. Returns the same structure as the console
    endpoint so write_batched_evidence processes it unchanged.
    """
    window = parse_window(window_label)
    start_iso = window.start
    end_iso = window.end
    # Defer to `build_time_buckets`'s window-aware heuristic (1h ≤24h /
    # 3h ≤72h / 6h >72h). A single hard-coded value silently regresses
    # 7d direct-mode invocations into ~168 buckets.
    bucket_hours = None

    # Dispatch all independent sources in parallel (one per source group).
    # control-plane now comes from Loki (plane="control") inside
    # _fetch_loki_all_sources; the only remaining ES source is the airo-app
    # frontend.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        loki_future = pool.submit(_fetch_loki_all_sources, app_id, window, bucket_hours, timeout)
        es_airo_future = pool.submit(
            _fetch_es_source, app_id,
            "AIRO_BUILDER_ES_ENDPOINT", "AIRO_BUILDER_ES_API_KEY",
            "logs-*", "data.appId", "airo-app-frontend",
            start_iso, end_iso, timeout,
        )

        loki_by_source = loki_future.result()
        es_airo_result = es_airo_future.result()

    # Loki sources are already bucket-indexed inside _fetch_loki_all_sources.
    # The remaining ES source goes through _build_source_result → empty index;
    # mirror console's buildEvidenceIndex so every source hands Claude the
    # same { topSignatures, rareErrorSignatures, levelCounts, rawRefs }
    # surface. Without this, phase-1 prompts make Claude fetch raw pages
    # for ES, which is the path that burns turns.
    es_airo_result = _enrich_source_index(es_airo_result, app_id, window)

    sources = [
        loki_by_source["airo-agents"],
        loki_by_source["airo-preview"],
        loki_by_source["airo-publish"],
        loki_by_source["control-plane"],
        es_airo_result,
    ]

    # Stage-1 server-side Loki histogram (level/service counts via metric
    # queries — no raw-line pull). Cluster-scoped; soft-fails to a shaped
    # empty digest when LOKI_CLUSTER is unset so it can never trigger an
    # unbounded scan. Attached as a top-level `aggregation` key alongside the
    # existing bundle fields.
    aggregation = _collect_aggregation(
        app_id, window, _loki_env(),
        os.environ.get("LOKI_CLUSTER") or None, timeout,
    )

    bundle: dict[str, Any] = {
        "appId": app_id,
        "timeWindow": window_label,
        "complete": all(s.get("complete", False) for s in sources),
        "sources": sources,
        "aggregation": aggregation,
    }

    # Stage-2/3 digest: aggregation histograms + drain3-mined templates +
    # verbatim rare errors, combined into one compact surface the agent reads
    # first. Built from the now-assembled bundle so it can mine each source's
    # raw error messages and reuse the already-computed rareErrorSignatures.
    bundle["digest"] = build_log_digest(bundle)
    return bundle


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
            # feedback-source path: query Loki / ES directly
            try:
                data = fetch_direct_evidence(
                    args.appId, window.label, args.timeout
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
                sources, args.appId, window.label
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
    parser.add_argument("--sources", default="airo-app-frontend,airo-agents,airo-preview,airo-publish,control-plane")
    parser.add_argument("--window", default="24h", help="24h, 7d, or startISO,endISO")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--page-size", type=int, default=500)
    parser.add_argument("--bucket-hours", type=int, default=None)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument(
        "--timeout",
        type=int,
        default=45,
        help=(
            "Per-HTTP-call timeout (seconds) for ES sources. Loki uses its "
            "own per-page / per-bucket budget "
            "(see _LOKI_PER_PAGE_TIMEOUT_S / _LOKI_PER_BUCKET_BUDGET_S)."
        ),
    )
    parser.add_argument("--fail-on-incomplete", action="store_true")
    parser.add_argument("--batched-evidence", action=argparse.BooleanOptionalAction, default=True)
    return run(parser.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
