---
title: "Next.js 16 vendored React canary breaks CDS-loaded UPP/ExpressCheckout"
date: 2026-04-15
category: best-practices
module: paywall/checkout
problem_type: best_practice
component: tooling
severity: critical
applies_when:
  - Upgrading Next.js to version 16+
  - Using CDS-loaded components (UPP, ExpressCheckout)
  - Application bundles @ux/react-bundle (sets window.React)
  - External runtime-loaded dependencies rely on window.React
tags:
  - nextjs-16
  - react-canary
  - upp
  - cds
  - express-checkout
  - webpack-alias
  - uxp
  - window-react
related_components:
  - payments
  - frontend_stimulus
---

# Next.js 16 vendored React canary breaks CDS-loaded UPP/ExpressCheckout

## Context

After upgrading Next.js from 14.2.35 to 16.2.3 (commit `493703efa`, merged 2026-04-15), the plan upgrade checkout flow broke in production. Users clicked plan upgrade buttons, the UPP (Unified Plans and Pricing) library loaded via CDS, created a basket, but ExpressCheckout never fired its `/launch` request. No `onLoad` or `onError` callbacks executed. The UI showed an infinite loading spinner.

The bug manifested the same day as the Next.js 16 upgrade. It was reported as a Cart Support ticket at critical urgency. The `/assets` call to initialize ExpressCheckout was visible in network traffic, but nothing happened after that.

This is not a code bug in the Airo Builder codebase. The root cause is an incompatibility between Next.js 16's vendored React, GoDaddy's UXP framework (`@ux/react-bundle`), and UPP's internal `@px/checkouts` library.

## Guidance

**When upgrading Next.js in applications that use GoDaddy's UXP/CDS ecosystem:**

1. **Verify `window.React.version` in the browser** after upgrading. Next.js 16+ may silently alias your React to its internal canary build.
2. **Test all CDS-loaded components** (UPP, ExpressCheckout, etc.) that render using `window.React`. They fail silently when the React version is incompatible.
3. **Coordinate with UPP/px team before major Next.js upgrades**. Their components must support whatever React version ends up on `window.React`.
4. **Do not attempt webpack config workarounds** to replace `@ux/react-bundle`. The pnpm virtual store paths make `NormalModuleReplacementPlugin`, `IgnorePlugin`, and `resolve.alias` patterns unreliable.

### The causal chain

1. Next.js 16 vendors `react@19.3.0-canary-3f0b9e61-20260317` at `next/dist/compiled/react/`
2. Webpack aliases `react$` to `next/dist/compiled/react` for all client builds (`next/dist/build/create-compiler-aliases.js`)
3. `@ux/react-bundle/src/react.js` does `import React from 'react'` and gets the canary
4. Sets `window.React = React` (canary) and `window.ux.React = React`
5. CDS loads UPP at runtime via script tag injection from CDN
6. UPP uses `window.React` to render components, including ExpressCheckout from `@px/checkouts`
7. `@px/checkouts` does not support React 19 (or the canary specifically)
8. ExpressCheckout fails silently: never fires `/launch`, never calls callbacks

### How window.React gets set

```javascript
// @ux/react-bundle/src/react.js (bundled via UXP Gasket plugin)
import React from 'react';  // <-- Next.js 16 aliases to next/dist/compiled/react (canary)
if (typeof window !== 'undefined') {
  if (!window.ux) window.ux = {};
  window.React = window.ux.React = React;  // canary React on window
}
```

### How Next.js 16 aliases React

```javascript
// next/dist/build/create-compiler-aliases.js
reactAlias = {
  react$: `next/dist/compiled/react${bundledReactChannel}`,
  'react/jsx-runtime$': `next/dist/compiled/react${bundledReactChannel}/jsx-runtime`,
  'react-dom$': `next/dist/compiled/react-dom${bundledReactChannel}`,
  'react-dom/client$': `next/dist/compiled/react-dom${bundledReactChannel}/client`,
}
```

## Why This Matters

### Silent failure

ExpressCheckout doesn't throw errors. It renders a `<div>` with a loading spinner, calls `loadAssets()`, and then never progresses. The flow:

```
initPx() -> loadAssets() (POST /assets) -> loadScript() -> polls isCheckoutReady
                                                                    |
                                                          [NEVER BECOMES TRUE]
                                                                    |
                                                          loadCheckout() never called
                                                          /launch never fired
                                                          no callbacks
```

There is no error in the console, no failed network request, no visible indication of what went wrong. The only diagnostic is checking `window.React.version`.

### CDS architecture gap

CDS-loaded components exist outside the webpack bundle. They are loaded at runtime from CDN via script tag injection (`@venture/cds-loader` -> `loadCdsModule` -> `insertTag`). They have no way to bring their own React. They depend on `window.React` being a compatible version.

The `@venture/cds-loader/lib/load-dependencies.js` semver check covers `@ux/*` dependencies provided in `UPGRADE_DEPS`, but does NOT validate `window.React` compatibility. It trusts whatever is on the global.

### presentationCentral.params.react is a red herring

The `react: '19'` param added to `presentationCentral.params` in `gasket.ts` during the upgrade is redundant. `@godaddy/gasket-plugin-uxp/lib/presentation.js` (line 96-106) auto-detects the React version from `require('react').version` and merges it into params. The explicit param changes nothing.

## When to Apply

- **Before any Next.js major/minor upgrade** in apps using `@godaddy/gasket-plugin-uxp`
- **When CDS-loaded components stop working** after a framework upgrade (check `window.React.version` first)
- **When debugging checkout/paywall flows** that show `/assets` succeeding but no `/launch`
- **When `@ux/react-bundle` is bundled** (check for `window.ux.React` in the browser)

This does NOT apply when:
- Using only npm-installed GoDaddy packages (not CDS-loaded)
- Application doesn't bundle `@ux/react-bundle`
- Using UXP with `externals: true` (different React resolution strategy)

## Examples

### Quick verification

```javascript
// Browser console on any page
window.React.version
// Expected (stable): "19.1.0"
// Broken (Next.js 16 canary): "19.3.0-canary-3f0b9e61-20260317"
```

```bash
# Verify vendored React in Next.js
pnpm --filter website exec -- node -e "
  const path = require('path');
  const fs = require('fs');
  const nextDir = path.dirname(require.resolve('next/package.json'));
  const content = fs.readFileSync(
    path.join(nextDir, 'dist/compiled/react/cjs/react.production.js'), 'utf8'
  );
  const match = content.match(/exports\\.version\\s*=\\s*['\"]([^'\"]+)['\"]/);
  console.log('Vendored React:', match ? match[1] : 'unknown');
"
```

### What didn't work (webpack workarounds)

**NormalModuleReplacementPlugin** - regex didn't match pnpm virtual store paths:
```javascript
// DOES NOT WORK
config.plugins.push(
  new webpack.NormalModuleReplacementPlugin(
    /@ux[/\\]react-bundle[/\\]src[/\\]react/,
    '/path/to/noop.js'
  )
);
```

**resolve.alias** - alias didn't take effect:
```javascript
// DOES NOT WORK
config.resolve.alias['@ux/react-bundle/src/react'] = false;
```

**IgnorePlugin** - same regex matching issue:
```javascript
// DOES NOT WORK
config.plugins.push(
  new webpack.IgnorePlugin({ resourceRegExp: /react-bundle\/src\/react/ })
);
```

All three failed because `@ux/react-bundle` resolves through pnpm's virtual store (`node_modules/.pnpm/@ux+react-bundle@1.3.1/...`), not the bare package path.

### Other investigation dead ends

1. **`optimizePackageImports` + `react-intl`**: Hypothesized tree-shaking of `import * as ReactIntl` in `cdsLoader.tsx`. Built both ways, output byte-for-byte identical. Namespace imports are not affected by `optimizePackageImports`.

2. **D2P branch correlation**: Bug report coincided with Direct-to-Paid feature work on `mlindstedt/d2p`. That branch was never merged to prod. Pure timing coincidence.

3. **Gasket plugin version bumps**: `@godaddy/gasket-plugin-uxp` specifier changed `^3.7.3` -> `^3.7.4` but resolved version was already 3.7.4 before the upgrade. No behavioral change.

4. **CSP/proxy changes**: Proxy target protocol changed `https:` -> `http:` but only for local dev environments. Production not affected.

### Actual resolution path

**2026-04-15:** Prod rolled back. Cart team on the incident call. Their v2 cart component was supposed to support multiple React versions, but UPP was on v1. UPP updated to v2 and the cart component still failed.

**2026-04-23 (resolved):** PR #3126 converted all CDS paywall containers from UMD to ESM loader (`godaddyUnifiedPlansAndPricingLibraryEsm`). ESM mode uses `deps-esm.js` to supply the host's `react/jsx-runtime` directly, avoiding the `$$typeof` symbol mismatch at the source. Early iterations used Symbol.for intercept and `__CDS_ESM_LIBS__` Proxy, but these were removed once deps-esm.js eliminated the need. Only `shimReactInternals()` remains for `__SECRET_INTERNALS` bridging (needed by non-CDS UMD consumers like DomainPurchaseWidget). `CdsEsmPreload` warms module cache + calls `warmCache()` on page load for performance. See `docs/solutions/best-practices/cds-esm-react19-compat-shims-2026-04-23.md` for the full guide. Upstream fixes (jsx-runtime externals in `@ux/react-bundle`, `@px/checkout-react` rebuild) are still pending but no longer blocking deploys.

Escalation channels: `#upp-unified-plans-and-pricing`, `#cart`.

### Key files reference

| File | Role |
|------|------|
| `app/next.config.js` | Webpack config (where workarounds were attempted) |
| `app/gasket.ts` | Gasket framework config (UXP, CDS, presentationCentral) |
| `app/src/app/[market]/develop/components/paywall/cdsLoader.tsx` | CDS ESM wrapper (rewritten in PR #3126) |
| `app/src/app/[market]/develop/components/paywall/constants.ts` | Product IDs (UPGRADE_DEPS removed in PR #3126) |
| `app/src/app/[market]/develop/components/paywall/UpgradeContainer.tsx` | Routes to HigherPlans container |
| `app/src/utils/reactCompat.ts` | `shimReactInternals()` for `__SECRET_INTERNALS` bridging (non-CDS UMD consumers) |
| `@ux/react-bundle/src/react.js` | Sets `window.React` from `import React from 'react'` |
| `@venture/cds-loader/lib/load-cds-module.js` | Runtime script injection for CDS components |
| `@venture/cds-loader/lib/load-dependencies.js` | Semver check for provided deps, `window.ux` lookup |
| `@godaddy/gasket-plugin-uxp/lib/presentation.js` | Auto-detects React version for PC params |
| `@godaddy/gasket-plugin-uxp/lib/webpack-config.js` | UXP webpack hooks (externals, UMD) |
| `@px/checkouts/esm/Checkout.js` | ExpressCheckout component (initPx, loadAssets, loadCheckout) |

## Related

- `docs/solutions/workflow-issues/upp-payment-error-investigation.md` (session history) - UPP payment debugging methodology, Kibana dashboards, escalation channels. Different root causes (cart errors, d2p gaps) but same component system.
- `docs/solutions/best-practices/upp-component-architecture-subtypes-2026-04-14.md` - UPP CDS subType selection (DirectToPaid vs SinglePlanUpgrade vs UniversalUpgrade).
- `docs/solutions/build-errors/pnpm-babel-runtime-hoisting-2026-03-30.md` - Previous `@px/checkouts` compatibility issue (pnpm hoisting). Same class of problem (external lib breaks after environment change), different mechanism.
