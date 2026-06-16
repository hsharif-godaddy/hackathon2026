# Type Design Analyzer

Review type safety and type design quality. Only run when the diff adds or modifies type definitions.

## What to Check

### `any` Usage
- New `any` annotations that could use a narrower type
- `any` in function parameters that accept known shapes
- Type assertions (`as any`) used to silence compiler errors instead of fixing types
- Generic parameters defaulting to `any` without constraints

### Discriminated Unions
- Union types missing a discriminant field (making exhaustive checks impossible)
- Switch/if chains on union types without exhaustive handling
- Type narrowing that relies on truthiness instead of discriminant checks

### Overly Broad Types
- `string` where a string literal union would be appropriate (known set of values)
- `object` or `Record<string, any>` where a specific interface exists
- `unknown[]` where tuple types or typed arrays would be more accurate
- Optional fields (`?`) used where the field is always present in practice

### Unsafe Assertions
- Non-null assertions (`!`) on values that could genuinely be null at runtime
- Type assertions (`as Type`) without runtime validation at trust boundaries
- `as const` assertions that mask a missing type definition

### Missing Constraints
- Generic type parameters without `extends` constraints that should have them
- Function overloads where a single generic signature would be clearer
- Index signatures (`[key: string]: T`) where a mapped type or specific keys apply

### Nullability
- Functions that return `T | null` without documenting when null occurs
- Parameters typed as optional but always provided by all callers
- Null checks on values the type system guarantees are defined (unnecessary guards)
- Missing null checks on values typed as nullable (possible runtime crash)

## Severity Classification

- [Critical]: Type assertion hiding a genuine runtime type mismatch (would crash)
- [Important]: `any` in public API signatures; missing null handling on nullable values at boundaries; union without exhaustive check in branching logic
- [Suggestion]: Overly broad types on internal code, missing constraints, unnecessary null guards

## Exclusions

- Do NOT flag `any` in test files (test utilities often need flexible types)
- Do NOT flag type assertions in test setup/mocking code
- Do NOT flag existing `any` in unchanged code
- Do NOT suggest type changes that would require large cascading refactors
- Do NOT flag vendor/generated type definitions
- Do NOT flag `unknown` used correctly at system boundaries

## Verification

Before reporting [Critical] or [Important]:
1. Confirm the type mismatch could actually occur at runtime (not just theoretical)
2. Check if the type assertion is guarded by a runtime check elsewhere
3. Verify that "missing null check" isn't handled by a higher-level wrapper or middleware
4. Confirm union handling is actually non-exhaustive (check all branches)
