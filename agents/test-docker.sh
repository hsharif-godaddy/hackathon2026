#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/.env" ]; then
  source "$SCRIPT_DIR/.env"
else
  echo "Error: agents/.env not found"
  exit 1
fi

NOMAD_SPEC_IMAGE_VERSION=${NOMAD_SPEC_IMAGE_VERSION:-pre-dev-v1.0.0}
IMAGE_TAG=${NOMAD_SPEC_IMAGE_VERSION}

exec docker run --rm \
  -e OPENAI_API_KEY="${OPENAI_API_KEY}" \
  -e OPENAI_BASE_URL="${OPENAI_BASE_URL}" \
  -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  -e ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL}" \
  -p 4000:4000 \
  airo-agents:${IMAGE_TAG}
