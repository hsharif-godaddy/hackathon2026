# INC6463526: React 19 Checkout Crash - Root Cause & Fix Plan

## Status

- **Shim fix (airo-app-builder):** PR #2865 on `deverton/revert-react` - ready to merge
- **Upstream fixes:** Not started - see fix chain below

## Problem

All upgrade/checkout paths (F2P, P2P, add-on credits, domain purchase) show an infinite loading spinner. The remote `express.js` UMD bundle from the cart CDN crashes with:

```
TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')
```

## Root Cause Chain

### 1. Next.js 16 vendors React 19

Next.js 16.2.3 vendors React 19.3.0-canary at `next/dist/compiled/react/`. Its webpack config (`createVendoredReactAliases`) aliases ALL `react` imports to this vendored copy, bypassing any installed React version (pnpm overrides, catalog entries, etc.).

### 2. React 19 renamed its internals property

- React 18: `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`
- React 19: `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`

### 3. `@ux/react-bundle` sets `window.React` to the vendored copy

`@ux/react-bundle/src/react.js` does `window.React = React` using whatever webpack resolves `import React from 'react'` to - which is Next's vendored React 19.3.0-canary.

### 4. The cart CDN's `express.js` bundles a React 18 jsx-runtime

The `express.js` UMD bundle (built by `@px/checkout-react`) contains a vendored copy of React 18's `react/jsx-runtime` (module 75251 in the built artifact). This module reads `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner` from `window.React` - which no longer exists on the React 19 object.

### 5. Why `react/jsx-runtime` is bundled instead of externalized

**`@ux/react-bundle@1.3.1` `src/externals.js`** only externalizes three modules:

```javascript
const umd = {
  'react': { root: 'React', ... },
  'react-dom': { root: 'ReactDOM', ... },
  'react-dom/client': { root: 'ReactDOM', ... }
};
```

**`react/jsx-runtime` and `react/jsx-dev-runtime` are NOT listed.**

**`@px/checkout-react` `babel.config.js`** uses `@babel/preset-react` without options (line 18), which defaults to `runtime: 'automatic'`. This transforms JSX to:

```javascript
import { jsx as _jsx } from "react/jsx-runtime";
```

Since `react/jsx-runtime` is not in the webpack externals, webpack resolves it from `node_modules/react/jsx-runtime.js` and bundles it into `express.js`. The bundled copy is React 18's jsx-runtime which accesses the old internals property name.

## Fix Chain

### Fix 1: Shim in airo-app-builder (immediate - PR #2865)

**Repo:** `gdcorp-partners/airo-app-builder`
**Branch:** `deverton/revert-react`
**PR:** https://github.com/gdcorp-partners/airo-app-builder/pull/2865

Aliases the React 19 internals object back to the React 18 property name on `window.React` before checkout bundles load. Idempotent and forward-compatible - becomes a no-op once upstream fixes land.

Files changed:

- `app/src/utils/reactCompat.ts` - the shim function
- `app/src/utils/reactCompat.test.ts` - tests
- `app/src/app/develop/components/paywall/cdsLoader.tsx` - calls shim before CDS dynamic import
- `app/src/app/develop/components/widgets/DomainPurchaseWidget.tsx` - calls shim before @px/checkouts dynamic import

### Fix 2: Add jsx-runtime to `@ux/react-bundle` externals (upstream - fixes all consumers)

**Repo:** `github.com/gdcorp-uxp/react-bundle`
**Package:** `@ux/react-bundle` (currently v1.3.1)
**File:** `src/externals.js`
**Publish to:** `https://gdartifactory1.jfrog.io/artifactory/api/npm/node-uxplatform-local/`
**Maintainer:** Arnout Kazemier <akazemier@godaddy.com>

Add `react/jsx-runtime` and `react/jsx-dev-runtime` to the UMD externals map:

```javascript
const umd = {
  react: {
    root: "React",
    commonjs: "react",
    commonjs2: "react",
    amd: "react",
  },
  "react-dom": {
    root: "ReactDOM",
    commonjs: "react-dom",
    commonjs2: "react-dom",
    amd: "react-dom",
  },
  "react-dom/client": {
    root: "ReactDOM",
    commonjs: "react-dom/client",
    commonjs2: "react-dom/client",
    amd: "react-dom/client",
  },
  "react/jsx-runtime": {
    root: "React",
    commonjs: "react/jsx-runtime",
    commonjs2: "react/jsx-runtime",
    amd: "react/jsx-runtime",
  },
  "react/jsx-dev-runtime": {
    root: "React",
    commonjs: "react/jsx-dev-runtime",
    commonjs2: "react/jsx-dev-runtime",
    amd: "react/jsx-dev-runtime",
  },
};
```

The ESM externals array should also be updated:

```javascript
const esm = [
  "react",
  "react-dom/client",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];
```

The `root: 'React'` mapping works because React 19 (and 18) export `jsx`, `jsxs`, and `Fragment` from the top-level React object.

Publish as a minor version bump (1.4.0).

### Fix 3: Rebuild `@px/checkout-react` and redeploy `express.js` to cart CDN

**Repo:** `github.com/gdcorp-site/px-checkout-react`
**Package:** `@px/checkout-react` (currently v2.3.24)
**Team contact:** chopstx@godaddy.com (package author)
**Build command:** `npm run build` (`cross-env NODE_ENV=production webpack`)
**Output:** `dist/express.js` (UMD) - deployed to `cart.{domain}` CDN

Steps:

1. Bump `@ux/react-bundle` to 1.4.0+ in devDependencies
2. Run `npm install` then `npm run build`
3. Verify `dist/express.js` does NOT contain `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` (should now be externalized)
4. Deploy to cart CDN

**Alternative quick fix** (if `@ux/react-bundle` update is slow): Add the externals directly to `webpack.common.js` line 58:

```javascript
externals: {
  ...umd,
  'react/jsx-runtime': { root: 'React', commonjs: 'react/jsx-runtime', commonjs2: 'react/jsx-runtime', amd: 'react/jsx-runtime' },
  'react/jsx-dev-runtime': { root: 'React', commonjs: 'react/jsx-dev-runtime', commonjs2: 'react/jsx-dev-runtime', amd: 'react/jsx-dev-runtime' }
}
```

### Fix 4: Remove shim from airo-app-builder (cleanup)

Once fix 3 is deployed to the cart CDN, remove:

- `app/src/utils/reactCompat.ts`
- `app/src/utils/reactCompat.test.ts`
- `shimReactInternals()` calls from `cdsLoader.tsx` and `DomainPurchaseWidget.tsx`
- Revert `DomainPurchaseWidget.tsx` from dynamic import back to static import of `Checkout`

## Key Files Reference

| File                           | Repo                             | Role                                                         |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------ |
| `src/externals.js`             | gdcorp-uxp/react-bundle          | UMD externals map (missing jsx-runtime)                      |
| `webpack.common.js`            | gdcorp-site/px-checkout-react    | Consumes externals, builds express.js                        |
| `babel.config.js`              | gdcorp-site/px-checkout-react    | Uses automatic JSX runtime (causes jsx-runtime imports)      |
| `src/expressDom.js`            | gdcorp-site/px-checkout-react    | Entry point for express.js UMD bundle                        |
| `dist/express.js`              | cart CDN                         | The crashing bundle (contains vendored React 18 jsx-runtime) |
| `app/src/utils/reactCompat.ts` | gdcorp-partners/airo-app-builder | Our shim (temporary fix)                                     |

## What Was Ruled Out

- **React 18 downgrade** - Next.js 16 bypasses it via webpack alias to vendored React 19
- **`@px/checkouts` 2.1.0 upgrade** - Only widens peerDeps range; `Checkout.js` loader is identical
- **UPP library changes** - `unified-plans-and-pricing-library` externalizes React to `window.React` with no internals references in source
- **`gasket.ts` `presentationCentral.react` setting** - Only affects Presentation Central API params, not webpack resolution
