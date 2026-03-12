---
name: commerce
description: Set up e-commerce storefronts — shopping cart, product pages, shop/gallery, checkout, and product catalog powered by GoDaddy Commerce
whenToUse: User wants to sell products, add a shop, set up e-commerce, take payments, manage inventory, or build a storefront. Also when they mention GoDaddy Commerce by name. Phrases like "add a store", "sell products", "set up commerce", "I want to take payments", "add a shopping cart", "GoDaddy Commerce".
dependencies:
  - '@godaddy/react'
  - '@godaddy/localizations'
  - '@tanstack/react-query'
---

# Commerce Skill

<terminology>
The Commerce API uses different terms from common e-commerce language. Use the API terms when calling tools.

| Commerce API term | Common name | Notes                                     |
| ----------------- | ----------- | ----------------------------------------- |
| SKU Group         | Product     | Container for variants (returned as `id`) |
| SKU               | Variant     | A purchasable unit with its own price     |
| Channel           | Storefront  | Sales channel connected to a store        |

Checkout requires individual SKU (variant) IDs, not SKU Group (product) IDs — the cart and checkout components pass SKU IDs to the checkout session API.
</terminology>

<when_to_use>
Activate this skill when the user:

- Wants to sell products, set up a store, add a shop page, or show their catalog
- Asks to build a product page, product gallery, or shop/store section
- Asks for shopping cart functionality, a buy button, or checkout flow
- Mentions GoDaddy Commerce, products, checkout, payments, or e-commerce
  </when_to_use>

<authorization>
Step 1 of the workflow (`oauthConnect`) handles auth and renders the popup for the user.

If a commerce tool later returns `needsAuth: true` (token expired mid-flow), re-authenticate by calling `oauthConnect` again — it is the only tool that can render the auth popup. Then call `suggestedResponse` with "I've connected my GoDaddy account" so the user can confirm, and retry the failed tool call.
</authorization>

<workflow>
Follow these steps in order. Run independent steps in parallel where noted.

1. Call `oauthConnect` to render the auth popup.
2. Collect the user's first name, last name, and email — `setup_store` needs these to create a new store. If the user already provided them, skip this step.
3. Call `commerce__setup_store` with firstName, lastName, email. It returns `storeId`, `channelId`, and `locationId`. Save all three — you need them in later steps. The tool ensures a location always exists (fetching or creating one as needed).
4. Call `commerce__fetch_catalog` to check if products already exist. Always call this, even for a new store.
5. If the catalog is empty, create **at most 2** sample products relevant to the user's store concept. Each product should have a **single SKU** — multi-variant products require option attributes that this tool doesn't support, so the `ProductDetails` component can't render a variant selector for them and Add to Cart won't work.
6. After creating products, stock inventory for every SKU using the `locationId` from step 3. Call `commerce__manage_inventory` with `stockInventory`, quantity 50, for each SKU. Products without inventory appear out-of-stock and the Add to Cart button stays disabled.
7. Call `skill({ action: "install", skill: "commerce" })` to copy template components and install npm dependencies. | Run steps 7 and 8 in parallel.
8. Call `commerce__install_storefront` with storeId and channelId to write env vars to `.env`.
9. Read the installed template files, then customise them based on user preferences (layout, styling, pages).
   </workflow>

<installed_templates>
After step 7 copies templates into the app (`components/`, `pages/`, `lib/`, `server/api/`), read them to understand the wiring, then customise freely. Keep these constraints in mind:

- **CSS import order**: Place `@import '@godaddy/react/styles-tailwind.css'` in `globals.css` **before** the `@tailwind` directives. Postcss requires `@import` to precede all other at-rules — placing it after causes a build error.
- **Checkout endpoint**: Leave `server/api/commerce/create-checkout-session/POST.ts` unchanged. It handles OAuth token exchange and checkout session creation — editing it breaks checkout.
- **Provider setup**: Wrap the app with `GoDaddyCommerceProvider` in the root layout. The provider owns the only `QueryClientProvider` in the app — do not add a second one in `main.tsx` or elsewhere. Duplicate `QueryClientProvider` wrappers cause the draft-order cache to split between two clients, making "Add to Cart" fail with "Order not found". The provider and Cart component read config from env vars (`VITE_GODADDY_*`) — no storeId/channelId props needed. If `main.tsx` already has a `QueryClientProvider`, remove it after adding `GoDaddyCommerceProvider`.
- **Cart lazy-mount**: The Cart template defers mounting `GoDaddyCart` until the user opens the cart. This is intentional — `GoDaddyCart` fetches the cart order on mount, and if a stale order ID exists in localStorage the fetch fails. Do not remove the `hasOpened` guard.
- **Available components**: Only use components and hooks from the template files. The `@godaddy/react` package has a limited public API — for example, there is no `useCart` hook. Stick to what the templates demonstrate: `ProductGrid`, `ProductDetails`, `Cart`, `GoDaddyProvider`.
  </installed_templates>

<product_management>
Product operations are split across four focused tools with flat parameters (no nested objects).

### `commerce__manage_products` — Product & SKU CRUD

| Action          | Purpose                                 | Required params            |
| --------------- | --------------------------------------- | -------------------------- |
| `createProduct` | Create a new product with SKUs          | `storeId`, `label`, `type` |
| `updateProduct` | Update product label/description/status | `storeId`, `skuGroupId`    |
| `deleteProduct` | Delete a product and its SKUs           | `storeId`, `skuGroupId`    |
| `updateSku`     | Update a single SKU's label/code/status | `storeId`, `skuId`         |

Pass `label`, `description`, `type`, `status` at the top level. For createProduct, pass `skus` as an array. For updateSku, use `skuLabel`, `skuName`, `skuCode`.

### `commerce__manage_inventory` — Locations & Stock

| Action            | Purpose                         | Required params                              |
| ----------------- | ------------------------------- | -------------------------------------------- |
| `getLocations`    | List inventory locations        | `storeId`                                    |
| `createLocation`  | Create a new inventory location | `storeId`, `locationLabel`, `countryCode`    |
| `adjustInventory` | Add/remove stock (relative)     | `storeId`, `skuId`, `locationId`, `delta`    |
| `stockInventory`  | Set stock count (absolute)      | `storeId`, `skuId`, `locationId`, `quantity` |

Address fields are flat: `addressLine1`, `addressLine2`, `adminArea1`, `adminArea2`, `postalCode`, `countryCode`.

### `commerce__manage_pricing` — Price Updates

Updates a SKU price. No `action` parameter — just pass the price fields directly.

Required: `storeId`, `skuId`, `priceId`, `currencyCode`, `value`. Optionally pass `compareAtValue` for discount display. Get `priceId` from the `fetch_catalog` response (`skus[].prices[].priceId`).

### `commerce__manage_media` — Product Images & Videos

| Action        | Purpose                        | Required params                                       |
| ------------- | ------------------------------ | ----------------------------------------------------- |
| `addMedia`    | Add images/videos to a product | `storeId`, `skuGroupId`, `mediaUrl` or `mediaObjects` |
| `removeMedia` | Remove media from a product    | `storeId`, `skuGroupId`, `mediaObjectIds`             |

For a single image, use the `mediaUrl` + `mediaType` shortcut. For multiple images, use the `mediaObjects` array.

### Pricing

Prices are integers in minor currency units (cents for USD). The API rejects decimal values.

- $5.50 USD → `currencyCode: "USD", value: 550`
- $10.00 AUD → `currencyCode: "AUD", value: 1000`
- ¥500 JPY → `currencyCode: "JPY", value: 500`

### Product Images

Products need images to display properly in the storefront. After creating products, find images using `mediaSearch` (e.g., search "coffee latte" for a café product), then call `commerce__manage_media` with action `addMedia` to attach the returned URL.

### Inventory

`setup_store` always returns a `locationId` — it fetches the existing location or creates a default one. Use `commerce__manage_inventory` to manage stock:

- `stockInventory` (absolute) when the user states a total ("I have 50 of each")
- `adjustInventory` (relative) when they describe a change ("add 10 more")

### Product Status

Products and SKUs are created in `DRAFT` status by default. Set `status: "ACTIVE"` on both the product and its SKUs for them to appear in the storefront.
</product_management>

<examples>
<example title="Create a sample product with a single SKU (commerce__manage_products)">
Sample products should have one SKU each. Multi-variant products require named option attributes to render a variant selector in `ProductDetails`, which this tool doesn't support — so the Add to Cart button won't work for multi-SKU products.
```json
{
  "action": "createProduct",
  "storeId": "store-abc",
  "label": "Espresso",
  "type": "PHYSICAL",
  "status": "ACTIVE",
  "skus": [
    {
      "label": "Espresso",
      "name": "espresso",
      "status": "ACTIVE",
      "prices": [{ "value": { "currencyCode": "USD", "value": 450 } }]
    }
  ]
}
```
`name` is auto-slugified if you pass a human-readable string. Price `value` of 450 = $4.50 (cents).
</example>

<example title="Add an image to a product (commerce__manage_media)">
First, call `mediaSearch` with query "coffee beans bag" to get an asset URL. Then:
```json
{
  "action": "addMedia",
  "storeId": "store-abc",
  "skuGroupId": "product-xyz",
  "mediaUrl": "https://assets.example.com/coffee.jpg",
  "mediaType": "IMAGE"
}
```
</example>

<example title="Update a price (commerce__manage_pricing)">
```json
{
  "storeId": "store-abc",
  "skuId": "sku-123",
  "priceId": "price-456",
  "currencyCode": "USD",
  "value": 2000
}
```
No `action` parameter. Get `priceId` from `fetch_catalog` response.
</example>

<example title="Stock inventory after creating products (commerce__manage_inventory)">
Use the `locationId` returned by `setup_store`:
```json
{ "action": "stockInventory", "storeId": "store-abc", "skuId": "sku-123", "locationId": "loc-456", "quantity": 50 }
```
</example>
</examples>

<order_management>
Use `commerce__get_orders` to view orders:

- List recent orders: pass `storeId` only
- Fetch a specific order: pass `storeId` and `orderId`

Orders are read-only through this tool. Fulfilment and refunds are managed through the GoDaddy Commerce dashboard.
</order_management>

<communication>
After each commerce operation, show the `manageUrl` returned by the tool so the user can verify results in the GoDaddy dashboard.

Use `suggestedResponse` after operations that need user confirmation before continuing:

- After `oauthConnect` → "I've connected my GoDaddy account"
- After `setup_store` → "My store is ready, let's add products"
- After creating products → "Products look good" or "I'd like to make changes"
- After `install_storefront` → "Let's preview the store"
  </communication>
