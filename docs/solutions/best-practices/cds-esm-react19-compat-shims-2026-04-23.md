---
title: "CDS ESM components in React 19 host: compat shims + preload"
date: 2026-04-23
last_updated: 2026-06-01
session_history_used: true
category: best-practices
module: app/paywall
problem_type: best_practice
component: payments
severity: critical
applies_when:
  - Loading CDS ESM components in a React 19 / Next.js 16 host application
  - CDS ESM bundle vendors a React 18 jsx-runtime
  - Host @ux/* components loaded with React 19 are passed to CDS components
tags:
  - cds
  - esm
  - react-19
  - react-18-compat
  - upp
  - paywall
  - warm-cache
  - preload
  - module-side-effect
  - cross-team
  - deploy-blocker
related_components:
  - frontend_stimulus
  - tooling
---

# CDS ESM components in React 19 host: compat shims + preload

## Context

After converting UPP/CDS paywall loading from CJS/UMD to ESM mode (PR #3126), the CDS remote ESM component failed to render in our React 19 / Next.js 16 host. The root cause: CDS ESM bundle vendors a React 18 jsx-runtime that creates elements with `Symbol.for("react.element")`, but React 19's reconciler expects `Symbol.for("react.transitional.element")` and hard-throws on the old symbol.

The solution evolved through several iterations. Early versions used Symbol.for intercepts, `__CDS_ESM_LIBS__` Proxy, and `id="root"` wrappers. These were removed when `deps-esm.js` was updated to supply the host's `react/jsx-runtime` directly, eliminating the symbol mismatch at the source.

Current state (as of 2026-05-22): a minimal `shimReactInternals()` bridge plus `CdsEsmPreload` with `warmCache()` for performance. PR #3904 (CDS team) landed a deps architecture refactor: `@/lib/cdsEsmDeps.ts` wrapper deleted, `@cds/deps-esm` webpack alias created, deps injection centralized in `ComponentLoader`, host aliases trimmed to 3 (prop-types, axios, redux). `events` is supplied as a manualDep via `cdsEventsShim`, not a host alias. See the [smoke-test workflow guide](../developer-experience/smoke-test-cds-esm-against-prod-cdn-from-local-dev-2026-05-08.md) for how to reproduce the verification locally against the same bundle prod serves.

### Cross-team dependency chain

```
CDS PR #269 (version isolation CLI + byDependency.commonjs @babel/runtime fix)  ← MERGED (0.0.91, 2026-05-06)
  └─ UPP PR #3045 (cds-cli 0.0.91 + usePortal dedup + jsx-runtime externals)    ← MERGED (2026-05-07)
      └─ UPP PR #3046 (warmCache + UpgradeLoadingSkeleton export)               ← MERGED (2026-05-07)
          └─ UPP prod CDN publish (hash 33dcd35)                                ← PUBLISHED (2026-05-08)
              └─ Airo Builder PR #3126 (feat/upp-esm-conversion)                ← READY TO MERGE
```

CDS PR #266 (version isolation loader) merged 2026-05-05 as cds-loader 0.0.86. CDS PR #268 (null-frame + SSR type fix) is independent. CDS PR #271 (afterResolve @babel/runtime) closed as redundant — #269's `byDependency.commonjs` covers it. UPP #3019 closed 2026-05-06 and split into #3045 + #3046.

### Key investigation learnings

**1.3s is JS engine parse time, not module evaluation.** Instrumented `cdsIndex.tsx` with `performance.mark` at module top and bottom. Module eval between marks: 0.0ms. The 1.3s is the browser parsing 6.7MB of JavaScript before any in-module code executes. `performance.mark` cannot capture parse time.

**Code splitting the ESM bundle has limited ROI without per-subType entry points.** Lazy-loading non-critical components (CancellationModal, TermSwitcher, etc.) saves ~500KB-1MB. The bulk is UniversalUpgrade + deps (xstate 2.5MB, react-query 1.9MB). Meaningful reduction requires CDS per-subType entry points (architecture change).

**webpack's enhanced-resolve recursion guard keys on hook+path+request, not conditionNames.** A custom resolve plugin that taps `resolve` and calls `doResolve(resolver.getHook('resolve'), ...)` with only `conditionNames` changed produces an identical stack entry. enhanced-resolve detects recursion and fails. The working approach: `nmf.hooks.afterResolve` rewrites `createData.resource` after resolution completes.

**PR #267→#271 evolution.** PR #267's global `['require', 'default']` conditionNames dropped `import`/`module` conditions entirely, regressing `@ux/*` packages. Three alternatives failed (custom resolve plugin, NormalModuleReplacementPlugin, per-package resolve.plugins). PR #271 uses `afterResolve` hook to rewrite `@babel/runtime/helpers/esm/` to CJS paths per-package.

**CDS version isolation has P0 gaps (PRs #269, #266).** PR #269: `detectReactDependent` regex misses `react/jsx-runtime` imports (automatic JSX runtime + externalized jsx-runtime means artifacts contain `from "react/jsx-runtime"`, not `from "react"`). PR #266: nested CDS component cascade gap where deps resolve global React while parent is scoped.

## Guidance

### 1. shimReactInternals() for __SECRET_INTERNALS bridging

The vendored code reads `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner.current`. React 19 renamed this to `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`.

**Fix:** `shimReactInternals()` in `app/src/utils/reactCompat.ts` bridges the rename. Runs once as a module side-effect on first import. This is the only remaining React compat shim. Symbol.for intercept and `__CDS_ESM_LIBS__` Proxy were removed once `deps-esm.js` started supplying the host's jsx-runtime.

### 2. CdsEsmPreload: module cache + warmCache

`CdsEsmPreload` mounts hidden on the develop page and does two things:

1. **CDS infrastructure warmup**: renders a hidden `CdsComponentLoader` with `subType="UpgradeLoadingSkeleton"` which triggers import map setup, host dep resolution, and UPP bundle download/parse
2. **Redux store pre-population**: after `window.__CDS_IMPORT_MAP_SETUP__` becomes true, dynamically imports the cached UPP bundle and calls `warmCache()` to dispatch getAuth + getConfig + getAllExperiments to UPP's Redux singleton

**Why UpgradeLoadingSkeleton, not UniversalUpgrade?** UniversalUpgrade fires analytics impressions and API calls in the hidden div. UpgradeLoadingSkeleton is lightweight and shares the same bundle (warms the module cache identically).

**Why warmCache after import map setup, not after module load?** The `__CDS_IMPORT_MAP_SETUP__` flag indicates CDS infrastructure is ready. The dynamic `import()` of the entry URL resolves from browser module cache (no network). warmCache takes no parameters (uses cookie auth) so it can fire immediately.

**Entry URL construction:** mirrors CDS's `getEntryUrl()` logic including `cdsVersion` localStorage/query string overrides for local dev.

### 2a. Deps injection: two-tier pattern (post-PR #3904)

PR #3904 centralized deps injection. Two consumption patterns now exist:

**Standard path (via ComponentLoader):** `cdsLoader.tsx`'s `ComponentLoader` auto-injects deps when `loaderMode === 'esm'`. Individual containers (DirectToPaid, CreditsUpgrade, HigherPlansUpgrade) no longer pass `deps`.

```tsx
// cdsLoader.tsx internals
<CdsComponentLoader {...props} {...(props.loaderMode === 'esm' && { deps: depsEsm })} />
```

```tsx
// Consumer — no deps prop needed
<ComponentLoader loaderMode="esm" subType="DirectToPaid" {...otherProps} />
```

**Bypass path (CdsEsmPreload):** Preload uses raw `CdsComponentLoader` directly (no error boundary wrapping, no MutationObserver, lightweight). Must import and pass deps explicitly:

```tsx
import depsEsm from '@cds/deps-esm'
<CdsComponentLoader deps={depsEsm} ... />
```

**Import path:** Always `@cds/deps-esm` (webpack alias to `./cds/deps-esm.js`). The old `@/lib/cdsEsmDeps` re-export wrapper is deleted. TypeScript types declared in `app/src/types/cds-deps.d.ts`. Vitest alias in `app/vitest.config.ts`.

**Host aliases (cds.host.esm.config.js):** Trimmed from ~10 to 3: `prop-types`, `axios`, `redux`. CDS handles all other deps internally. `events` is not a host alias — it ships as a manualDep in `generate-cds-deps.js` pointed at `cdsEventsShim` (see [events-polyfill doc](../integration-issues/cds-esm-events-polyfill-missing-from-import-map.md)).

**Environment config:** `cds.api.baseUrl` added to gasket.ts per environment (dev/test/prod).

### 2b. Where to mount CdsEsmPreload (per-page, not shared layout)

Mount `CdsEsmPreload` on every page that renders CDS-based paywall modals. As of PR #4007:

| Page | Mount location |
|------|---------------|
| `/[market]/develop/[id]` | `page.tsx` line 1820 (original) |
| `/[market]/manage-plan` | `page.tsx` end of ManagePlanContent |
| `/[market]` (homepage) | `HomeContent.tsx` (covers all experiment variants) |

Always wrap in `<ErrorBoundary fallback={() => null}>` so preload failure never breaks the page.

**Why per-page, not shared layout:** `warmCache()` makes real network requests (auth/config/experiments to UPP's Redux store). 6 of 9 pages under `[market]/layout.tsx` never show paywall modals. Layout mounting wastes bandwidth on 67% of page loads.

**Why per-page, not in `usePaywallModal` hook:** The hook only covers half of upgrade modal trigger paths. The other half call `useDevelopPageStore.openUpgradeModal` directly (HeaderUpgradeButton, BudgetExceededBanner, UsageGauge, etc.). Hook mounting would leave those paths with a cold cache.

**Why HomeContent, not each experiment variant:** Single mount in the shared wrapper survives experiment churn (4 variants at time of writing). All variants render `UpgradeContainer` from the same paywall barrel.

**Test mocks:** Pages that mount CdsEsmPreload need it stubbed in their test mock factory:

```typescript
vi.mock('@/app/[market]/develop/components/paywall', () => ({
  CdsEsmPreload: () => null,
  // ... other component stubs
}));
```

(session history) Prior session on `feat/cds-esm-coverage-check` identified this gap: "CdsEsmPreload scope error — must be mounted on every page that shows paywall modals, not just develop."

### 3. Loading feedback: spinner-in-button + skeleton modal (D2P/HigherPlans), LoadingComponent swap (Credits)

D2P and HigherPlans use `LoadingComponent={() => null}` to suppress CDS's default "Loading..." text, combined with a spinner-on-trigger approach: the popover stays open with a spinner on the CTA button while CDS loads, and UPP's portal is hidden via injected CSS (`opacity: 0` on `.ux-disrupt-backdrop`) until `onLoadSuccess` fires. No skeleton modal is rendered. See [cds-modal-loading-lifecycle](../architecture-patterns/cds-modal-loading-lifecycle.md) for the complete pattern. The Credits container still uses the `LoadingComponent` swap (renders `PaywallLoadingModal` as the loader's `LoadingComponent`).

**Why `() => null` not `null`:** CDS's code is `LoadingComponent || (() => <div>Loading...</div>)`. Passing `null` is falsy and falls through to the default. Must pass a function that returns null.

**Why not skeleton modal:** The initial PR #4151 approach used a `PaywallLoadingModal` (which uses `@ux/modal`) during CDS load. This created dual portals on `document.body` with competing backdrops and focus traps, causing visual flicker. The spinner-on-trigger approach avoids this by never rendering a second modal.

### 4. Debounced MutationObserver fallback detection

CDS ESM loader temporarily renders its `FallbackComponent` div during async import map setup. The MutationObserver detects this and debounces (5s) before triggering error state. If the element disappears before the timer fires, the timer is canceled.

The `onError` callback clears the debounce timer to prevent duplicate error notifications when CDS reports an error while the timer is pending.

### 5. Shim lifecycle: module side-effect, not per-component

Global monkey-patches are page-scoped. Tying lifecycle to component mount/unmount via useEffect causes ref counting bugs when multiple instances coexist. Run shims once as module side-effects with a boolean guard.

**Anti-pattern:** `useEffect(() => { install(); return () => uninstall() })` with a module-level singleton. When component A unmounts, it restores the global while component B is still using the patched version.

## Why This Matters

Without `shimReactInternals()`, CDS ESM components crash in React 19 hosts. Without `CdsEsmPreload`, first-click latency is ~3.4s. With preload + warmCache, first-click drops to ~2.2s and second-click is 465ms.

These shims are temporary. Remove them when:
- CDS ships version isolation (PRs #269, #266 after P0 fixes), which scopes React per-component and eliminates shimReactInternals entirely
- CDS ESM loader stops rendering FallbackComponent during setup (eliminates debounce)
- UPP ships a `warmCache()` export in production CDS builds (CdsEsmPreload already calls it)

### Principle: configure before shimming (auto memory [claude])

When bridging two systems, the first question should be "is there a configuration that makes this translation unnecessary?" not "how do I write this translation correctly?" We spent weeks on React 18/19 compat shims (Symbol.for intercept, __SECRET_INTERNALS bridge, Proxy interceptor) when the actual fix was one config approach: host-supplying `react/jsx-runtime` via `deps-esm.js` so CDS uses the host's React 19 instead of its vendored React 18.

## When to Apply

- Any GoDaddy application using CDS ESM components on React 19 / Next.js 16+
- The specific CDS type is `godaddyUnifiedPlansAndPricingLibraryEsm` but the same pattern applies to any CDS ESM component needing React 18/19 bridging

Does NOT apply when:
- The host application uses React 18 (no version mismatch)
- Using the CJS/UMD CDS loader path (different mechanism)
- CDS has shipped a React 19-compatible ESM build

## Examples

### Profiling data (local dev, 2026-04-29)

| Scenario | Portal | Plan cards |
|----------|--------|-----------|
| No preload (baseline) | 1366ms | 3424ms |
| CdsEsmPreload + warmCache (first click) | 2231ms | -- |
| Second click (cached) | 465ms | 465ms |

CDS loader phase: ~70ms on warm cache. Not the bottleneck. Module parse (~1.3s, one-time) and data fetch (~2s first mount) are UPP-internal costs.

### Verifying warmCache worked

```javascript
// In browser console after page load
window.__CDS_IMPORT_MAP_SETUP__  // true (CDS infra warm)
```

## What Didn't Work

- **Symbol.for intercept + __CDS_ESM_LIBS__ Proxy + id="root" wrapper**: the initial shim set. Removed when deps-esm.js was updated to supply host jsx-runtime directly.
- **@ux/modal skeleton as LoadingComponent**: skip-to-main-content flash from focus trap
- **Parallel mount (skeleton + CDS)**: double backdrop, double close button
- **Portal reuse via portalElem prop**: crashes UPP (two React trees on same DOM)
- **CDS useState init optimization**: rejected by CDS team, hydration mismatch + `__CDS_IMPORT_MAP_SETUP__` race condition (auto memory [claude])
- **UniversalUpgrade as preload subType**: fires analytics + API calls in background
- **prefetchedData prop on UPP components**: Redux singleton with 20 reducers, sequential init waterfall dispatching to ~20 slices. External hydration too complex. warmCache() is the viable alternative
- **Removing xstate from notExternals**: import chain UniversalUpgrade → ContentfulUPPWrapper → useUpgradeFlow → useMachine. Cannot externalize without breaking primary use case
- **PR #267 global conditionNames override**: `['require', 'default']` dropped `import`/`module` conditions entirely, regressing `@ux/*` packages that PR #264 had just fixed
- **Custom resolve plugin**: enhanced-resolve recursion guard keys on hook+path+request, not conditionNames. Identical stack entry causes recursion failure
- **NormalModuleReplacementPlugin**: fires at `beforeResolve`, but the exports field mapping undoes the rewrite at resolution time
- **Webpack workarounds** (resolve.alias): pnpm virtual store paths don't match bare package patterns (session history)
- **Per-component shim lifecycle**: useEffect install/uninstall causes ref counting bug with multiple instances (session history)
- **Rebase of PR #2735**: failed due to RTL file moves (session history)
- **MutationObserver without delay**: fires on transient FallbackComponent, kills component (session history)
- **Prebuild static validation script** (PR #3910): 150-line network-dependent script to fetch CDS registry and validate specifier coverage. Rejected as overengineered: only one incident (`events` gap) which was caught in test env. Carrying cost too high for single-occurrence bug (session history)
- **PR #3904 initial `deps: []` attempt**: Jonathan's first approach (empty deps array) broke ESM loading entirely. The merged version uses a different strategy: centralizing deps injection in ComponentLoader and trimming host aliases (session history)

## Related

- `docs/solutions/best-practices/nextjs16-vendored-react-canary-breaks-cds-upp.md` -- broader Next.js 16 / React 19 CDS incompatibility
- `docs/solutions/best-practices/upp-component-architecture-subtypes-2026-04-14.md` -- CDS subType routing
- `docs/solutions/design-patterns/react-portal-content-escapes-ancestor-css-and-attrs.md` -- why wrapper CSS/ARIA can't hide a portaled @ux/modal; generalizes the focus-trap constraint behind Section 3 and the failed loading approaches
- `docs/solutions/workflow-issues/upp-payment-error-investigation.md` -- UPP debugging methodology
- `docs/solutions/ui-bugs/paywall-renewal-modal-stuck-2026-04-30.md` -- adjacent paywall bug (stuck renewal modal)
- Follow-on perf work handed off to the UPP and CDS teams: ESM load-performance profiling and CDS-loader warm-cache optimization.
- PR #4007 -- CdsEsmPreload mounted on manage-plan + homepage (per-page coverage)
- PR #3904 -- CDS team deps architecture refactor (centralized injection, `@cds/deps-esm` alias, host alias trim)
- PR #3126 -- Airo Builder ESM conversion
- PR #3019 -- UPP skeleton + warmCache + cds-cli bump
- PR #271 -- CDS per-package conditionNames via afterResolve
- PR #268 -- CDS null-frame + SSR type fix
- PR #269 -- CDS version isolation CLI (has P0: detectReactDependent regex)
- PR #266 -- CDS version isolation loader (has P0: nested cascade scope gap)

### Key files

| File | Role |
|------|------|
| `app/src/utils/reactCompat.ts` | `shimReactInternals()` for __SECRET_INTERNALS bridge |
| `app/src/app/[market]/develop/components/paywall/CdsEsmPreload.tsx` | Module cache preload + warmCache integration (bypass path, imports `@cds/deps-esm` directly) |
| `app/src/app/[market]/develop/components/paywall/cdsLoader.tsx` | `ComponentLoader` with centralized deps injection + debounced MutationObserver |
| `app/src/app/[market]/manage-plan/page.tsx` | CdsEsmPreload mount for manage-plan (PR #4007) |
| `app/src/app/[market]/HomeContent.tsx` | CdsEsmPreload mount for homepage variants (PR #4007) |
| `app/cds.host.esm.config.js` | ESM host alias config (3 host-alias deps: prop-types, axios, redux; `events` is a manualDep via cdsEventsShim, not a host alias) |
| `app/cds/deps-esm.js` | Generated deps bundle consumed via `@cds/deps-esm` webpack alias |
| `app/scripts/generate-cds-deps.js` | Generates `cds/deps-esm.js` at prebuild time |
| `app/src/types/cds-deps.d.ts` | TypeScript declarations for `@cds/deps-esm` and `*/cds/deps-esm.js` |

### Test coverage

- `app/src/utils/reactCompat.test.ts` (5 tests): shimReactInternals bridging
- `app/src/app/[market]/develop/components/paywall/cdsLoader.test.tsx` (8 tests): error handling, debounced MutationObserver, LoadingComponent passthrough
- 265 paywall tests pass across 17 test files
