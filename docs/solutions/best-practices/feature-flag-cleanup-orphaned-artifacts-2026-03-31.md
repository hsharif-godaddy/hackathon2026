---
title: "Verify orphaned artifacts after feature flag cleanup"
date: 2026-03-31
category: best-practices
module: refactoring
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - removing feature flag code paths across multiple files
  - deleting files that export constants or utilities consumed by removed code
  - reviewing refactors spanning 50+ files or significant line deletions
tags:
  - feature-flag
  - dead-code
  - orphaned-hook
  - cleanup
  - refactoring
  - grants
---

# Verify orphaned artifacts after feature flag cleanup

## Context

During PR #2342 ("feat: remove app-builder-grants OFF branches"), an 84-file refactor removed all legacy feature flag OFF code paths (-4507/+544 lines). The cleanup successfully deleted several orphaned files (`EntitlementPollingService`, `useUpdateEntitlement`, `LegacyPopoverContent`), but one orphaned hook `app/src/hooks/useDailyUsage.ts` (155 lines) was missed.

The hook had zero importers after the cleanup but remained in the codebase. It also exported a `TOAST_THRESHOLD=90` constant that was duplicated locally in `useUsage.ts`, creating two sources of truth for the same value.

The orphan was caught during code review by two independent reviewers (maintainability and type-safety lenses) who both grepped for the hook name and found zero importers. Cross-reviewer agreement boosted confidence to 1.0.

## Guidance

After removing feature flag code paths, systematically verify that all secondary artifacts (hooks, services, utilities, constants) have remaining consumers:

1. **Audit file imports** for every file that was only used by removed code:
   ```bash
   # Find all references to a suspected orphan
   git grep "useDailyUsage" -- app/src
   # Zero results = safe to delete
   ```

2. **Check exported constants** for duplication:
   ```bash
   # If the orphan exports constants, check for duplicates
   git grep "TOAST_THRESHOLD" -- app/src
   ```

3. **Verify typecheck after deletion**:
   ```bash
   rm app/src/hooks/useDailyUsage.ts
   pnpm typecheck  # Confirm no hidden type dependencies
   ```

4. **Use multiple review lenses**: Orphans that survive initial cleanup are often caught by reviewers focused on maintainability or type-safety rather than correctness.

## Why This Matters

- Orphaned hooks remain in the bundle and type definitions, adding cognitive load during future refactors
- Duplicate constants (like `TOAST_THRESHOLD` in two places) risk divergence if one is updated and the other forgotten
- Large flag cleanups are high-risk for missed orphans because conditional branches hide secondary dependencies
- Incomplete cleanup leaves reviewers uncertain whether the refactor is done, reducing confidence in the PR

## When to Apply

- After removing large feature flags or conditional code paths across multiple files
- When deleting files that export constants or utilities (high likelihood of duplication elsewhere)
- During code review of refactors spanning 50+ files
- When the deleted code had "utility" consumers (hooks, services) that were only used by the removed code paths

## Examples

**Before (orphaned hook remains after flag cleanup):**
```
app/src/hooks/useDailyUsage.ts  (155 lines, zero importers)
  exports: TOAST_THRESHOLD = 90

app/src/hooks/useUsage.ts
  local: const TOAST_THRESHOLD = 90  (duplicate)

$ git grep "useDailyUsage" -- app/src
app/src/hooks/useDailyUsage.ts:...  # Only the definition itself
```

**After (cleanup verified):**
```bash
$ git grep "useDailyUsage" -- app/src
# (no output -- confirmed zero references)

$ git grep "TOAST_THRESHOLD" -- app/src
app/src/hooks/useUsage.ts:const TOAST_THRESHOLD = 90;
# Single source of truth

$ pnpm typecheck
# No new errors
```

**Prevention checklist for flag cleanup PRs:**
- Search for all importers of files touched by the flag removal (not just direct call sites)
- Identify constants exported by files that lost their consumers
- Audit test mocks and spy assertions for references to deleted/refactored functions
- Run typecheck + test suite locally before push

## Related

- [feature-flag-guard-replacement-2026-03-30.md](../best-practices/feature-flag-guard-replacement-2026-03-30.md) -- companion doc: how to replace flag guards with capability checks during the same cleanup
- [useusage-loading-state-enabled-bug-2026-03-31.md](../logic-errors/useusage-loading-state-enabled-bug-2026-03-31.md) -- sibling issue from same PR: `useUsage` hook loading state regression after flag removal
- [usePaywallModal-stale-spy-assertions-2026-03-31.md](../test-failures/usePaywallModal-stale-spy-assertions-2026-03-31.md) -- sibling issue: test assertion failures after hook signature changes during flag removal
- PR #2342: feat: remove app-builder-grants OFF branches
- [pnpm-workspace-hoisting-script-dependency.md](../build-errors/pnpm-workspace-hoisting-script-dependency.md) -- sibling pattern: dead-dep removal broke root script import
