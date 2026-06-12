---
title: Scoping fallow audit fixes to PR-changed files only
date: 2026-06-08
category: best-practices
module: app
problem_type: best_practice
component: development_workflow
severity: low
applies_when:
  - Running fallow audit on a feature branch with many inherited findings
  - Fallow reports hundreds of issues but only a subset relate to your PR
tags:
  - fallow
  - dead-code
  - code-quality
  - pr-hygiene
---

# Scoping fallow audit fixes to PR-changed files only

## Context

`fallow audit` reports all dead code, duplication, and complexity across the entire `app/` package. On a feature branch with 196 changed files vs main, fallow found 70 dead-code issues, 73 complexity findings, and 50 clone groups. Most are inherited from main and unrelated to the PR's changes.

## Guidance

Cross-reference fallow output against your PR's changed file list before fixing anything. Only fix issues in files your PR actually touches.

**Workflow:**

```bash
# Get PR changed files
gh pr diff <PR_NUMBER> --name-only

# Run fallow in the app package
cd app && fallow audit
# or: fallow dead-code

# Cross-reference: only fix issues in files from step 1
```

**Safe to fix (PR-scoped):**
- Circular deps in files you changed (e.g., barrel re-exporting itself)
- Unused barrel exports when you can verify no external consumers exist
- Duplication across files you already modified

**Leave alone (inherited from main):**
- Unused exports in files you didn't touch
- Complexity findings (require major refactors)
- Unused dependencies (false positives from framework plugins like Gasket)
- Unresolved imports in `.scss` files (framework-handled)

## Why This Matters

Fixing unrelated fallow issues in a feature PR creates noise in review, inflates the diff, and risks merge conflicts. Scoped fixes keep the PR focused and reviewable.

## When to Apply

- Before pushing a feature branch that ran `fallow audit`
- When CI gates on fallow findings (currently advisory, not blocking)
- When cleaning up dead code as a fast-follow after a feature lands

## Examples

**Circular dependency fix (PR-scoped):**

```typescript
// Before: UsageGauge.tsx imports from barrel which re-exports itself
import { GrantsPopoverContent } from '.'

// After: direct import breaks the cycle
import { GrantsPopoverContent } from './GrantsPopoverContent'
```

**Barrel trimming (PR-scoped, with consumer verification):**

```bash
# Verify no external consumers before removing re-exports
grep -r "from.*components/paywall'" src/ --include="*.ts" --include="*.tsx"

# Only keep exports that have external barrel consumers
# Internal relative imports (within the directory) don't count
```

**Duplication extraction (PR-scoped):**

When fallow flags a clone group across files you're already modifying, extract the shared code. Example: collapsible card toggle button repeated in AddonCreditCard and PlanCreditsCard became a shared `CollapsibleCardToggle` component.

## Related

- PR #4415 (test/cart-loading-e2e-coverage branch)
- fallow docs: https://docs.fallow.tools/explanations/dead-code
