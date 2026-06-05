#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The Lambda Node base puts /var/lang libraries first. Python from the OS dnf
# install must prefer the system OpenSSL libraries to avoid ssl import failures.
export LD_LIBRARY_PATH="/usr/lib64:${LD_LIBRARY_PATH:-}"

# Run under python3.11 (not the base's stripped 3.9) and expose the CRG/drain3
# deps installed at /opt/py-packages so the skill's Stage-2 template mining uses
# real drain3. Both urllib3 and drain3 imports in the skill are guarded, so a
# missing dep falls back to the stdlib path — but on the prod image both resolve.
export PYTHONPATH="/opt/py-packages:${PYTHONPATH:-}"

exec python3.11 "${SCRIPT_DIR}/search_frontend_logs.py" "$@"
