---
title: usePaywallModal test assertions don't match refactored hook signature
date: 2026-03-31
category: test-failures
module: app/src/hooks/usePaywallModal.test.tsx
problem_type: test_failure
component: testing_framework
severity: low
symptoms:
  - "CI failure: spy expected to be called with ('app-456') but called with [] (no args)"
  - "CI failure: spy expected to be called with (undefined) but called with [] (no args)"
root_cause: logic_error
resolution_type: test_fix
tags:
  - react-hooks
  - test-assertions
  - spy-arity
  - feature-flag-removal
  - refactor-regression
---

# usePaywallModal test assertions don't match refactored hook signature

## Problem

Two tests in `usePaywallModal.test.tsx` failed in CI after `usePaywallEligibility` was refactored from `(appId?: string)` to `()` during the `app-builder-grants` flag removal. The call site was updated but test spy assertions still expected the old parameter-passing behavior.

## Symptoms

- CI job `quality-checks-app-unit-tests` failed with 2 assertion errors
- `expect(spy).toHaveBeenCalledWith('app-456')` received `[]`
- `expect(spy).toHaveBeenCalledWith(undefined)` received `[]`
- Both at `src/hooks/usePaywallModal.test.tsx:160` and `:175`

## What Didn't Work

Straightforward diagnosis — the error messages directly showed the arity mismatch.

## Solution

```diff
- expect(spy).toHaveBeenCalledWith('app-456');
+ expect(spy).toHaveBeenCalled();

- expect(spy).toHaveBeenCalledWith(undefined);
+ expect(spy).toHaveBeenCalled();
```

Two-line change at `app/src/hooks/usePaywallModal.test.tsx:160,175`.

## Why This Works

`usePaywallEligibility` changed from per-app eligibility (taking `appId`) to account-level subscription check (no args). The hook in `usePaywallModal.tsx:86` was correctly updated to `usePaywallEligibility()`, but the integration tests still asserted the old calling convention. `toHaveBeenCalled()` correctly validates the hook is invoked without asserting specific arguments.

## Prevention

1. **Grep tests for old signatures.** When changing a function/hook signature, search test files for spy assertions referencing it: `grep -r "toHaveBeenCalledWith" --include="*.test.*" | grep "functionName"`.

2. **Run affected tests before push.** `pnpm --filter website test "usePaywallModal"` would have caught this before CI.

3. **Feature flag removal checklist.** When removing flag-gated code, verify both production code AND test assertions match the simplified signatures. Tests that mock or spy on refactored hooks are especially prone to arity drift.

## Related Issues

- PR: gdcorp-partners/airo-app-builder#2342 (feat: remove app-builder-grants OFF branches)
- Related: `docs/solutions/logic-errors/useusage-loading-state-enabled-bug-2026-03-31.md` (sibling regression from same PR)
- Related: `docs/solutions/best-practices/feature-flag-guard-replacement-2026-03-30.md` (flag removal patterns from same PR)
