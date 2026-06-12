---
title: "local:test with local agents instead of remote"
date: 2026-03-31
last_updated: 2026-04-06
category: workflow-issues
module: local-dev
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - testing local code changes involving WebSocket events (budget_context, grant_context)
  - testing feature-flagged behavior with switchboard overrides
  - E2E browser testing against local agents with test SSO auth
  - manual testing for PRs that modify agent-side WebSocket handlers
  - testing agent-side env var config (BUDGET_SERVICE_URL, feature flags) that only affects local agents
tags:
  - local-dev
  - control-plane
  - socket-io
  - jwt-auth
  - env-config
  - local-test
  - websocket
  - budget-service
---

# local:test with local agents instead of remote

## Context

`pnpm run local:test` uses test SSO auth (`sso.test-godaddy.com`) but sets `MGMT_AIRO_BASE_URL=https://mgmt.nstk.net` (the remote control plane). The remote control plane returns remote agent URLs like `https://xxx.agent.c4.test-airoapp.ai`. The browser's Socket.IO connection goes to the remote agent, never hitting local agents on port 4000. This makes it impossible to test local code changes that involve WebSocket events or agent-side handlers.

## Guidance

### Prerequisites

- `/etc/hosts` must have: `127.0.0.1 airo-builder.test-godaddy.com`
- AWS SSO login: `aws sso login --profile airobuild-dev-private-sso`
- Docker running (local control plane needs it)
- **For BMS testing:** test account shopperId must be added to switchboard allowlist (`app-builder-budget-service` flag) before creating apps. See `docs/solutions/best-practices/cp-contract-alignment-bms-signup-runtime-gating-2026-04-13.md` "Test Account Setup" section. Requires `DEV-Airo-Builders` AD group.

### Setup

1. **`app/.env.local`** -- override control plane URL:

```
MGMT_AIRO_BASE_URL=http://localhost:4100
```

Switchboard flags are evaluated server-side via `@godaddy/gasket-plugin-switchboard` (no local override map). Enable any flag you need on the test account in Switchboard.

2. **`agents/.env.local`** -- allow self-signed cert for JWT validation:

```
NODE_TLS_REJECT_UNAUTHORIZED=0
```

3. **Start local control plane** (separate terminal):

```bash
cd local-control-plane && AWS_PROFILE=airobuild-dev-private-sso make run
```

4. **Start app + agents**:

```bash
pnpm run local:test
```

Three processes should be running:
- local-control-plane on :4100
- agents on :4000
- app on :3000 + :443 (HTTPS proxy)

5. **Create a new app** through the UI at `https://airo-builder.test-godaddy.com/` -- test env apps don't exist in the local control plane's SQLite DB.

## Why This Matters

| Config | Default (local:test) | With override |
|--------|---------------------|---------------|
| `MGMT_AIRO_BASE_URL` | `https://mgmt.nstk.net` (remote) | `http://localhost:4100` (local CP) |
| `agent_url` returned | `https://xxx.agent.c4.test-airoapp.ai` | `https://local.gasket.dev-godaddy.com:4000` |
| Socket.IO target | Remote agent | Local agent |

- The local control plane defaults `agent_url` to `https://local.gasket.dev-godaddy.com:4000` for all sites (`local-control-plane/internal/api/apps.go:114-115`), overridable via the `AGENTS_BASE_URL` env var (`apps.go:736-738`)
- Without `NODE_TLS_REJECT_UNAUTHORIZED=0`, agents can't fetch JWKS from `https://airo-builder.test-godaddy.com/.well-known/jwks.json` because that resolves to localhost via `/etc/hosts` and the local HTTPS proxy uses self-signed certs from mkcert
- Switchboard flags are evaluated server-side via `@godaddy/gasket-plugin-switchboard`; enable the flag on the test account in Switchboard rather than relying on a local override map

## When to Apply

- Testing local code changes that involve WebSocket events (budget_context, grant_context)
- Testing feature-flagged behavior with switchboard overrides
- Any E2E browser testing against local agents with test SSO auth
- Manual testing for PRs that modify agent-side WebSocket handlers

## Examples

**Before (broken):**
Browser on `airo-builder.test-godaddy.com` connects Socket.IO to `https://xxx.agent.c4.test-airoapp.ai` (remote). Local agents on :4000 never see traffic. Agent logs show no WebSocket connections.

**After (working):**
Local control plane returns `agent_url: https://local.gasket.dev-godaddy.com:4000`. Browser Socket.IO connects locally. Agent logs show:

```
websocket.auth.connection_approved
websocket.budget_context.received
```

## Diagnosing the Problem

The failure mode is **silent** -- prompts succeed normally because remote agents handle them. These signals indicate traffic is bypassing local agents:

| Signal | Where to check | Local (working) | Remote (broken) |
|--------|---------------|-----------------|-----------------|
| WebSocket URL | Browser console / Network tab | `wss://local.gasket.dev-godaddy.com:4000/...` | `wss://xxx.agent.c4.test-airoapp.ai/...` |
| Agent logs | `agents/dev.log` | Messages logged on each prompt | Empty / startup-only |
| Health endpoint | `curl http://localhost:4000/health` | `last_message_at` updates after prompt | `last_message_at` stale (hours/days old) |
| Agent env var changes | e.g. set `BUDGET_SERVICE_URL` | Takes effect | No effect |

**JWT decoding trick:** Fetch a fresh agent token from the browser console to confirm what claims the BFF is sending:

```js
fetch('/api/auth/agent-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ appId: '<appId>', siteId: '<siteId>' })
})
.then(r => r.json())
.then(d => JSON.parse(atob(d.token.split('.')[1])))
.then(console.log)
```

If `budgetServiceEnabled: true` appears in the JWT but local agents show no budget logs, traffic is going to remote agents.

## Gotchas

- **Stale pnpm symlinks**: deleted git worktrees leave broken symlinks in `node_modules/@airo/*`, causing build failures like `Cannot find module '@airo/shared/grants'`. Fix: `pnpm install`
- **AWS profile for local CP**: explicitly pass `AWS_PROFILE=airobuild-dev-private-sso` when starting the local control plane. Raw AWS creds in `agents/.env.local` can interfere with the Go process's AWS SDK config
- **`NEXT_PUBLIC_*` env vars**: baked at build time by Next.js. Must restart the app process after changing them -- HMR won't pick them up
- **Compact websocket logger**: the `🔌` prefix logger doesn't show structured data for `budget_context.received`. Check browser console for `websocket.budget_context.send` to see the actual payload values
- **Test env apps don't exist locally**: the local control plane has its own SQLite DB. Must create new apps via the UI after switching from remote to local control plane

## Related

- `local-control-plane/CLAUDE.md` -- local control plane service docs
- `local-control-plane/internal/api/apps.go` -- where `agent_url` defaults to `https://local.gasket.dev-godaddy.com:4000` (overridable via `AGENTS_BASE_URL`)
- `app/src/config/dynamic-api.ts` -- where the app resolves `agent_url` from site data
- `GETTING_STARTED.md` (line ~316) -- documents default local:test behavior
- `docs/solutions/developer-experience/local-dev-stuck-initialization-creating-status-2026-03-31.md` -- complementary troubleshooting for same environment
- `docs/solutions/developer-experience/gasket-nextjs-local-testing-constraints-2026-03-31.md` -- sibling doc for local:test constraints
