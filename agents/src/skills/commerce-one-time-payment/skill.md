---
name: commerce-one-time-payment
description: Render a simple GoDaddy Commerce one-time checkout UI (products, checkout, success/cancel pages) using existing Commerce SKUs. UI only.
whenToUse: Trigger when user wants simple payments or a buy-now checkout — "accept payments", "charge customers", "one-time service payment", "payment page", "buy now page", "single product checkout", "one-time payment". Backed by GoDaddy Commerce SKU data, not a full cart storefront. Load the `commerce` skill first to verify/setup store/catalog data, then use this skill for UI wiring.
intents:
  - accept payments/buy-now/one-time payment/charge customers (load commerce first)
---

# GoDaddy Commerce One-Time Payment UI Skill

Use this skill when the user wants a **simple buy-now checkout flow**.

This skill is **UI wiring only**.

- It does **not** create stores/products/prices/inventory.
- Load the `commerce` skill for Commerce store/catalog/product/pricing/inventory/order operations.

## Scope Split

| Tool / Skill                  | Purpose                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `commerce`                    | Store setup + catalog/product/pricing/inventory/media/orders through GoDaddy Commerce MCP |
| `commerce-one-time-payment`   | Simple one-time checkout UI pages                                                         |
| `commerce-storefront`         | Full storefront UI (catalog + cart + product details)                                     |

## Absolute Rules

1. **Resolve Commerce data first** by loading the `commerce` skill and using its Commerce MCP tools.
2. **Use SKU IDs for checkout** (`product.skuId`), never SKU Group IDs.
3. **Do NOT modify** `src/server/api/commerce/create-checkout-session/POST.ts` or `src/server/api/commerce/order-status/GET.ts` (immutable routes).
4. Keep preview URL fallback behavior for return/success URLs.
5. Do not request Commerce OAuth secrets manually — the `src/server/api/commerce/*` routes read system-managed OAuth credentials from task-local config (`$NOMAD_TASK_DIR/config.json`, usually `/local/config.json`; `/alloc/config.json` is a compatibility symlink).
6. This one-time payment flow does **not** require `VITE_GODADDY_CLIENT_ID` or `VITE_GODADDY_API_HOST`; those browser-side public vars are only needed by the full `@godaddy/react` storefront flow.

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

Load the `commerce` skill, then use its Commerce MCP tools.

```typescript
// 1. Load Commerce platform/data tools
skill({ action: 'load', skill: 'commerce' });

// 2. Discover and execute the Commerce MCP tools you need
```

Use discovery to find the right tools:

- a `store`/`setup` tool → get `storeId`, `channelId`, `locationId`
- a `catalog`/`products` tool → get existing products/SKUs

If the catalog is empty, stop and ask whether to run the Commerce management workflow (product/catalog/pricing tools via the `commerce` skill) first.

---

## Step 1: Install One-Time Payment Templates

```typescript
skill({ action: 'install', skill: 'commerce-one-time-payment' });
```

Installs:

- `src/lib/commerce-client.ts`
- `src/lib/commerce/products.ts`
- `src/lib/commerce/payment-flow.ts`
- `src/pages/commerce/Products.tsx`
- `src/pages/commerce/Checkout.tsx`
- `src/pages/commerce/Success.tsx`
- `src/pages/commerce/Cancel.tsx`
- `src/server/lib/logger.ts`
- `src/server/api/commerce/create-checkout-session/POST.ts`
- `src/server/api/commerce/order-status/GET.ts`

Read these templates before customization so checkout wiring remains correct.

`order-status/GET.ts` is installed for flows that need to confirm paid status after the hosted checkout redirects back (for example appointment booking or reservation flows). The basic one-time product template stores/displays the draft order ID but does not call this route by default.

---

## Step 2: Populate Product Data from Commerce MCP

Fetch catalog data via the `commerce` skill (pick the tool surfaced by a `catalog fetch products` search), then update `src/lib/commerce/products.ts` by replacing the empty `COMMERCE_PRODUCTS` array.

Mapping from the catalog/products MCP tool output:

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

Use `storeId` and `channelId` from the Commerce MCP store setup tool (discovered and executed via the `commerce` skill). `channelId` is required for order number assignment in the GoDaddy Commerce admin.

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
- **Customer prefill:** `Checkout.tsx` reads `customer` from two sources (first wins): React Router `location.state`, then `sessionStorage` key `commerce-checkout-customer`. To pre-fill the GoDaddy checkout form, the upstream page (e.g. appointment booking form) must do **both**:
  ```ts
  const customerPayload = { billing: { firstName, lastName, email } };
  sessionStorage.setItem('commerce-checkout-customer', JSON.stringify(customerPayload));
  navigate(`/checkout/${skuId}`, { state: { customer: customerPayload } });
  ```
  Writing to both ensures prefill survives page refreshes and direct URL navigation (state is lost on refresh; sessionStorage persists). Pass contact info under `billing` — the POST route automatically mirrors `billing.firstName`, `billing.lastName`, and `billing.email` → `shipping.*` because `<Checkout />` reads prefill values from `order.shipping.*` (`mapOrderToFormValues` in `@godaddy/react`).
  Do **not** remove the `customer` forwarding from `Checkout.tsx` — it must survive any regeneration.
- Keep `payment-flow.ts` URL behavior:
  - `returnUrl: ${previewUrl}/checkout/cancel`
  - `successUrl: ${previewUrl}/checkout/success`
- **`Success.tsx` reads `orderId` from `sessionStorage`** (`commerce-order-id` key). `Checkout.tsx` stores `result.draftOrderId` there before redirecting to GoDaddy. GoDaddy does **not** append `orderId` to the redirect URL — do **not** rely on `useSearchParams` to receive the orderId from GoDaddy. `useSearchParams` is used only as a read-after-refresh fallback: after reading from sessionStorage, `Success.tsx` writes `?orderId=` into the URL via `history.replaceState` so a page refresh still shows the order ID.

You may restyle page layout/copy, but keep checkout payload as `lineItems: [{ skuId, quantity }]`.

---

## Validate Flow

1. Open `/products`
2. Verify product list renders real Commerce SKUs
3. Click **Buy Now**
4. Verify checkout request sends `lineItems: [{ skuId, quantity: 1 }]`
5. Verify redirect to Commerce checkout URL
6. Complete payment and verify `/checkout/success`
7. If the app uses paid-status confirmation, verify `GET /api/commerce/order-status?orderId={orderId}` with the returned draft order ID
8. Cancel checkout and verify `/checkout/cancel`

---

## Completion Summary

Report:

- number of products mapped from catalog
- store ID configured
- routes added
- checkout flow validation outcome
- order-status route validation outcome, if used by the installed flow
