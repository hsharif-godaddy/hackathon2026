---
title: Docker build fails on CDS postinstall hook in json-only install layer
date: 2026-05-12
category: build-errors
module: app
problem_type: build_error
component: tooling
severity: high
symptoms:
  - "Docker build error: Cannot find module '/workspace/app/scripts/post-install.js'"
  - "pnpm install --frozen-lockfile triggers postinstall in Docker install layer where only package.json files exist"
  - "Local dev works fine because all source files present during install"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components:
  - development_workflow
  - testing_framework
tags:
  - docker
  - pnpm
  - lifecycle-hooks
  - turborepo-prune
  - layer-caching
  - cds-dependencies
  - vitest-setup
---

# Docker build fails on CDS postinstall hook in json-only install layer

## Problem

Docker build fails because `postinstall` hook triggers CDS dependency generation during `pnpm install --frozen-lockfile`, but the script doesn't exist in the install layer. The Dockerfile uses Turborepo prune which separates package.json files (json/ output for layer caching) from source code (full/ output), and pnpm install runs in the json-only layer.

## Symptoms

- Docker build error: `Cannot find module '/workspace/app/scripts/post-install.js'`
- `pnpm install --frozen-lockfile` in Dockerfile triggers postinstall before source is copied
- Local dev unaffected (all files present during install)
- CI Docker image builds consistently fail

## What Didn't Work

- **Conditional postinstall** (`if [ -f scripts/post-install.js ]; then ... fi`): Papers over the real issue. postinstall is the wrong lifecycle phase for build inputs.
- **Explicit `pnpm prebuild` in Dockerfile**: Redundant. `pnpm build` auto-triggers prebuild via npm lifecycle hooks, causing double execution.
- **`pretest` hook for test scripts**: pnpm 10 doesn't fire `pre*` hooks for colon-separated script names (`test:unit`, `test:integration`) without `enable-pre-post-scripts=true`.
- **Inline `node scripts/generate-cds-deps.js &&` in each test script**: Works but duplicates the call across 6 scripts. Fragile to maintain.

## Solution

Move CDS generation from install-time to three purpose-specific lifecycle points:

**1. Build (Docker + CI):** `prebuild` hook in package.json

```json
"prebuild": "node scripts/generate-cds-deps.js && tsx gasket.ts build"
```

**2. Local dev:** `prelocal` hook (fires for all `local:*` variants via shared `local` script)

```json
"prelocal": "node scripts/generate-cds-deps.js",
"local": "concurrently \"npm run build:tsc:watch\" \"npm run local:https\" \"next dev --webpack\""
```

**3. Tests:** Vitest `globalSetup` (runs once before any test suite, regardless of script name)

```typescript
// app/vitest.globalSetup.ts
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export function setup(): void {
  execFileSync(process.execPath, [resolve(__dirname, 'scripts/generate-cds-deps.js')], {
    stdio: 'inherit',
    cwd: resolve(__dirname),
  });
}
```

**4. Dockerfile:** Remove explicit prebuild (lifecycle auto-triggers it)

```dockerfile
RUN pnpm build  # prebuild fires automatically before build
```

**5. Rename:** `post-install.js` to `generate-cds-deps.js` to reflect actual purpose.

## Why This Works

CDS dependency generation produces `cds/deps-esm.js`, a build input consumed by webpack during compilation. It requires both node_modules (for version resolution) and source files (the script itself). `postinstall` was the wrong lifecycle hook because:

1. It runs during `pnpm install` when Docker's layer caching strategy has only package.json files
2. It conflates "dependency change" with "build input generation"
3. The generated file is only consumed at build/dev/test time, never at install time

The three-hook approach places generation at each consumption point: `prebuild` for Docker/CI builds, `prelocal` for dev server startup, and Vitest `globalSetup` for test runs. Each runs after full source is available and before the consumer needs the file.

## Prevention

1. **Install hooks are for install-time work only.** postinstall/preinstall should handle native builds, binary downloads, or node_modules patches. If a script reads source files, it's not an install hook.

2. **Turborepo prune awareness.** Docker layer caching with `turbo prune --docker` creates json/ (package.json only) and full/ (all source). Any hook that runs during `pnpm install` has access only to json/. Verify with `docker build` after hook changes.

3. **pnpm 10 pre-hook limitation.** pnpm 10 doesn't fire `pre*` hooks for colon-separated script names without `enable-pre-post-scripts=true`. Use Vitest `globalSetup` or inline calls for test variants.

4. **Named exports work in Vitest globalSetup.** Both `export default` and named `export function setup` are valid (documented in Vitest config reference).

5. **Use `process.execPath` over bare `node`.** More robust across CI/sandbox environments where PATH resolution may differ from the running Node binary.

## Related Issues

- [docs/solutions/best-practices/cds-esm-react19-compat-shims-2026-04-23.md](../best-practices/cds-esm-react19-compat-shims-2026-04-23.md): Documents the CDS ESM generation mechanism; "State lifecycle risks" section's postinstall constraint is now resolved by this fix
- PR #3126: the UPP ESM conversion that introduced the postinstall requirement
- PR #3672: The fix PR
- [docs/solutions/tooling-decisions/nextjs-image-optimization-bypass-katana.md](../tooling-decisions/nextjs-image-optimization-bypass-katana.md): another case where the Docker build context (not local dev) was the failure surface — `.gitignore` `*.png` rule dropped a committed asset from the build
