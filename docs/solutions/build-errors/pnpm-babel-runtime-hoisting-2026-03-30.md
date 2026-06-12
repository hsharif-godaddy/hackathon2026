---
title: pnpm public-hoist-pattern not applied without force reinstall
date: 2026-03-30
category: build-errors
module: package-management
problem_type: build_error
component: tooling
symptoms:
  - "Module not found: Can't resolve '@babel/runtime/helpers/defineProperty'"
  - "@babel/runtime not hoisted to root node_modules despite public-hoist-pattern in .npmrc"
  - "Webpack build fails for @px/checkouts and @site/buttons transitive deps"
root_cause: incomplete_setup
resolution_type: environment_setup
severity: high
related_components:
  - development_workflow
tags:
  - pnpm
  - babel
  - hoisting
  - monorepo
  - webpack
  - node_modules
---

# pnpm public-hoist-pattern not applied without force reinstall

## Problem

`pnpm build` fails with multiple `Module not found: Can't resolve '@babel/runtime/...'` webpack errors. The `.npmrc` already has `public-hoist-pattern[]=@babel/runtime` configured, but a normal `pnpm install` doesn't hoist the package to root `node_modules/`.

## Symptoms

- `Module not found: Can't resolve '@babel/runtime/helpers/defineProperty'`
- `Module not found: Can't resolve '@babel/runtime/helpers/slicedToArray'`
- `Module not found: Can't resolve '@babel/runtime/helpers/asyncToGenerator'`
- `Module not found: Can't resolve '@babel/runtime/regenerator'`
- `Module not found: Can't resolve '@babel/runtime/helpers/interopRequireDefault'`
- Errors originate from `@px/checkouts` and `@site/buttons` in the `.pnpm/` store
- Root `node_modules/@babel/` contains `parser`, `traverse`, `types` but NOT `runtime`
- Import trace leads through `DomainPurchaseWidget.tsx` -> widgets/index.ts -> page.tsx

## What Didn't Work

- **`pnpm --filter website add @babel/runtime` alone**: Added the package to `app/node_modules/@babel/runtime` but did NOT hoist to root. Packages in `.pnpm/` store still couldn't resolve it.
- **`pnpm install` after adding the dep**: Returned "Already up to date" and skipped hoisting reevaluation.
- **`pnpm build` retry**: Turbo cache replayed the failed build (same hash `049f19f7dcc84889`).

## Solution

```bash
# 1. Add @babel/runtime as explicit dep
pnpm --filter website add @babel/runtime

# 2. Force pnpm to rebuild node_modules and apply hoisting
pnpm install --force

# 3. Bypass turbo cache
pnpm build --force
```

## Why This Works

pnpm's incremental `install` only applies hoisting patterns to newly resolved packages. When `node_modules` already exists from a prior install, adding a new dependency doesn't trigger a full hoisting reevaluation. The `--force` flag deletes the existing `node_modules` and `.pnpm/` structure, then rebuilds from scratch, applying all `public-hoist-pattern` rules from `.npmrc`.

Once `@babel/runtime` is both a direct dependency of `website` AND the hoisting pattern is applied, pnpm places it at root `node_modules/@babel/runtime/`, making it accessible to all packages including those resolved through the `.pnpm/` store.

## Prevention

- After modifying `.npmrc` hoisting patterns or adding deps that need hoisting, always run `pnpm install --force` to ensure patterns take effect
- When `pnpm build` fails with `Module not found` for a package that should be hoisted, check root `node_modules/` first before debugging webpack config
- `GETTING_STARTED.md` troubleshooting section should document this scenario

## Related Issues

- `.npmrc` line 5: `public-hoist-pattern[]=@babel/runtime` (the config that needed force-apply)
- `GETTING_STARTED.md`: recommends `pnpm install --force && pnpm build --force` for general troubleshooting but doesn't call out hoisting specifically
- No related GitHub issues found
- `docs/solutions/best-practices/nextjs16-vendored-react-canary-breaks-cds-upp.md` -- Next.js 16 React canary version mismatch (same class: external lib breaks after environment change)
- `docs/solutions/build-errors/pnpm-workspace-hoisting-script-dependency.md` -- root scripts need explicit deps, workspace hoisting doesn't cover them
