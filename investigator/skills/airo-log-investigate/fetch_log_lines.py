#!/usr/bin/env python3
"""Stage-4 drill-on-demand CLI: pull raw Loki lines for one service/window.

Thin wrapper around `search_frontend_logs.fetch_log_lines`. After the agent
has read the digest (aggregation + templates + rare errors), this fetches the
actual raw lines for ONE service/template/window to confirm a hypothesis.
Cluster-scoped + bounded by --limit; soft-fails (never throws) so the agent
always gets a JSON result.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

# Import the shared implementation from the same skill directory. The skill is
# invoked from arbitrary CWDs (Lambda, local shell), so pin the path explicitly
# rather than rely on the import search path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import search_frontend_logs  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Fetch raw Loki lines for one service/template/window (drill-on-demand)."
    )
    parser.add_argument("--appId", required=True)
    parser.add_argument("--plane", default="data")
    parser.add_argument("--service", default=None, help="Exact service_name (e.g. airo-preview-application)")
    parser.add_argument("--contains", default=None, help="Line-substring filter (template fragment)")
    parser.add_argument("--window", default="1h", help="1h, 24h, 7d, or startISO,endISO")
    parser.add_argument("--env", default=None)
    parser.add_argument("--cluster", default=None)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args(argv)

    result = search_frontend_logs.fetch_log_lines(
        args.appId,
        plane=args.plane,
        service_name=args.service,
        contains=args.contains,
        window=args.window,
        env=args.env,
        cluster=args.cluster,
        limit=args.limit,
        timeout=args.timeout,
    )
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
