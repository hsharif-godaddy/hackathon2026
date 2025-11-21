# Commerce Checkout Implementation Guide

## Overview

When implementing commerce checkout, copy the POST.ts template file exactly as-is from the app-templates directory. This file is protected by the file-edit tool's immutability feature.

## Requirements

### 1. Environment Variable Setup - Preview URL

**CRITICAL:** Commerce API rejects localhost URLs with 403 Forbidden. The app must be configured with its public preview URL.

**Step 1: Add VITE_PREVIEW_URL to .env file**

Use fileEdit to create or update `.env` in the app root with the preview URL:

```bash
VITE_PREVIEW_URL=http://[app-id].preview.dev-godaddy.com:[port]
```

**IMPORTANT:** You must get the actual app ID and port from the app context:

- App ID is available in the conversation context as `appId`
- Port can be found in the app metadata
- The preview URL format is: `http://[appId].preview.dev-godaddy.com:[port]` (HTTP, not HTTPS)

**Example .env content:**

```bash
VITE_PREVIEW_URL=http://abc123def456.preview.dev-godaddy.com:5007
```

**Step 2: Use the environment variable in checkout code**

```typescript
// Read preview URL from environment variable
const previewUrl = import.meta.env.VITE_PREVIEW_URL || 'https://dummy.godaddy.com';
const returnUrl = `${previewUrl}/checkout`;
const successUrl = `${previewUrl}/checkout/success`;
```

**IMPORTANT:**

- The `.env` file must contain the actual preview URL with app-id and port
- DO NOT use `window.location` - it will be localhost
- The fallback `dummy.godaddy.com` prevents 403 but won't redirect back properly

---

## Overview

When users request e-commerce functionality with product listings and checkout, you need to implement a complete checkout flow using the GoDaddy Commerce API integration.

## When to Implement Commerce Checkout

Trigger commerce checkout implementation when:

- ✅ User asks to "add checkout", "enable purchases", "allow customers to buy"
- ✅ User mentions "shopping cart", "buy button", "payment", "checkout flow"
- ✅ User wants to "sell products", "accept payments", "process orders"
- ✅ User requests "product page with buy now button"

## Required Flow: Three Pages

**⚠️ CRITICAL - USE ACTUAL COMMERCE DATA ⚠️**

When implementing product listings with Commerce, you MUST use the **actual product data** returned by the Commerce Agent.

**REQUIRED:**

- Use exact SKU IDs, prices, titles, and descriptions from Commerce Agent handoff response
- It's OK to include this data directly in the source code (hardcoding is acceptable for now)
- Verify that SKU IDs match the format returned by Commerce API (e.g., '019a97f4-5e10-7111-b33f-ac2928ef9413')

**FORBIDDEN:**

- ❌ DO NOT make up or invent SKU IDs (e.g., 'abc123', 'prod-001')
- ❌ DO NOT make up prices, titles, or descriptions
- ❌ DO NOT use placeholder data

**Why This Matters:**

- Checkout will FAIL if SKU IDs don't match actual Commerce products
- Made-up data breaks the entire commerce integration
- Only actual Commerce data will work with the checkout session creation

---

### 1. Product Listing Page

**Purpose:** Display products with purchase buttons

**⚠️ CRITICAL - SKU ID:** The `skuId` field returned by the Commerce Agent's GetProducts tool is the ONLY valid SKU ID to use for checkout. This is the `sku.id` from the GraphQL API response. DO NOT use any other ID field (like `code`, `groupId`, etc.).

**⚠️ MANDATORY UI REQUIREMENT:** ALL product listing pages MUST visibly display the SKU ID for each product. This is not optional - SKU IDs must be shown in the UI for debugging, customer reference, and order tracking purposes.

**Implementation Steps:**

1. Trigger Commerce Agent handoff to fetch product data
2. Create a product listing page component
3. Display each product with:
   - Product image (if available)
   - **SKU ID (MANDATORY - must be visible in UI)** - Display **product.skuId** prominently
   - Title
   - Description
   - Price (formatted using `formatPrice` from `@/lib/commerce-client`)
   - "Buy Now" or "Add to Cart" button
4. On button click, navigate to checkout preparation page with **product.skuId**

**Example Code Pattern:**

```tsx
import { formatPrice, type CommerceProduct } from '@/lib/commerce-client';

function ProductCard({ product }: { product: CommerceProduct }) {
  const navigate = useNavigate();

  const handleBuyClick = () => {
    navigate(`/checkout/${product.skuId}`, {
      state: { product },
    });
  };

  return (
    <div>
      <h3>{product.title}</h3>
      {/* MANDATORY: SKU ID must be visible in the UI */}
      <p>
        <strong>SKU:</strong> {product.skuId}
      </p>
      <p>{product.description}</p>
      <p>{formatPrice(product.price, product.currencyCode)}</p>
      <button onClick={handleBuyClick}>Buy Now</button>
    </div>
  );
}
```

### 2. Checkout Preparation Page

**Purpose:** Confirm purchase and create checkout session

**Route:** `/checkout/:skuId` or `/checkout/prepare`

**⚠️ MANDATORY UI REQUIREMENT:** The checkout preparation page MUST display the SKU ID being purchased.

**⚠️ MANDATORY API REQUIREMENT:** The SKU ID MUST be sent to the backend POST.ts endpoint via `createCheckoutSession`.

**Implementation Steps:**

1. Extract SKU ID from URL params: `const { skuId } = useParams();`
2. Display selected product details (from navigation state or fetch by SKU)
3. Show product name, **SKU ID (MANDATORY - visible in UI)**, and price
4. "Continue to Payment" button
5. On button click:
   - Call `createCheckoutSession` from `@/lib/commerce-client`
   - **MUST pass the SKU ID**: `skuId: skuId!` (from URL params or product.skuId)
   - Pass quantity, returnUrl, successUrl (NO email required)
   - On success, redirect to `checkoutUrl`
   - On error, display error message

**Example Code Pattern:**

```tsx
import { useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { createCheckoutSession, formatPrice } from '@/lib/commerce-client';

function CheckoutPreparationPage() {
  // MANDATORY: Extract SKU ID from URL params
  const { skuId } = useParams();
  const location = useLocation();
  const product = location.state?.product;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleContinueToPayment = async () => {
    setLoading(true);
    setError('');

    // IMPORTANT: Use preview URL from environment variable
    // DO NOT use window.location - it will be localhost
    const previewUrl = import.meta.env.VITE_PREVIEW_URL || 'https://dummy.godaddy.com';

    // MANDATORY: Pass SKU ID to backend API (POST.ts)
    // NO email required - customer enters email in GoDaddy checkout flow
    const result = await createCheckoutSession({
      skuId: skuId!, // This SKU ID is sent to POST.ts
      quantity: 1,
      returnUrl: `${previewUrl}/checkout/${skuId}`,
      successUrl: `${previewUrl}/checkout/success`,
    });

    if (result.success && result.checkoutUrl) {
      // Redirect to GoDaddy Commerce checkout
      window.location.href = result.checkoutUrl;
    } else {
      setError(result.error || 'Failed to create checkout session');
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Complete Your Purchase</h1>
      {product && (
        <div>
          <h2>{product.title}</h2>
          {/* MANDATORY: SKU ID must be visible in the UI AND sent to POST.ts */}
          <p>
            <strong>SKU:</strong> {product.skuId || skuId}
          </p>
          <p>{formatPrice(product.price, product.currencyCode)}</p>
        </div>
      )}

      <button onClick={handleContinueToPayment} disabled={loading}>
        {loading ? 'Processing...' : 'Continue to Payment'}
      </button>

      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
```

### 3. Success Page

**Purpose:** Confirm successful purchase

**Route:** `/checkout/success`

**Implementation Steps:**

1. Display thank you message
2. Confirm that payment was successful
3. Display order confirmation text
4. Provide link to return to product listings or home page

**Example Code Pattern:**

```tsx
function CheckoutSuccessPage() {
  return (
    <div>
      <h1>Thank You for Your Purchase!</h1>
      <p>Your order has been successfully processed.</p>
      <p>You will receive a confirmation email shortly.</p>
      <a href="/products">Continue Shopping</a>
    </div>
  );
}
```

## Backend API Route

**CRITICAL:** The checkout session creation MUST happen on the backend for security.

### MANDATORY IMPLEMENTATION STEPS

**YOU MUST FOLLOW THESE EXACT STEPS:**

**Step 1: Copy POST.ts Template**

Copy the backend API route template:

1. Use `readFile` tool to read: `app-templates/v8/src/server/api/commerce/create-checkout-session/POST.ts`
2. Use `fileEdit` tool with `mode: 'create'` and the exact content to write to: `src/server/api/commerce/create-checkout-session/POST.ts`

**Note:** This file is protected by the file-edit tool's immutability feature, so it won't be accidentally modified later. It implements OAuth token retrieval and GraphQL mutations for creating checkout sessions

**What the backend route does:**

- Validates request body (skuId, quantity, returnUrl, successUrl)
- Transforms localhost URLs to public domain for Commerce API compatibility
- Retrieves OAuth access token using client credentials flow
- Executes GraphQL mutation to create checkout session with:
  - Environment: "dev"
  - Store configuration (storeId, storeName, channelId)
  - Checkout options (payment methods, billing address collection, etc.)
  - Line items (skuId and quantity)
  - Redirect URLs (returnUrl, successUrl)
- Returns checkout session ID and URL to frontend

## Summary: Files to Create

When implementing commerce checkout, you need to create these files:

1. **`src/server/api/commerce/create-checkout-session/POST.ts`** - Backend API route (copy from template)
2. **`src/lib/commerce-client.ts`** - Frontend helper (copy from template)
3. **Frontend pages** - Product listing, checkout, success pages

**Commerce Credentials:** The POST.ts file reads OAuth credentials from `/alloc/config.json`, which is automatically populated by the platform when OAuth setup completes. The config.json structure includes:

```json
{
  "DATABASE": { ... },
  "COMMERCE": {
    "CLIENT_ID": "...",
    "CLIENT_SECRET": "...",
    "STORE_ID": "...",
    "GODADDY_API_BASE_URL": "https://api.dev-godaddy.com",
    "CHECKOUT_API_BASE_URL": "https://checkout.commerce.api.dev-godaddy.com",
    "CHANNEL_ID": "web"
  }
}
```

**IMPORTANT:**

- DO NOT manually create or edit `/alloc/config.json` - the platform manages this file
- Simply copy POST.ts from the template exactly as-is - it already knows how to read from config.json

## Security Best Practices

1. **Never expose credentials client-side:** API keys and secrets stay in backend
2. **Always use backend API routes:** Client calls `/api/commerce/create-checkout-session`, not external APIs directly
3. **Validate inputs:** Email, SKU ID, quantity on both frontend and backend
4. **Handle errors gracefully:** Display user-friendly error messages

## Commerce Agent Handoff

When user requests product listings with checkout:

1. **First:** Handoff to Commerce Agent to fetch product data

   ```typescript
   // Commerce Agent fetches products
   const products = await getProducts();
   ```

2. **Then:** Generate the three-page checkout flow described above

3. **Commerce Agent responsibilities:**
   - Fetch product catalog
   - Return product data (SKU, title, description, price)
   - Hand off to you for HTML/UI generation

4. **Your responsibilities:**
   - Generate product listing UI
   - Generate checkout preparation page
   - Generate success page
   - Generate backend API route (or copy reference implementation)
   - Configure routing

## Example User Request & Response

**User:** "Create a store page where users can view products and buy them"

**Your Response:**

1. Trigger Commerce Agent handoff: "Fetching products from Commerce API..."
2. Receive product data from Commerce Agent
3. Generate product listing page with products
4. Generate `/checkout/:skuId` preparation page
5. Generate `/checkout/success` page
6. Copy backend API route to `src/server/api/commerce/create-checkout-session/POST.ts` (use readFile from template + fileEdit create with exact content)
7. Add routes to router configuration
8. Confirm to user: "Created product store with checkout flow. Customers can browse products and purchase them securely through GoDaddy Commerce."

## Common Patterns

### ⚠️ MANDATORY: Displaying SKU IDs in UI

**CRITICAL REQUIREMENT:** Every product display MUST show the SKU ID visibly in the UI. This applies to:

- Product listing pages
- Product detail pages
- Checkout preparation pages
- Order confirmation displays

**Example:**

```tsx
<div className="product">
  <h3>{product.title}</h3>
  {/* MANDATORY - SKU ID must be visible */}
  <p className="sku-id">
    <strong>SKU:</strong> {product.skuId}
  </p>
  <p>{product.description}</p>
  <p>{formatPrice(product.price, product.currencyCode)}</p>
</div>
```

### Displaying Products in a Grid

```tsx
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  {products.map((product) => (
    <ProductCard key={product.skuId} product={product} />
  ))}
</div>
```

### Loading States

```tsx
const [loading, setLoading] = useState(false);

{
  loading && <p>Processing your order...</p>;
}
```

### Error Handling

```tsx
const [error, setError] = useState<string | null>(null);

{
  error && (
    <div className="error">
      <p>{error}</p>
    </div>
  );
}
```

## Testing the Flow

After implementation, users can test:

1. Navigate to product listing page → see products **with visible SKU IDs**
2. Click "Buy Now" → navigate to checkout page **showing SKU ID**
3. Enter email → click "Continue to Payment"
4. Redirected to `https://checkout.dev-godaddy.com/c/...`
5. Complete payment (or cancel)
6. Return to success page

## Key Reminders

- **⚠️ MANDATORY:** ALL product displays MUST show SKU IDs visibly in the UI
- Commerce Agent only fetches products, never renders HTML
- You (Develop Agent) generate all UI components and routes
- Checkout session creation happens in backend API route
- Customer is redirected to GoDaddy's hosted checkout page
- Success page URL is configured in checkout session creation
