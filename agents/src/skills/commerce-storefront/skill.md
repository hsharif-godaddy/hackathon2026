---
name: commerce-storefront
description: Render GoDaddy Commerce storefront UI (catalog, product detail, cart, and checkout success/cancel pages) from existing Commerce store/catalog data. UI only.
whenToUse: Trigger for requests like "build the product catalog", "build the shop/storefront", "add cart", or "wire checkout" when catalog data should come from GoDaddy Commerce. For ambiguous e-commerce prompts, load commerce first to verify/setup store data, then use this skill for UI wiring. Do NOT hand-build static catalog/cart pages when the user intends Commerce integration.
intents:
  - build product catalog UI/storefront UI/cart UI/checkout UI (load commerce first)
dependencies:
  - "@godaddy/react"
  - "@godaddy/localizations"
  - "@tanstack/react-query"
---

# GoDaddy Commerce Storefront UI Skill

Use this skill for a **catalog + cart storefront UI**.

This skill is **UI wiring only**:

- It does **not** create stores/products/prices/inventory.
- Use `commerce` skill first for Commerce management operations.

## Scope Split

| Skill                       | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `commerce`                  | Store setup + catalog/product/pricing/inventory/media/orders APIs |
| `commerce-storefront`       | Storefront UI (shop, product page, cart, checkout redirects)      |
| `commerce-one-time-payment` | Simple one-time checkout UI (no storefront cart flow)             |

## Absolute Rules

1. **Load `commerce` skill first** for store/catalog data.
2. Use `ProductGrid`, `ProductDetails`, and `Cart` from `@godaddy/react` (do not hand-roll storefront/cart primitives).
3. `Cart.onCheckout(orderId)` **must** call checkout session creation with `draftOrderId: orderId`.
4. Catalog and product pages **must** wire `onAddToCartSuccess` to open the cart.
5. **Do NOT modify** `src/server/api/commerce/create-checkout-session/POST.ts` (immutable template route).
6. Keep a **single QueryClientProvider tree**. `StorefrontProvider` must run inside the existing QueryClient context.
7. Keep `clientId` and `apiHost` from `VITE_` env vars.
8. Keep `storeId`/`channelId` in runtime config (`VITE_GODADDY_STORE_ID` + `VITE_GODADDY_CHANNEL_ID` or fallback constants).
9. For catalog/storefront requests, do **not** scaffold static mock product files as the primary implementation path. Use Commerce-backed templates and data flow.

---

## Routing Guardrail for Ambiguous Prompts

If the user says things like:

- "Looks great, let's build the product catalog"
- "Add a shop page"
- "Add cart + checkout"

assume they likely want Commerce integration unless they explicitly ask for static/local mock data.

In that case:

1. Load `commerce` first.
2. Verify/setup store + catalog (`commerce__setup_store`, `commerce__fetch_catalog`).
3. Then install/use this storefront skill.

Do not skip directly to hand-built static catalog pages.

---

## Required Pre-Step: Prepare Commerce Data

```typescript
skill({ action: 'load', skill: 'commerce' });
```

Then verify data exists:

- `commerce__setup_store` → get `storeId`, `channelId`, `locationId`
- `commerce__fetch_catalog` → confirm products/SKUs exist

If catalog is empty, stop and ask user whether to run the `commerce` management workflow first.

---

## Step 1: Install Storefront Templates

```typescript
skill({ action: 'install', skill: 'commerce-storefront' });
```

Installs:

- `src/lib/commerce-client.ts`
- `src/server/api/commerce/create-checkout-session/POST.ts`
- `src/lib/commerce/storefront-config.ts`
- `src/components/commerce/StorefrontProvider.tsx`
- `src/components/commerce/StorefrontShell.tsx`
- `src/pages/commerce/storefront/Catalog.tsx`
- `src/pages/commerce/storefront/Product.tsx`
- `src/pages/commerce/storefront/Success.tsx`
- `src/pages/commerce/storefront/Cancel.tsx`

Read these files before customizing so checkout/provider wiring stays intact.

---

## Step 2: Configure Runtime Environment

Preferred: if available in current flow, use `commerce__install_storefront` from the `commerce` skill to write env vars automatically.

Otherwise, add/update `.env` manually:

```bash
VITE_GODADDY_CLIENT_ID=<from /alloc/config.json GODADDY_OAUTH_CLIENT_ID.VALUE>
VITE_GODADDY_API_HOST=<hostname from GODADDY_API_BASE_URL, no https://>
GODADDY_API_BASE_URL=https://<same-host-as-VITE_GODADDY_API_HOST>
VITE_GODADDY_STORE_ID=<storeId from commerce__setup_store>
VITE_GODADDY_CHANNEL_ID=<channelId from commerce__setup_store>
VITE_PREVIEW_URL=http://[app-id].preview.dev-godaddy.com:[port]
```

Notes:

- `VITE_GODADDY_API_HOST` must be host only (no protocol).
- `GODADDY_API_BASE_URL` must include protocol (for example `https://api.dev-godaddy.com`) so server checkout routes can call Commerce APIs.
- `VITE_PREVIEW_URL` is used for checkout return/success redirects; runtime falls back to `window.location.origin`.
- `storefront-config.ts` supports env-first IDs with constants as fallback.

---

## Step 3: Storefront Config Fallback Constants

If env vars are not set, update `src/lib/commerce/storefront-config.ts`:

```ts
export const STOREFRONT_STORE_ID = 'REPLACE_WITH_STORE_ID';
export const STOREFRONT_CHANNEL_ID = 'REPLACE_WITH_CHANNEL_ID';
```

Use values from `commerce__setup_store`.

---

## Step 4: Wire Provider in `src/main.tsx`

1. Ensure style imports include:

```ts
import './styles/globals.css';
import '@godaddy/react/styles-tailwind.css';
```

This matches the official `@godaddy/react` examples in `godaddy/javascript/examples/nextjs`, and the package exports `./styles-tailwind.css` from `@godaddy/react`.

2. If the app already has a shared `QueryClientProvider`, keep using that single client and pass it into `GoDaddyProvider` via `StorefrontProvider`.
3. Do not create a second **QueryClient instance** just for storefront.

The official examples show `GoDaddyProvider` can own the React Query provider itself. In this template integration, `StorefrontProvider` uses the app's existing query client (`useQueryClient()`) and passes it through to `GoDaddyProvider`, so it must stay under the existing `QueryClientProvider`.

---

## Step 5: Wire Routes

In `src/routes.tsx` add lazy imports + routes:

```tsx
const CommerceStorefrontCatalogPage = lazy(() => import('./pages/commerce/storefront/Catalog'));
const CommerceStorefrontProductPage = lazy(() => import('./pages/commerce/storefront/Product'));
const CommerceStorefrontSuccessPage = lazy(() => import('./pages/commerce/storefront/Success'));
const CommerceStorefrontCancelPage = lazy(() => import('./pages/commerce/storefront/Cancel'));

{ path: '/shop', element: <CommerceStorefrontCatalogPage /> },
{ path: '/shop/product/:id', element: <CommerceStorefrontProductPage /> },
{ path: '/checkout/success', element: <CommerceStorefrontSuccessPage /> },
{ path: '/checkout/cancel', element: <CommerceStorefrontCancelPage /> },
```

Update route path types/enums accordingly.

---

## Template Integration Contract (Must Match)

These are the critical parts that must stay aligned with the reference storefront integration:

### `src/components/commerce/StorefrontShell.tsx`

- Own cart state (`isCartOpen`) and checkout loading state (`isCheckingOut`).
- Expose cart controls via `useStorefrontCart()` context hook (`openCart`, `closeCart`).
- Keep `Cart` wiring:
  - `open={isCartOpen}`
  - `onOpenChange={setIsCartOpen}`
  - `isCheckingOut={isCheckingOut}`
  - `onCheckout={handleCheckout}`
- `handleCheckout(orderId)` must call `createCheckoutSession` with:
  - `storeId: config.storeId`
  - `draftOrderId: orderId`
  - `returnUrl: ${previewUrl}/checkout/cancel`
  - `successUrl: ${previewUrl}/checkout/success?orderId=${orderId}` — embed the draft order ID so `Success.tsx` can read it from `?orderId=` via `useSearchParams`. Do **not** use `session_id` or any Stripe-style param.

### `src/pages/commerce/storefront/Catalog.tsx`

- Keep `StorefrontShell` wrapper.
- Use `<ProductSearch />` above the grid.
- Use `<ProductGrid enablePagination ... />`.
- Keep route mapping: `getProductHref={(id) => \`/shop/product/${id}\`}` (or equivalent route base if user chose different path).
- Set `onAddToCartSuccess={openCart}` using `useStorefrontCart()`.

### `src/pages/commerce/storefront/Product.tsx`

- Keep `StorefrontShell` wrapper.
- Resolve route param `id` and pass to `ProductDetails` as `productId`.
- Set `onAddToCartSuccess={openCart}` using `useStorefrontCart()`.

### `src/server/api/commerce/create-checkout-session/POST.ts`

- Treat as immutable.
- Do not change request payload contract or auth behavior.

You may change copy/layout/styling, but do not break these data flows.

---

## Validate Flow

1. Open `/shop`
2. Verify `ProductSearch` and `ProductGrid` render Commerce data
3. Add item from grid and verify cart opens automatically
4. Open `/shop/product/:id`
5. Add item from product detail and verify cart opens automatically
6. Checkout from cart and verify request sends `draftOrderId`
7. Verify redirect to Commerce checkout, then `/checkout/success`
8. Cancel checkout and verify `/checkout/cancel`

---

## Completion Summary

Report:

- store/channel IDs configured
- env vars configured
- routes added
- storefront/cart checkout validation outcome
