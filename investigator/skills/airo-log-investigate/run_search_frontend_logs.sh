#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The Lambda Node base puts /var/lang libraries first. Python from the OS dnf
# install must prefer the system OpenSSL libraries to avoid ssl import failures.
export LD_LIBRARY_PATH="/usr/lib64:${LD_LIBRARY_PATH:-}"

exec python3 "${SCRIPT_DIR}/search_frontend_logs.py" "$@"
