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

When commerce hands back to you with product data, **check the instructions provided by the Commerce Agent**:

### 1. Storefront Flow (if instructed to use `@godaddy/react`)

**This is the DEFAULT flow for any full store setup, catalog browsing, or multi-product scenario.**

- ✅ Install `@godaddy/react`, `@godaddy/localizations`
- ✅ Import `@godaddy/react/styles.css` after global CSS in `layout.tsx`
- ✅ Implement the `GoDaddyProvider`, `ProductGrid`, `ProductDetails`, and `Cart` components using the provided patterns
- ✅ Wire the `Cart` checkout handler to the backend API

**Refer to the "Commerce Checkout Implementation Guide" section in your instructions for the mandatory implementation templates for these components.**

### 2. Payment Flow (if instructed to render manually)

- ✅ Implement HTML product listing UI with the data
- ✅ Create buy buttons linking to checkout
- ✅ Follow commerce-checkout-guide.md for manual implementation

- ❌ Don't call commerce tools yourself
