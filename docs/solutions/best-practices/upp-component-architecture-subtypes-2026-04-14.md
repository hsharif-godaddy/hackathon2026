---
title: UPP component architecture -- three distinct CDS subTypes
date: 2026-04-14
category: best-practices
module: app/src/app/[market]/develop/components/paywall
problem_type: best_practice
component: payments
severity: high
applies_when:
  - adding or modifying paywall/upgrade flows
  - integrating new UPP purchase paths (D2P, P2P, F2P)
  - debugging CDS ComponentLoader errors in the upgrade modal
  - reading UPP team PRs or changelog
tags:
  - upp
  - cds
  - paywall
  - direct-to-paid
  - d2p
  - single-plan-upgrade
  - universal-upgrade
  - component-loader
---

# UPP component architecture -- three distinct CDS subTypes

## Context

In PR #2772 (April 2026), we assumed Direct-to-Paid (D2P) was a *mode* of the `SinglePlanUpgrade` CDS component, activated by passing a `planGroupId` prop. This was wrong. The UPP library has `DirectToPaid` as a completely separate component tree with its own layouts, context providers, and term toggle. Passing `planGroupId` to `SinglePlanUpgrade` caused errors because that component doesn't accept it.

The confusion arose because:
- UPP Slack threads discussed D2P using `planGroupId` and `productId` without clarifying which subType consumes them
- The CDS ComponentLoader accepts `Record<string, unknown>`, so unknown props pass through without TypeScript errors
- There was no documentation mapping UPP subTypes to purchase flows

## Guidance

The UPP library (`godaddyUnifiedPlansAndPricingLibrary`) loaded via `@venture/cds-loader` has **three distinct subTypes**. Each is a separate component tree, not a mode or prop variation of another:

| CDS `subType` | Purchase flow | Required props | Container in our codebase |
|---|---|---|---|
| `UniversalUpgrade` | Multi-plan F2P and P2P comparison | `accountId`, `currentPlan`, `requestedPlanType` | `HigherPlansUpgradeContainer.tsx` |
| `DirectToPaid` | Net-new customer, no subscription | `offerGroupId`, `productId` (no `entitlementId`) | `DirectToPaidContainer.tsx` |
| `StandaloneAddon` | Add-on purchase (credits) | `entitlementId`, `productId` | `CreditsUpgradeContainer.tsx` |

### Key differences for DirectToPaid

- Has its own component tree: `D2PPlansContainer`, `D2PPlansLineup`, `D2PTermToggle`, `D2PLayouts`
- Has its own context: `D2PLineupTermContext` (billing term toggle between monthly/annual)
- Takes `offerGroupId` (e.g., `D2P_OFFER_GROUP_IDS.AIRO_BUILDER_LINEUP`) + `productId` (e.g., `AiroBuilderProduct`)
- Does NOT take `entitlementId` (new customer has none)
- UPP playground: `/d2p?planGroupId=airoBuilderLineup&productId=AiroBuilderProduct`
- Reference: `gdcorp-im/unified-plans-and-pricing-library` PR #2930

### Integration pattern

Each UPP subType needs its own container component. `UpgradeContainer.tsx` currently routes:

```typescript
// UpgradeContainer.tsx routing (current implementation)
if (!hasSubscriptionWithEntitlement) return <DirectToPaidContainer {...props} />
return <HigherPlansUpgradeContainer {...props} />
```

Do NOT reuse an existing container by adding conditional props. The prop APIs are different enough that conditional spreading creates subtle bugs (wrong props silently ignored due to `Record<string, unknown>`).

## Why This Matters

The CDS ComponentLoader uses `Record<string, unknown>` for props, which means:
- **Unknown props are silently passed through** -- no TypeScript error when you pass `planGroupId` to `SinglePlanUpgrade`
- **Wrong subType + correct-looking props = runtime error inside the CDS iframe**, not a compile-time error
- **Debugging is hard** because the error surfaces as a generic CDS fallback, not a "wrong subType" message

Without this knowledge, any developer adding a new purchase flow will likely try to reuse an existing container with conditional props (as we did) rather than creating a new one for the correct subType.

## When to Apply

- Before integrating any new UPP purchase path
- When UPP ships a new PR affecting Airo Builder products
- When debugging CDS errors that only affect certain customer types
- When reading UPP Slack threads mentioning new props or flows

## Examples

### Wrong (PR #2772 approach)

```typescript
// SinglePlanUpgradeContainer.tsx -- WRONG
// Tried to make SinglePlanUpgrade handle D2P via conditional planGroupId
<ComponentLoader
  subType='SinglePlanUpgrade'
  entitlementId={entitlementId}
  {...(isNewCustomer && { planGroupId: PLAN_GROUP_IDS.AIRO_BUILDER_LINEUP })}
/>
// Result: runtime error -- SinglePlanUpgrade doesn't accept planGroupId
```

### Correct (current implementation in DirectToPaidContainer.tsx)

```typescript
// DirectToPaidContainer.tsx -- CORRECT
// Separate container for the DirectToPaid subType.
// ESM loader via cdsLoader's ComponentLoader; deps are injected centrally
// (no per-container deps prop — see cds-esm-centralized-deps-alias doc).
<ComponentLoader
  type={umdFallback ? CDS_TYPE_UMD : CDS_TYPE_ESM}
  {...(!umdFallback && { loaderMode: 'esm' })}
  subType='DirectToPaid'
  offerGroupId={D2P_OFFER_GROUP_IDS.AIRO_BUILDER_LINEUP}
  productId={productId}
  cds={gasketData?.cds}
  locale={gasketData?.intl?.locale || 'en-US'}
  app="airo-builder"
  source={source || 'app-builder-D2P'}
  // ... callbacks
/>
```

## Related

- `docs/solutions/architecture-patterns/cart-billing-term-visibility-owned-by-cds-upp.md` -- cart side of this seam: term visibility (monthly/annual) is controlled by the cart appKey `hideTerm` Contentful flag, not Airo code
- `docs/solutions/workflow-issues/upp-payment-error-investigation.md` -- UPP debugging methodology
- `docs/solutions/ui-bugs/new-customer-upgrade-modal-undefined-entitlement-2026-04-13.md` -- PR #2772 investigation context (closed without merge, used wrong subType)
- `docs/solutions/best-practices/nextjs16-vendored-react-canary-breaks-cds-upp.md` -- Next.js 16 React canary incompatibility with CDS-loaded UPP
- UPP playground: `https://upp-playground.test-godaddy.com/d2p?planGroupId=airoBuilderLineup&productId=AiroBuilderProduct`
- UPP source: `gdcorp-im/unified-plans-and-pricing-library` PR #2930
- CDS loader: `app/src/app/[market]/develop/components/paywall/cdsLoader.tsx`
- Escalation: `#upp-unified-plans-and-pricing` (UPP team)
