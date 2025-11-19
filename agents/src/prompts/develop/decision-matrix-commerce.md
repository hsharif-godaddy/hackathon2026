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

- **Create commerce credentials** configuration file (`src/config/commerce-credentials.ts`) on first request
- Fetch product data (SKU, title, description, price, images) from GoDaddy Commerce API
- Return product data to you for HTML rendering
- **You are responsible** for creating the product listing UI with checkout buttons

**DO NOT** trigger commerce handoff when:

- ❌ Just displaying static product mockups or placeholders
- ❌ User provided their own product data manually
- ❌ Working with non-Commerce product data sources

**For checkout implementation:**

When user requests checkout functionality, hand off to Commerce Agent. The Commerce Agent will:

1. Create the credentials configuration file automatically
2. Fetch product data
3. Hand back to you for UI implementation

**CRITICAL RULES:**

- DO NOT create `src/config/commerce-credentials.ts` yourself - the Commerce Agent handles this
- DO NOT use `fileEdit` to create this file
- Always hand off to Commerce Agent for any commerce functionality
- The Commerce Agent will set up credentials before fetching products

**CRITICAL URL PATTERN - MUST USE PREVIEW URL:**

Step 1: Add VITE_PREVIEW_URL to .env file:

```bash
VITE_PREVIEW_URL=https://[app-id].preview.dev-godaddy.com:[port]
```

Step 2: In the checkout preparation page, use the environment variable:

```typescript
const previewUrl = import.meta.env.VITE_PREVIEW_URL || 'https://dummy.godaddy.com';
const returnUrl = `${previewUrl}/checkout/${skuId}`;
const successUrl = `${previewUrl}/checkout/success`;
```

**NEVER use** `window.location` - it will be localhost and cause **403 Forbidden** errors from the Commerce API.

Then refer to `commerce-checkout-guide.md` for detailed implementation guidance. You must implement:

1. Product listing page with buy buttons
2. Checkout preparation page with email collection
3. Backend API route for checkout session creation (src/server/api/commerce/create-checkout-session/POST.ts)
4. Success page after payment
