---
title: Cart display (labels, hostnames, terms, pricing) is cart-side config (CDS/UPP + Contentful appKey), not Airo code
date: 2026-06-01
last_updated: 2026-06-08
category: architecture-patterns
module: "app/src/app/[market]/develop/components/paywall"
problem_type: architecture_pattern
component: payments
severity: high
applies_when:
  - "a billing term (monthly vs annual) is missing or wrong in the Airo Builder cart"
  - "internal Airo preview hostnames (e.g. *.airoapp.ai) appear in the cart instead of friendly names"
  - "cart labels, product names, or pricing display incorrectly for Airo products"
  - "a paywall upgrade or new-purchase flow defaults to annual or adds only a domain to cart"
  - "deciding whether a cart display bug is owned by Airo Builder or the cart team"
  - "auditing CDS/UPP ComponentLoader usage in paywall flows before changing purchase params"
symptoms:
  - "internal Airo preview hostnames (e.g. z3ysmvkb5w.c37.airoapp.ai) shown in cart"
  - "monthly billing term option missing in cart for F2P and new-purchase flows"
  - "cart silently defaults to annual term"
  - "cart item labeled Renewal for a first-time purchase"
  - "nothing added to cart except a domain"
root_cause: config_error
resolution_type: config_change
related_components:
  - "app/src/app/[market]/develop/components/paywall/HigherPlansUpgradeContainer.tsx"
  - "app/src/app/[market]/develop/components/paywall/DirectToPaidContainer.tsx"
  - "app/src/app/[market]/develop/components/paywall/CreditsUpgradeContainer.tsx"
  - "app/src/app/[market]/develop/components/paywall/cdsLoader.tsx"
  - "app/src/app/[market]/develop/components/widgets/DomainPurchaseWidget.tsx"
tags:
  - cart
  - billing-term
  - cds
  - upp
  - contentful
  - paywall
  - responsibility-boundary
  - express-cart
  - hostname
---

# Cart display (labels, hostnames, terms, pricing) is cart-side config (CDS/UPP + Contentful appKey), not Airo code

## Context

Cart display issues in GoDaddy's commerce checkout for Airo Builder flows include: billing-term visibility (monthly vs annual), internal preview hostnames appearing as product labels, incorrect pricing presentation, and "Renewal" labeling on first-time purchases. The friction is diagnostic, not behavioral, because the symptom surfaces far from its cause and the escalation trail naturally points the wrong way.

The trail typically runs support → FOS → Payments → Cart, and each handoff nudges suspicion back toward Airo Builder's pricing or upgrade path. But the Airo paywall has no API surface for display content: it hands plan identity parameters to a CDS/UPP component and the cart owns everything about what text, labels, and prices are shown. The upgrade-path lead is almost always a red herring.

## Guidance

- **Rule of thumb:** ALL cart display content (product labels, hostnames, terms, pricing, renewal language) is governed by **CDS (Commerce Design System) / UPP (Unified Purchase Platform)** plus the **cart appKey's Contentful configuration**. It is **not** controlled by Airo Builder code. Any unexpected text, label, hostname, or pricing in the cart is a cart-side config symptom by default.
- **Confirm our side is clean (fast check):** the paywall containers pass only plan/identity params to the CDS/UPP `ComponentLoader` and set **no** display-related props (no hostname, site name, label, term, period, cadence, or `hideTerm`). Grep the paywall dir for `hostname`, `siteName`, `label`, `term`, `period`, `hideTerm`, `recurring` and expect zero hits. The integration ends at `ComponentLoader` (a thin wrapper over `@venture/cds-loader`); everything downstream is cart-owned.
- **What Airo passes to CDS (exhaustive per container):**
  - `DirectToPaidContainer`: `offerGroupId`, `productId`, `app="airo-builder"`, `source`, `itc`
  - `HigherPlansUpgradeContainer`: `productNamespace='airobuildr'`, `shopperId`, `accountId` (entitlementId), `app="airo-builder"`, `source="app-builder-NES"`
  - `CreditsUpgradeContainer`: `shopperId`, `productId`, `entitlementId`, `source`
- **The appKey distinction (the actual fix locus):** two **separate** Contentful express-cart appKeys back the two flows. `appBuilder` is the **free-to-paid / new-purchase** key and **should show the term selector**. `appBuilderP2P` is the **paid-to-paid** key and **intentionally** carries `hideTerm = yes`, because ecomm does not support changing term between two paid plans, so the suppressed selector is correct **only** for P2P. The reported bug class is `hideTerm = yes` leaking onto `appBuilder`; the fix is to flip the flag for `appBuilder` only and **leave `appBuilderP2P` untouched**. Neither appKey exists in our repo; they are external Contentful identifiers owned by the cart team.
- **Don't confuse with the domain appKey:** the only appKey in our develop components is `airo-abuilder` (`DomainPurchaseWidget.tsx:433`), used for domain express-checkout, unrelated to plan terms.

## Why This Matters

- **Stops misrouting:** a cart-config bug that lands in Airo eng burns a debugging cycle on code that can't be the cause, because the paywall has no term knob to turn.
- **Speeds escalation:** knowing the cause lives in the cart appKey's Contentful `hideTerm` flag routes the issue straight to the cart team with a concrete hypothesis instead of another vague "upgrade path" handoff.
- **Protects by-design behavior:** treating the suppressed P2P selector as "the bug" risks an accidental fix on `appBuilderP2P` that breaks the intentional ecomm contract. Scoping the fix to `appBuilder` preserves it.

## When to Apply

- Internal Airo preview hostnames (e.g. `z3ysmvkb5w.c37.airoapp.ai`) appear in the cart instead of friendly names.
- A billing term / cadence (monthly, annual, etc.) is missing or incorrect in the GoDaddy cart for an Airo Builder purchase or upgrade.
- Cart labels show "Renewal" for a first-time purchase (PFID language from Airo's freemium model being treated as existing subscription by ecomm).
- Cart product names, pricing, or descriptions display incorrectly for Airo products.
- The cart silently defaults to annual, or adds only a domain instead of the expected plan term.
- A report frames the issue as an "upgrade-path issue" originating from cart, payments, or the order shim.
- Before changing any paywall purchase parameters in response to a cart display symptom; confirm the cause is cart-owned first.

## Examples

**Hostname display (AIROBUILD-2242):**

- *Looks like:* "Internal Airo hostnames are showing in the cart instead of site names. Airo must be passing the wrong label."
- *Actually is:* UPP resolves the product display name from subscription/entitlement metadata or Contentful product catalog. Airo passes no hostname or name prop. Cart-side fix needed.

**Billing-term visibility:**

- *Looks like:* "Our upgrade path sends the wrong recurring term, Airo Builder is forcing annual."
- *Actually is:* the `appBuilder` express-cart appKey had `hideTerm = yes` in Contentful (a flag that belongs only on the P2P key `appBuilderP2P`), suppressing the monthly selector for free-to-paid. Cart-owned config, not Airo code.

**Where our integration ends (no term control downstream):**

- `app/src/app/[market]/develop/components/paywall/HigherPlansUpgradeContainer.tsx` renders the CDS/UPP `ComponentLoader` with `subType='UniversalUpgrade'`, passing `app="airo-builder"`, `source="app-builder-NES"`, `productNamespace='airobuildr'`, plus `requestedPlanType`, `shopperId`, `accountId`. No term/period/`hideTerm` param.
- `app/src/app/[market]/develop/components/paywall/DirectToPaidContainer.tsx` is the new-customer flow, same pattern with `subType='DirectToPaid'`. No term/period/`hideTerm` param.
- `app/src/app/[market]/develop/components/paywall/cdsLoader.tsx` is the generic `ComponentLoader` wrapping `@venture/cds-loader`'s `CdsComponentLoader`; this is the handoff boundary to CDS/UPP.

**Unrelated appKey (don't chase):**

- `app/src/app/[market]/develop/components/widgets/DomainPurchaseWidget.tsx:433` sets `appKey="airo-abuilder"` for domain express-checkout. The only appKey in our code, and unrelated to plan terms.

**By-design behaviors, NOT bugs:**

- New purchase blocked when the customer already has Airo Builder on the account.
- Additional plan creation blocked past the 50-published-site cap.
- The term selector hidden under the **P2P** appKey (`appBuilderP2P`), intentional since ecomm does not support term changes between paid plans.

## Resolution History

### Hostname display regression (AIROBUILD-2242, 2026-06-08)

Internal preview hostnames (`z3ysmvkb5w.c37.airoapp.ai`, `2rn63dhhcx.c38.airoapp.ai`, etc.) resurfaced in the cart. Reported via customer #39392224. Flow: godaddy.com/airo/ai-builder -> My Apps -> Publish.

The cart team confirmed: "we removed that a while ago, but it looks like it resurfaced." Escalated to cart team. The hostname display is resolved by UPP from the product catalog or subscription metadata. Airo passes no hostname prop.

Status: investigating (cart-side). Jira: AIROBUILD-2242.

### Billing-term selector (2026-06-02)

The `appBuilder` appKey's `hideTerm` flag was flipped to `no` in Contentful by the cart team:
- Test: deployed 2026-05-30
- Verified in test: 2026-06-02 (term toggle visible, monthly Starter $19.99 added to cart with "1 Month" duration, zero console errors, all CDS ESM resources HTTP 200)
- Prod: deployed 2026-06-02
- Customer-confirmed resolved: 2026-06-02

Verification approach: opened /manage-plan on deployed test env (airo-builder.test-godaddy.com via Akamai, not localhost), triggered F2P upgrade modal, confirmed "Billed monthly" / "Billed yearly" toggle rendered, selected monthly, completed add-to-cart. Duration dropdown in checkout showed both "1 Month" and "12 Months".

Contacts: cart team (Contentful config owner), product (approval for appBuilder-only scope).

## Related

- `docs/solutions/best-practices/upp-component-architecture-subtypes-2026-04-14.md` covers the Airo side of this seam (one container per CDS subType, F2P/D2P/P2P props). This doc covers the cart side (term visibility via the appKey `hideTerm` Contentful flag). Together they form the full picture.
- `docs/solutions/workflow-issues/upp-payment-error-investigation.md` covers UPP/CDS iframe debugging methodology (empty cart, shopper/entitlement IDs).
- `docs/solutions/best-practices/cds-purchase-callback-reliability-patterns-2026-04-15.md` covers post-purchase callback handling on the same integration surface.
- Monthly-term-selector-missing issue: reported 2026-05-26, closed 2026-06-02.
