---
title: Stale app/app/ directory shadows Next.js App Router routes
date: 2026-04-03
category: runtime-errors
module: app
problem_type: runtime_error
component: development_workflow
severity: high
symptoms:
  - all Next.js routes return 404
  - only _not-found page compiles
  - sub-20ms 404 responses indicate no compilation attempted
  - app-paths-manifest.json contains only _not-found
root_cause: config_error
resolution_type: environment_setup
tags:
  - nextjs
  - app-router
  - stale-directory
  - local-dev
  - gasket
  - route-detection
---

# Stale app/app/ directory shadows Next.js App Router routes

## Problem

A stale `app/app/` directory containing empty subdirectories caused Next.js App Router to resolve every route to 404, completely breaking local development in `local:test` mode.

## Symptoms

- `GET / 404 in 17ms` -- response time too fast for on-demand compilation, indicating Next.js never attempted to compile the route
- `GET /apps 404 in 11ms` -- same pattern across all routes including dynamic routes
- `.next/server/app-paths-manifest.json` contained only `{"/_not-found/page": "app/_not-found/page.js"}`
- `.next/server/app/` contained only `_not-found/` directory
- `_not-found` compiled normally (926ms), confirming Next.js itself was functional
- Hitting `localhost:3000` directly (bypassing Gasket HTTPS proxy) still returned 404

## What Didn't Work

1. **Checked SSO auth/cookies** -- cookies were set correctly on `.test-godaddy.com`; auth was not the issue since 404 occurred even on localhost without proxy
2. **Suspected proxy port mismatch** (443 vs 8443 in `LOGIN_REDIRECT_URL`) -- ruled out because `localhost:3000` also 404'd
3. **Inspected `middleware.ts`** -- only matches `/api/*` and passes everything else through
4. **Checked Gasket-generated Next.js config** -- `appDir`, `dir`, `srcDir` all undefined (correct defaults)
5. **Cleared `.next` cache and restarted** -- same result; fresh `.next` directory still only had `_not-found`

All of these failed because they investigated runtime behavior rather than the filesystem layout that Next.js uses for route discovery.

## Solution

```bash
rm -rf app/app
```

Remove the stale `app/app/` directory, then restart the dev server. All routes immediately compiled and loaded correctly.

The stale directory contained only empty subdirectories:

```
app/app/
  src/
    app/
      api/
        credits/
          status/     (empty)
    lib/
      budget-service/ (empty)
```

## Why This Works

Next.js App Router scans for an `app/` directory relative to the project root. Within the `app/` workspace package, Next.js found `app/app/` (a nested `app/` directory) before `app/src/app/`. Since `app/app/src/app/` contained only empty directories with no `page.tsx` files, Next.js registered zero routes. The framework-generated `_not-found` page was the only thing that compiled because Next.js creates it internally regardless of the route tree.

The key diagnostic clue: sub-20ms 404 responses mean Next.js is not attempting compilation -- it has no route entries to match against. Compare with `_not-found` at 926ms (actual compilation). When you see this pattern, check `app-paths-manifest.json` first.

The stale directory was likely scaffolded by a code generation tool or AI agent that created the directory structure for a budget service feature but never populated the actual page files.

## Prevention

1. **Diagnostic shortcut** -- when all routes 404 with sub-20ms response times, check `.next/server/app-paths-manifest.json` first; if nearly empty, the problem is route discovery (filesystem layout), not runtime
2. **Check for phantom directories** -- run `ls app/app 2>/dev/null` to verify no nested `app/` directory exists before debugging routing issues
3. **Code generation guardrails** -- tools or agents creating files in the `app/` workspace should validate paths against the established `app/src/app/` convention before writing
4. **Post-branch cleanup** -- after feature branches that scaffold new directories, verify no empty directory trees remain

## Related Issues

- [gasket-nextjs-local-testing-constraints](../developer-experience/gasket-nextjs-local-testing-constraints-2026-03-31.md) -- general Gasket/Next.js local dev constraints
- [local-dev-stuck-initialization](../developer-experience/local-dev-stuck-initialization-creating-status-2026-03-31.md) -- similar local dev diagnostic pattern
- [feature-flag-cleanup-orphaned-artifacts](../best-practices/feature-flag-cleanup-orphaned-artifacts-2026-03-31.md) -- orphaned artifact detection patterns
