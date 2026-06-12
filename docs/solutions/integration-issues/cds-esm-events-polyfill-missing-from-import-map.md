---
title: "CDS ESM events polyfill missing from import map after UPP #3074"
module: app/cds-loader
date: 2026-05-19
category: integration-issues
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "Failed to resolve module specifier 'events' in CDS paywall modal"
  - "Class extends value undefined is not a constructor or null (EventEmitter)"
  - "cds-loader.internal-fallback-detected fires, modal shows Something went wrong"
  - "Issue invisible under cdsVersion=local (CDS CLI bundles everything inline)"
root_cause: config_error
resolution_type: code_fix
related_components:
  - frontend_stimulus
tags:
  - cds
  - esm
  - import-map
  - events-polyfill
  - cjs-interop
  - paywall
  - dify-lead-gen
  - prebuild-validation
related_docs:
  - docs/solutions/workflow-issues/flag-gated-migration-verification-2026-05-18.md
  - docs/solutions/best-practices/cds-esm-react19-compat-shims-2026-04-23.md
  - docs/solutions/developer-experience/smoke-test-cds-esm-against-prod-cdn-from-local-dev-2026-05-08.md
---

# CDS ESM events polyfill missing from import map after UPP #3074

## Problem

After UPP PR #3074 removed `@wsb/dify-lead-gen` from `hostProvided`, CDS built a fallback chunk for it. That chunk transitively imports `events` (Node EventEmitter polyfill via `debug` package). Neither the registry manifest nor AAB's `deps-esm.js` provided `events`, breaking the paywall modal at runtime.

## Symptoms

- Browser console: `Failed to resolve module specifier "events"`
- After adding `events` to manualDeps naively: `Class extends value undefined is not a constructor or null`
- `cds-loader.internal-fallback-detected` fires after 5s debounce
- Modal shows "Something went wrong"
- Issue invisible under `cdsVersion=local` (CDS CLI local dev server bundles everything inline, masking externalization)

## What Didn't Work

**Adding `events` directly to manualDeps** (pointing at the raw `events` package): Resolved the specifier error but exposed a second failure. Webpack's CJS-to-ESM interop wraps `events` as `{ default: EventEmitter }` without the self-reference pattern (`EventEmitter.EventEmitter = EventEmitter`). The cds-loader data-URL shim only re-exports keys it finds on the namespace object, so it generated only `export default` without `EventEmitter` as a named export. Code doing `class Foo extends EventEmitter` got `undefined`.

**Testing with `cdsVersion=local`** (session history): The CDS CLI local dev server (localhost:9000) bundles everything inline, never splitting deps into fallback chunks. This hid the production failure mode entirely. The `events` bare specifier only fails against the real CDN registry where fallback chunks externalize transitive deps.

**Jonathan's PR #3904 initial approach (`deps: []`)**: Removed all host dep injection. The cds-loader expects `deps` to be an object `{ 'pkg': { module, version } }`. Empty array/object means no host deps seeded, breaking `axios` and 6+ other specifiers that require host provision. Note: PR #3904 was later reworked and merged with a different strategy (centralized deps injection in ComponentLoader + trimmed host aliases to 4). See `../best-practices/cds-esm-react19-compat-shims-2026-04-23.md` section 2a.

## Solution

Two files:

**`app/src/lib/cdsEventsShim.ts`** explicitly re-exports `EventEmitter` as a named export:

```typescript
import EventEmitter from 'events'

export { EventEmitter }
export default EventEmitter
```

**`app/scripts/generate-cds-deps.js`** points manualDeps at the shim:

```javascript
{ specifier: 'events', importName: 'events', importPath: '../src/lib/cdsEventsShim' },
```

This produces `window.__CDS_ESM_LIBS__['events'] = { EventEmitter, default }` at runtime. The cds-loader sees both keys and generates a data-URL with `export const EventEmitter = mod.EventEmitter; export default ...`.

## Why This Works

The root cause is a CJS-to-ESM interop gap in a two-layer system:

1. **Externalization layer** (CDS builder): When CDS builds the `@wsb/dify-lead-gen` fallback chunk, it treats `events` as an external because it appears as a bare import. The chunk emits `import * as u from "events"` expecting the host to resolve it.

2. **Resolution layer** (cds-loader): The loader builds an import map from `deps-esm.js` host deps + registry manifest deps. Each dep gets a data-URL shim that re-exports keys from `window.__CDS_ESM_LIBS__[pkg]`. For CJS packages, webpack only puts `{ default }` on the namespace, so the shim only re-exports `default`.

The explicit shim bypasses the generic re-export mechanism by statically declaring `EventEmitter` as a named export before webpack processes it.

## Prevention

**A prebuild static check was prototyped but not shipped.** `app/scripts/validate-deps-esm-coverage.mjs` (fetch registry manifest + fallback chunks, regex-extract bare specifiers, validate each resolves in `deps-esm.js` or registry `dependencies`) lives only on the unmerged `feat/cds-esm-coverage-check` branch. It is **not on main** and **not wired into prebuild** — the prebuild is `generate-cds-deps.js && tsx gasket.ts build`. The same approach was rejected as overengineered (PR #3910): only one incident ever (this `events` gap), caught in test env. See `../best-practices/cds-esm-react19-compat-shims-2026-04-23.md` and `../architecture-patterns/cds-esm-centralized-deps-alias.md` for that decision. Smoke-testing against the real CDN registry (below) is the active guardrail.

**Always smoke-test against real CDN registry**, never `cdsVersion=local`. The local dev server inlines deps and hides externalization failures. Use Switchboard per-shopper override or global flag flip in test env to exercise the full SSR path.

**When adding Node polyfill packages to manualDeps**, verify named exports consumers expect are present in the interop wrapper. If webpack's `import * as X from 'pkg'` only yields `{ default }`, write an explicit shim rather than relying on the generic cds-loader data-URL mechanism.

**Pattern for future CDS fallback-chunk externals**: if a new fallback chunk surfaces a missing specifier, the fix is always: (1) add to `app/package.json` deps, (2) add to `manualDeps` in `generate-cds-deps.js`, (3) if the package is CJS with named exports consumers need, write a shim like `cdsEventsShim.ts`.
