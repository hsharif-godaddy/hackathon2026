---
title: Propagating optional type changes across package boundaries
date: 2026-04-22
category: best-practices
module: packages/shared
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Making a required field optional in a shared package type
  - Adding nullability to date or timestamp fields
  - Adding new fields to interface contracts used across services
  - Any shared type change that produces zero compile errors (investigate why)
tags:
  - typescript
  - type-safety
  - shared-types
  - null-guard
  - monorepo
  - date-constructor
  - structural-typing
---

# Propagating optional type changes across package boundaries

## Context

PR #3036 changed `CreditGrant.useBefore` from `string` (required) to `string | null | undefined` (optional) in `packages/shared/src/grants/types.ts`. BMS budget items may not have expiration dates, so the field needed to become nullable.

The PR correctly updated some consumers (`GrantManager`, `GrantSessionManager`, the new adapter), but missed others. TypeScript reported zero compile errors for the missed consumers because JavaScript's `Date` constructor silently accepts bad input:

- `new Date(undefined)` returns Invalid Date (not an error)
- `new Date(null)` returns epoch, Jan 1 1970 (not an error)

Comparisons with Invalid Date always return false. Grants without expiration would be silently filtered out as "expired."

A second instance occurred in the same PR: `bmsBudgetId` was passed to `jwtService.getToken(tokenOptions)` but `CreateTokenOptions` didn't declare the field. TypeScript's structural typing silently dropped the extra property. The value was lost with no compile error.

## Guidance

### 1. Find all consumers before changing the type

```bash
git grep -n "grant\.useBefore" app/ packages/
git grep -n "\.useBefore" --include="*.ts" --include="*.tsx"
```

Every hit needs a null guard audit.

### 2. Guard against silent Date coercion

```typescript
// BROKEN: undefined -> Invalid Date -> comparison always false
const notExpired = new Date(grant.useBefore) > new Date()

// FIXED: null/undefined means no expiration (always valid)
const notExpired = !grant.useBefore || new Date(grant.useBefore) > new Date()
```

For sorting, null values should sort last (no expiration = lowest priority):

```typescript
grants.sort((a, b) => {
  if (!a.useBefore && !b.useBefore) return 0
  if (!a.useBefore) return 1
  if (!b.useBefore) return -1
  return new Date(a.useBefore).getTime() - new Date(b.useBefore).getTime()
})
```

### 3. Declare all fields on interface contracts

TypeScript silently drops undeclared properties on object literals:

```typescript
interface CreateTokenOptions {
  customerId: string
  // bmsBudgetId NOT declared
}

jwtService.getToken({
  customerId: 'cust_123',
  bmsBudgetId: 'budget_789'  // SILENTLY DROPPED
})
```

Add the field to the interface. Also add it to `getCacheKey()` and `createTokenPayload()` if the interface feeds into token/cache construction.

### 4. Run typecheck after shared type changes

```bash
pnpm typecheck
```

Vitest won't catch type mismatches (session history, (auto memory [claude])). `tsc` catches what vitest doesn't because vitest uses esbuild for transpilation, which strips type information at runtime.

## Why This Matters

- **Silent failures are worse than crashes.** `new Date(undefined)` doesn't throw, it returns a value that makes every comparison fail. Users see correct-looking UI with wrong data.
- **Shared type changes ripple widely.** A single field change in `packages/shared/` affects agents, app BFF, frontend hooks, UI components, and tests.
- **Partial updates create inconsistent behavior.** Some code paths handle null correctly while others silently fail, producing intermittent bugs that depend on data source (BMS vs legacy).
- **Structural typing drops properties silently.** Extra fields on object literals passed to functions vanish without trace. (session history)

## When to Apply

- Changing a field from required to optional (or vice versa)
- Adding `| null` or `| undefined` to an existing type
- Adding new fields to interfaces consumed by functions that construct tokens, caches, or payloads
- Any change in `packages/shared/` that produces zero `tsc` errors (that's suspicious, not reassuring)

Red flags:
- `new Date(value)` called on a newly-optional field
- Sort/filter operations on newly-nullable fields
- Object literals passed to functions when adding new properties
- No type errors after a breaking change

## Examples

### Missed consumer: getCreditPackGrants

```typescript
// BEFORE (broken after useBefore became optional)
.sort((a, b) => {
  const aExpired = !a.isAvailable || a.finalState !== null || new Date(a.useBefore) <= now
  // undefined -> Invalid Date -> comparison always false -> never "expired"
  // but also never "not expired" -> unpredictable sort
})

// AFTER (null-safe)
.sort((a, b) => {
  const aExpired = !a.isAvailable || a.finalState !== null
    || (a.useBefore ? new Date(a.useBefore) <= now : false)
})
```

### Missed consumer: getActiveGrants

```typescript
// BEFORE (broken)
if (new Date(grant.useBefore) <= now) return false
// undefined -> Invalid Date <= now -> false -> grant passes filter
// BUT: comparison semantics are inverted from intent

// AFTER (null-safe)
if (grant.useBefore && new Date(grant.useBefore) <= now) return false
// no useBefore = no expiration = active
```

### Discovery process

```bash
# Step 1: find all consumers
git grep -n "\.useBefore" app/ packages/ --include="*.ts" --include="*.tsx"

# Step 2: check each for null guards
# Missing guards -> needs fix

# Step 3: run typecheck
pnpm typecheck
```

## Related

- [BFF budget client stale field names](../integration-issues/bff-budget-client-stale-field-names-2026-04-07.md): sister issue, shared type field renames invisible to downstream consumers
- [Vitest esbuild strips enum type checks](../logic-errors/vitest-esbuild-strips-enum-type-checks-2026-04-07.md): tsc catches what vitest doesn't
- [NaN bypass in budget service fail-closed gate](../logic-errors/nan-bypass-budget-service-fail-closed-2026-04-06.md): parallel pattern, JavaScript silent coercion requiring explicit guards
- PR #3036: feat(paywall): bms support in experience
