---
title: Root script import fails after removing dependency from root package.json
date: 2026-06-08
category: build-errors
module: package-management
problem_type: build_error
component: development_workflow
symptoms:
  - "Pre-commit hook fails with ERR_MODULE_NOT_FOUND for gray-matter"
  - "pnpm install completes but root-level script cannot resolve dependency"
  - "Dependency exists in workspace packages but not accessible from root scripts"
root_cause: missing_workflow_step
resolution_type: dependency_update
severity: medium
tags:
  - pnpm
  - monorepo
  - workspace-hoisting
  - pre-commit-hooks
  - dependency-management
  - dead-code-removal
---

# Root script import fails after removing dependency from root package.json

## Problem

Removing `gray-matter` from root `package.json` devDependencies broke the pre-commit hook because `scripts/validate-skill.mjs` imports it, and pnpm's strict resolution doesn't hoist workspace package dependencies to root `node_modules`.

## Symptoms

- Pre-commit hook exits with code 1
- Error: `ERR_MODULE_NOT_FOUND: Cannot find package 'gray-matter' imported from /Users/.../scripts/validate-skill.mjs`
- The dependency still exists in workspace packages (agents, app) but the root script can't find it

## What Didn't Work

- **Grepping only TypeScript source files**: Search pattern `--include="*.ts" --include="*.tsx"` missed `.mjs` files in `scripts/` (session history)
- **Assuming workspace deps would hoist**: Expected pnpm to make gray-matter (declared in agents and app) available at root via hoisting. pnpm's strict resolution doesn't guarantee this.
- **Just editing package.json and lockfile**: After restoring the entries, still needed `pnpm install --frozen-lockfile` to materialize the package in root `node_modules`

## Solution

Restore the dependency to root `package.json` where the script that imports it lives:

```json
// root package.json devDependencies
{
  "@testla/cli": "0.6.4",
  "gray-matter": "catalog:",
  "husky": "^8.0.3"
}
```

Also restore the lockfile entry under root importers:

```yaml
importers:
  .:
    devDependencies:
      gray-matter:
        specifier: 'catalog:'
        version: 4.0.3
```

Then run `pnpm install --frozen-lockfile` to sync `node_modules`.

## Why This Works

pnpm resolves imports from a script's nearest `package.json` ancestor. Root-level scripts resolve from root `package.json`. Even when workspace packages declare the same dependency, pnpm's strict dependency resolution doesn't guarantee hoisting to root `node_modules/`. The package must be explicitly declared where it's consumed.

This is distinct from the `public-hoist-pattern` mechanism (see related issues). Hoisting patterns affect transitive deps of workspace packages. Direct imports in root-level scripts require explicit root-level declaration regardless of hoisting config.

## Prevention

**Comprehensive grep pattern for dependency removal:**
```bash
grep -rE "from ['\"]<pkg>['\"]|require\(['\"]<pkg>['\"]\)" . \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" \
  --include="*.cjs" | grep -v node_modules
```

**Check all script locations, not just `src/`:**
- `scripts/` (build and validation scripts)
- Root config files (`.eslintrc.js`, `vitest.config.ts`)
- Tool-specific scripts (`*.config.js`, `*.config.mjs`)
- Pre-commit hook targets (check `.husky/pre-commit` and `lint-staged` config)

**pnpm workspace rule:**
- If a root-level script/config imports a package, it must be in root `package.json`
- Workspace package deps are NOT available to root scripts via hoisting
- After manual lockfile edits, run `pnpm install --frozen-lockfile` to sync

## Related Issues

- `docs/solutions/build-errors/pnpm-babel-runtime-hoisting-2026-03-30.md` -- related pnpm resolution issue (hoisting patterns vs explicit deps)
- `docs/solutions/best-practices/feature-flag-cleanup-orphaned-artifacts-2026-03-31.md` -- parallel pattern for incomplete cleanup audits
