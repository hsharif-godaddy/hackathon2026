---
name: ui
description: Internal Commerce UI/routes implementation pack for product catalog UI, product detail pages, and cart management. The commerce router decides when to load and install it.
whenToUse: Do not load directly for user intent. Load `commerce` first for store/catalog/cart requests; `commerce` loads and installs this pack only after store/channel setup.
post-install-notes: 'Commerce catalog/cart routes and helpers are included in the templates. Do NOT create replacement src/server/api/commerce/products, src/server/api/commerce/cart, useProducts, or cart proxy files manually. Build UI against the installed routes/helpers. Checkout routes are NOT included in this pack — if any cart checkout, buy button, or checkout page is needed, you MUST load the payment router and confirm region before provider selection. Commerce cart checkout is supported only through GoDaddy Payments for confirmed US/CA merchants; block checkout for non-US/CA merchants before building checkout UI and recommend Stripe or another third-party processor for a non-Commerce payment flow.'
---

# Commerce UI Template Pack

Internal implementation pack for Commerce-backed catalog, product detail, and cart UI. This skill is **not a public router**. Load `commerce` for Commerce user intent; `commerce` owns setup/data work and decides when to load and install this pack.

## Direct-Load Guardrail

If this skill was loaded directly from first-message/user intent, stop and load `commerce` instead. Do not proceed from this template pack until `commerce` has resolved the store/channel context.

Generic activation workflows may say to load and then install template skills. For `commerce/ui`, only follow that order after `commerce__provision` has returned `status: 'ready'` and env values are written. This pack depends on that setup.

## Required Pre-Step — Commerce Setup Must Be Complete

**Hard blocker. Do not write a single line of commerce UI until this is done.**

`commerce__provision` must have returned `status: 'ready'` before proceeding. If it hasn't been called, load `commerce` and call it first.

Symptoms of skipping setup: catalog renders empty, add-to-cart fails because there is no SKU to reference, and cart routes 4xx/500 because store/channel env vars are missing or wrong.

If the catalog is empty after setup, stop and ask what the user wants to do before continuing:

- Create starter products with the agent.
- Manage products in Commerce Home, then return when the catalog is ready.
- Continue with an empty catalog.

Include the Commerce Home link from `commerce__provision`'s `commerceHomeUrl`, or `selectedCommerceResources.storeUrl`, when available. If the user chooses starter products or provided concrete product details, return to `commerce` and use `commerce__search_tools` plus `commerce__execute_tool` for product/catalog/inventory/media work. Do not tell the user to manage products in Commerce Home as the only path forward.

## Required Pre-Step — Install the `commerce/ui` Templates

Run this only after the Commerce setup pre-step above is complete. If this skill is loaded by the `commerce` router for a UI request, this is the next skill call before writing UI or same-origin Commerce routes:

```typescript
skill({ action: 'install', skill: 'commerce/ui' });
```

Templates are fully wired into the route table. Files under `templates/server/api/commerce/**/*.ts` are copied into `src/server/api/commerce/**/*.ts` and auto-registered in `src/server/entry.ts` by the skill loader. Do not wire routes manually.

After install, read the route docblocks for the endpoints you plan to call. Each route file documents its body/query/response shape. Do not guess at shapes.

The kit files at `src/lib/commerce/` are split by upstream subgraph:

- `catalog-subgraph.ts` — product/SKU types and view helpers like `getPrimaryImageUrl`, `getProductAttributes`, `getSingleMatchedSkuId`, `getAvailableInventoryQuantity`.
- `order-subgraph.ts` — cart/order types and helpers like `addToCart` and `getCartSummaryTotals`.
- `config.ts` and `gql.ts` — server/proxy support used by route handlers.

Import view-model helpers and types into client code from `catalog-subgraph.ts` and `order-subgraph.ts`. Do not import GraphQL transport helpers (`gqlRequest`, `storefrontHeaders`, endpoint helpers) into client code. Client code calls same-origin `/api/commerce/*` routes.

## Security Boundary — Proxy First, Always

All Commerce APIs are called through same-origin proxy routes this skill installs. Even storefront/catalog reads go through `/api/commerce/*` routes the customer app owns. The browser never sees `X-Store-ID`, `X-Client-ID`, or any other GoDaddy header.

The only "really good reasons" to deviate:

- A pure static export with no server runtime.
- Asset URLs the browser obviously fetches directly from the CDN.

If you think you have found another exception, ask the user before bypassing the proxy.

`clientSecret` lives in `/local/config.json` and is read server-side via `readCommerceConfig()` from `lib/commerce/config.ts`. Store ID, Channel ID, API base URL, and currency are read by the same config reader from runtime env or the app `.env` file written by `commerce__provision`; server route code must not rely on `import.meta.env` for those values. Never re-read the file by hand, never cast config entries to `string`, and never hardcode known Commerce IDs into source as fallbacks.

## Installed Routes

These ship out of the box. Read the file for body/query/response shape; do not guess.

All cart routes return the same response shape: `{ cart: CartOrder | null }`. The proxy re-fetches the full cart after every mutation so clients only ever read `data.cart`.

| Method | Path | Purpose | Response | File |
| --- | --- | --- | --- | --- |
| `GET` | `/api/commerce/products` | Paginated catalog grid (`skuGroups` query) | `{ skuGroups: ... }` | `templates/server/api/commerce/products/GET.ts` |
| `GET` | `/api/commerce/products/:id` | PDP detail (`skuGroup` query) | `{ skuGroup: ... }` | `templates/server/api/commerce/products/[id]/GET.ts` |
| `GET` | `/api/commerce/skus/:id` | Full SKU after variant selection | `{ sku: ... }` | `templates/server/api/commerce/skus/[id]/GET.ts` |
| `POST` | `/api/commerce/cart` | Create draft order (first add-to-cart) | `{ cart: CartOrder \| null }` | `templates/server/api/commerce/cart/POST.ts` |
| `GET` | `/api/commerce/cart/:id` | Hydrate cart from client, if available | `{ cart: CartOrder \| null }` | `templates/server/api/commerce/cart/[id]/GET.ts` |
| `POST` | `/api/commerce/cart/:id/items` | Append a line item to the cart | `{ cart: CartOrder \| null }` | `templates/server/api/commerce/cart/[id]/items/POST.ts` |
| `PATCH` | `/api/commerce/cart/:id/items/:itemId` | Update a line item | `{ cart: CartOrder \| null }` | `templates/server/api/commerce/cart/[id]/items/[itemId]/PATCH.ts` |
| `DELETE` | `/api/commerce/cart/:id/items/:itemId` | Remove a line item | `{ cart: CartOrder \| null }` | `templates/server/api/commerce/cart/[id]/items/[itemId]/DELETE.ts` |
| `POST` | `/api/commerce/cart/:id/discounts` | Apply promo codes to the cart | `{ cart: CartOrder \| null }` | `templates/server/api/commerce/cart/[id]/discounts/POST.ts` |

This skill does not include `/api/commerce/checkout` or `/api/commerce/order-status` routes. It also does not expose or compute a hosted checkout URL from the cart. Hosted checkout URL creation comes from the `payment/godaddy-payments` templates.

## Domain Concepts

- A **product** in storefront UI is a `SKUGroup`.
- A purchasable **variant** is a `SKU`. Always check out and add-to-cart by `sku.id`, never `skuGroup.id`.
- A **cart** is a draft order. The app owns persistence of this, typically in `localStorage` keyed per store/channel.
- After a SKU is selected, prefer SKU-level price/media over SKU-group-level price/media.
- Prices are integers in the currency's smallest unit. A `value: 1999` on a USD price means `$19.99`.
- When rendering product DOM directly, put `data-dev-source-origin="commerce"` and `data-dev-commerce-product-id={skuGroup.id}` on the top-most card/PDP product root. Add `data-dev-commerce-sku-id={sku.id}` when a variant is selected or uniquely resolved. Child name/price/description/image elements inherit this marker, so AAB dev-tools block inline/Fix/Quick Edit mutations for Commerce-owned fields.

Commerce-related data-dev-* attributes placement; keep the app's normal product markup/styles and add Commerce markers to the outer product element:

```tsx
<article
  {...productCardProps}
  data-dev-source-origin="commerce"
  data-dev-commerce-product-id={skuGroup.id ?? ''}
  data-dev-commerce-sku-id={selectedSku?.id ?? undefined}
>
  {productContent}
</article>
```

## Common Flows

For each scope, call the listed routes from the browser via `fetch('/api/commerce/...')`. Open the route file for query-param/body/response shape.

### Catalog grid

- `GET /api/commerce/products` with `first`, `after`, `searchQuery`, `productIds` repeated param, or `categoryIds` repeated param.
- Render cards from `skuGroups.edges`.
- Use `getPrimaryImageUrl(node)`, `node.label`, and `node.priceRange`.
- Wire pagination from `pageInfo.endCursor` into the next call's `after`.
- `searchQuery` is ignored when `productIds` or `categoryIds` are specified.

### Product details

- `GET /api/commerce/products/:id` with `attributeValues` as repeated query params when attributes are selected.
- Render `getProductAttributes(skuGroup)` as selectors.
- When attributes resolve to a single SKU (`getSingleMatchedSkuId(skuGroup)` returns non-null), call `GET /api/commerce/skus/:id` for full price/media/inventory/description.
- Disable add-to-cart when `getAvailableInventoryQuantity(sku) === 0`. When it returns `null`, inventory is not tracked; keep the button enabled.
- Use `addToCart` from `order-subgraph.ts`; it handles both first add and subsequent adds.

```ts
const data = await addToCart(cartId, {
  skuId: sku.id,
  quantity,
  name: skuGroup.label ?? skuGroup.name ?? '',
  productAssetUrl: getPrimaryImageUrl(skuGroup) ?? undefined,
});
```

### Cart

Every cart route returns `{ cart: CartOrder | null }`. Always read `data.cart` and feed it to `getCartSummaryTotals(cart)`. Do not read upstream GraphQL field names like `orderById`, `addDraftOrder`, `addLineItemBySkuId`, `updateLineItemById`, `deleteLineItemById`, or `applyDiscountCodes`.

- On app load, hydrate an existing cart id from `localStorage` via `GET /api/commerce/cart/:id`. If `data.cart` is `null`, clear the persisted id.
- First add-to-cart: use `addToCart(null, { skuId, name, quantity, productAssetUrl? })`. Persist `data.cart.id`.
- Subsequent adds: use the same `addToCart(cartId, ...)` helper.
- Quantity changes: `PATCH /api/commerce/cart/:id/items/:itemId`.
- Removal: `DELETE /api/commerce/cart/:id/items/:itemId`.
- Promo codes: `POST /api/commerce/cart/:id/discounts` with `{ discountCodes: string[] }`.
- There is no delete-cart route. Clear cart by deleting every line item or abandoning the cart.

## UI Defaults

Override any of these if the user's prompt is explicit; otherwise these are the defaults.

- **Cart** — drawer that slides in from the right edge, overlays page content, displays each line item (image, name, variant, quantity stepper, line total, remove button), shows cart subtotal at the bottom, and has a primary Checkout button. Closes on backdrop click or close button.
- **Product catalog page** — responsive grid of product cards (image, name, price/price range), with pagination controls and a search input that filters by name. Clicking a card navigates to the product details page.
- **Product details page** — single-product view: large primary image with a thumbnail strip if multiple media exist, name, price, description, variant/attribute selectors when applicable, quantity stepper, and an Add to cart button.

## MANDATORY GATE — Checkout Cannot Proceed Without Payment Skill

**If ANY of the following are true about the original request or what you have already built:**
- A cart with a "Checkout" or "Proceed to Checkout" button
- Any page named "checkout", "order", "place-order", or "order-confirmation"
- Any buy button, hosted-checkout redirect, or complete-purchase flow

**STOP all cart/storefront work now and run this sequence exactly, in order, before writing a single line of checkout UI, checkout-adjacent buttons, or order pages:**

1. Load the payment router:
```ts
skill({ action: 'load', skill: 'payment' });
```
2. Follow the router to determine or ask for the merchant selling country before provider selection. Commerce cart checkout is supported only through GoDaddy Payments for confirmed US/CA merchants. For non-US/Canada merchants, stop before building checkout UI, explain that GoDaddy Payments checkout is unavailable in their region, and recommend Stripe or another third-party processor for a non-Commerce payment flow; do not load, provision, or install `payment/godaddy-payments` for them.
3. Only when the router selects GoDaddy Payments for a confirmed US/CA merchant, load it with the confirmed country and call provision with the same country:
```ts
skill({ action: 'load', skill: 'payment/godaddy-payments', sellingCountry: 'US' });
godaddy-payments__provision({ sellingCountry: 'US' });
```
4. When GoDaddy Payments provision returns `status: "ready"`, install templates immediately with the same confirmed country:
```ts
skill({ action: 'install', skill: 'payment/godaddy-payments', sellingCountry: 'US' });
```
5. For confirmed US/CA GoDaddy Payments only, wire the cart checkout button to `POST /api/commerce/checkout` with `draftOrderId`, `returnUrl`, and `successUrl`, then redirect to `data.url`.
6. Call `commerce__validate_checkout` and fix every finding before continuing.

**FORBIDDEN before this sequence is complete:**
- Do NOT create a Checkout button that navigates anywhere
- Do NOT build a `/checkout` page, route, or order-confirmation page
- Do NOT tell the user "payment can be added later" or leave a placeholder
- Do NOT mark the shop or cart as complete
- Do NOT assume Commerce cart has a native checkout URL — it does not

Do not stop after loading the payment skill. Do not build replacement `/api/commerce/checkout`, shipping-update, place-order, or order-status routes by hand. The installed GoDaddy Payments templates own hosted checkout session creation and order-status verification.

## Completion Signal

This skill owns the durable completion marker for Commerce storefront UI. Only call completion after all of these are true:

- `commerce__provision` returned `status: 'ready'`.
- `commerce/ui` templates are installed.
- Catalog data has been handled: products were created/updated when provided, or the user chose starter products, Commerce Home management, or an empty catalog.
- Product catalog, product detail, and cart UI requested by the user are wired to the installed `/api/commerce/*` routes and `src/lib/commerce/*` helpers.
- If checkout, buy buttons, hosted checkout, order pages, or order confirmation are in scope: `payment/godaddy-payments` has been provisioned, its templates are installed, its completion signal has been called, and `commerce__validate_checkout` has passed with no findings.

Once the storefront UI work is fully done, signal completion as the final internal step before your final summary:

```typescript
skill({ action: 'complete', skill: 'commerce/ui' });
```

Do this exactly once per app. Do not call `skill({ action: 'complete', skill: 'commerce' })`.

Cart checkout request shape after `payment/godaddy-payments` is installed:

```ts
const data = await fetch('/api/commerce/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    draftOrderId: cart.id,
    returnUrl: `${origin}/cart`,
    successUrl: `${origin}/checkout/success?orderId=${encodeURIComponent(cart.id)}`,
  }),
}).then((response) => response.json());

window.location.assign(data.url);
```

## Common Mistakes

1. Bypassing the proxy and calling Commerce GraphQL from the browser.
2. Adding to cart by `skuGroup.id`. Cart line items always use `sku.id`.
3. Losing the cart's `draftOrderId`. Persist it immediately after first add.
4. Omitting `name` from add-to-cart input. It is required for readable order history.
5. Passing SKU-based `lineItems` directly to `addDraftOrder`. The shipped route creates an empty cart, then calls `addLineItemBySkuId`.
6. Reading wrong response keys. Cart proxy routes expose `{ cart }`, not upstream GraphQL field names.
7. Expecting checkout routes from this skill. Checkout and order status routes are not included.
8. Building Commerce cart checkout for a non-US/Canada merchant. This implementation does not support Stripe-backed Commerce cart checkout; block before checkout UI and recommend Stripe or another third-party processor for a non-Commerce payment flow.
9. Loading `payment/godaddy-payments` but forgetting to call `godaddy-payments__provision` and install its templates before building confirmed US/CA checkout.
10. Inventing a Commerce native checkout URL from the cart. The cart is a draft order; hosted checkout URL creation comes from `/api/commerce/checkout` installed by `payment/godaddy-payments` for confirmed US/CA checkout.
11. Building custom checkout, shipping, place-order, or order-status routes by hand instead of using the confirmed eligible provider path.
