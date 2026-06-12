---
title: Preflight Artifactory check fails on first-match stale token in ~/.npmrc
date: 2026-05-01
category: developer-experience
module: dev-runner
problem_type: developer_experience
component: tooling
severity: medium
root_cause: logic_error
resolution_type: config_change
symptoms:
  - "Preflight check: Artifactory rejected the token in ~/.npmrc (expired or revoked)"
  - pnpm login succeeds but preflight still fails on next run
tags:
  - artifactory
  - npmrc
  - preflight
  - dev-runner
  - jfrog
---

# Preflight Artifactory check fails on first-match stale token in ~/.npmrc

## Problem

Dev-runner preflight reports "Artifactory rejected the token in ~/.npmrc (expired or revoked)" even after a successful `pnpm login --registry .../node-virt/ --auth-type web`.

## Symptoms

- Preflight shows `Artifactory Auth` as failed with 401
- Running `pnpm login` for `node-virt` says "Logged in" but preflight keeps failing
- `pnpm install` may still work (pnpm resolves per-registry tokens differently than the preflight)

## What Didn't Work

- Re-running `pnpm login` for node-virt. The login writes a valid token on line 6, but the preflight never reaches it.

## Solution

Remove expired CI-user tokens from `~/.npmrc`. The file accumulates tokens from multiple Artifactory registries over time (from other projects, CI tooling, or team setup scripts). Keep only `registry=` and your personal `node-virt` token.

**Before** (6 Artifactory entries, 5 expired):
```
//gdartifactory1.jfrog.io/.../npm-site-repo-local/:_authToken=...     # ci_site, expired
//gdartifactory1.jfrog.io/.../node-warehouse-local/:_authToken=...    # ci_uxp, expired
//gdartifactory1.jfrog.io/.../npm-site-feature-fabric-local/:_authToken=...  # expired
//gdartifactory1.jfrog.io/.../node-uxplatform-local/:_authToken=...   # expired
registry=https://registry.npmjs.org/
//gdartifactory1.jfrog.io/.../node-virt/:_authToken=...               # kbader, VALID
//gdartifactory1.jfrog.io/.../npm-gasket-core-local/:_authToken=...   # ci_gasket, expired
```

**After** (only the lines that matter):
```
registry=https://registry.npmjs.org/
//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=<your-token>
```

## Why This Works

`dev-runner/internal/preflight/jfrog/token.go` `tokenFromNpmrcBytes()` (line 82, delegating to `npmrcEntryFromBytes()` at lines 87-106) iterates lines and returns the **first** `_authToken` matching `gdartifactory1.jfrog.io`. It does not filter by registry path (e.g., `node-virt`). If an expired CI token for `npm-site-repo-local` appears before your valid `node-virt` token, the preflight probes with the expired one and gets a 401.

The `Probe()` function hits `/api/system/version` with a Bearer token. Expired JWT = 401 = `ErrUnauthorized` = preflight failure.

## Prevention

- Periodically audit `~/.npmrc` for stale tokens: `node -e "..." ~/.npmrc` to decode JWT exp claims
- When onboarding to a new GoDaddy project, check if its setup script appends CI tokens to your global npmrc
- The preflight could be improved to prefer the `node-virt` registry token specifically, or to try all tokens before failing

## Related Issues

- `dev-runner/internal/preflight/jfrog/token.go` - first-match logic in `npmrcEntryFromBytes()` at lines 87-106; `Host = "gdartifactory1.jfrog.io"` at line 24
- `dev-runner/internal/preflight/checks/artifactory.go` - the check that surfaces the error
