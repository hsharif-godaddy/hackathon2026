---
title: Stale clone in tool construction closure leaks state across invocations
date: 2026-04-06
category: logic-errors
module: ai-lib
problem_type: logic_error
component: service_object
severity: medium
symptoms:
  - Child agent mutations persist into subsequent delegate tool invocations
  - State leaks between unrelated delegations on the same socket
root_cause: logic_error
resolution_type: code_fix
tags:
  - delegate-tool
  - closure
  - clone
  - mutation
  - execution-context
  - per-invocation
---

# Stale clone in tool construction closure leaks state across invocations

## Problem

`createDelegateTool` cloned `executionContext.metadata` at tool construction time (once), not per-invocation. The cloned object was reused across all delegations from the same agent, so mutations by one child agent leaked into subsequent invocations.

## Symptoms

- If child agent A mutates `metadata.budgetBudgetId`, child agent B (invoked later by the same parent) sees A's mutated value
- State leaks silently; no errors thrown
- Budget session attribution could drift across delegations within a single prompt

## What Didn't Work

Not applicable; found by copilot code reviewer on PR #2572 before reaching production.

## Solution

Move the clone from the tool's outer closure to inside the async handler (per-invocation).

**Before:**
```typescript
export function createDelegateTool(factory, sourceAgentId, executionContext?) {
  // Clone once at construction -- STALE for subsequent calls
  const clonedContext = executionContext
    ? { ...executionContext, metadata: { ...(executionContext.metadata as Record<string, unknown>) } }
    : undefined

  return createTool(/* ... */, async ({ targetAgent, task }) => {
    const result = await factory.executeHandoff(sourceAgentId, targetAgent, handoffContext, clonedContext)
  })
}
```

**After:**
```typescript
export function createDelegateTool(factory, sourceAgentId, executionContext?) {
  return createTool(/* ... */, async ({ targetAgent, task }) => {
    // Clone per-invocation -- fresh copy for each delegation
    const clonedContext = executionContext
      ? { ...executionContext, metadata: executionContext.metadata ? { ...(executionContext.metadata as Record<string, unknown>) } : undefined }
      : undefined

    const result = await factory.executeHandoff(sourceAgentId, targetAgent, handoffContext, clonedContext)
  })
}
```

## Why This Works

The outer closure captures `executionContext` by reference. Cloning it once at construction produces a single shared copy. Each child agent receives the same object, and mutations accumulate. Moving the clone inside the handler creates a fresh shallow copy per delegation, isolating each child's mutations.

## Prevention

- When passing mutable state through closures in tool/handler factories, clone at invocation time, not construction time
- Pattern: factory captures the *source* by reference, handler clones per-call
- If deep isolation is needed (nested objects), use `structuredClone()` instead of spread

## Related Issues

- PR #2572: Budget GoCode passthrough + report creation
- `docs/solutions/logic-errors/budget-headers-inherited-on-grant-fallback-retry-2026-04-06.md`: related pattern (shared mutable state leaking across retry paths)
