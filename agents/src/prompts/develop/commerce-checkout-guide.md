# Commerce Checkout Implementation Guide (commerce-checkout-guide.md)

## Overview

When implementing commerce checkout, rely on the pre-installed `POST.ts` file in `src/server/api/commerce/create-checkout-session/`. This file is included in the app template and is protected by the file-edit tool's immutability feature. DO NOT attempt to modify it.

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
// Read preview URL with fallback chain
const previewUrl =
  import.meta.env.VITE_PREVIEW_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'https://placeholder.godaddy.com');
const returnUrl = `${previewUrl}/checkout`;
const successUrl = `${previewUrl}/checkout/success`;
```

**IMPORTANT:**

- The `.env` file should contain the actual preview URL with app-id and port when available
- Fallback to `window.location.origin` if VITE_PREVIEW_URL is not set
- Final fallback to `placeholder.godaddy.com` for server-side rendering

---

## Overview

When users request e-commerce functionality with product listings and checkout, you need to implement a complete checkout flow using the GoDaddy Commerce API integration.

## Commerce Terminology

You must understand the specific terminology used in the GoDaddy Commerce platform:

- **SKU Group**: Equivalent to a "Product" in other systems. This is the presentational grouping of items (e.g., "T-Shirt").
- **SKU**: Equivalent to a "Variant" in other systems. This is the actual purchasable unit with specific attributes (e.g., "T-Shirt - Black/Small").

When users ask for "products", they are typically referring to **SKU Groups**. When managing inventory or prices, you are dealing with **SKUs**.

**CRITICAL: Checkout operations ALWAYS require SKU IDs, not SKU Group IDs.** You cannot checkout with a SKU Group ID.

## When to Implement Commerce Checkout

Trigger commerce checkout implementation when:

- ✅ User asks to "add checkout", "enable purchases", "allow customers to buy"
- ✅ User mentions "shopping cart", "buy button", "payment", "checkout flow"
- ✅ User wants to "sell products", "accept payments", "process orders"
- ✅ User requests "product page with buy now button"

## Implementation Flows

You will implement one of two flows based on the instructions from the Commerce Agent.

### Flow A: Storefront Components (Full Store)

**Use this when building a catalog/store with `@godaddy/react`.**

You must implement the following components using these exact patterns.

#### 1. Provider Setup (Root Layout)

Wrap your application or store routes in `GoDaddyProvider`. This is typically done in `src/app/layout.tsx`.

```tsx
'use client';
import { GoDaddyProvider } from '@godaddy/react';
import { QueryClient } from '@tanstack/react-query';
import '@godaddy/react/styles.css'; // MUST come after globals.css

export function StoreProviders({
  children,
  queryClient,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
}) {
  // Use values passed by Commerce Agent. If not available, use process.env or placeholders.
  const storeId = 'REPLACE_WITH_STORE_ID';
  const channelId = 'REPLACE_WITH_CHANNEL_ID';
  const clientId = 'REPLACE_WITH_CLIENT_ID';
  const apiHost = 'REPLACE_WITH_API_HOST'; // e.g. api.commerce.godaddy.com (no https://)

  return (
    <GoDaddyProvider
      queryClient={queryClient}
      storeId={storeId}
      clientId={clientId}
      channelId={channelId}
      apiHost={apiHost}
    >
      {children}
    </GoDaddyProvider>
  );
}
```

#### 2. Cart & Layout Integration

The `Cart` component manages the shopping bag and checkout.

```tsx
'use client';
import { Cart } from '@godaddy/react';
import { useState } from 'react';

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  const [isCartOpen, setIsCartOpen] = useState(false);

  // CRITICAL: Use this exact checkout handler pattern
  // IMPORTANT: Fallback chain for preview URL (Commerce API rejects localhost with 403 errors)
  const handleCheckout = async (cartItems: Array<{ skuId: string; quantity: number }>) => {
    const previewUrl =
      import.meta.env.VITE_PREVIEW_URL ||
      (typeof window !== 'undefined' ? window.location.origin : 'https://placeholder.godaddy.com');
    const response = await fetch('/api/commerce/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: 'YOUR_STORE_ID', // From Commerce Agent handoff
        lineItems: cartItems,
        returnUrl: `${previewUrl}/checkout/success`,
        successUrl: `${previewUrl}/checkout/success`,
      }),
    });
    const result = await response.json();
    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl;
    }
  };

  return (
    <>
      <header className="p-4 flex justify-end">
        <button onClick={() => setIsCartOpen(true)} className="p-2 bg-primary text-white rounded">
          Cart
        </button>
      </header>
      <main>{children}</main>
      <Cart open={isCartOpen} onOpenChange={setIsCartOpen} onCheckout={handleCheckout} />
    </>
  );
}
```

#### 3. Product Grid (Catalog Page)

Displays the full catalog automatically. Create `src/app/shop/page.tsx`:

```tsx
'use client';
import { ProductGrid } from '@godaddy/react';

export default function CatalogPage() {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Our Products</h1>
      <ProductGrid
        getProductHref={(id) => `/shop/product/${id}`}
        onAddToCartSuccess={() => console.log('Added to cart')}
      />
    </div>
  );
}
```

#### 4. Product Details (Single Product Page)

Displays a single product with variant selectors. Create `src/app/shop/product/[id]/page.tsx`:

```tsx
'use client';
import { ProductDetails } from '@godaddy/react';

export default function ProductPage({ params }: { params: { id: string } }) {
  return (
    <div className="container mx-auto p-4">
      <ProductDetails
        productId={params.id}
        onAddToCartSuccess={() => console.log('Added to cart')}
      />
    </div>
  );
}
```

### Flow B: Manual Implementation (Payment Flow)

**Use this for single items, donations, or simple "Buy Now" buttons.**

## Required Flow: Three Pages (For Manual Implementation)

**⚠️ CRITICAL - USE ACTUAL COMMERCE DATA ⚠️**
**⚠️ CRITICAL - USE SKU IDs FOR CHECKOUT ⚠️**

When implementing product listings with Commerce, you MUST use the **actual product data** returned by the Commerce Agent.

**REQUIRED:**

- Use exact SKU IDs (NOT SKU Group IDs) for all checkout operations
- Use exact prices, titles, and descriptions from Commerce Agent handoff response
- Use exact `storeId` and `channelId` from Commerce Agent handoff response
- It's OK to include this data directly in the source code (hardcoding is acceptable for now)
- Verify that SKU IDs match the format returned by Commerce API (e.g., '019a97f4-5e10-7111-b33f-ac2928ef9413')

**FORBIDDEN:**

- ❌ DO NOT use SKU Group IDs for checkout
- ❌ DO NOT make up or invent SKU IDs (e.g., 'abc123', 'prod-001')
- ❌ DO NOT make up prices, titles, or descriptions
- ❌ DO NOT use placeholder data

**Why This Matters:**

- Checkout will FAIL if you use a SKU Group ID instead of a SKU ID
- Checkout will FAIL if SKU IDs don't match actual Commerce products
- Made-up data breaks the entire commerce integration
- Only actual Commerce data will work with the checkout session creation

---

### 1. Product Listing Page

**Purpose:** Display products with purchase buttons

**⚠️ CRITICAL - SKU ID:** The `skuId` field returned by the Commerce Agent's searchSkuGroups or skuGroup tool is the ONLY valid SKU ID to use for checkout. This is the `product.skus[0].id` (Variant ID) from the tool response, NOT `product.id` (SKU Group ID). DO NOT use any other ID field (like `code`, `groupId`, etc.).

**Implementation Steps:**

1. Trigger Commerce Agent handoff to fetch product data
2. Create a product listing page component
3. Display each product with:
   - Product image (if available)
   - Title
   - Description
   - Price (formatted using `formatPrice` from `@/lib/commerce-client`)
   - "Buy Now" or "Add to Cart" button
4. On button click, navigate to checkout preparation page with **product.skus[0].id**

**Example Code Pattern:**

```tsx
import { formatPrice, type CommerceProduct } from '@/lib/commerce-client';

function ProductCard({ product }: { product: CommerceProduct }) {
  const navigate = useNavigate();

  const handleBuyClick = () => {
    navigate(`/checkout/${product.skus[0].id}`, {
      state: { product },
    });
  };

  return (
    <div>
      <h3>{product.title}</h3>
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

**⚠️ MANDATORY API REQUIREMENT:** The SKU ID MUST be sent to the backend POST.ts endpoint via `createCheckoutSession` in the `lineItems` array.

**Implementation Steps:**

1. Extract SKU ID from URL params: `const { skuId } = useParams();`
2. Display selected product details (from navigation state or fetch by SKU)
3. Show product name, **SKU ID (MANDATORY - visible in UI)**, and price
4. "Continue to Payment" button
5. On button click:
   - Call `createCheckoutSession` from `@/lib/commerce-client`
   - **MUST pass `lineItems` array** with SKU IDs and quantities
   - **NEVER pass the SKU Group ID** (product.id)
   - **MUST pass Store ID**: `storeId` (from Commerce Agent handoff)
   - Pass returnUrl, successUrl (NO email required)
   - Optionally pass checkout config options (storeName, enableShipping, etc.)
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

    // IMPORTANT: Fallback chain for preview URL (Commerce API rejects localhost with 403 errors)
    const previewUrl =
      import.meta.env.VITE_PREVIEW_URL ||
      (typeof window !== 'undefined' ? window.location.origin : 'https://placeholder.godaddy.com');

    // MANDATORY: Pass lineItems array with SKU IDs
    // NO email required - customer enters email in GoDaddy checkout flow
    const result = await createCheckoutSession({
      storeId: 'YOUR_STORE_ID', // Hardcode from Commerce Agent response
      lineItems: [{ skuId: skuId!, quantity: 1 }],
      returnUrl: `${previewUrl}/checkout/${skuId}`,
      successUrl: `${previewUrl}/checkout/success`,
      // Optional checkout configuration:
      // storeName: 'My Store',
      // enableShipping: true,
      // enableTaxCollection: true,
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

**Step 1: Verify Backend Route Exists**

The backend API route is already provided in the app template.

1. Verify existence of: `src/server/api/commerce/create-checkout-session/POST.ts`
2. **DO NOT MODIFY THIS FILE.** It is immutable.

**What the backend route does:**

- Validates request body (storeId, lineItems, returnUrl, successUrl)
- Transforms localhost URLs to public domain for Commerce API compatibility
- Retrieves OAuth access token using client credentials flow
- Executes GraphQL mutation to create checkout session with:
  - Environment: "dev"
  - Store configuration (storeId, storeName)
  - Checkout options (enableShipping, enableTaxCollection, payment methods, etc.)
  - Line items array (each with skuId and quantity)
  - Redirect URLs (returnUrl, successUrl)
- Returns checkout session ID and URL to frontend

**Request body format:**

```json
{
  "storeId": "store-123",
  "lineItems": [
    { "skuId": "sku-abc", "quantity": 1 },
    { "skuId": "sku-xyz", "quantity": 2 }
  ],
  "returnUrl": "http://example.com/checkout",
  "successUrl": "http://example.com/checkout/success",
  "storeName": "My Store",
  "enableShipping": false,
  "enableTaxCollection": false
}
```

**Optional checkout configuration fields:**

- `storeName` - Display name for the store
- `enableShipping` - Enable shipping options (default: false)
- `enableLocalPickup` - Enable local pickup (default: false)
- `enableBillingAddressCollection` - Collect billing address (default: true)
- `enableShippingAddressCollection` - Collect shipping address (default: false)
- `enablePhoneCollection` - Collect phone number (default: false)
- `enableTaxCollection` - Enable tax calculation (default: false)
- `enablePaymentMethodCollection` - Enable payment methods (default: true)

## Summary: Files to Create

When implementing commerce checkout, you need to create these files:

1. **`src/server/api/commerce/create-checkout-session/POST.ts`** - Backend API route (already exists - DO NOT MODIFY)
2. **`src/lib/commerce-client.ts`** - Frontend helper (already exists - DO NOT MODIFY)
3. **Frontend pages** - Product listing, checkout, success pages

**Commerce Credentials:** The POST.ts file reads OAuth credentials from `/alloc/config.json` and `GODADDY_API_BASE_URL` from environment variables. The config.json structure includes:

```json
{
  "GODADDY_OAUTH_CLIENT_ID": {
    "SYSTEM_MANAGED": true,
    "VALUE": "..."
  },
  "GODADDY_OAUTH_CLIENT_SECRET": {
    "SYSTEM_MANAGED": true,
    "VALUE": "..."
  }
}
```

**Environment Variables (required):**

- `GODADDY_API_BASE_URL`: GoDaddy API base URL (e.g., `https://api.dev-godaddy.com`)

**IMPORTANT:**

- DO NOT manually create or edit `/alloc/config.json` - the platform manages this file
- Ensure `GODADDY_API_BASE_URL` is set in the environment
- Simply use the existing `POST.ts` - it already knows how to read from config.json and environment variables

## Security Best Practices

1. **Never expose credentials client-side:** API keys and secrets stay in backend
2. **Always use backend API routes:** Client calls `/api/commerce/create-checkout-session`, not external APIs directly
3. **Validate inputs:** Email, SKU ID, quantity on both frontend and backend
4. **Handle errors gracefully:** Display user-friendly error messages

## Commerce Agent Handoff

When user requests product listings with checkout:

1. **First:** Handoff to Commerce Agent. Commerce agent has the appropriate tools to setup the commerce integration, search proudcts, or perform any other operations on products.

2. **Then:** Generate the three-page checkout flow described above

3. **Commerce Agent responsibilities:**
   - Fetch product catalog
   - Return product data (SKU, title, description, price)
   - Return store configuration (storeId, channelId)
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
6. Verify backend API route exists at `src/server/api/commerce/create-checkout-session/POST.ts` (do not modify)
7. Add routes to router configuration
8. Confirm to user: "Created product store with checkout flow. Customers can browse products and purchase them securely through GoDaddy Commerce."

## Common Patterns

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
  loading ? <p>Processing your order...</p> : <p>Pay now</p>;
}
```

### Error Handling

```tsx
const [error, setError] = useState<string | null>(null);

{
  error ? (
    <div className="error">
      <p>{error}</p>
    </div>
  ) : null;
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

- Commerce Agent only fetches products, never renders HTML
- You (Develop Agent) generate all UI components and routes
- Checkout session creation happens in backend API route
- Customer is redirected to GoDaddy's hosted checkout page
- Success page URL is configured in checkout session creation
