---
name: commerce
description: Manage GoDaddy Commerce store data and operations via APIs (auth, store setup, catalog, products/SKUs, pricing, inventory, media, and orders). UI rendering belongs to commerce-storefront and commerce-one-time-payment skills.
whenToUse: Load IMMEDIATELY — before using askQuestion or asking the user anything — for ANY e-commerce intent (create online store, sell online, sell products, e-commerce site, I want a shop, build product catalog, set up shop/store, add products, add cart/checkout, connect GoDaddy Commerce). Do NOT ask the user which store or what products before loading this skill — the skill workflow handles store discovery automatically via commerce__setup_store. ALWAYS load this skill first for ANY store/catalog/product/selling operation (even when the user starts with UI or high-level wording), then load commerce-storefront or commerce-one-time-payment for UI pages. NEVER suggest, mention, or use Stripe unless the user explicitly says "use Stripe" or "I want to use Stripe"
intents:
  - online store/e-commerce/sell products/shop/set up store/catalog data
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
Do **not** ask the user which store to use before calling `commerce__setup_store` — call the tool first and let it return `storeChoiceRequired` or `businessChoiceRequired` to determine what to ask.
</when_to_use>

<authorization>
`oauthConnect` is the only tool that renders the auth popup.

1. Start with `oauthConnect`.
2. If any Commerce tool returns `needsAuth: true`, call `oauthConnect` again.
3. Then call `suggestedResponse` with: **"I've connected my GoDaddy account"** and retry the failed call.
   </authorization>

<workflow>
**Critical:** Never ask the user "which store?" before calling `commerce__setup_store`. Always call `oauthConnect` + `commerce__setup_store` first — the tool response determines store state and will prompt the user for the right choice automatically.

**ALWAYS re-run `commerce__setup_store` at the start of every commerce flow — even if a `storeId` is already present in the conversation context.** The account may have multiple stores or businesses that were not visible in a prior turn. Never skip `setup_store` and call `fetch_catalog` or `manage_products` directly with a cached storeId. Re-running `setup_store` is cheap and is the ONLY safe way to confirm the user is managing the correct store.

**`VITE_GODADDY_STORE_ID` is for the frontend storefront only.** If you see `VITE_GODADDY_STORE_ID` in the app environment or context, ignore it when making store management decisions — it controls which store the storefront UI renders, not which store the user wants to manage products in. NEVER use it as a reason to skip calling `commerce__setup_store`.

Follow this order for management work:

1. Call `oauthConnect`.
2. If the user already shared a Commerce Home URL or Store ID, call `commerce__setup_store` with `storeUrl` or `storeId` so the existing store is linked directly.
3. Otherwise call `commerce__setup_store` once (no preference) to discover store state.
   **Handling `businessChoiceRequired: true`:**
   The result includes a `businesses` array listing every GoDaddy business with its stores. Use `askQuestion` with `multiSelect: false`, `allowOther: false`, and one suggestion per business (text = business legalName). Do NOT use `suggestedResponse` for this. Then retry `commerce__setup_store` with `businessId: "<chosen businessId>"`. Do not retry without a `businessId`.
   **Handling `storeChoiceRequired: true`:**
   Only fires when the account has **2 or more** stores (1 biz / 2+ stores, or after ADD_STORE). The result includes an `existingStores` array. Use `askQuestion` with `multiSelect: false`, `allowOther: false`, and one suggestion per store (text = store displayName). Always include a "Create a new store" option as the last suggestion. Do NOT use `suggestedResponse` for this. Do not retry `commerce__setup_store` again in the same turn.
   **1 biz / 1 store:** `setup_store` auto-proceeds and returns `storeId` directly — no choice required, no `askQuestion` needed.
   **Handling `needsOwnerIdentity: true`:** ask for first name, last name, and email, then retry with `storePreference: "new"`.
   **Handling `needsStoreName: true`:** ask the user what to name the new store, then retry with `storePreference: "new"` and the new `storeName`.
   **Handling `noExistingStoreFound: true`:** ask for first name, last name, and email, then retry with `storePreference: "new"`.
   **Handling `storeProvisioningInProgress: true`:** tell the user Commerce store setup is still finishing and do not call `commerce__setup_store` again.
   **Handling `paymentsManualSetupRequired: true`:** tell the user the store was created but GoDaddy Payments must be finished manually in Commerce Home.
4. After the user chooses a path, call `commerce__setup_store` with the explicit preference:
   - **Use existing store:** `storePreference: "existing"`, `storeName: "<chosen store name>"` (required when multiple stores exist to select the right one). Also pass `businessId` and `channelId` from the chosen `existingStores` entry if they are present — this avoids redundant API lookups.
   - **Create additional store (2nd, 3rd, …):** `storePreference: "new"`, `storeName: "<new store name>"`. Owner identity (firstName/lastName/email) is NOT needed — the business is already onboarded. The tool handles this via ADD_STORE.
   - **Create first store (no existing stores):** `storePreference: "new"` plus `firstName`, `lastName`, `email`.
5. Reuse the resulting `storeId`, `channelId`, and `locationId` for the rest of the flow. Do not call `commerce__setup_store` again in the same flow just to recover `channelId` or re-check an existing store.
   **Multi-store rule:** Never save `storeId` to persistent app memory. Always rediscover it via `commerce__setup_store` at the start of each new conversation AND whenever the user asks to add/manage products or connect a store mid-conversation — even if a `storeId` is already present in the conversation context. The user may have multiple businesses; re-running `setup_store` is the only way to detect them and present the correct choice. Store selection matrix: 1 biz / 1 store → proceeds directly (no choice prompt); 1 biz / 2+ stores → `storeChoiceRequired`; 2+ businesses → `businessChoiceRequired`; businessId scoped → filters stores to that business.
   **After ADD_STORE (`addedToExistingBusiness: true`):** The response also includes `storeChoiceRequired: true` with `existingStores` listing ALL stores including the new one. Treat it exactly like a `storeChoiceRequired` response — call `askQuestion` immediately to let the user pick which store to manage. Do NOT auto-proceed to product operations.
6. Call `commerce__fetch_catalog` to inspect existing products.
7. If catalog is empty and user wants starter data, create **up to 2** relevant starter products.
8. Ensure each SKU has:
   - price (`commerce__manage_pricing` if needed)
   - inventory (`commerce__manage_inventory` with `stockInventory`, usually quantity 50)
   - media (`commerce__manage_media`)
9. If the user wants UI pages/components, then load the appropriate UI skill:
   - `commerce-storefront` (catalog/cart storefront)
   - `commerce-one-time-payment` (simple buy-now flow)
     </workflow>

<tool_guide>
Use these tools for Commerce management:

- `commerce__setup_store` — create/reuse store and return `storeId`, `channelId`, `locationId`
  This is both the store-discovery and store-setup tool. If an existing store is found and no `storePreference` is provided, it returns `storeChoiceRequired` instead of deciding for the user.
  Pass `storeId` or `storeUrl` when the user already shared an existing Commerce store link.
  Only require `firstName`, `lastName`, and `email` when creating a new store. Never synthesize them from the business name.
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

<inventory_tracking>
When creating or updating SKUs for **service or appointment products** (e.g. bookings, consultations, classes, sessions), always set `disableInventoryTracking: true`:
- `createProduct` with `singleDefault` mode → set `defaultSku: { disableInventoryTracking: true }`
- `createProduct` with `fromAttributes` mode → set `skuTemplate: { disableInventoryTracking: true }`
- `updateSku` on an existing service/appointment SKU → set `skuDisableInventoryTracking: true`

Do **not** set this on physical products (apparel, merchandise, goods) where stock enforcement is required.
</inventory_tracking>

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
- before `setup_store` when owner identity is missing: "I need your first name, last name, and email address to create your Commerce store."
- after `setup_store`: "My store is ready, let's manage products"
- after product/inventory/media updates: "Products look good" / "I'd like to make changes"
- if UI is requested: "Let's build the storefront UI" or "Let's set up one-time checkout UI"

Use `askQuestion` (not `suggestedResponse`) for choice prompts:

- when `businessChoiceRequired` is returned: one suggestion per business (legalName), `multiSelect: false`, `allowOther: false`
- when `storeChoiceRequired` is returned: one suggestion per store (displayName) plus "Create a new store", `multiSelect: false`, `allowOther: false`
  </communication>
