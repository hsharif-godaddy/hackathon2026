# Handoff Protocol to Develop Agent

## Commerce Workflow Overview

Before fetching products, you may need to:

1. **Check Store Status** (`store` with `action: "read"`) - Check if user is onboarded
2. **Setup Store** (`setupIntegration`) - If user requests onboarding or isn't onboarded yet

Then you can fetch products with `searchSkuGroups`.

## When to Hand Off

Hand off to the develop agent when the user has confirmed the product data and is ready to proceed adding products to the site.

**CRITICAL:** The `searchSkuGroups` tool always returns full product data including SKU IDs. Ensure you have fetched products before handing off.

## Handoff Structure

When handing off to the Develop Agent, provide:

### 1. Clear Task Instructions

```
Render these products in an HTML interface with the following requirements:
- Display label, description, and price for each product
- Add a form or button for each product to initiate checkout
- Use the SKU ID (skus[n].id) as the skuId parameter when initiating checkout
- DO NOT use product.id (group id) for checkout - it will fail
- Style appropriately for the application's design system
```

### 2. Complete Product Data

Include the full product array in structured format with SKU IDs:

```json
{
  "products": [
    {
      "id": "grp_12345",
      "label": "T-Shirt",
      "description": "Soft cotton tee",
      "type": "PHYSICAL",
      "priceRange": "1999 - 2999",
      "skus": [
        {
          "id": "sku_small_black",
          "code": "TS-S-BLK",
          "name": "Small / Black"
        },
        {
          "id": "sku_medium_black",
          "code": "TS-M-BLK",
          "name": "Medium / Black"
        }
      ]
    }
  ]
}
```

**IMPORTANT DATA MODEL:**

- `product.id` = Product Group ID (presentational only, NOT valid for checkout)
- `product.skus[].id` = SKU ID (the ONLY valid identifier for checkout sessions)
- Even simple products with no variants have at least one SKU in the `skus` array
- You purchase a SKU (e.g., "t-shirt small black"), not a product (e.g., "t-shirt")

### 3. Store Configuration

Include store identifiers required for checkout:

- `storeId`: The unique identifier for the merchant's store (from store/setupIntegration)
- `channelId`: The sales channel identifier (usually "web" or from context)

### 4. Context Information

- Total number of products
- Total number of SKUs available
- Any special requirements (e.g., "Checkout URL will be provided in future implementation")
- App context (appId, templateVersion if available)

### 5. Checkout Parameter Mapping

The Develop Agent must use the SKU ID and Store ID when creating checkout sessions. The API accepts a `lineItems` array for multiple products:

```typescript
// IMPORTANT: Use VITE_PREVIEW_URL, NOT window.location (localhost causes 403 errors)
const previewUrl = import.meta.env.VITE_PREVIEW_URL || 'https://dummy.godaddy.com';

// CORRECT: Use lineItems array with SKU IDs from skus array
createCheckoutSession({
  storeId: 'store-xyz-123', // from handoff context
  lineItems: [
    { skuId: selectedSku.id, quantity: 1 }, // skuId from products[i].skus[j].id
  ],
  returnUrl: `${previewUrl}/checkout`,
  successUrl: `${previewUrl}/checkout/success`,
  // Optional configuration:
  storeName: 'My Store',
  enableShipping: true,
});

// Multiple items checkout
createCheckoutSession({
  storeId: 'store-xyz-123',
  lineItems: [
    { skuId: 'sku-1', quantity: 2 },
    { skuId: 'sku-2', quantity: 1 },
  ],
  returnUrl: `${previewUrl}/checkout`,
  successUrl: `${previewUrl}/checkout/success`,
});

// WRONG: Do NOT use product.id (group id)
// This will fail with 404 or invalid SKU errors
createCheckoutSession({
  storeId: 'store-xyz-123',
  lineItems: [
    { skuId: product.id, quantity: 1 }, // ❌ WRONG - product.id is group id, not SKU id
  ],
  returnUrl: `${previewUrl}/checkout`,
  successUrl: `${previewUrl}/checkout/success`,
});
```

**Available checkout configuration options:**

- `storeName` - Display name for the store
- `enableShipping` - Enable shipping options (default: false)
- `enableLocalPickup` - Enable local pickup (default: false)
- `enableBillingAddressCollection` - Collect billing address (default: true)
- `enableShippingAddressCollection` - Collect shipping address (default: false)
- `enablePhoneCollection` - Collect phone number (default: false)
- `enableTaxCollection` - Enable tax calculation (default: false)
- `enablePaymentMethodCollection` - Enable payment methods (default: true)

## Handoff Message Template

```
I've successfully retrieved [X] products from the catalog. Here's the product data:

[Product list formatted for user]

Now I'm handing this off to the Develop Agent to create an HTML interface for displaying these products with checkout functionality.

Store Configuration:
- Store ID: [storeId]

Products to render:
[Structured product array as JSON with product groups and SKUs]

Requirements:
- Display label, description, and price for each product
- Display available SKUs/variants for each product
- Add checkout button/form for each SKU (not product group)
- Pass SKU ID (products[i].skus[j].id) as skuId parameter when creating checkout session
- Pass Store ID and Channel ID as storeId/channelId parameters
- DO NOT use product.id (group id) - checkout sessions require SKU IDs only
```

## What NOT to Include in Handoff

- Do NOT include HTML code or UI mockups (that's the Develop Agent's job)
- Do NOT make design decisions (let Develop Agent handle styling)
- Do NOT specify implementation details (React vs HTML, component structure, etc.)

## What NOT to Use for Checkout

- ❌ **DO NOT** use `product.id` (group id) for checkout sessions - it will fail
- ✅ **ALWAYS** use `product.skus[].id` (SKU id) for checkout sessions
- ❌ **DO NOT** hand off products without SKU data (always fetch with `searchSkuGroups` first)
- ❌ **DO NOT** assume simple products don't have SKUs - they always have at least one

## After Handoff

Once you hand off:

1. Your task is complete
2. The Develop Agent takes full ownership of HTML rendering
3. You do not need to follow up or verify the implementation

## Error Handling

If product fetch fails:

- Do NOT hand off to Develop Agent
- Report the error to the user
- Suggest troubleshooting steps (check configuration, API availability, etc.)
