---
title: "Immutability patterns for shared module-level state in TypeScript"
date: 2026-03-30
category: best-practices
module: cross-cutting
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Exporting arrays, objects, or config from shared modules
  - Using module-level Maps/Sets as caches or registries
  - Sorting or mutating arrays that may be shared references
  - Deciding between as const, Object.freeze(), and Readonly<>
  - Reviewing PRs that touch module-level state
tags:
  - typescript
  - immutability
  - as-const
  - module-state
  - cache-eviction
  - code-quality
---

# Immutability patterns for shared module-level state in TypeScript

## Context

Codebase audit found ~27 mutable module-level objects spanning security-critical arrays, unbounded caches, and exported Maps. Some were active bugs (an `OAuthScopes.sort()` mutating a shared array per-request), some were memory leak vectors (unbounded server-side Maps), some were harmless (browser-scoped state). The audit revealed that not all mutable state is equal — classification determines the correct fix.

The originating cleanup plan has since been completed: the specific bug instances cited below (`OAuthScopes.sort()`, `pkceStateStore`/`PKCEState`) have been removed entirely, and `BYPASS_SITE_IDS` / `PLAN_PRIORITY` moved (`agents/src/services/` and `app/src/lib/paywall/shared.ts` respectively). The examples are retained as historical illustrations of the patterns; the **classification framework and decision trees below are the durable, reusable part**.

## Guidance

### 1. Classification framework

Classify module-level mutable state into one of five categories before choosing a fix:

| Category | Fix | Example |
|----------|-----|---------|
| **Static data** (arrays/objects that never change at runtime) | `as const` | `OAuthScopes`, `BYPASS_SITE_IDS` |
| **Server-side runtime caches** (Maps/Sets in Node.js process) | Cleanup/eviction logic | `site-validation-cache.ts`, `grant-session-manager.ts` |
| **Browser-scoped state** (Maps in `'use client'` modules) | None — bounded by tab lifetime | `agent-fetch.ts:tokenCache`, `file-agent.ts:tokenCache` |
| **Event-driven cleanup** (Maps cleaned on disconnect/completion) | None — already handled | WebSocket server Maps |
| **Lazy-init singletons** (`let cachedX = null`) | None — standard Node.js pattern | `nomad-config.ts:cachedConfig` |

### 2. `as const` decision tree

- Flat array/object constant -> `as const`
- Nested object with arrays -> plain `as const` (deeply freezes types)
- Object with explicit `Record<>` type annotation -> `as const satisfies Record<X, Y>` (annotation erases literal types; `satisfies` preserves them)
- Never use `Object.freeze()` if `as const` is the established pattern — mixing paradigms creates inconsistency

### 3. Type cascade awareness

Adding `as const` to an array changes it to `readonly string[]`. This cascades to: interfaces that store the array, error classes that expose it, function parameters that accept it, test mocks that override it. All must be updated atomically — `as const` alone will break compilation if consumers call `.sort()`, `.push()`, or expect `string[]`.

### 4. Exemplar cleanup patterns

Reference existing patterns in the codebase rather than inventing new ones:

- `site-validation-cache.ts` — TTL check on read + max-size on write (bounded cache exemplar)
- `grant-session-manager.ts` — interval-based stale entry removal + orphan cleanup + graceful shutdown
- `connectionStartTimes` — size-threshold pruning when exceeding N entries

### 5. Browser vs server classification

A file in `app/src/lib/` is NOT necessarily server-side. Check whether it's imported by `'use client'` components. If so, its module-level state lives in the browser and is bounded by tab lifetime. `file-agent.ts:tokenCache` was initially classified as server-side but turned out to be browser-scoped — imported exclusively by `ChatAttachmentMenu.tsx` and `FileUploadButton.tsx` (both `'use client'`).

### 6. Encapsulate exported Maps behind accessors

Don't export `Map` or `Set` directly. Wrap in accessor functions (`getX`, `setX`, `deleteX`, `clearX`). This prevents consumers from calling `.set()`, `.clear()`, or other mutating methods on shared state.

## Why This Matters

- An in-place `.sort()` on a shared exported array (the `OAuthScopes.sort()` case, since removed) mutates it per-request — a real production bug class
- Unbounded server-side Maps can cause OOM over time in long-running Node.js processes
- Exported mutable Maps break encapsulation — any consumer can `.set()` or `.clear()`
- Browser-scoped state incorrectly classified as server-side leads to unnecessary cleanup complexity
- Consistent patterns (`as const` everywhere, same cleanup shape) reduce cognitive load across the monorepo

## When to Apply

- When adding new module-level constants: use `as const`
- When adding new module-level Maps/Sets: classify browser vs server, add cleanup if server-side
- When exporting a Map/Set: encapsulate behind accessor functions instead
- When a `Record<>` type annotation is needed on a constant: use `as const satisfies Record<>`
- When reviewing PRs that touch module-level state
- When classifying whether a `app/src/lib/` file is server or browser: check import chain for `'use client'` directives

## Examples

### Fix in-place sort of shared array

**Before (bug):**
```typescript
export const OAuthScopes = ['scope1', 'scope2', 'scope3'];

// In request handler — mutates the shared array every call:
const sorted = OAuthScopes.sort().join(' ');
```

**After:**
```typescript
export const OAuthScopes = ['scope1', 'scope2', 'scope3'] as const;

// Spread-then-sort — original untouched:
const sorted = [...OAuthScopes].sort().join(' ');
```

### Preserve literal types with `satisfies`

**Before (literal types erased by annotation):**
```typescript
export const PLAN_PRIORITY: Record<Plan, number> = {
  None: 0, Free: 1, Basic: 2, Premium: 3,
};
// typeof PLAN_PRIORITY.Free === number (not 1)
// PLAN_PRIORITY.Free = 999 is allowed
```

**After:**
```typescript
export const PLAN_PRIORITY = {
  None: 0, Free: 1, Basic: 2, Premium: 3,
} as const satisfies Record<Plan, number>;
// typeof PLAN_PRIORITY.Free === 1 (literal preserved)
// PLAN_PRIORITY.Free = 999 is a type error
```

### Encapsulate exported Maps

**Before (any consumer can mutate):**
```typescript
export const pkceStateStore = new Map<string, PKCEState>();
```

**After:**
```typescript
const pkceStateStore = new Map<string, PKCEState>();

export function getPkceState(key: string): PKCEState | undefined {
  return pkceStateStore.get(key);
}

export function setPkceState(key: string, state: PKCEState): void {
  if (pkceStateStore.size >= MAX_SIZE) pruneOldest(pkceStateStore);
  pkceStateStore.set(key, state);
}

export function deletePkceState(key: string): void {
  pkceStateStore.delete(key);
}
```

## Related

- Exemplar: `app/src/app/api/auth/agent-token/site-validation-cache.ts` — bounded cache with TTL + max-size
- Exemplar: `packages/ai-grants/src/grant-session-manager.ts` — interval cleanup + graceful shutdown
