---
title: "pnpm workspace: dead entries and glob exclusions"
date: 2026-06-08
category: conventions
module: root
problem_type: convention
component: tooling
severity: low
applies_when:
  - "Removing a workspace package from the monorepo"
  - "Adding non-JS directories under a glob-matched path (e.g. Go packages under packages/)"
  - "Seeing fallow warnings about missing package.json in workspace members"
tags:
  - pnpm
  - workspace
  - fallow
  - monorepo
  - glob
---

# pnpm workspace: dead entries and glob exclusions

## Context

`pnpm-workspace.yaml` declared `'setup'` (directory deleted in PR #3024, April 2026) and used a `'packages/*'` glob that matched Go packages (`packages/go-auth`, `packages/logging`) with no `package.json`. These stale entries caused fallow workspace discovery warnings on every run.

## Guidance

**Remove workspace entries when directories are deleted.** The entry alone causes tools to warn even after the code is gone.

**Use negation patterns for non-JS directories matched by globs:**

```yaml
packages:
  - 'packages/*'
  - '!packages/go-auth'
  - '!packages/logging'
```

pnpm honors `!`-prefixed patterns as exclusions. This keeps the convenience of `packages/*` while skipping directories that aren't JS workspaces.

**Known fallow limitation:** Fallow's `ignorePatterns` config (`workspaces.ignorePatterns` in `.fallowrc.json`) only suppresses analysis-phase findings. It does NOT suppress workspace discovery diagnostics. Directories with a `package.json` that aren't listed as workspaces (`app-templates/v8`, `container-scripts/preview`, `investigator`) still produce informational diagnostics even when listed in `ignorePatterns`. This is a fallow bug (v2.88.3). No workaround exists.

## Why This Matters

- Stale workspace entries cause noisy warnings in fallow, pnpm, and any tool that reads `pnpm-workspace.yaml`
- Non-JS directories matched by globs can trigger unexpected behavior in tools that assume all workspace packages have `package.json`
- fallow's 8+ minute OOM on this repo (35GB+ memory) was partially caused by workspace resolution confusion

## When to Apply

- Deleting a package/workspace directory from the repo
- Adding Go, Rust, or other non-JS code under a directory matched by a workspace glob
- Configuring fallow and seeing persistent workspace discovery diagnostics despite `ignorePatterns`

## Examples

**Before:**

```yaml
packages:
  - 'packages/*'      # matches go-auth, logging (no package.json)
  - 'setup'           # deleted in PR #3024
  - 'cdk'
```

**After:**

```yaml
packages:
  - 'packages/*'
  - '!packages/go-auth'
  - '!packages/logging'
  - 'cdk'
```

## Related

- PR #4151 (`feat/paywall-spinner-in-button`)
- `docs/solutions/tooling-decisions/fallow-monorepo-memory-isolation.md` (per-workspace config isolation when glob hygiene alone doesn't prevent OOM)
