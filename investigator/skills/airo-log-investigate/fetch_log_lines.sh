#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LD_LIBRARY_PATH="/usr/lib64:${LD_LIBRARY_PATH:-}"
# Match run_search_frontend_logs.sh: python3.11 + the CRG/drain3 deps. The
# skill's optional imports are guarded, so this is purely additive.
export PYTHONPATH="/opt/py-packages:${PYTHONPATH:-}"
exec python3.11 "${SCRIPT_DIR}/fetch_log_lines.py" "$@"
