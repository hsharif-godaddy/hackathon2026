---
title: Debugging stuck initialization screen in local dev (site in creating status)
date: 2026-03-31
category: developer-experience
module: app
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - Running locally with GASKET_ENV=local.test against test control plane
  - Site/job ID is still in 'creating' status with no agent or preview URL
  - First-time local setup or switching to a different test app
symptoms:
  - "Initialization screen stuck on 'Making sure the AI didn't break anything...' indefinitely"
  - "Repeated GET /api/servers/{siteId} returns 200 but preview never loads"
  - "Browser console shows 'dynamic-api.site.not-ready' with status: 'creating', hasAgentUrl: false"
  - "Subscription cache hitRate=0 with repeated misses for the app ID"
root_cause: incomplete_setup
resolution_type: documentation_update
tags:
  - local-dev
  - initialization
  - preview-pane
  - server-polling
  - health-check
  - control-plane
  - creating-status
---

# Debugging stuck initialization screen in local dev (site in creating status)

## Context

When running Airo Builder locally with `GASKET_ENV=local.test` and hosts file pointing `airo-builder.test-godaddy.com` to localhost, the app initialization can get stuck on "Making sure the AI didn't break anything..." indefinitely. The spinner never completes. Server-side logs show repeated `GET /api/servers/{id}` returning 200, making it look like everything is working. The actual diagnostic information is only visible in the browser console.

## Guidance

### 1. Check browser console first, not server logs

The most direct diagnostic is the browser console. Filter for `dynamic-api`:

```
dynamic-api.site.not-ready Site {id} not ready
  status: 'creating', hasAgentUrl: false
dynamic-api.config.fetch-failure Failed to fetch dynamic config for site
  error: 'Site {id} agent is not ready yet. Status: creating.'
```

If `status` is `creating` (not `running`), the site never finished provisioning in the test control plane. No amount of waiting will fix it locally.

### 2. Understand the initialization chain

The "Making sure the AI didn't break anything..." screen resolves when `isReady` becomes true in the server polling store. `isReady` requires ALL of:

1. `serverData.status === 'running'` (from `/api/servers/{id}`)
2. `!!serverData.url` (preview URL exists)
3. `healthCheckPassed` (HEAD request to preview URL returned 2xx)

The health check (step 3) only runs when `status === 'running' || status === 'starting'` AND `serverData.url` is truthy (`useServerPollingStore.ts` line ~249). If the site is in `creating` status with no URL, steps 2 and 3 are never attempted.

Key files in this chain:
- `app/src/stores/useServerPollingStore.ts` - polling loop + health check gate
- `app/src/app/[market]/develop/components/preview/PreviewPane.tsx` - loading UI gate (`!serverState.isReady`)
- `app/src/app/api/servers/[id]/route.ts` - returns raw `site.status` when no preview_url
- `app/src/lib/control-plane/v2-control-plane-adapter.ts` - `getSite()` fallback chain

### 3. Ignore subscription cache red herrings

Server logs (`app/dev.log`) may show subscription cache misses (`hitRate=0`) for your app ID. This is misleading for job-type IDs. Job IDs (e.g., `7274l6d`) resolve through `jobIdLookup()`, not the subscription cache. The `getSite()` fallback chain is:

1. Cache lookup (miss for job IDs - expected)
2. Cache refresh (still misses - expected)
3. Job ID lookup (finds the site)
4. Full subscription search (last resort)

Cache misses are expected for job-type IDs and are not the cause of the stuck initialization.

### 4. Resolution

Switch to an app that is in `running` status in the test environment. Visit `https://airo-builder.test-godaddy.com` directly and verify the app loads in the hosted environment. If it doesn't load there either, the app's Nomad allocation failed and a new app must be created.

### 5. Prerequisite: agents must be running

If agents fail to start with `EADDRINUSE` on port 4000, a stale agents process is holding the port:

```bash
lsof -ti:4000 | xargs kill -9
```

This is a separate issue from the stuck initialization but must be resolved first since WebSocket connections depend on agents.

## Why This Matters

The initialization flow has multiple layers (site status -> URL availability -> health check -> `isReady`), and each layer only activates when the previous one succeeds. When the root cause is at the earliest layer (site never provisioned), the symptom appears at the latest layer (spinner never resolves). Server-side logs return 200 responses and show no errors, creating a misleading picture. The actual diagnostic (`status: 'creating'`) is only in the browser console, which is easy to miss when focused on terminal logs.

## When to Apply

- Local dev initialization screen hangs indefinitely
- `GET /api/servers/{id}` returns 200 but the app never becomes interactive
- Server logs show subscription cache misses or repeated polling with no errors
- First-time local setup or switching to a different test app
- After resolving port conflicts or stale processes, but initialization still hangs

## Examples

### Quick diagnostic flow

1. Open browser DevTools -> Console tab
2. Filter for `dynamic-api`
3. Look for `site.not-ready` with `status: 'creating'`

If present: the site never provisioned. Switch to a `running` app.

### Verify app status on test site

Visit `https://airo-builder.test-godaddy.com` directly, log in, and check whether the app appears and loads. If the app shows an error or is missing, create a new app there, wait for it to reach `running` status, then use that app's ID locally.

### Full debugging chain

```
Browser console: dynamic-api.site.not-ready -> site status is not 'running'
  |
  v (if status IS running but still stuck)
Server logs (app/dev.log): GET /api/servers/{id} -> check response for url field
  |
  v (if url exists but still stuck)
Network tab: HEAD requests to preview URL -> check for CORS or network errors
  |
  v (if health check passes but still stuck)
Console: websocket.connection.* -> check WebSocket connection lifecycle
```

## Related

- `docs/preview-app-authentication.md` - documents the cross-domain auth flow that health checks participate in
- `docs/solutions/logic-errors/useusage-loading-state-enabled-bug-2026-03-31.md` - unrelated bug fix from the same session (useUsage hook, not initialization)
