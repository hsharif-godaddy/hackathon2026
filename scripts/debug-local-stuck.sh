#!/usr/bin/env bash
#
# Diagnose why the local dev environment is stuck/hung.
#
# Run this when:
#   - The browser is stuck on "Loading your App..."
#   - `pnpm run dev` appears to be running but pages don't load
#   - HTTP requests to https://local.gasket.dev-godaddy.com:8443 time out
#
# Usage:
#   ./scripts/debug-local-stuck.sh                 # Print report to stdout
#   ./scripts/debug-local-stuck.sh --kill-zombies  # Also kill orphaned dev processes
#
# What it checks:
#   1. Zombie dev sessions  — old `pnpm run dev` chains that survived a crash
#                             (PPID=1, airo-related). These hold ports and
#                             trigger phantom recompilations from tsx --watch.
#   2. Per-process CPU      — flags any node/tsx/next-server pegged >80%
#                             (deterministic webpack/event-loop loop).
#   3. Listening ports      — 3000 (Next.js), 8443 (Gasket), ${AGENTS_PORT:-4000}
#                             (agents), 4100 (control plane). All four must be up.
#   4. Health responses     — BFF /health, agent /health, control plane /health.
#                             Times out fast (3s) so the script doesn't itself hang.
#   5. JWKS endpoint        — Docker preview containers fetch this for JWT auth.
#                             If it stalls, every container request 307-redirects.
#   6. Recent BFF timings   — last 20 API call durations from app/dev.log.
#                             Any "next.js: 2min+" entry = compilation hang.
#   7. Recent error spam    — cert-token / mgmt-airo / control-plane connect errors
#                             from the log tail. Reveals upstream timeouts that
#                             cascade into request hangs.

set -uo pipefail

KILL_ZOMBIES=0
if [[ "${1:-}" == "--kill-zombies" ]]; then
  KILL_ZOMBIES=1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_LOG="$REPO_ROOT/app/dev.log"
AGENTS_PORT="${AGENTS_PORT:-4000}"
AGENTS_HEALTH_URL="https://local.gasket.dev-godaddy.com:${AGENTS_PORT}/health"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
red()  { printf "\033[31m%s\033[0m\n" "$*"; }
green(){ printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

bold "=== 1. Zombie dev sessions (PPID=1, airo-related) ==="
# Orphaned tsx --watch / pnpm run dev / next-server processes that survived a crash
ZOMBIE_PIDS=$(ps -e -o pid,ppid,etime,command \
  | awk '$2==1' \
  | grep -E "tsx|next-server|pnpm run dev|concurrently|build:tsc:watch|build:deps|next dev" \
  | grep -vE "Cursor|VSCode|agent-browser|claude" \
  | awk '{print $1}')

if [[ -z "$ZOMBIE_PIDS" ]]; then
  green "  No orphaned dev processes detected."
else
  red "  Orphaned processes found (these hold ports and watch files in the background):"
  for pid in $ZOMBIE_PIDS; do
    ps -p "$pid" -o pid,ppid,etime,command 2>/dev/null | tail -n +2 | awk '{ printf "    PID %s  age %s  %s\n", $1, $3, substr($0, index($0,$4), 100) }'
  done
  if [[ "$KILL_ZOMBIES" == "1" ]]; then
    yellow "  --kill-zombies set, terminating..."
    for pid in $ZOMBIE_PIDS; do kill -9 "$pid" 2>/dev/null && echo "    killed $pid"; done
    pkill -9 -f "build:tsc:watch" 2>/dev/null
    pkill -9 -f "local:https" 2>/dev/null
    pkill -9 -f "next dev --webpack" 2>/dev/null
  else
    yellow "  Re-run with --kill-zombies to terminate them."
  fi
fi
echo

bold "=== 2. High-CPU dev processes ==="
# Any tsx/node/next-server pegged at 80%+ is in a compile loop or event-loop block
ps -e -o pid,pcpu,pmem,etime,command \
  | awk 'NR==1 || ($2+0 >= 80 && $0 ~ /tsx|next-server|node/)' \
  | grep -vE "Cursor|VSCode|agent-browser" \
  | head -10
echo

bold "=== 3. Port listeners ==="
for port_pair in "3000:Next.js" "8443:Gasket-proxy" "${AGENTS_PORT}:Agents" "4100:Control-plane"; do
  port="${port_pair%%:*}"
  name="${port_pair##*:}"
  pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [[ -n "$pid" ]]; then
    cmd=$(ps -p "$pid" -o command= 2>/dev/null | head -c 60)
    green "  $name ($port): PID $pid — $cmd"
  else
    red "  $name ($port): NOT LISTENING"
  fi
done
echo

bold "=== 4. Connection storm check (Next.js port 3000) ==="
# Browser tabs leak SSE/WebSocket connections. >50 ESTABLISHED → Next.js can't service new requests.
EST_COUNT=$(lsof -nP -iTCP:3000 2>/dev/null | grep -c ESTABLISHED || true)
if [[ "$EST_COUNT" -gt 50 ]]; then
  red "  $EST_COUNT ESTABLISHED connections — browser has leaked too many sockets."
  red "  -> Close ALL browser tabs pointing at localhost:8443, then re-open one."
elif [[ "$EST_COUNT" -gt 20 ]]; then
  yellow "  $EST_COUNT ESTABLISHED connections (high but not yet pathological)."
else
  green "  $EST_COUNT ESTABLISHED connections (healthy)."
fi
echo

bold "=== 5. Health endpoints ==="
# Use 30s timeout for BFF routes — Next.js dev compiles routes on-demand and
# first-time compile of complex pages can take 10-20s. Anything over 30s with
# zero CPU spike on the next-server PID indicates a real hang, not compilation.
check_url() {
  local label="$1"; local url="$2"; local timeout="$3"; local insecure="${4:-}"
  local code time_total
  read -r code time_total < <(curl -s --max-time "$timeout" $insecure -o /dev/null -w "%{http_code} %{time_total}" "$url" 2>/dev/null || echo "000 timeout")
  # 404 from /health is fine — it just means the route isn't defined; the server is responding.
  if [[ "$code" =~ ^[2-4] ]]; then
    if (( $(awk "BEGIN{print ($time_total > 5)}") )); then
      yellow "  $label: $code in ${time_total}s (slow, likely first-compile)"
    else
      green "  $label: $code in ${time_total}s"
    fi
  else
    red   "  $label: $code (after ${time_total}s — actual hang)"
  fi
}
check_url "BFF /api/health         " "https://local.gasket.dev-godaddy.com:8443/api/health" 30 "-k"
check_url "BFF JWKS                " "https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json" 30 "-k"
check_url "Agents /health          " "$AGENTS_HEALTH_URL" 5 "-k"
check_url "Control plane /health   " "http://localhost:4100/health" 5
echo

bold "=== 6. Recent BFF API timings (last 15 from dev.log) ==="
if [[ -f "$APP_LOG" ]]; then
  # Extract route + duration. Anything >30s for next.js: indicates compile hang.
  grep -oE "(GET|POST|DELETE) /api/[^[:space:]]+ [0-9]+ in [0-9.]+(min|s|ms)\\s*\\(next\\.js: [0-9.]+(min|s|ms),[^)]*\\)" "$APP_LOG" \
    | tail -15 \
    | awk '{
        if ($0 ~ /min/) printf "  \033[31m%s\033[0m\n", $0
        else if ($0 ~ /[0-9]+s/ && $0 ~ /[0-9]{2,}\.[0-9]+s/) printf "  \033[33m%s\033[0m\n", $0
        else printf "  \033[32m%s\033[0m\n", $0
      }' || echo "  (no matching log lines)"
else
  yellow "  $APP_LOG not found"
fi
echo

bold "=== 7. Recent upstream errors (last 30 lines, dedup) ==="
if [[ -f "$APP_LOG" ]]; then
  grep -E "cert-token\.(sso|refresh)\.(timeout|failed|error)|mgmt-airo\.api\.attempt-error|control-plane.*error|venture\.(get\.failed|create.*failed)|websocket.connection.init_failed" "$APP_LOG" \
    | tail -30 \
    | sed -E 's/\[2m\(https?:[^)]+\)\[22m//; s/\033\[[0-9;]*m//g; s/^[^A-Z]*//' \
    | sort -u \
    | head -10 \
    || echo "  (no upstream errors in log)"
fi
echo

bold "=== 8. Suggested next steps ==="
if [[ -n "$ZOMBIE_PIDS" ]]; then
  red "  -> Zombie processes are present. Re-run with --kill-zombies, then:"
  red "       pnpm run dev   (or pnpm run dev:legacy + pnpm run dev:control-plane)"
fi
JWKS_CODE=$(curl -sk --max-time 30 -o /dev/null -w "%{http_code}" https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json 2>/dev/null || echo "000")
if [[ "$JWKS_CODE" != "200" ]]; then
  yellow "  -> BFF JWKS not responding within 30s. If Next.js CPU is also low, the dev server"
  yellow "     is likely in a bad state — restart with: ./scripts/debug-local-stuck.sh --kill-zombies && pnpm run dev"
fi
if ! curl -s --max-time 2 http://localhost:4100/health 2>/dev/null | grep -q ok; then
  yellow "  -> Control plane is down. \`dev:legacy\` does NOT start it. Run:"
  yellow "       pnpm run dev:control-plane (in a separate shell)"
fi
echo
