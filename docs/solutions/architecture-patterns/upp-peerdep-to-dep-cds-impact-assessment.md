---
title: UPP peerDep-to-dep moves and CDS host impact assessment
date: 2026-06-02
category: architecture-patterns
module: app/paywall
problem_type: architecture_pattern
component: tooling
severity: low
applies_when:
  - UPP moves packages from peerDependencies to dependencies
  - UPP changes its externalization surface (cds.config.esm.js hostProvided array)
  - UXCore version in UPP diverges from host app UXCore version
tags:
  - upp
  - cds
  - deps-esm
  - uxcore
  - peer-dependencies
  - tooltip-legacy
  - paywall
---

# UPP peerDep-to-dep moves and CDS host impact assessment

## Context

UPP (unified-plans-and-pricing-library) is consumed via CDS at runtime, not as a direct npm dependency. The host app provides certain packages to UPP through `app/cds/deps-esm.js` (aliased as `@cds/deps-esm`). When UPP moves packages from `peerDependencies` to `dependencies`, it bundles those packages internally rather than consuming them from the host.

PR #3111 (UPP v16.8.0) moved all `@ux/*` packages from peerDeps to deps and dropped `@ux/tooltip-legacy` in favor of `@ux/tooltip`. This means UPP bundles UXCore 2400.x internally while the host app runs 2500.x.

(session history) Prior sessions on this branch confirm that CDS ESM loading has a ~700ms cold-load gap when `warmCache` fails (57% failure rate in test env). During this window, the skeleton modal is the only loading feedback. UXCore version conflicts could affect modal rendering during this gap.

## Guidance

When UPP changes its dependency strategy (peer to bundled or vice versa):

1. **Check `app/cds/deps-esm.js`** for host-provided packages UPP no longer requests. After the new UPP version lands in CDS registry, remove dead entries from deps-esm.js and the corresponding packages from `app/package.json`.

2. **Assess CSS/style conflicts**: if UPP bundles UXCore N.x internally while the host runs M.x, both render in the same DOM. Watch for visual regressions in paywall modals where UPP components coexist with host UXCore.

3. **React context isolation**: UPP's internally-bundled UXCore components cannot access React context from the host tree (theme providers, intl). Verify UPP components render correctly without host-provided context.

4. **No preemptive changes before the new version ships to CDS**. The CDS boundary abstracts the dependency; changes are only needed after the new version is live.

5. **Verify with CDN smoke test** (`docs/solutions/developer-experience/smoke-test-cds-esm-against-prod-cdn-from-local-dev-2026-05-08.md`) before and after the CDS registry update.

### Specific cleanup for UPP v16.8.0 (PR #3111)

UPP v16.8.0 has shipped and no longer requests `@ux/tooltip-legacy` from host. Cleanup is half-done:

- **Done:** the `@ux/tooltip-legacy` entry is already removed from `app/cds/deps-esm.js` (the `import * as uxTooltipLegacy from '@ux/tooltip-legacy'` line and its `'@ux/tooltip-legacy': { module: uxTooltipLegacy, version: '2400.19.2' }` registration are gone).
- **Remaining:** `@ux/tooltip-legacy` is still listed in `app/package.json` (`"@ux/tooltip-legacy": "^2400.19.2"`). It is NOT droppable as-is: the host still consumes it via a CSS import — `@import "@ux/tooltip-legacy/styles";` at `app/src/styles/uxcore-components.css:31`. To remove the dep, first delete that `@import` (and confirm no host component renders a legacy tooltip), then drop the `app/package.json` entry.

## Why This Matters

CDS acts as a runtime module federation layer. When UPP listed UXCore as peerDependencies, the host controlled the version and one copy existed in the DOM. When UPP internalizes deps, two versions coexist at runtime. CSS class name collisions or specificity conflicts between UXCore 2400.x (inside UPP) and 2500.x (host) can cause subtle visual bugs.

The isolation model means bundle size impact stays within UPP's CDS chunk (doesn't affect the host webpack bundle), but DOM-level side effects (styles, context) still cross the boundary.

(session history) Prior investigation found the events polyfill breakage from UPP PR #3074 followed the same pattern: UPP changed its externalization, broke AAB's paywall. The `cds-esm-events-polyfill-missing-from-import-map.md` doc records that precedent.

## When to Apply

- Whenever UPP publishes a version that changes its peerDependencies list
- When the CDS team announces UXCore version isolation features (the CDS team's ESM version isolation)
- When upgrading the host app's UXCore version while UPP still bundles a different version
- During paywall/upgrade modal visual regression triage
- When `generate-cds-deps.js` or `cds.host.esm.config.js` needs updating after upstream changes

## Examples

UPP package.json change (PR #3111):

```json
// Before — UXCore as peerDependencies (host provides)
"peerDependencies": {
  "@ux/alert": "*",
  "@ux/button": "*",
  "@ux/tooltip-legacy": "*"
}

// After — UXCore as dependencies (UPP bundles internally)
"dependencies": {
  "@ux/alert": "2400.15.1",
  "@ux/button": "2400.15.1",
  "@ux/tooltip": "2400.15.1"
}
```

CDS loading path in this repo:
- `app/src/app/[market]/develop/components/paywall/cdsConfig.ts` defines type IDs
- `app/src/app/[market]/develop/components/paywall/cdsLoader.tsx` wraps `@venture/cds-loader`
- `app/cds/deps-esm.js` provides host deps via `@cds/deps-esm` alias
- `CdsEsmPreload.tsx` pre-warms the ESM bundle and plan data

Impact assessment template for future UPP peerDep changes:

| Check | Question |
|-------|----------|
| Dead deps in deps-esm.js? | Does UPP still request this package from host, or bundle it now? |
| Version conflict risk? | Does the bundled version differ from host's version? |
| CSS collision? | Do both versions use the same class names / intent tokens? |
| Context isolation? | Does the bundled dep need host-level React context? |
| Bundle size? | How much does UPP's CDS chunk grow? (host bundle unaffected) |

## Related

- `docs/solutions/architecture-patterns/cds-esm-centralized-deps-alias.md` — deps-esm architecture and manualDeps management
- `docs/solutions/best-practices/cds-esm-react19-compat-shims-2026-04-23.md` — canonical CDS ESM integration doc
- `docs/solutions/integration-issues/cds-esm-events-polyfill-missing-from-import-map.md` — precedent: UPP externalization change broke AAB
- `docs/solutions/workflow-issues/flag-gated-migration-verification-2026-05-18.md` — verification protocol for UPP upstream changes
- `docs/solutions/architecture-patterns/cds-modal-loading-lifecycle.md` — paywall loading pattern
- Escalation: `#upp-unified-plans-and-pricing` (UPP team)
