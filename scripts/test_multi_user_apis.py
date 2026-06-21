#!/usr/bin/env python3
"""
Manual HTTP helpers for multi-user / AuthZ work (OpenFGA check + optional AAB agent-token).

Stdlib only (no pip install).

Usage:
  OpenFGA check (AuthZ contract: customer + venture — see docs/multi-user-flows.md §3):
    FGA_BASE_URL=https://fga.api.int.dev-godaddy.com \\
    FGA_STORE_ID=<store-uuid> FGA_TOKEN=<s2s bearer> \\
    ./scripts/test_multi_user_apis.py fga-check \\
      --user 'customer:<customerId>' --object 'venture:<ventureId>' --relation can_build

  AAB agent token:
    AAB_BASE_URL=https://local.gasket.dev-godaddy.com:8443 AAB_COOKIE='gdssid=...' \\
    ./scripts/test_multi_user_apis.py agent-token --site-id <10-char-app-id>

  Help:
    ./scripts/test_multi_user_apis.py --help
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import quote


def usage_text() -> str:
    return """
test_multi_user_apis.py — minimal HTTP probes for multi-user implementation

Commands:
  fga-check     POST {FGA_BASE_URL}{FGA_PATH_PREFIX}/stores/{FGA_STORE_ID}/check
  agent-token   POST {AAB_BASE_URL}/api/auth/agent-token

Environment:
  fga-check:
    FGA_BASE_URL       default https://fga.api.int.godaddy.com (dev example: https://fga.api.int.dev-godaddy.com)
    FGA_PATH_PREFIX    default "" (set to "/v1" if your deployment prefixes routes)
    FGA_STORE_ID       required
    FGA_TOKEN          Bearer token (s2s OAuth when sorted)
    FGA_AUTH_MODEL_ID  optional Authorization-Model-Id header

  agent-token:
    AAB_BASE_URL       default http://localhost:3000
    AAB_COOKIE         Cookie header for an authenticated session

Examples:
  ./scripts/test_multi_user_apis.py fga-check \\
    --user 'customer:123456' --object 'venture:01HZZZZZZZZZZZZZZZZZZZZZZ' --relation can_build

  ./scripts/test_multi_user_apis.py agent-token --site-id abcd123456
"""


def mask_token(t: str) -> str:
    if not t or len(t) < 12:
        return "(set)"
    return f"{t[:6]}…{t[-4:]}"


def http_post_json(url: str, headers: dict[str, str], body: dict[str, Any]) -> tuple[int, str]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace") if e.fp else ""
        return e.code, text


def print_response(status: int, text: str) -> None:
    print(f"Status: {status}")
    try:
        parsed = json.loads(text)
        print(json.dumps(parsed, indent=2))
    except json.JSONDecodeError:
        print(text)


def cmd_fga_check(args: argparse.Namespace) -> int:
    base = (os.environ.get("FGA_BASE_URL") or "https://fga.api.int.godaddy.com").rstrip("/")
    prefix = (os.environ.get("FGA_PATH_PREFIX") or "").rstrip("/")
    store_id = os.environ.get("FGA_STORE_ID")
    token = os.environ.get("FGA_TOKEN")
    model_id = os.environ.get("FGA_AUTH_MODEL_ID")

    if not store_id:
        print("FGA_STORE_ID is required", file=sys.stderr)
        return 1
    if not token:
        print("FGA_TOKEN is required", file=sys.stderr)
        return 1

    url = f"{base}{prefix}/stores/{quote(store_id, safe='')}/check"
    body: dict[str, Any] = {
        "tuple_key": {
            "user": args.user,
            "relation": args.relation,
            "object": args.object,
        },
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    if model_id:
        headers["Authorization-Model-Id"] = model_id

    print(f"POST {url}")
    print(f"Body: {json.dumps(body)}")

    status, text = http_post_json(url, headers, body)
    print_response(status, text)
    return 0 if 200 <= status < 300 else 1


def cmd_agent_token(args: argparse.Namespace) -> int:
    base = (os.environ.get("AAB_BASE_URL") or "http://localhost:3000").rstrip("/")
    cookie = os.environ.get("AAB_COOKIE")
    if not cookie:
        print("AAB_COOKIE is required", file=sys.stderr)
        return 1

    url = f"{base}/api/auth/agent-token"
    body: dict[str, Any] = {"siteId": args.site_id}
    if args.expires is not None:
        body["expiresInSeconds"] = args.expires

    headers = {
        "Content-Type": "application/json",
        "Cookie": cookie,
    }

    print(f"POST {url}")
    print(f"Cookie: {mask_token(cookie)}")

    status, text = http_post_json(url, headers, body)
    print_response(status, text)
    return 0 if 200 <= status < 300 else 1


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="HTTP probes for OpenFGA check and AAB agent-token.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=usage_text(),
    )
    sub = p.add_subparsers(dest="command", required=True)

    p_fga = sub.add_parser("fga-check", help="POST OpenFGA /stores/.../check")
    p_fga.add_argument("--user", required=True, help="Tuple user, e.g. customer:<customerId> (AuthZ venture model)")
    p_fga.add_argument("--object", required=True, help="Tuple object, e.g. venture:<ventureId>")
    p_fga.add_argument("--relation", required=True, help="Relation or permission name, e.g. can_build")
    p_fga.set_defaults(run=cmd_fga_check)

    p_aab = sub.add_parser("agent-token", help="POST AAB /api/auth/agent-token")
    p_aab.add_argument("--site-id", required=True, dest="site_id", help="10-char Airo site id")
    p_aab.add_argument(
        "--expires",
        type=int,
        default=None,
        metavar="SECONDS",
        help="Optional JWT TTL in seconds",
    )
    p_aab.set_defaults(run=cmd_agent_token)

    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.run(args))


if __name__ == "__main__":
    sys.exit(main())
