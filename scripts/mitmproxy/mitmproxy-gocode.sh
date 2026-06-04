#!/bin/sh
#
# Reverse-proxy an LLM backend through mitmweb for local inspection and fault
# injection (see gocode-random-error.py).
#
# Default upstream is the dev GoCode S2S endpoint, which matches a local
# agents/.env running NODE_ENV=development with GOCODE_USE_S2S_AUTH=true — this
# is the endpoint the OpenAI-compatible path uses.
#
# Override the upstream for other environments:
#   GOCODE_UPSTREAM=https://api.gocode.caas.gdcorp.tools ./mitmproxy-gocode.sh                  # prod GoCode (S2S)
#   GOCODE_UPSTREAM=https://caas-gocode-prod.caas-prod.prod.onkatana.net ./mitmproxy-gocode.sh  # prod Anthropic proxy
#
# Point the agent at the proxy by adding to agents/.env (remove when done):
#   OPENAI_BASE_URL=http://localhost:8080
#   ANTHROPIC_BASE_URL=http://localhost:8080
#
# mitmweb listens on :8080 (proxy) and opens its web UI on :8081.

set -e

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
GOCODE_UPSTREAM="${GOCODE_UPSTREAM:-https://api.gocode.caas.dev-gdcorp.tools}"

exec mitmweb -s "$SCRIPT_DIR/gocode-random-error.py" --mode "reverse:$GOCODE_UPSTREAM" "$@"
