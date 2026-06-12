---
title: Replace feature flag guards with capability checks during flag cleanup
date: 2026-03-30
category: best-practices
module: grants
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - removing a feature flag that guarded error handlers or fallback paths
  - cleaning up conditional branches where the flag gated access to a subsystem
  - the flag was used as a proxy for "does this subsystem have state"
tags:
  - feature-flag
  - cleanup
  - grants
  - error-handling
  - rolling-deploy
---

# Replace feature flag guards with capability checks during flag cleanup

## Context

During removal of the `app-builder-grants` feature flag (64 files, ~3000 lines), a `BudgetExceededError` handler in `packages/ai-lib/src/core/agent-factory.ts` was simplified from:

```typescript
if (!socketId || !grantSessionManager.isFeatureEnabled(socketId)) {
  throw normalizedError
}
```

to just:

```typescript
if (!socketId) {
  throw normalizedError
}
```

This was too permissive. When `socketId` exists but no grants are mapped for the session, the code fell through into grant retry machinery (`advanceToNextGrant`, `requestGrantRefreshAndWait`) which all failed, transforming the original `BudgetExceededError` into `AllGrantsExhausted`. The user saw a misleading "all grants exhausted" message instead of the actual budget error.

## Guidance

When removing a feature flag guard, ask: **was the flag a proxy for a capability check?**

If `isFeatureEnabled(id)` was really asking "does this session have grants?", replace it with the direct capability check (`hasGrants(id)`), not with nothing.

```typescript
// Before: flag as proxy for capability
if (!socketId || !grantSessionManager.isFeatureEnabled(socketId)) {
  throw normalizedError
}

// Wrong: just delete the guard
if (!socketId) {
  throw normalizedError
}

// Right: replace with capability check
if (!socketId || !grantSessionManager.hasGrants(socketId)) {
  throw normalizedError
}
```

## Why This Matters

Feature flags often serve double duty: they gate a feature AND act as a proxy for whether the subsystem has initialized state. Removing the flag without replacing the capability check creates a path where code assumes state exists when it doesn't, producing confusing error messages and wasted API calls.

## When to Apply

- Error handlers that fall back to an alternative subsystem (grants, caching, billing)
- Retry loops gated by feature availability
- Any path where the flag prevented entering code that assumes subsystem state

## Examples

The `=== false` guard pattern for rolling deploy safety is a related technique from the same cleanup:

```typescript
// Old: truthy check (blocks undefined AND false)
if (!data.featureEnabled) { return }

// New: strict check (blocks only explicit false, passes undefined)
if (data.featureEnabled === false) { return }
```

This allows the field to be removed from the payload in a later deploy without breaking the agent during the rollout window.

## Related

- [Dual-path feature flag pattern](dual-path-feature-flag-react-query-websocket-2026-04-09.md) -- the dual-path pattern this cleanup applies to after migration completes
- `docs/solutions/developer-experience/feature-flag-layer-selection-2026-04-01.md` -- Switchboard vs features.ts layer distinction
- PR: gdcorp-partners/airo-app-builder#2342
