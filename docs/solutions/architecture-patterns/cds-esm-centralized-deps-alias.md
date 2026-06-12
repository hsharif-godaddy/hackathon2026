---
title: "CDS ESM: centralize deps via webpack alias, not per-component injection"
date: 2026-05-22
category: architecture-patterns
module: app/cds
problem_type: architecture_pattern
component: frontend_stimulus
severity: low
applies_when:
  - "Using CDS ESM loader mode with host-provided dependencies"
  - "Adding new paywall containers that need CDS deps"
  - "Auditing which packages need to be host-provided vs CDS fallback chunks"
root_cause: wrong_api
resolution_type: config_change
tags:
  - cds
  - esm
  - webpack-alias
  - host-provided
  - upp
  - paywall
  - deps-esm
---

# CDS ESM: centralize deps via webpack alias, not per-component injection

## Context

CDS ESM integration accumulated complexity from the original React 18/19 migration:

- Each paywall container (`CreditsUpgradeContainer`, `DirectToPaidContainer`, `HigherPlansUpgradeContainer`) imported and threaded `deps` as a prop individually
- A re-export shim (`app/src/lib/cdsEsmDeps.ts`) existed solely to bridge the import path to the generated `cds/deps-esm.js`
- `generate-cds-deps.js` force-included 4 packages (`@ux/util`, `react-device-detect`, `react-focus-lock`, `react-transition-group`) as manual host-provided deps, despite UPP's ESM build bundling them in fallback chunks
- `cds.host.esm.config.js` aliases created duplicate entries in the generated file

This created maintenance burden (every new component copies the pattern), cargo-culting risk (developers add deps "to be safe"), and diagnostic confusion (why does the shim exist?).

Prior sessions (session history): PR #3910 attempted a 150-line prebuild validation script to catch missing specifiers statically. Closed as overengineered; only one incident ever (events polyfill, caught in test env), caused by workflow failure, not tooling gap.

## Guidance

**1. Use a webpack alias for the generated deps file:**

```typescript
// next.config.js
config.resolve.alias['@cds/deps-esm'] = path.resolve(__dirname, 'cds/deps-esm.js');

// tsconfig.json paths (for type resolution)
"@cds/deps-esm": ["./cds/deps-esm.js"]

// vitest.config.ts (mirror the alias for tests)
'@cds/deps-esm': path.resolve(__dirname, './cds/deps-esm.js'),
```

**2. Inject deps once at the loader boundary, not per-container:**

```typescript
// cdsLoader.tsx
import depsEsm from '@cds/deps-esm'

export function ComponentLoader(props) {
  return (
    <CdsComponentLoader
      {...props}
      {...(props.loaderMode === 'esm' && { deps: depsEsm })}
    />
  )
}
```

**3. Only list truly host-provided deps by cross-referencing the upstream config:**

Check UPP's `cds.config.esm.js` for the `hostProvided` array. Only those packages (plus special shims like `events` via `cdsEventsShim.ts`) belong in `manualDeps`:

```javascript
// generate-cds-deps.js
const manualDeps = [
  { specifier: 'react/jsx-runtime', importName: 'jsxRuntime', importPath: 'react/jsx-runtime', versionExpr: 'react.version' },
  { specifier: 'axios', importName: 'axios', importPath: 'axios' },
  { specifier: 'events', importName: 'events', importPath: '../src/lib/cdsEventsShim' },
]
```

**4. Verify against the real CDN registry, never `cdsVersion=local`:**

The local CDS dev server inlines everything and hides externalization gaps. Always test with the real registry hash from `blobby.dev-wsimg.com`.

## Why This Matters

**Prevents cargo-culting:** Without centralization, every new paywall component copies the `deps` import/prop pattern without understanding why. Developers add manual deps "just to be safe."

**Reduces blast radius:** When the deps contract changes, update one place (the loader) instead of N containers.

**Self-documenting configuration:** `manualDeps` now mirrors UPP's ESM config exactly. If it's not in `hostProvided` upstream, it shouldn't be in the generator.

**Catches real runtime issues:** Testing against CDN registry exposes missing externalizations that `cdsVersion=local` masks silently.

## When to Apply

- Any CDS ESM integration where multiple components consume the same externalized dependencies
- When adding a new paywall or CDS-based container component
- When auditing whether a package needs to be host-provided: check `cds.config.esm.js` in the component's repo (e.g., `unified-plans-and-pricing-library/cds.config.esm.js`)
- When tempted to add a re-export shim: a webpack alias + centralized injection eliminates the translation layer (auto memory [claude]: "configure before shimming" principle)

## Examples

**Before (per-component threading + unnecessary deps):**

```typescript
// app/src/lib/cdsEsmDeps.ts (shim)
import esmDeps from '../../cds/deps-esm.js'
export default esmDeps

// CreditsUpgradeContainer.tsx
import esmDeps from '@/lib/cdsEsmDeps'
<ComponentLoader {...(!umdFallback && { loaderMode: 'esm', deps: esmDeps })} />
```

```javascript
// generate-cds-deps.js (4 unnecessary packages)
const manualDeps = [
  { specifier: '@ux/util', ... },           // NOT in UPP hostProvided
  { specifier: 'react-device-detect', ... }, // NOT in UPP hostProvided
  { specifier: 'react-focus-lock', ... },    // NOT in UPP hostProvided
  { specifier: 'react-transition-group', ... }, // NOT in UPP hostProvided
]
```

**After (centralized alias + verified minimal deps):**

```typescript
// cdsLoader.tsx (one place)
import depsEsm from '@cds/deps-esm'
<CdsComponentLoader {...props} {...(props.loaderMode === 'esm' && { deps: depsEsm })} />

// CreditsUpgradeContainer.tsx (no deps import)
<ComponentLoader {...(!umdFallback && { loaderMode: 'esm' })} />
```

```javascript
// generate-cds-deps.js (only verified host-provided)
const manualDeps = [
  { specifier: 'react/jsx-runtime', ... },
  { specifier: 'axios', ... },
  { specifier: 'events', importPath: '../src/lib/cdsEventsShim' },
]
```

**Verification checklist:**
1. `window.__CDS_IMPORT_MAP_SETUP__ === true` on the develop page
2. Network tab shows component loading from `blobby.*.wsimg.com` (real CDN)
3. Removed packages appear as fallback chunk network requests (not host-provided)
4. No `Failed to resolve module specifier` console errors

## Related

- `docs/solutions/best-practices/cds-esm-react19-compat-shims-2026-04-23.md` (parent architecture doc, section 2a needs refresh)
- `docs/solutions/integration-issues/cds-esm-events-polyfill-missing-from-import-map.md` (events shim pattern)
- `docs/solutions/developer-experience/smoke-test-cds-esm-against-prod-cdn-from-local-dev-2026-05-08.md` (verification workflow)
- `docs/solutions/workflow-issues/flag-gated-migration-verification-2026-05-18.md` (verify both UMD/ESM paths)
- PR #3904: [VNEXT-79756] Fix CDS implementation
- PR #3908: fix(paywall): add events polyfill to CDS ESM host deps
- PR #3910: (closed) prebuild static check deemed overengineered
