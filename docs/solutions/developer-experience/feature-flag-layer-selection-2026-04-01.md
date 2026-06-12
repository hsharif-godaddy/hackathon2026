---
title: "Feature Flag Layer Selection -- Switchboard vs features.ts"
date: 2026-04-01
category: developer-experience
module: feature-flags
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - Adding a new feature flag to the app
  - Debugging why a flag isn't working locally
  - Planning implementation that references feature flags
  - Setting up local dev overrides for a flag
tags:
  - feature-flags
  - switchboard
  - features-ts
  - local-dev
  - local-overrides
  - gasket
---

# Feature Flag Layer Selection -- Switchboard vs features.ts

## Context

During budget service planning (Q2 2026), the implementation plan incorrectly listed `app/src/lib/features.ts` as a modification target for the `app-builder-budget-service` Switchboard flag. The code already consumed the flag correctly via `useSwitchboard('app-builder-budget-service')`, but the plan confused the two feature flag systems. This led to a completion gap: the actual work needed was adding the flag to switchboard local override lists, not to `features.ts`.

## Guidance

The app has two distinct feature flag systems. Know which one you're working with:

**Layer 1: Static env-var flags (`features.ts`)**
- File: `app/src/lib/features.ts`
- Parsed once at startup from `NEXT_PUBLIC_*` environment variables
- Accessed via `isFeatureEnabled.*` (e.g., `isFeatureEnabled.mockLogin()`, `isFeatureEnabled.developmentMode()`, `isFeatureEnabled.devSupervisorTcp()`)
- Build-time only; requires app restart to change
- Use for: infrastructure toggles, auth modes, dev tools

**Layer 2: Switchboard dynamic flags**
- Client: `useSwitchboard('flag-name')` hook in `app/src/hooks/useSwitchboard.ts`
- Server: `checkSwitchboardFlag('flag-name')` in `app/src/lib/switchboard/server.ts`
- Runtime flags from GoDaddy's Switchboard API (`bff.pcx.{rootDomain}/api/config/feature/`)
- Can be toggled without restart (in deployed environments)
- Use for: feature rollouts, billing mode switches, A/B tests, runtime gating

**Local dev behavior for Switchboard flags:**
- Flags are evaluated server-side by `@godaddy/gasket-plugin-switchboard` (IAM-authenticated) and serialized into gasket-data; the client hook reads those serialized values
- There is no local override map (`LOCAL_FEATURE_OVERRIDES` / `SERVER_LOCAL_FEATURE_OVERRIDES`) or `NEXT_PUBLIC_ENABLE_LOCAL_FEATURES` gate -- both were removed
- To exercise a flag locally, enable it in Switchboard for the test account

## Why This Matters

Misidentifying the flag layer causes:
- **Wrong file edits**: Adding a Switchboard flag to `features.ts` has no effect on code that calls `useSwitchboard()`
- **Broken local dev**: If a Switchboard flag isn't enabled in Switchboard for the test account, it resolves `false` locally
- **Wasted debugging time**: Flag "looks enabled" in one system but code checks the other

## When to Apply

- Adding any feature flag: determine if it's dynamic (Switchboard) or static (env var) first
- Debugging a flag that won't toggle: check which system the consuming code uses
- Planning work that references feature flags: verify the correct file targets
- Setting up local dev for a flagged feature: enable it in Switchboard for the test account

## Examples

**Identifying the layer from consuming code:**

```typescript
// Layer 1 (static) -- accesses features.ts
if (isFeatureEnabled.mockLogin()) { /* ... */ }

// Layer 2 (Switchboard) -- accesses Switchboard API
const { data: enabled } = useSwitchboard('app-builder-budget-service')
```

**Consuming a Switchboard flag:**

```typescript
// Server (app/src/lib/switchboard/server.ts) -- evaluated via gasket-plugin-switchboard, serialized to gasket-data
const enabled = await checkSwitchboardFlag('app-builder-budget-service')

// Client (app/src/hooks/useSwitchboard.ts) -- reads serialized value
const enabled = useSwitchboard('app-builder-budget-service')
```

For local dev, enable the flag in Switchboard for the test account. There is no local override map to edit.

## Related

- `docs/solutions/developer-experience/feature-flag-websocket-relay-pattern-2026-03-31.md` -- how Switchboard flags flow via WebSocket to agents (5-layer pattern)
- `docs/solutions/developer-experience/gasket-nextjs-local-testing-constraints-2026-03-31.md` -- local testing constraints including override activation
- `docs/solutions/best-practices/feature-flag-guard-replacement-2026-03-30.md` -- replacing flag proxies with capability checks during cleanup
- `app/CLAUDE.md` (Feature Flags section) -- canonical two-layer reference
