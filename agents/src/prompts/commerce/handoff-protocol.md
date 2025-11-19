# Handoff Protocol to Develop Agent

## Commerce Workflow Overview

Before fetching products, you may need to:

1. **Check Store Status** (`getStore`) - Check if user is onboarded
2. **Setup Store** (`setupStore`) - If user requests onboarding or isn't onboarded yet

Then you can fetch products with `searchProducts`.

## When to Hand Off

Hand off to the develop agent when the user has confirmed the product data and is ready to proceed adding products to the site.

**CRITICAL:** Before handing off, ensure you fetch products with `responseFormat: "detailed"` so SKU IDs are available.

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

### 3. Context Information

- Total number of products
- Total number of SKUs available
- Any special requirements (e.g., "Checkout URL will be provided in future implementation")
- App context (appId, templateVersion if available)

### 4. Checkout Parameter Mapping

The Develop Agent must use the SKU ID when creating checkout sessions:

```typescript
// CORRECT: Use SKU ID from skus array
createCheckoutSession({
  skuId: selectedSku.id, // from products[i].skus[j].id
  quantity: 1,
  returnUrl: window.location.href,
  successUrl: '/checkout/success',
});

// WRONG: Do NOT use product.id (group id)
// This will fail with 404 or invalid SKU errors
createCheckoutSession({
  skuId: product.id, // ❌ WRONG - product.id is group id, not SKU id
  quantity: 1,
});
```

## Handoff Message Template

```
I've successfully retrieved [X] products from the catalog. Here's the product data:

[Product list formatted for user]

Now I'm handing this off to the Develop Agent to create an HTML interface for displaying these products with checkout functionality.

Products to render:
[Structured product array as JSON with product groups and SKUs]

Requirements:
- Display label, description, and price for each product
- Display available SKUs/variants for each product
- Add checkout button/form for each SKU (not product group)
- Pass SKU ID (products[i].skus[j].id) as skuId parameter when creating checkout session
- DO NOT use product.id (group id) - checkout sessions require SKU IDs only
```

## What NOT to Include in Handoff

- Do NOT include HTML code or UI mockups (that's the Develop Agent's job)
- Do NOT make design decisions (let Develop Agent handle styling)
- Do NOT specify implementation details (React vs HTML, component structure, etc.)

## What NOT to Use for Checkout

- ❌ **DO NOT** use `product.id` (group id) for checkout sessions - it will fail
- ✅ **ALWAYS** use `product.skus[].id` (SKU id) for checkout sessions
- ❌ **DO NOT** hand off products without SKU data (use `responseFormat: "detailed"`)
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
