---
name: commerce-one-time-payment
description: Render a simple GoDaddy Commerce one-time checkout UI (products, checkout, success/cancel pages) using existing Commerce SKUs. UI only.
whenToUse: Trigger when user wants simple payments or a buy-now checkout — "accept payments", "charge customers", "one-time service payment", "payment page", "buy now page", "single product checkout", "one-time payment". Backed by GoDaddy Commerce SKU data, not a full cart storefront. Load commerce first to verify/setup store/catalog data, then use this skill for UI wiring.
---

# GoDaddy Commerce One-Time Payment UI Skill

Use this skill when the user wants a **simple buy-now checkout flow**.

This skill is **UI wiring only**.

- It does **not** create stores/products/prices/inventory.
- Use `commerce` skill first for Commerce management operations.

## Scope Split

| Skill                       | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `commerce`                  | Store setup + catalog/product/pricing/inventory/media/orders APIs |
| `commerce-one-time-payment` | Simple one-time checkout UI pages                                 |
| `commerce-storefront`       | Full storefront UI (catalog + cart + product details)             |

## Absolute Rules

1. **Load `commerce` skill first** and use existing Commerce data.
2. **Use SKU IDs for checkout** (`product.skuId`), never SKU Group IDs.
3. **Do NOT modify** `src/server/api/commerce/create-checkout-session/POST.ts` (immutable route).
4. Keep preview URL fallback behavior for return/success URLs.
5. Do not request Commerce OAuth secrets manually (system-managed in task-local config.json).

## Understanding draftOrderId and Payment Flow

**IMPORTANT:** `createCheckoutSession` returns an `orderId` which is a **draft order ID** (unpaid order in GoDaddy Commerce).

- **Store the draftOrderId** in your database immediately after session creation (e.g., `booking.orderId = session.orderId`)
- **Customer pays** at the returned `checkoutUrl` (redirects to GoDaddy Commerce checkout)
- **On successUrl redirect** (customer returns after payment), use the same `orderId` to check payment status via `GET /api/commerce/order-status?orderId={orderId}`
- **If payment succeeded**, the draft order is now a paid order (same ID, status transitions from `pending` → `paid`)
- **If customer doesn't pay**, draft order auto-expires after 24 hours in GoDaddy Commerce
- **Use case:** For booking/reservation features, create your DB record first with `orderId: null`, then create payment session, then update record with `orderId` from session response

---

## Pre-Check: Existing Storefront UI

If the app already uses storefront components (`ProductGrid`, `ProductDetails`, `Cart`), ask:

> "This app already has a storefront flow. Do you want to:
>
> 1. Keep storefront components
> 2. Add a separate simple one-time checkout flow"

Wait for confirmation before proceeding.

---

## Required Pre-Step: Prepare Commerce Data

```typescript
skill({ action: 'load', skill: 'commerce' });
```

Then verify store/catalog data:

- `commerce__setup_store` → get `storeId`, `channelId`, `locationId`
- `commerce__fetch_catalog` → get existing products/SKUs

If catalog is empty, stop and ask whether to run the `commerce` management workflow first.

---

## Step 1: Install One-Time Payment Templates

```typescript
skill({ action: 'install', skill: 'commerce-one-time-payment' });
```

Installs:

- `src/lib/commerce-client.ts`
- `src/server/api/commerce/create-checkout-session/POST.ts`
- `src/lib/commerce/products.ts`
- `src/lib/commerce/payment-flow.ts`
- `src/pages/commerce/Products.tsx`
- `src/pages/commerce/Checkout.tsx`
- `src/pages/commerce/Success.tsx`
- `src/pages/commerce/Cancel.tsx`

Read these templates before customization so checkout wiring remains correct.

---

## Step 2: Populate Product Data from `commerce__fetch_catalog`

Update `src/lib/commerce/products.ts` by replacing the empty `COMMERCE_PRODUCTS` array.

Mapping from `commerce__fetch_catalog` output:

- `product.skus[i].id` → `skuId`
- `product.label` (or `sku.label`) → `title`
- `product.description` → `description`
- `product.skus[i].prices[0].value` → `price`
- `product.skus[i].prices[0].currencyCode` → `currencyCode`

Important:

- `price` must stay in smallest currency unit (e.g., cents for USD).
- Only include SKUs that actually have a valid price.
- `imageUrl` is optional.

---

## Step 3: Set Store ID and Channel ID

Update `src/lib/commerce/payment-flow.ts`:

```ts
export const STORE_ID = 'REPLACE_WITH_STORE_ID';
export const CHANNEL_ID = 'REPLACE_WITH_CHANNEL_ID';
```

Use `storeId` and `channelId` from `commerce__setup_store`. `channelId` is required for order number assignment in the GoDaddy Commerce admin.

---

## Step 4: Wire Routes

In `src/routes.tsx` add lazy imports + routes:

```tsx
const CommerceProductsPage = lazy(() => import('./pages/commerce/Products'));
const CommerceCheckoutPage = lazy(() => import('./pages/commerce/Checkout'));
const CommerceSuccessPage = lazy(() => import('./pages/commerce/Success'));
const CommerceCancelPage = lazy(() => import('./pages/commerce/Cancel'));

{ path: '/products', element: <CommerceProductsPage /> },
{ path: '/checkout/:skuId', element: <CommerceCheckoutPage /> },
{ path: '/checkout/success', element: <CommerceSuccessPage /> },
{ path: '/checkout/cancel', element: <CommerceCancelPage /> },
```

Update route path types/enums accordingly.

---

## Rendering Guidance (Template-Specific)

- Keep products page driven by `COMMERCE_PRODUCTS`.
- Keep checkout page lookup by route `skuId` and `getCommerceProductBySkuId`.
- Keep checkout button behavior in `Checkout.tsx`:
  - call `startOneTimeCommerceCheckout({ skuId, quantity: 1 })`
  - redirect to `result.checkoutUrl` on success
  - show error message on failure
- **Customer prefill:** `Checkout.tsx` already reads `customer` from React Router `location.state` and forwards it to `startOneTimeCommerceCheckout`. To pre-fill the GoDaddy checkout form, the upstream page (e.g. appointment booking form) must navigate with state:
  ```ts
  navigate(`/checkout/${skuId}`, { state: { customer: { billing: { firstName, lastName, email } } } })
  ```
  Pass email under either `billing.email` or `shipping.email` — the POST route automatically mirrors `billing.email → shipping.email` because `<Checkout />` reads `order.shipping.email` and `billing.email` is not exposed in the session query response.
  Do **not** remove the `customer` forwarding from `Checkout.tsx` — it must survive any regeneration.
- Keep `payment-flow.ts` URL behavior:
  - `returnUrl: ${previewUrl}/checkout/cancel`
  - `successUrl: ${previewUrl}/checkout/success`

You may restyle page layout/copy, but keep checkout payload as `lineItems: [{ skuId, quantity }]`.

---

## Validate Flow

1. Open `/products`
2. Verify product list renders real Commerce SKUs
3. Click **Buy Now**
4. Verify checkout request sends `lineItems: [{ skuId, quantity: 1 }]`
5. Verify redirect to Commerce checkout URL
6. Complete payment and verify `/checkout/success`
7. Cancel checkout and verify `/checkout/cancel`

---

## Completion Summary

Report:

- number of products mapped from catalog
- store ID configured
- routes added
- checkout flow validation outcome
