---
title: Gasket/Next.js local testing constraints for switchboard-gated and subscription-dependent features
date: 2026-03-31
last_updated: 2026-03-31
category: developer-experience
module: app
problem_type: developer_experience
component: testing_framework
severity: high
applies_when:
  - Testing switchboard-gated features locally
  - Validating subscription plan-specific flows (free, starter, pro, ultimate)
  - Setting up browser automation for authenticated GoDaddy SSO sessions
  - Debugging switchboard flag overrides that work client-side but not server-side
  - Validating WebSocket payload changes between frontend and agents
related_components:
  - development_workflow
  - tooling
tags:
  - gasket
  - nextjs
  - local-testing
  - switchboard-flags
  - server-side-rendering
  - playwright
  - browser-automation
  - websocket
  - subscription-testing
---

# Gasket/Next.js local testing constraints for switchboard-gated and subscription-dependent features

## Context

Testing PR #2342 (removing `app-builder-grants` feature flag OFF branches) required validating UI flows across different subscription plans (free, starter, ultimate), switchboard flag states, and WebSocket payloads. Multiple browser automation approaches were tried (Playwright CLI, agent-browser, AppleScript) against the `local:test` environment. Several architectural constraints of the Gasket/Next.js stack were discovered that differ from standard Next.js behavior and affect how local testing must be structured.

(auto memory [claude]) Prior knowledge: `local.dev` environment with local control plane lacks subscriptions/grants data. Must use `local:test` with `sso.test-godaddy.com` for full testing.

## Guidance

### 1. Switchboard flags resolve via the gasket-plugin-switchboard plugin

```bash
pnpm run local:test
```

Flags are read through `@godaddy/gasket-plugin-switchboard`, not local override maps. `app/src/lib/switchboard/server.ts` wraps the plugin: it evaluates flags server-side using IAM auth, serializes the results into gasket-data, and exposes `checkSwitchboardFlag`. The client hook (`app/src/hooks/useSwitchboard.ts`) reads those serialized values (`useSwitchboard = getSwitchboardFlag`).

There is no longer a two-map override mechanism (`LOCAL_FEATURE_OVERRIDES` / `SERVER_LOCAL_FEATURE_OVERRIDES`) or an `NEXT_PUBLIC_ENABLE_LOCAL_FEATURES` env gate. To exercise a flag locally, the test account must have the flag enabled in Switchboard (see the BMS allowlist note in the sibling `local-test-with-local-agents` doc), since the plugin evaluates real flag state server-side.

### 2. API routes do NOT hot-reload in Gasket local:test mode

Changes to `app/src/app/api/*/route.ts` files require a **full server restart**. The Gasket HTTPS proxy (port 443) forwards to Next.js (port 3000), and the compilation pipeline caches routes aggressively.

Behaviors that do NOT trigger recompilation:
- Saving the file
- `touch`ing the file
- Waiting for Next.js dev watcher
- Navigating directly to the API route URL

Workaround:
```bash
# Stop the process (Ctrl+C)
rm -rf app/.next          # optional, forces full recompile
pnpm run local:test
```

This differs from standard Next.js dev mode where API routes recompile on save.

### 3. Subscription/grants data cannot be mocked client-side

Playwright `page.route()` only intercepts browser-initiated fetches. Subscription data comes from server-side BFF routes (`/api/subscriptions`) called during SSR/RSC and hydrated to the client via Gasket's data layer (`withGasketData()` / `useGasketData()`).

Approaches that do NOT work:
- Playwright route interception (`page.route('**/api/subscriptions', ...)`)
- agent-browser route blocking
- Client-side JavaScript overrides of fetch

For testing different subscription plans:
- **Preferred**: Use real test accounts with actual subscription levels on `sso.test-godaddy.com`
- **Alternative**: Add temporary BFF-level mocks in the API route, but these require a full restart to activate (see point 2)

### 4. Browser automation auth strategies for GoDaddy SSO

**Playwright CLI with persistent profile** (recommended):
```bash
playwright-cli open https://airo-builder.test-godaddy.com/ --headed --persistent --profile=/tmp/playwright-airo-profile
# Log in manually in the browser window
# Subsequent commands reuse the authenticated session
playwright-cli snapshot
playwright-cli click e5
```

**AppleScript for driving an existing Chrome window**:
```bash
# Requires: Chrome > View > Developer > Allow JavaScript from Apple Events
osascript -e 'tell application "Google Chrome" to execute active tab of window 1 javascript "document.title"'
```
Useful when Chrome is already authenticated. No remote debugging needed. Limited to JavaScript execution and window management (no screenshots, no element refs).

**agent-browser with Chrome remote debugging**:
```bash
# Quit all Chrome instances first, then:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug 2>/dev/null &
```
Both `--remote-debugging-port` and `--user-data-dir` are required. If Chrome is already running or `--user-data-dir` is omitted, the debugging port silently fails to open.

### 5. WebSocket payload interception via Playwright

Monkey-patch `WebSocket.prototype.send` via `page.evaluate()`:

```javascript
// Install the interceptor
await page.evaluate(() => {
  window._wsLog = [];
  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function(data) {
    const str = typeof data === 'string' ? data : '';
    if (str.includes('grant_context')) {
      window._wsLog.push({ time: Date.now(), preview: str.substring(0, 300) });
    }
    return origSend.apply(this, arguments);
  };
});

// Trigger events (e.g., visibility change)
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});

// Read captured events
const logs = await page.evaluate(() => JSON.stringify(window._wsLog));
```

The patch must be installed AFTER page load but BEFORE the events you want to capture. If installed too late (after WebSocket connection), initial events are missed.

### 6. Playwright CLI snapshot files accumulate in repo root

Playwright CLI saves snapshot `.yml` files to the current working directory by default. Over a testing session these pile up (40+ files in one session). Clean up after testing:

```bash
# Remove snapshot ymls (careful not to delete docker-compose.yml, api-spec.yml)
rm -f brew-back.yml develop-clean.yml gauge-popover.yml manage-plan.yml ...
rm -rf .playwright-cli/
```

Use `--filename=` to control output location, or run playwright-cli from a temp directory.

### 7. Component render locations differ from expected pages

Some components only render on specific routes, not where you might expect:

| Component | Renders on | NOT on |
|-----------|-----------|--------|
| `AppInactivityAlert` | `/apps` (app list page) | `/develop/*` |
| `HeaderUpgradeButton` | `/develop/*` only | `/manage-plan`, homepage, `/apps` |
| `UsageGauge` | `/develop/*` (inside `ChatInput`) | `/manage-plan` (has its own gauge) |

Testing on the wrong page wastes time. Check component imports to find the actual render location before testing.

### 8. Test env app provisioning can hang

New app creation on the test env (`airo-builder.test-godaddy.com`) allocates Nomad jobs via the mhp-core control plane. This can take 5+ minutes or hang indefinitely in "creating" status.

Console error when stuck: `hook.media_manifest.fetch.error - Site <id> agent is not ready yet. Status: creat...Please wait for deployment to complete.`

Check status via API:
```javascript
const res = await fetch('/api/sites');
const sites = await res.json();
// New app won't appear until Nomad job is allocated
```

Not a code issue. If stuck, try creating a different app or wait.

## Why This Matters

- **Server-side flag evaluation**: Switchboard flags are evaluated server-side and serialized to the client. A flag must be enabled in Switchboard for the test account; there is no local override map to toggle.
- **No hot-reload for API routes**: Developers expect Next.js dev mode behavior. The Gasket proxy layer breaks this expectation, leading to wasted debugging cycles when route changes appear to have no effect.
- **SSR blocks client mocking**: Traditional E2E mocking patterns (route interception) fundamentally do not work for subscription-gated flows. Test strategy must account for server-rendered data.
- **Auth complexity**: GoDaddy SSO requires specific setup for each automation tool. The wrong approach (e.g., remote debugging without `--user-data-dir`) fails silently.

## When to Apply

- Testing features gated by switchboard flags locally
- Testing flows that differ by subscription plan (free/starter/pro/ultimate)
- Setting up browser automation for authenticated GoDaddy SSO sessions
- Debugging switchboard flag overrides that work client-side but not server-side
- Validating WebSocket payload changes between frontend and agents
- Troubleshooting API route changes not appearing after file edits
- Debugging why a component isn't rendering during manual testing (check render location)
- Cleaning up after Playwright CLI testing sessions

## Examples

### Reading a switchboard flag

Server (`app/src/lib/switchboard/server.ts`) evaluates via `@godaddy/gasket-plugin-switchboard` and serializes to gasket-data:
```typescript
const enabled = await checkSwitchboardFlag('appbuilder-airoplus-paywall');
```

Client (`app/src/hooks/useSwitchboard.ts`) reads the serialized value:
```typescript
const enabled = useSwitchboard('appbuilder-airoplus-paywall');
```

To exercise the flag locally, enable it in Switchboard for the test account. There is no local override map to edit.

## Related

- `docs/solutions/developer-experience/feature-flag-layer-selection-2026-04-01.md` -- Switchboard vs features.ts layer distinction
- `app/CLAUDE.md` (Feature Flags section): documents the two-layer switchboard system
- `app/TESTING.md`: testing guidelines (lacks switchboard-specific guidance)
- `app/MOCK-AUTH-SETUP.md`: mock auth setup (different from SSO testing)
- `docs/preview-app-authentication.md`: JWT auth for preview apps
- `docs/solutions/best-practices/feature-flag-cleanup-orphaned-artifacts-2026-03-31.md`: flag removal checklist
- `docs/solutions/developer-experience/local-dev-stuck-initialization-creating-status-2026-03-31.md`: complementary local dev troubleshooting
- `docs/solutions/tooling-decisions/nextjs-image-optimization-bypass-katana.md`: another Gasket/Next.js convention that behaves differently in local vs deployed (image optimization unavailable in Katana)
