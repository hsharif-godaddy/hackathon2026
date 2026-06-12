---
title: Vitest esbuild strips enum type checks, tsc catches them
date: 2026-04-07
category: logic-errors
module: app/api/credits
problem_type: logic_error
component: testing_framework
severity: medium
symptoms:
  - Tests pass with vitest but tsc --noEmit reports type errors
  - String literal used where enum value expected
  - Structurally identical types treated as incompatible
root_cause: test_isolation
resolution_type: test_fix
tags:
  - vitest
  - typescript
  - type-checking
  - esbuild
  - enum-validation
---

# Vitest esbuild strips enum type checks, tsc catches them

## Problem

When switching from `CreditGrant` (`@airo/shared/grants`) to `AiroCreditGrant` (`@/lib/mgmt-airo`) in a BFF route, type mismatches were introduced that vitest did not catch. Tests passed at runtime but `tsc --noEmit` failed.

## Symptoms

- `tsc --noEmit` reports `TS2345: Argument of type 'CreditGrant[] | AiroCreditGrant[]' is not assignable`
- Test mock uses `type: 'plan-monthly'` (string literal) but `AiroCreditGrant.type` expects `AiroGrantType` enum
- `.catch()` fallback uses `[] as CreditGrant[]` but `getCreditGrants()` returns `AiroCreditGrant[]`
- All 19 vitest tests pass green

## What Didn't Work

Running only `pnpm --filter website test` after the type refactor. Vitest uses esbuild for transpilation, which strips all TypeScript types at runtime. The test runner cannot detect:
- Enum vs string literal mismatches
- Union type incompatibilities from mismatched generics
- Nominal type differences between structurally identical interfaces

## Solution

1. Use the correct enum from the new type's package:

```typescript
// Before (shared grants enum)
import type { CreditGrant } from '@airo/shared/grants';

const MOCK_GRANT: CreditGrant = {
  type: 'plan-monthly', // string literal works with GrantType
};

// After (mgmt-airo enum)
import { type AiroCreditGrant, AiroGrantType } from '@/lib/mgmt-airo';

const MOCK_GRANT: AiroCreditGrant = {
  type: AiroGrantType.PlanMonthly, // must use AiroGrantType enum
};
```

2. Match the catch fallback type to the function return type:

```typescript
// Before
return [] as CreditGrant[];

// After
return [] as AiroCreditGrant[];
```

## Why This Works

TypeScript uses nominal typing for enums. `GrantType.PlanMonthly` and `AiroGrantType.PlanMonthly` both have value `'plan-monthly'`, but TypeScript treats them as incompatible types. At runtime (esbuild), enums are just strings, so tests pass. At type-check time (`tsc`), the nominal mismatch is caught.

## Prevention

- Run `pnpm typecheck` (or `pnpm --filter <pkg> typecheck`) after any commit that changes type imports, interface references, or enum usage. Don't rely on vitest alone for type correctness.
- When switching from one type alias to another (even structurally identical ones), update all references: type annotations, generic parameters, enum values, and type assertions.
- Never mix enums from different packages even if they have identical string values.

## Related Issues

- `docs/solutions/integration-issues/bff-budget-client-stale-field-names-2026-04-07.md` -- sibling issue: field name drift also invisible until tsc runs
- `docs/solutions/best-practices/bff-budget-client-iam-s2s-auth-2026-04-07.md` -- notes `as z.ZodType<T>` cast suppresses compile-time checking (same class of type escape hatch)
- `docs/solutions/best-practices/bff-parallel-fetch-enrichment-2026-04-07.md` -- the code where this bug occurred
