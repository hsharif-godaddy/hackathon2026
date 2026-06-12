---
title: Split large parallel-subagent branches into focused PRs
date: 2026-04-16
category: best-practices
module: development-workflow
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - multi-unit plans with 3+ implementation units
  - parallel subagent execution producing combined branches
  - feature branch exceeding ~15 changed files
tags:
  - pr-decomposition
  - parallel-subagents
  - branch-splitting
  - code-review
  - cherry-pick
  - shared-files
---

# Split large parallel-subagent branches into focused PRs

## Context

When executing a multi-unit plan with parallel subagents, all work lands on a single feature branch. A 10-unit plan (3 phases, 10 subagents) produced a 35-file, 4300+ line branch with 3 commits. This was flagged as too large to review.

The core tension: parallel execution is fast, but it produces monolithic branches. Reviewers need focused, independently mergeable PRs.

## Guidance

Split after the fact using selective file checkout and targeted edits to shared files.

### Step 1: Save the full branch reference

```bash
FULL=$(git rev-parse HEAD)
```

### Step 2: Create per-PR branches from main

```bash
git checkout -b refactor/feature-x main
```

### Step 3: Cherry-pick files unique to each PR

```bash
git checkout $FULL -- agents/src/tools/ai-lib-tools/publish.ts
git checkout $FULL -- agents/src/tools/ai-lib-tools/__tests__/publish.test.ts
```

### Step 4: Handle shared files manually

Shared registry files (index.ts, develop-agent.ts) on the full branch contain all registrations from all units. Do not cherry-pick them. Make targeted edits per branch adding only that PR's entries.

```typescript
// On refactor/memory-delete-app-status branch, index.ts adds only:
export { memoryDeleteAITool } from './memory-delete.js';
export { appStatusAITool } from './app-status.js';
```

Cherry-picking the full branch's index.ts would pull in registrations for tools that don't exist on this branch.

### Step 5: Track dependency order

Some PRs must merge before others. Document which.

### Step 6: Aim for <15 files per PR

## Why This Matters

- Large PRs get superficial or delayed reviews. Smaller PRs get thorough, fast reviews.
- Dependency-ordered branches can merge independently, reducing blast radius.
- Shared registry files need per-branch targeted edits, not full cherry-picks.

## When to Apply

- Multi-unit plans with 3+ implementation units
- Parallel subagent execution that produces combined branches
- Any feature branch exceeding ~15 changed files

## Examples

A 10-unit refactor was split into 5 branches:

| Priority | Branch | Units | Files | Dependencies | Status |
|---|---|---|---|---|---|
| -- | refactor/context-injection | 1,2,3 | 12 | none | merged (PR #2897) |
| 1 | refactor/rebuild-stages-db-export | 6,10 | 7 | none | pending |
| 2 | refactor/color-scheme-split | 5 | 6 | none | pending |
| 3 | refactor/publish-domain-tools | 4,9 | 9 | none (was blocked on context-injection) | unblocked |
| 4 | refactor/memory-delete-app-status | 7,8 | 8 | none | pending |

Grouping criteria: units that share files or have data dependencies go in the same PR. Independent units can be grouped by theme to keep PR count manageable.

## Related

- `docs/solutions/best-practices/ai-code-bloat-simplification-pass-2026-04-02.md` (multi-pass review workflow for AI-generated code)
