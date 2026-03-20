---
name: commerce
description: Manage GoDaddy Commerce store data and operations via APIs (auth, store setup, catalog, products/SKUs, pricing, inventory, media, and orders). UI rendering belongs to commerce-storefront and commerce-one-time-payment skills.
whenToUse: Trigger for requests like "build product catalog", "set up shop/store", "add products", "add cart/checkout", or "connect GoDaddy Commerce" whenever data should come from GoDaddy Commerce APIs. ALWAYS load this skill first for ANY store/catalog/product operation (even when the user starts with UI wording), then load commerce-storefront or commerce-one-time-payment for UI pages.
---

# Commerce Management Skill

Use this skill as the **Commerce API management layer**.

This skill is for:

- connecting/authing Commerce
- creating or reusing a store
- managing catalog data (products/SKUs)
- managing pricing, inventory, media, and orders

This skill is **not** for storefront UI/page rendering.

- Use `commerce-storefront` for catalog/cart storefront UI.
- Use `commerce-one-time-payment` for simple one-time checkout UI.

<scope_split>

| Skill                       | Responsibility                                                                   |
| --------------------------- | -------------------------------------------------------------------------------- |
| `commerce`                  | Commerce API data + operations (store/catalog/orders)                            |
| `commerce-storefront`       | Storefront UI (ProductGrid, ProductDetails, Cart, checkout success/cancel pages) |
| `commerce-one-time-payment` | Simple one-time payment UI flow (products/checkout/success pages)                |

</scope_split>

<terminology>
The Commerce API uses different terms from common e-commerce language. Use API terms when calling tools.

| Commerce API term | Common name | Notes                                     |
| ----------------- | ----------- | ----------------------------------------- |
| SKU Group         | Product     | Container for variants (returned as `id`) |
| SKU               | Variant     | Purchasable unit with its own price       |
| Channel           | Storefront  | Sales channel connected to a store        |

Checkout APIs require **SKU IDs** (variants), not SKU Group IDs (products).
</terminology>

<when_to_use>
Activate this skill when the user wants to:

- connect or set up GoDaddy Commerce
- create/manage products or variants
- update pricing
- manage inventory/locations
- add/remove product media
- inspect orders
- prepare store/catalog data before wiring UI
- handle ambiguous prompts like "build the product catalog" by setting up/fetching Commerce data first (instead of static catalog scaffolding)

Do **not** use this skill alone for rendering storefront pages/components. Hand off to Commerce UI skills for UI implementation.
</when_to_use>

<authorization>
`oauthConnect` is the only tool that renders the auth popup.

1. Start with `oauthConnect`.
2. If any Commerce tool returns `needsAuth: true`, call `oauthConnect` again.
3. Then call `suggestedResponse` with: **"I've connected my GoDaddy account"** and retry the failed call.
   </authorization>

<workflow>
Follow this order for management work:

1. Call `oauthConnect`.
2. Collect first name, last name, and email if needed for new store creation.
3. Call `commerce__setup_store` to get `storeId`, `channelId`, and `locationId`.
4. Call `commerce__fetch_catalog` to inspect existing products.
5. If catalog is empty and user wants starter data, create **up to 2** relevant starter products.
6. Ensure each SKU has:
   - price (`commerce__manage_pricing` if needed)
   - inventory (`commerce__manage_inventory` with `stockInventory`, usually quantity 50)
   - media (`commerce__manage_media`)
7. If the user wants UI pages/components, then load the appropriate UI skill:
   - `commerce-storefront` (catalog/cart storefront)
   - `commerce-one-time-payment` (simple buy-now flow)
     </workflow>

<tool_guide>
Use these tools for Commerce management:

- `commerce__setup_store` — create/reuse store and return `storeId`, `channelId`, `locationId`
- `commerce__fetch_catalog` — list products/SKUs with pagination
- `commerce__manage_products` — create/update/delete products and update SKUs
- `commerce__manage_inventory` — locations + stock updates
- `commerce__manage_pricing` — create/update SKU prices
- `commerce__manage_media` — add/remove product media
- `commerce__get_orders` — fetch orders (single or list)

Note: `commerce__install_storefront` is for environment wiring used by UI flows; keep UI rendering instructions in `commerce-storefront` / `commerce-one-time-payment`.
</tool_guide>

<product_management>
Product operations use flat parameters (no nested action envelopes except where shown).

### `commerce__manage_products`

| Action          | Purpose                  | Required params            |
| --------------- | ------------------------ | -------------------------- |
| `createProduct` | Create product with SKUs | `storeId`, `label`, `type` |
| `updateProduct` | Update product metadata  | `storeId`, `skuGroupId`    |
| `deleteProduct` | Delete product + SKUs    | `storeId`, `skuGroupId`    |
| `updateSku`     | Update a SKU             | `storeId`, `skuId`         |

`createProduct` defaults:

- Product `status` defaults to `ACTIVE` if not provided.
- Generated/manual SKUs default to `ACTIVE` unless explicit `status` values are provided.

`createProduct` SKU modes:

- `manual` (default): pass `skus`
- `singleDefault`: auto-create one SKU
- `fromAttributes`: generate variants from `attributes[].values[]`

### `commerce__manage_inventory`

| Action            | Purpose               | Required params                              |
| ----------------- | --------------------- | -------------------------------------------- |
| `getLocations`    | List locations        | `storeId`                                    |
| `createLocation`  | Create location       | `storeId`, `locationLabel`, `countryCode`    |
| `adjustInventory` | Relative stock change | `storeId`, `skuId`, `locationId`, `delta`    |
| `stockInventory`  | Absolute stock set    | `storeId`, `skuId`, `locationId`, `quantity` |

### `commerce__manage_pricing`

Required: `storeId`, `skuId`, `currencyCode`, `value`.
Optional: `priceId`, `compareAtValue`.

- Provide `priceId` (from `commerce__fetch_catalog` → `skus[].prices[].priceId`) to **update** an existing price.
- Omit `priceId` (or set `priceId: "new"`) to **create** a new price for the SKU.

### `commerce__manage_media`

| Action        | Purpose              | Required params                                             |
| ------------- | -------------------- | ----------------------------------------------------------- |
| `addMedia`    | Add product media    | `storeId`, `skuGroupId`, and (`mediaUrl` or `mediaObjects`) |
| `removeMedia` | Remove product media | `storeId`, `skuGroupId`, `mediaObjectIds`                   |

For one image, `mediaUrl` + `mediaType` is simplest.
</product_management>

<pricing_rules>
Prices are integers in minor currency units (no decimals):

- $5.50 USD → `550`
- $10.00 AUD → `1000`
- ¥500 JPY → `500`
  </pricing_rules>

<order_management>
Use `commerce__get_orders`:

- list recent orders: `storeId`
- get one order: `storeId` + `orderId`

This tool is read-focused; advanced fulfillment/refund handling is managed in Commerce dashboard.
</order_management>

<communication>
After commerce operations, share dashboard links returned by tools:
- Prefer `dashboardLinks`
- `manageLinks.homeUrl` (store home)
- `manageLinks.ordersUrl`
- `manageLinks.catalogUrl`

Use `suggestedResponse` for confirmation points:

- after `oauthConnect`: "I've connected my GoDaddy account"
- after `setup_store`: "My store is ready, let's manage products"
- after product/inventory/media updates: "Products look good" / "I'd like to make changes"
- if UI is requested: "Let's build the storefront UI" or "Let's set up one-time checkout UI"
  </communication>
