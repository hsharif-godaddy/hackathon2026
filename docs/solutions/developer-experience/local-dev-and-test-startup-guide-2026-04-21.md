---
title: Local dev and test startup guide
date: 2026-04-21
category: developer-experience
module: dev-environment
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - setting up local development for the first time
  - switching between dev and test modes
  - running agents service non-interactively (CI, background processes, Claude Code)
  - debugging billing, grants, or budget features that need real subscription data
tags:
  - local-dev
  - setup
  - dev-server
  - local-test
  - control-plane
  - agents
  - non-interactive
---

# Local dev and test startup guide

## Context

Airo App Builder has multiple dev modes with different capabilities. Choosing the wrong mode wastes time: `pnpm dev` lacks grant/billing data, `local:test` requires extra setup, and the TUI dev runner fails in non-interactive environments. This guide covers all modes and when to use each.

## Guidance

### Prerequisites

- Node.js 22.16.0+, pnpm 10.17.0 (via `corepack enable`)
- Docker Desktop (for local-control-plane containers)
- direnv + shell hook (`eval "$(direnv hook zsh)"` in ~/.zshrc)
- mkcert (`brew install mkcert && mkcert -install`)
- AWS SSO access to `airobuild-dev-private-sso` profile
- `/etc/hosts` entry: `127.0.0.1  local.gasket.dev-godaddy.com`

Run `./setup.sh` for automated setup (requires direnv and mkcert installed first). Unset `AWS_PROFILE` before running.

### Mode comparison

| Mode | Command | Services | Grants/billing | Use when |
|---|---|---|---|---|
| **Dev (TUI)** | `pnpm dev` | agents:4000, app:3000, control-plane:4100 | Stubbed | General feature work, full-stack development |
| **Dev (legacy)** | `pnpm dev:legacy` | agents:4000, app:3000 | Stubbed | Same as TUI but non-interactive (no control plane) |
| **Dev (agents only)** | `pnpm dev:agents` | agents:4000 | Stubbed | Backend-only work, testing agent logic |
| **local:test** | `pnpm local:test` | agents:4000, app:3000+443 | Real (with local CP) | Billing, grants, budget, paywall work |

### Starting dev mode

**Config:** In `app/.env.local`, **uncomment** `MGMT_AIRO_BASE_URL=http://localhost:4100` so the app uses the local control plane. Without this, the app hits remote mgmt.nstk.net and your apps page will be empty.

**Gasket config:** In `gasket.ts`, set both `https.port` and `httpsProxy.port` to `8443` for the `local.test` environment.

**TUI (interactive terminal required):**
```bash
AWS_PROFILE=airobuild-dev-private-sso pnpm dev
```
Starts all 3 services (agents:4000, app:3000, control-plane:4100) with a terminal UI. Requires an interactive TTY. This is the recommended way to start dev; it manages process restarts and gives you a unified view.

**Non-interactive (background processes, CI, Claude Code):**

The TUI cannot run in non-interactive environments. Start all 3 services individually:

```bash
# Start all 3 (agents + app + control plane)
nohup pnpm dev:agents > /tmp/agents-dev.log 2>&1 &
nohup pnpm --filter website dev > /tmp/app-dev.log 2>&1 &
cd local-control-plane && nohup env AWS_PROFILE=airobuild-dev-private-sso make run > /tmp/control-plane-dev.log 2>&1 &
cd ..

# Wait and verify
sleep 20
curl -s -o /dev/null -w "agents:%{http_code} " http://localhost:4000/health
curl -s -o /dev/null -w "app:%{http_code} " https://local.gasket.dev-godaddy.com:8443
curl -s -o /dev/null -w "cp:%{http_code}" http://localhost:4100/health
```

You MUST start all 3 services. Without the control plane, the apps page shows 0 apps because the app can't query the local mgmt API.

Other non-interactive shortcuts (when you don't need all 3):
```bash
pnpm dev:legacy          # agents + app only (no control plane, no apps listing)
pnpm dev:agents          # agents only (backend work, testing agent logic)
```

**URLs:**
- App: https://local.gasket.dev-godaddy.com:8443
- Agents API: http://localhost:4000
- Control plane: http://localhost:4100
- Health checks: `curl http://localhost:4000/health` and `curl http://localhost:4100/health`

### Logging in (dev mode)

After starting dev, navigate to https://local.gasket.dev-godaddy.com:8443.

1. Accept the cookie banner
2. Click the user icon (top right) to open the user menu
3. Click "Sign In"
4. SSO form loads in an iframe. Use your GoDaddy dev credentials.
5. After login, "My Apps" appears in the top nav. Click it or navigate to `/apps`.

For automated browser login (agent-browser CLI):
```bash
agent-browser --headed open "https://local.gasket.dev-godaddy.com:8443"
# Accept cookies, click user menu, click Sign In
# Fill SSO iframe fields: Username and Password
# Click Sign In button in the iframe
# Navigate to /apps to verify
```

The SSO form is inside an iframe ("Container for sign in"). Browser automation tools need to interact with elements inside the iframe (agent-browser handles this transparently via snapshot refs).

### Starting local:test mode

Required for any work touching grants, budgets, billing, or paywalls. Dev mode stubs these endpoints.

**Config:** In `app/.env.local`, **comment out** `MGMT_AIRO_BASE_URL` so the app connects to the remote control plane at mgmt.nstk.net (not the local one).

**Step 1: Allow self-signed certs for agents**

In `agents/.env.local`, add:
```
NODE_TLS_REJECT_UNAUTHORIZED=0
```
Agents validate JWTs via local HTTPS proxy with self-signed certs.

**Step 2: Start services**
```bash
pnpm local:test
```

**URLs:**
- App: https://airo-builder.test-godaddy.com (requires `/etc/hosts`: `127.0.0.1 airo-builder.test-godaddy.com`)
- Agents: http://localhost:4000

### Starting local:test with local agents

If you need local:test to hit your local agents (instead of remote test agents), you need the local control plane:

**Step 1: Uncomment** `MGMT_AIRO_BASE_URL=http://localhost:4100` in `app/.env.local`

**Step 2: Start local control plane**
```bash
cd local-control-plane && AWS_PROFILE=airobuild-dev-private-sso make run
```
Listens on port 4100. Needs AWS SSO creds to fetch JWT signing keys from Secrets Manager.

**Step 3: Start services**
```bash
pnpm local:test
```

**Step 4: Create a test app**

Apps from the test environment won't exist in the local control plane's SQLite DB. Create a new app through the UI after switching.

### Enabling the budget service

Required for budget, credit display, and cost categorization work.

**Step 1:** Enable the `app-builder-budget-service` switchboard flag for your account. This flag is read server-side via `checkSwitchboardFlag('app-builder-budget-service', ...)` in `app/src/app/api/auth/agent-token/route.ts`. The exact toggle path may have changed since this was written (billing has since unified onto a single grants path), so verify against the current agent-token route rather than the older `app/server.ts` / `useSwitchboard.ts` toggle.

**Step 2:** In `agents/.env.local`, set the budget service URL for your environment:
```
# Dev environment
BUDGET_SERVICE_URL=https://budget-service.api.int.dev-godaddy.com

# Test environment
BUDGET_SERVICE_URL=https://budget-service.api.int.test-godaddy.com
```

BMS is migrating to a GoDaddy Gateway host (`bms.api.int.*`). The `budget-service.api.int.*` form above still works for now.

### AWS SSO

Agents auto-resolve AWS creds from `AWS_PROFILE` at startup (via `load-env.cjs`). Login once per day:
```bash
aws sso login --profile airobuild-dev-private-sso
```

### AI provider

Uses GoCode proxy (OpenAI-compatible API). Key env vars in `agents/.env`:
- `OPENAI_BASE_URL`: GoCode proxy endpoint
- `OPENAI_API_KEY`: GoCode API key
- `OPENAI_MODEL`: default `claude-sonnet-4`

## Why This Matters

Using the wrong mode leads to silent failures: billing code appears to work in dev mode because endpoints are stubbed, but breaks in production. Non-interactive startup is essential for CI, automated testing, and agent-driven workflows where the TUI can't run.

## When to Apply

- First-time local setup
- Switching between feature work (dev) and billing work (local:test)
- Running services from background processes or CI
- Debugging "grants not loading" or "paywall not working" issues (answer: switch to local:test)

### Troubleshooting

**`go.sum` checksum mismatch in local-control-plane:**
Internal Go modules (e.g., `github.com/gdcorp-golang/auth`) sometimes get re-tagged upstream. Fix:
```bash
cd local-control-plane
grep -v 'github.com/gdcorp-golang/auth' go.sum > go.sum.tmp && mv go.sum.tmp go.sum
GONOSUMCHECK=github.com/gdcorp-golang/auth GOFLAGS=-mod=mod go mod tidy
cd ..
```

**Apps page shows 0 apps:** The local control plane isn't running or `MGMT_AIRO_BASE_URL` is commented out in `app/.env.local`. Both must be active for the app to query the local mgmt API.

**Agents crash loop in non-interactive mode:** The file watcher (`dev:watch`) may restart and stop. Check `/tmp/agents-dev.log`. If it says "Waiting for file changes before restarting", the initial startup failed (usually a missing env var or port conflict).

## Examples

**Quick start for feature work (interactive terminal):**
```bash
aws sso login --profile airobuild-dev-private-sso
# Ensure app/.env.local has MGMT_AIRO_BASE_URL=http://localhost:4100 uncommented
AWS_PROFILE=airobuild-dev-private-sso pnpm dev
```

**Full non-interactive startup (all 3 services):**
```bash
aws sso login --profile airobuild-dev-private-sso
nohup pnpm dev:agents > /tmp/agents-dev.log 2>&1 &
nohup pnpm --filter website dev > /tmp/app-dev.log 2>&1 &
cd local-control-plane && nohup env AWS_PROFILE=airobuild-dev-private-sso make run > /tmp/control-plane-dev.log 2>&1 & cd ..
sleep 20
# Verify all 3 are up
curl -s -o /dev/null -w "agents:%{http_code} " http://localhost:4000/health
curl -s -o /dev/null -w "app:%{http_code} " https://local.gasket.dev-godaddy.com:8443
curl -s -o /dev/null -w "cp:%{http_code}" http://localhost:4100/health
```

**Agents-only for backend testing:**
```bash
nohup pnpm dev:agents > /tmp/agents-dev.log 2>&1 &
sleep 10
curl -s http://localhost:4000/health  # verify
```

**Switching to local:test for billing work:**
```bash
# 1. Comment out MGMT_AIRO_BASE_URL in app/.env.local (use remote CP)
# 2. Ensure agents/.env.local has NODE_TLS_REJECT_UNAUTHORIZED=0
pnpm local:test
# Login at https://airo-builder.test-godaddy.com with test credentials
```

## Related

- `GETTING_STARTED.md`: official setup guide
- `CLAUDE.md`: key commands section
- `local-control-plane/CLAUDE.md`: control plane details
