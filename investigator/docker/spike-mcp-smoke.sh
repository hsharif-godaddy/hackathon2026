#!/bin/bash
set -euo pipefail
# NOTE: Entrypoint corrected by the 2026-06-02 spike. There is no
# `code_review_graph.mcp` module. The stdio MCP server is launched via the
# `serve` (or `mcp`) subcommand of the package CLI. We invoke it through the
# package module so PYTHONPATH alone is enough (no reliance on /opt/py-packages/bin
# being on PATH). LD_LIBRARY_PATH=/usr/lib64 is REQUIRED on the Lambda nodejs base
# so python3.11's _ssl.so binds the AL2023 libcrypto (which exports
# COMP_get_type@OPENSSL_3.0.0) instead of Node's bundled /var/lang/lib/libcrypto.
cat > /tmp/mcp.json <<'JSON'
{ "mcpServers": { "crg": { "command": "python3.11", "args": ["-m", "code_review_graph", "serve"], "env": { "PYTHONPATH": "/opt/py-packages", "LD_LIBRARY_PATH": "/usr/lib64" } } } }
JSON
claude -p "List the MCP tools you can call. Return only their names." \
  --mcp-config /tmp/mcp.json --model claude-sonnet-4-6 \
  --output-format stream-json --verbose --dangerously-skip-permissions --max-turns 3
