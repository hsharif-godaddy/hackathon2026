---
title: Per-workspace fallow configs to prevent OOM in monorepo
date: 2026-06-08
category: tooling-decisions
module: development_workflow
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - Running fallow dead-code analysis from repo root
  - Adding new workspaces to the monorepo
  - Fallow reports false positives from cross-workspace deps
tags:
  - fallow
  - dead-code
  - monorepo
  - memory
  - tooling
---

# Per-workspace fallow configs to prevent OOM in monorepo

## Context

`fallow` (v2.88.3) OOMs when building the dependency graph across this monorepo's 22 workspaces. Even scoped to a single workspace (`--workspace agents`, 1061 files, single-threaded), it hits 27GB in 30 seconds and crashes VS Code.

The root cause is fallow's architecture: the full cross-workspace dependency graph is always built before any filtering. The `--workspace`, `--changed-since`, and `--file` flags are output filters only.

Commands that skip the graph work fine: `fallow dupes` (2.8s), `fallow list` (instant).

Prior sessions attempted `--threads 1`, `--production` mode, and workspace scoping. None reduced memory. (session history)

## Guidance

Isolate fallow's graph with per-workspace config files in `.fallow/`. Each config uses top-level `ignorePatterns` to exclude other workspaces, so fallow only loads files from one workspace group.

```jsonc
// .fallow/agents.json
{
  "ignorePatterns": [
    "app/**", "packages/**", "blog/**", "cdk/**", /* ...other workspaces */
    "agents/src/skills/**/templates/**"  // resolve in generated apps, not here
  ],
  "ignoreDependencies": [
    "@airo/shared", "@airo/ai-lib"  // cross-workspace, can't resolve
  ],
  "ignoreUnresolvedImports": ["@/*", "#airo/*"]  // template path aliases
}
```

Run via wrapper scripts:

```bash
./scripts/fallow-safe.sh                      # default: all checks, ~1s total
./scripts/fallow-safe.sh --unresolved-imports # specific check
./scripts/fallow-dead-files.sh                # find confirmed dead files
./scripts/fallow-dead-files.sh --delete       # find and delete them
```

## Why This Matters

Without isolation, fallow is completely unusable in this repo. With per-workspace configs, each run completes in under 1 second with normal memory. This makes dead-code detection, unused dep detection, and unlisted dep detection practical for daily use.

## When to Apply

- Running fallow from repo root (always use `./scripts/fallow-safe.sh`)
- Adding a new workspace: add it to the appropriate `.fallow/*.json` config, exclude it from the others
- False positives from cross-workspace deps: add to `ignoreDependencies` explicitly (globs not supported)
- False positives from framework-loaded deps (Gasket, CDS): add to `ignoreDependencies`

## Examples

**Config that does NOT work** (silently ignored):

```jsonc
{
  "workspaces": {
    "packages": ["agents/"],         // ignored, fallow reads pnpm-workspace.yaml
    "ignorePatterns": ["app/**"]     // ignored, resolved config shows patterns: []
  }
}
```

**Config that DOES work:**

```jsonc
{
  "ignorePatterns": ["app/**", "packages/**"]  // top-level only
}
```

**`ignoreDependencies` does NOT support globs:**

```jsonc
// WRONG: "@airo/*" is treated as a literal string, not a glob
"ignoreDependencies": ["@airo/*"]

// RIGHT: list each package explicitly
"ignoreDependencies": ["@airo/shared", "@airo/ai-lib", "@airo/ai-transport"]
```

**Known false positive categories:**

| Category | Suppress via |
|----------|-------------|
| Template files (`skills/**/templates/**`) | `ignorePatterns` |
| `.js` imports referencing `.ts` files (ESM) | `ignoreUnresolvedImports` |
| Barrel/index files (re-exports) | `ignorePatterns` on specific files |
| Gasket/CDS plugin-loaded deps | `ignoreDependencies` |
| Cross-workspace `@airo/*` deps | `ignoreDependencies` |
| SCSS/CSS tooling imports | `ignoreUnresolvedImports` |

## Related

- `docs/solutions/best-practices/fallow-audit-scoped-to-pr-files.md` (complementary: scoping audit fixes to PR files)
- `.fallow/agents.json`, `.fallow/app.json`, `.fallow/packages.json` (the configs)
- `scripts/fallow-safe.sh`, `scripts/fallow-dead-files.sh` (wrapper scripts)
