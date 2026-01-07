# Commerce Integration

## When to Hand Off to Commerce Agent

**Hand off IMMEDIATELY when user mentions ANY of these:**

**Store/Shop**: "store", "shop", "commerce", "e-commerce", "sell", "online store"
**Products**: "products", "product catalog", "items for sale", "inventory"
**Onboarding**: "onboard", "create store", "setup commerce"
**Checkout**: "checkout", "buy button", "shopping cart", "payment", "purchase"

**Examples:**

- ✅ "Build a commerce site" → Hand off
- ✅ "I want to sell products" → Hand off
- ✅ "Show my products" → Hand off
- ✅ "Add checkout functionality" → Hand off

**You do NOT have commerce tools** - always use `handoff` tool to delegate to commerce agent.

## After Commerce Handoff Returns

When commerce agent hands back, **detect flow type from `FLOW_TYPE` header**:

### Flow A: Storefront Components (FLOW_TYPE: STOREFRONT_COMPONENTS)

**Use for full stores with product catalogs.**

#### 1. Setup Environment Variables

Add to `.env` file:

```bash
# Read GODADDY_OAUTH_CLIENT_ID from /alloc/config.json
# Read GODADDY_API_BASE_URL from .env, strip protocol
VITE_GODADDY_CLIENT_ID=<from-config.json>
VITE_GODADDY_API_HOST=<hostname-only-no-https>
VITE_PREVIEW_URL=http://[app-id].preview.dev-godaddy.com:[port]
```

#### 2. Install Dependencies

```bash
npm install @godaddy/react @godaddy/localizations @tanstack/react-query
```

#### 3. Create Providers Component

```tsx
'use client';
import { GoDaddyProvider } from '@godaddy/react';
import '@godaddy/react/styles-tailwind.css'; // After globals.css

export function StoreProviders({ children, queryClient }) {
  const storeId = 'FROM_HANDOFF_CONTEXT';
  const channelId = 'FROM_HANDOFF_CONTEXT';
  const clientId = import.meta.env.VITE_GODADDY_CLIENT_ID;
  const apiHost = import.meta.env.VITE_GODADDY_API_HOST;

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

#### 4. Cart Integration

**CRITICAL**: `onCheckout` receives `orderId: string`, use as `draftOrderId`:

```tsx
const handleCheckout = async (orderId: string) => {
  const previewUrl = import.meta.env.VITE_PREVIEW_URL || window.location.origin;
  const response = await fetch('/api/commerce/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storeId: 'FROM_HANDOFF',
      draftOrderId: orderId, // Use orderId as draftOrderId
      returnUrl: `${previewUrl}/checkout/success`,
      successUrl: `${previewUrl}/checkout/success`,
    }),
  });
  const result = await response.json();
  if (result.checkoutUrl) window.location.href = result.checkoutUrl;
};

<Cart open={isCartOpen} onOpenChange={setIsCartOpen} onCheckout={handleCheckout} />;
```

#### 5. Product Pages

```tsx
// Catalog page
import { ProductGrid } from '@godaddy/react';
<ProductGrid getProductHref={(id) => `/shop/product/${id}`} />;

// Product detail page
import { ProductDetails } from '@godaddy/react';
<ProductDetails productId={params.id} />;
```

### Flow B: Payment Flow (FLOW_TYPE: PAYMENT_SIMPLE)

**Use for simple buy buttons or single-item purchases.**

#### Required Pages

**1. Product Listing** - Display products with buy buttons
**2. Checkout Preparation** - `/checkout/:skuId` - Collect info and create session
**3. Success Page** - `/checkout/success` - Confirm purchase

#### Checkout Preparation Pattern

```tsx
import { useParams } from 'react-router-dom';

function CheckoutPage() {
  const { skuId } = useParams();

  const handleCheckout = async () => {
    const previewUrl = import.meta.env.VITE_PREVIEW_URL || window.location.origin;

    const response = await fetch('/api/commerce/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: 'FROM_HANDOFF',
        lineItems: [{ skuId: skuId!, quantity: 1 }],
        returnUrl: `${previewUrl}/checkout/${skuId}`,
        successUrl: `${previewUrl}/checkout/success`,
      }),
    });

    const result = await response.json();
    if (result.checkoutUrl) window.location.href = result.checkoutUrl;
  };

  return <button onClick={handleCheckout}>Continue to Payment</button>;
}
```

## Commerce Terminology

- **SKU Group** = Product (e.g., "T-Shirt")
- **SKU** = Variant (e.g., "T-Shirt - Black/Small")

**CRITICAL**: Checkout requires SKU IDs (variants), NOT SKU Group IDs (products).

## Backend API Route

The backend route is **pre-installed and immutable**:

- Location: `src/server/api/commerce/create-checkout-session/POST.ts`
- **DO NOT MODIFY** this file
- Reads credentials from `/alloc/config.json` and environment variables
- Handles OAuth token retrieval and checkout session creation

## Preview URL Requirement

**CRITICAL**: Commerce API rejects localhost URLs with 403 errors.

Always use preview URL fallback chain:

```typescript
const previewUrl =
  import.meta.env.VITE_PREVIEW_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'https://placeholder.godaddy.com');
```

Set `VITE_PREVIEW_URL` in `.env`:

```bash
VITE_PREVIEW_URL=http://[app-id].preview.dev-godaddy.com:[port]
```

## Key Rules

- Always hand off to commerce agent for any commerce functionality
- Use actual product data from commerce agent (never mock data)
- Use SKU IDs for checkout, not SKU Group IDs
- Backend POST.ts is immutable - don't modify it
- Preview URL is required - localhost will fail
- Credentials come from `/alloc/config.json` (system-managed)
