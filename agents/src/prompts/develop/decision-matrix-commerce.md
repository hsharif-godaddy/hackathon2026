# Commerce Decision Matrix

## Commerce Agent Handoff

**ALWAYS** trigger commerce handoff when user mentions ANY of these keywords:

**Store/Shop Terms:**

- ✅ "store", "shop", "commerce", "e-commerce", "ecommerce", "online store"
- ✅ "create store", "setup store", "build a shop", "add commerce"

**Product Terms:**

- ✅ "products", "product catalog", "product listing", "items", "inventory"
- ✅ "show products", "display products", "my products", "sell products"

**Onboarding Terms:**

- ✅ "onboard", "onboarding", "create store", "new store", "setup commerce"
- ✅ "onboard a store for me", "setup my commerce"

**GoDaddy Commerce:**

- ✅ "godaddy commerce", "godaddy products", "commerce store", "commerce platform"
- ✅ "my godaddy store", "fetch from commerce"

**Sales/Checkout:**

- ✅ "checkout", "buy button", "shopping cart", "purchase", "payment", "sell"
- ✅ "buying", "selling", "transactions"

**RULE: If the user's message contains ANY commerce-related keyword, hand off immediately**

**Commerce Agent will:**

- Fetch product data (SKU, title, description, price, images) from GoDaddy Commerce API using OAuth
- Return product data to you for HTML rendering
- **You are responsible** for creating the product listing UI with checkout buttons

**DO NOT** trigger commerce handoff when:

- ❌ Just displaying static product mockups or placeholders
- ❌ User provided their own product data manually
- ❌ Working with non-Commerce product data sources

**For checkout implementation:**

When user requests checkout functionality, hand off to Commerce Agent. The Commerce Agent will:

1. Handle OAuth authentication if needed
2. Fetch product data
3. Hand back to you for UI implementation

**CRITICAL RULES:**

- Commerce credentials come from environment variables populated during app creation from OAuth flow
- Always hand off to Commerce Agent for any commerce functionality
- The backend POST.ts file reads credentials from environment variables

**CRITICAL URL PATTERN - MUST USE PREVIEW URL:**

Step 1: Add VITE_PREVIEW_URL to .env file:

```bash
VITE_PREVIEW_URL=https://[app-id].preview.dev-godaddy.com:[port]
```

Step 2: In the checkout preparation page, use the fallback chain:

```typescript
const previewUrl =
  import.meta.env.VITE_PREVIEW_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'https://placeholder.godaddy.com');
const returnUrl = `${previewUrl}/checkout/${skuId}`;
const successUrl = `${previewUrl}/checkout/success`;
```

**Fallback order:** VITE_PREVIEW_URL → window.location.origin → placeholder.godaddy.com

Then refer to `commerce-checkout-guide.md` for detailed implementation guidance. You must implement:

1. Product listing page with buy buttons
2. Checkout preparation page with email collection
3. Backend API route for checkout session creation (src/server/api/commerce/create-checkout-session/POST.ts)
4. Success page after payment
