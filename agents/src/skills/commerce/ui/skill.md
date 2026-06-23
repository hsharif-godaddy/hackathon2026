---
name: ui
description: Internal Commerce UI/routes implementation pack for product catalog UI, product detail pages, and cart management. The commerce router decides when to load and install it.
whenToUse: Do not load directly for user intent. Load `commerce` first for store/catalog/cart requests; `commerce` loads and installs this pack only after store/channel setup. For checkout/payment intent, load `payment`.
post-install-notes: 'Commerce catalog/cart routes and helpers are included in the templates. Do NOT create replacement src/server/api/commerce/products, src/server/api/commerce/cart, useProducts, or cart proxy files manually. Build UI against the installed routes/helpers. Checkout routes are not included; install payment/godaddy-payments when checkout is needed.'
---

# Commerce UI Template Pack

Internal implementation pack for Commerce-backed catalog, product detail, and cart UI. This skill is **not a public router**. Load `commerce` for Commerce user intent; `commerce` owns setup/data work and decides when to load and install this pack.

Hosted checkout, order-status polling, non-catalog payments, buy buttons, and cart checkout handoff are owned by `payment/godaddy-payments`.

## Ownership Boundary

| Skill | Purpose |
| --- | --- |
| `commerce` | Store/catalog/product/inventory/channel/order operations through Commerce MCP |
| `commerce/ui` | Catalog grid, product detail page, cart/draft-order routes, and cart UI |
| `payment/godaddy-payments` | Hosted checkout route, order-status route, non-catalog checkout, SKU buy buttons, and cart checkout handoff |

If a catalog/cart app needs a Checkout button, install this skill for catalog/cart and install `payment/godaddy-payments` for `/api/commerce/checkout` and `/api/commerce/order-status`.

## Direct-Load Guardrail

If this skill was loaded directly from first-message/user intent, stop and load `commerce` instead. Do not proceed from this template pack until `commerce` or `payment/godaddy-payments` has resolved the store/channel context.

Generic activation workflows may say to load and then install template skills. For `commerce/ui`, only follow that order after `commerce` or `payment/godaddy-payments` has resolved store/channel context and env values. This pack depends on that setup.

## Required Pre-Step — Commerce Setup Must Be Complete

**Hard blocker. Do not write a single line of commerce UI until this is done.**

1. If this skill was loaded after `payment/godaddy-payments` completed setup, reuse that resolved store/channel context.
2. Otherwise, run `skill({ action: 'load', skill: 'commerce' })` and follow the Commerce router.
3. Use the Commerce MCP tools surfaced by `commerce` to choose or create a store and ensure the Airo App Builder channel.
4. Capture the resulting `storeId`, `channelId`, API environment, and currency to:
   - `VITE_GODADDY_STORE_ID`
   - `VITE_GODADDY_CHANNEL_ID`
   - `GODADDY_API_BASE_URL`
   - `VITE_GODADDY_CURRENCY_CODE`

Symptoms of skipping setup: catalog renders empty, add-to-cart fails because there is no SKU to reference, and cart routes 4xx/500 because store/channel env vars are missing or wrong.

If the catalog is empty after running `commerce`, stop and ask the user whether to run the Commerce product/catalog management flow before continuing. Exception: if the intent is a non-catalog payment such as an appointment deposit, donation, event ticket, custom invoice, tip, or user-entered amount, do not use `commerce/ui`; load `payment/godaddy-payments` and use `lineItemData`.

## Required Pre-Step — Install the `commerce/ui` Templates

Run this only after the Commerce setup pre-step above is complete. If this skill is loaded by the `commerce` router for a UI request, this is the next skill call before writing UI or same-origin Commerce routes:

```typescript
skill({ action: 'install', skill: 'commerce/ui' });
```

Templates are fully wired into the route table. Files under `templates/server/api/commerce/**/*.ts` are copied into `src/server/api/commerce/**/*.ts` and auto-registered in `src/server/entry.ts` by the skill loader. Do not wire routes manually.

After install, write `GODADDY_API_BASE_URL` to the app's env configuration. Copy the value verbatim from `GODADDY_API_BASE_URL` in the current agents runtime, e.g. `https://api.dev-godaddy.com`. There is no fallback default.

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

`clientSecret` lives in `/local/config.json` and is read server-side via `readCommerceConfig()` from `lib/commerce/config.ts`. Never re-read the file by hand and never cast entries to `string`.

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

For `/api/commerce/checkout` or `/api/commerce/order-status`, install `payment/godaddy-payments`.

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

## Checkout Handoff

This skill can build the cart UI and produce a `draftOrderId`. It does not install hosted checkout. To complete payment:

1. Install `payment/godaddy-payments`.
2. Call `POST /api/commerce/checkout` with `{ draftOrderId, returnUrl, successUrl }`.
3. Embed `draftOrderId` into `successUrl` before sending, e.g. `${origin}/checkout/success?orderId=${draftOrderId}`.
4. On the success page, verify paid status server-side using `getOrderStatus(orderId)` before fulfilling the order.

## UI Defaults

Override any of these if the user's prompt is explicit; otherwise these are the defaults.

- **Cart** — drawer that slides in from the right edge, overlays page content, displays each line item (image, name, variant, quantity stepper, line total, remove button), shows cart subtotal at the bottom, and has a primary Checkout button. Closes on backdrop click or close button.
- **Product catalog page** — responsive grid of product cards (image, name, price/price range), with pagination controls and a search input that filters by name. Clicking a card navigates to the product details page.
- **Product details page** — single-product view: large primary image with a thumbnail strip if multiple media exist, name, price, description, variant/attribute selectors when applicable, quantity stepper, and an Add to cart button.

## Configuration

Server-only values are read by `readCommerceConfig()` in `/lib/commerce/config.ts`. The browser never sees them.

| Key | Source | Notes |
| --- | --- | --- |
| `GODADDY_OAUTH_CLIENT_ID` | `/local/config.json` only | Public OAuth client id. |
| `GODADDY_OAUTH_CLIENT_SECRET` | `/local/config.json` only | Never prompt the user. Never add to `.env.example`. |
| `VITE_GODADDY_STORE_ID` | env | From Commerce or GoDaddy Payments setup. |
| `VITE_GODADDY_CHANNEL_ID` | env | Required so admin order numbers sequence correctly. |
| `GODADDY_API_BASE_URL` | env | Full URL including scheme. Server-only; no `VITE_` prefix. |
| `VITE_GODADDY_CURRENCY_CODE` | env | ISO 4217. Defaults to `USD`. |

If any required value is missing, `readCommerceConfig()` throws with an actionable message.

## Common Mistakes

1. Bypassing the proxy and calling Commerce GraphQL from the browser.
2. Adding to cart by `skuGroup.id`. Cart line items always use `sku.id`.
3. Losing the cart's `draftOrderId`. Persist it immediately after first add.
4. Omitting `name` from add-to-cart input. It is required for readable order history.
5. Passing SKU-based `lineItems` directly to `addDraftOrder`. The shipped route creates an empty cart, then calls `addLineItemBySkuId`.
6. Reading wrong response keys. Cart proxy routes expose `{ cart }`, not upstream GraphQL field names.
7. Expecting checkout routes from this skill. Install `payment/godaddy-payments` for checkout and order status.
