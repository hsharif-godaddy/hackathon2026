---
name: commerce-storefront
description: Render GoDaddy Commerce storefront UI (shop/catalog page, product detail/PDP, cart, and checkout success/cancel pages) from existing Commerce store/catalog data. UI only.
whenToUse: Trigger for requests like "build/update the product catalog", "build the shop/storefront", "wire the shop page", "wire the product detail/PDP page", "load products from the API", "add cart", or "wire checkout" when catalog data should come from GoDaddy Commerce. Load the `commerce` skill first to verify/setup store data, then use this skill for UI wiring. Do NOT hand-build static catalog/cart pages, custom product API routes, or `useProducts` hooks when the user intends Commerce integration.
intents:
  - product catalog UI/storefront UI/shop page/product detail page/PDP/cart UI/checkout UI (load commerce first)
  - build/update shop page/product catalog/product grid/load products from API (load commerce first)
  - product detail page/product page/PDP/product route (load commerce first)
dependencies:
  - "@godaddy/react"
  - "@godaddy/localizations"
  - "@tanstack/react-query"
---

# GoDaddy Commerce Storefront UI Skill

Use this skill for a **catalog + cart storefront UI**.

This skill is **UI wiring only**:

- It does **not** create stores/products/prices/inventory.
- Load the `commerce` skill for Commerce store/catalog/product/pricing/inventory/order operations.

## Scope Split

| Tool / Skill                            | Purpose                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `commerce`                              | Store setup + catalog/product/pricing/inventory/media/orders through GoDaddy Commerce MCP                     |
| `commerce-storefront`                   | Storefront UI (shop, product page, cart, checkout redirects)                                                  |
| `payment/commerce-one-time-payment`     | Simple one-time checkout UI (no storefront cart flow)                                                         |

## Absolute Rules

1. **Resolve store/catalog data first** by loading the `commerce` skill and using its Commerce MCP tools (for example `catalog_search`, `store_get`).
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

1. Load the `commerce` skill.
2. Use the Commerce MCP tools from that skill to verify/setup store + catalog (for example MCP tools like `store_get`, `catalog_search`, or the current setup/install equivalents returned by discovery).
3. Then install/use this storefront skill.

Do not skip directly to hand-built static catalog pages.

---

## Required Pre-Step: Prepare Commerce Data

Load the `commerce` skill, then use its Commerce MCP tools.

```typescript
// 1. Load Commerce platform/data tools
skill({ action: 'load', skill: 'commerce' });

// 2. Discover available Commerce tools with the commerce skill's search tool

// 3. Execute the tools discovery surfaced (names returned by search_tools)
```

Use discovery to find the right tools for your step, for example:

- a `store`/`setup` tool → get `storeId`, `channelId`, `locationId`
- a `catalog`/`products` search tool → confirm products/SKUs exist

If the catalog is empty, stop and ask the user whether to run the Commerce management workflow (product/catalog/pricing tools via the `commerce` skill) first.

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

Preferred: load `commerce`, discover an `install_storefront`-style Commerce MCP tool, and execute it to write app-specific storefront env/config automatically.

Platform-provided public env vars (`VITE_GODADDY_CLIENT_ID`, `VITE_GODADDY_API_HOST`) should already be present in the app runtime for the full storefront flow. The agent should usually only need to set store/channel IDs. If `import.meta.env.VITE_GODADDY_CLIENT_ID` is missing, stop and report that the app runtime is missing storefront public env vars; do not try to expose or request OAuth secrets manually.

Otherwise, add/update `.env` manually:

```bash
VITE_GODADDY_CLIENT_ID=<from /alloc/config.json GODADDY_OAUTH_CLIENT_ID.VALUE>
VITE_GODADDY_API_HOST=<hostname from GODADDY_API_BASE_URL, no https://>
GODADDY_API_BASE_URL=https://<same-host-as-VITE_GODADDY_API_HOST>
VITE_GODADDY_STORE_ID=<storeId from Commerce MCP store setup tool>
VITE_GODADDY_CHANNEL_ID=<channelId from Commerce MCP store setup tool>
VITE_PREVIEW_URL=http://[app-id].preview.dev-godaddy.com:[port]
```

Notes:

- `VITE_GODADDY_CLIENT_ID` is a public OAuth client identifier for browser-side `@godaddy/react` storefront APIs; never expose `GODADDY_OAUTH_CLIENT_SECRET` as a `VITE_` var.
- `VITE_GODADDY_API_HOST` must be host only (no protocol).
- `GODADDY_API_BASE_URL` must include protocol (for example `https://api.dev-godaddy.com`) so server checkout routes can call Commerce APIs.
- `VITE_PREVIEW_URL` is used for checkout return/success redirects; runtime falls back to `window.location.origin`.
- `storefront-config.ts` supports env-first IDs with constants as fallback.
- One-time payment pages do not need `VITE_GODADDY_CLIENT_ID`/`VITE_GODADDY_API_HOST`; only the full storefront skill uses browser-side `@godaddy/react` data/cart APIs.

---

## Step 3: Storefront Config Fallback Constants

If env vars are not set, update `src/lib/commerce/storefront-config.ts`:

```ts
export const STOREFRONT_STORE_ID = 'REPLACE_WITH_STORE_ID';
export const STOREFRONT_CHANNEL_ID = 'REPLACE_WITH_CHANNEL_ID';
```

Use values from the Commerce MCP store setup tool (discover via the `commerce` skill).

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
