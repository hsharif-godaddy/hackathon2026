# Commerce Agent Handoff

**Hand off IMMEDIATELY when the user mentions ANY commerce-related terms:**

- **Store/Shop keywords**: "store", "shop", "commerce", "sell", "selling", "online store", "e-commerce", "ecommerce"
- **Product keywords**: "products", "product catalog", "product listing", "items for sale", "inventory"
- **Commerce actions**: "onboard", "onboarding", "create store", "setup commerce", "add shop"
- **GoDaddy Commerce**: "godaddy commerce", "godaddy products", "my store", "commerce store"
- **Checkout/Sales**: "checkout", "buy button", "shopping cart", "purchase", "payment"

**Examples that should trigger handoff:**

- ✅ "Build a commerce site"
- ✅ "Onboard a new store for me"
- ✅ "I want to sell products"
- ✅ "Create an online store"
- ✅ "Show my products"
- ✅ "Add e-commerce functionality"
- ✅ "Setup a shop"
- ✅ Any mention of commerce, store, products, or selling

**CRITICAL: You do NOT have commerce tools**

- ❌ **DO NOT** try to call commerce API directly
- ❌ **DO NOT** create mock product data
- ✅ **ALWAYS** use the `handoff` tool to delegate to commerce agent
- ✅ The commerce agent has oauthConnect, store, setupIntegration, searchSkuGroups, skuGroup, sku, writeCommerceCredentials, and suggestedResponse tools.

**What the commerce agent will do:**

When you hand off to commerce, it will:

1. Set up OAuth authorization if needed
2. Fetch real product data from GoDaddy Commerce
3. Hand back product data to you for rendering
4. You implement the HTML/UI for product listings

**Handoff message format:**

```
The user wants to fetch their GoDaddy Commerce products. Please retrieve the product catalog.
```

**After handoff returns:**

When commerce hands back to you with product data, **detect the flow type from the `FLOW_TYPE` header**:

### 1. Storefront Flow (FLOW_TYPE: STOREFRONT_COMPONENTS)

**Detect by:** Look for `FLOW_TYPE: STOREFRONT_COMPONENTS` header in the handoff instructions.

**This is the DEFAULT flow for any full store setup, catalog browsing, or multi-product scenario.**

- ✅ Install `@godaddy/react`, `@godaddy/localizations`, `@tanstack/react-query`
- ✅ Import `@godaddy/react/styles-tailwind.css` after global CSS in `layout.tsx`
- ✅ Wrap app in `GoDaddyProvider` with the storeId, channelId, clientId, apiHost from context
- ✅ Use `ProductGrid`, `ProductDetails`, and `Cart` components
- ✅ Wire the `Cart` onCheckout handler to receive `orderId: string` and call backend with `draftOrderId: orderId`
- ❌ **DO NOT render product cards manually from the products array** - components fetch their own data

**Cart onCheckout Handler (CRITICAL):**

```tsx
const handleCheckout = async (orderId: string) => {
  setIsCheckingOut(true);
  const response = await fetch('/api/commerce/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storeId: 'FROM_CONTEXT',
      draftOrderId: orderId, // CRITICAL: Use orderId as draftOrderId
      returnUrl: `${previewUrl}/checkout/success`,
      successUrl: `${previewUrl}/checkout/success`,
    }),
  });
  // ... handle response
};
```

### 2. Payment Flow (FLOW_TYPE: PAYMENT_SIMPLE)

**Detect by:** Look for `FLOW_TYPE: PAYMENT_SIMPLE` header in the handoff instructions.

- ✅ Implement HTML product listing UI with the data
- ✅ Create buy buttons linking to checkout
- ✅ Follow commerce-checkout-guide.md for manual implementation

- ❌ Don't call commerce tools yourself
