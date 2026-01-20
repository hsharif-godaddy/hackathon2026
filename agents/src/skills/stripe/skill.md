---
name: stripe
description: Add Stripe payment integration for one-time purchases and subscriptions.
dependencies:
  - stripe@^17.4.0
---

# Stripe Payment Integration

## ⚠️ ABSOLUTE RULES

1. **NEVER print/log API keys**
2. **ALWAYS add View Details button** - Every card MUST have it
3. **ALWAYS add Detail Modal** - Required for all apps
4. **ALWAYS add Cart** - Required for all apps (uses /cart page)

---

## Pre-Check: Existing Commerce?

**🔴Always check If GoDaddy Commerce already integrated, ASK:**

> "This app already has GoDaddy Commerce. Do you want to:
>
> 1. **Replace with Stripe** → I'll remove GoDaddy Commerce routes and use Stripe
> 2. **Cancel** → Keep GoDaddy Commerce only"

**⚠️ Mandatory STOP - Wait for response**

---

## Quick Decision

| Has product/pricing page? | Action                                                      |
| ------------------------- | ----------------------------------------------------------- |
| **YES**                   | ENHANCE existing page (add checkout + View Details + modal) |
| **NO**                    | USE Products.tsx template                                   |

---

## Step 1: Install Templates FIRST

```typescript
skill({ action: 'install', skill: 'stripe' });
```

**Installs:** API routes, Products.tsx, cart.tsx (cart page), success/cancel pages, `cart-context.tsx` (shared cart state)

## Step 2: Request Keys

```typescript
requestSecrets({
  title: 'Stripe API Keys',
  description: 'Get from dashboard.stripe.com/apikeys',
  secrets: [
    { name: 'STRIPE_SECRET_KEY', required: true },
    { name: 'STRIPE_PUBLISHABLE_KEY', required: true },
  ],
  mode: 'add',
});
```

**⚠️ MANDATORY STOP - Wait for user to confirm they saved secrets**

## Step 3: Product Source (ASK USER)

**🛑 MANDATORY - Ask this question in chat. Do NOT skip:**

> "How should I set up products?
>
> 1. **Register app products** → I'll register your existing products with Stripe
> 2. **Use Stripe products** → Skip registration, use products already in your Stripe dashboard"

**🛑 MANDATORY STOP - Wait for answer. Do NOT skip:**

### Option 1: Register Products

**🔴 Use Preview URL from your dynamic context** (provided as "Preview URL: ...").

```bash
curl -X POST ${PREVIEW_URL}/api/stripe/register-product \
  -H "Content-Type: application/json" \
  -d '{"name":"Product","description":"...","price":2999,"currency":"inr"}' -k
```

Replace `${PREVIEW_URL}` with the actual Preview URL from your context.

**Required fields:** name, price, currency (same as app)
**Optional:** description, image (only if public HTTPS URL)

**✅ RECOMMENDED: Skip images in Stripe registration.** Keep app's existing product images - they work with any URL (local, relative, data URLs). Only use Stripe for checkout via `priceId`.

**Price conversion:** Standard currencies (USD, INR, EUR) → multiply by 100. Zero-decimal (JPY, KRW) → use as-is.

**🚫 DO NOT mention price conversion to user.**

**Show progress - EACH product on its OWN LINE (not comma-separated):**

```
✅ Registered: Starter Plan

✅ Registered: Pro Plan

✅ Registered: Enterprise
```

**❌ WRONG (all on one line):** "✅ Registered: Starter Plan, Pro Plan, Enterprise"
**✅ CORRECT:** Each "✅ Registered: X" on a separate line with blank line between

**Save priceIds internally for checkout buttons.**

**For subscriptions:** Add `"recurring":{"interval":"month"}`

### Option 2: Use Stripe Products

Skip registration - fetch from `/api/stripe/products`.

---

## Step 4: Set Up Pages

### Option A: NO existing page → Use Products.tsx

Already has View Details, Modal, Cart button linking to /cart. Set:

```tsx
const ENABLE_CART = true;
```

Add routes:

```tsx
{ path: '/products', element: <Products /> },
{ path: '/cart', element: <CartPage /> },
{ path: '/checkout/success', element: <CheckoutSuccess /> },
{ path: '/checkout/cancel', element: <CheckoutCancel /> },
```

### Option B: HAS existing page → ENHANCE IT

**🚨 CRITICAL RULES:**

1. DO NOT replace existing product data
2. DO NOT change/create product cards
3. DO NOT fetch from /api/stripe/products (unless user asks)
4. **DO NOT create new cart if one exists** → Enhance existing cart with Stripe checkout
5. **DO NOT create new checkout if one exists** → Add Stripe to existing checkout button
6. ONLY ADD: priceId, Stripe checkout calls, View Details, modal

**⚠️ BEFORE adding cart/checkout, CHECK if app already has:**

- Cart icon/button → Wire it to link to `/cart` page
- "Checkout" button → Add Stripe checkout call to existing button
- Cart page → Enhance it, don't create duplicate

**Add routes:**

```tsx
{ path: '/cart', element: <CartPage /> },
{ path: '/checkout/success', element: <CheckoutSuccess /> },
{ path: '/checkout/cancel', element: <CheckoutCancel /> },
```

**Map priceId to existing products (keep app's images):**

```tsx
// App's images stay as-is (local, relative, any URL) - only add priceId for checkout
const products = existingProducts.map((p) => ({ ...p, priceId: stripePriceIds[p.name] }));
```

---

### Option B: HAS existing product page → ENHANCE IT

**⚠️ YOU MUST ADD ALL OF THESE. DO NOT SKIP ANY:**

#### B1. Add State (REQUIRED)

```tsx
const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
const [isDialogOpen, setIsDialogOpen] = useState(false);
```

#### B2. Add Checkout Function

```tsx
const handleCheckout = async (priceId: string) => {
  const res = await fetch('/api/stripe/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priceId }),
  });
  const { url } = await res.json();
  if (url) window.location.href = url;
};
```

#### B3. Add VIEW DETAILS Button to EVERY Card (REQUIRED)

```tsx
<button
  onClick={() => {
    setSelectedProduct(product);
    setIsDialogOpen(true);
  }}
>
  View Details
</button>
```

**⚠️ Style to match existing buttons. Keep responsive - must NOT overflow the card.**

**🔴 VERIFY: Search for "View Details" in the file. If not found, you missed it!**

#### B4. Add Buy/Subscribe Button

```tsx
<button onClick={() => handleCheckout(product.priceId)}>Buy Now</button>
```

#### B5. Add Detail Modal (at end of component)

**Import `formatPrice`:** Use `@/lib/stripe/format` (NOT `stripe.ts` - breaks browser)

```tsx
import { formatPrice } from '@/lib/stripe/format';
```

```tsx
{
  isDialogOpen && selectedProduct && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto p-6">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-2xl font-bold">{selectedProduct.name}</h2>
          <button onClick={() => setIsDialogOpen(false)}>✕</button>
        </div>
        {selectedProduct.image && (
          <img src={selectedProduct.image} className="w-full h-48 object-cover rounded-lg mb-4" />
        )}
        <p className="text-gray-600 mb-4">{selectedProduct.description}</p>
        <p className="text-3xl font-bold mb-6">
          {formatPrice(selectedProduct.price, selectedProduct.currency)}
        </p>
        <button
          onClick={() => {
            setIsDialogOpen(false);
            handleCheckout(selectedProduct.priceId);
          }}
          className="w-full py-3 bg-blue-600 text-white rounded-lg"
        >
          {selectedProduct.recurring ? 'Subscribe Now' : 'Buy Now'}
        </button>
      </div>
    </div>
  );
}
```

#### B6. Cart (REQUIRED for all apps)

**⚠️ FIRST: Check if app already has cart functionality!**

**If YES - Full cart exists:**

- Find existing checkout button → Add Stripe checkout call
- Keep existing UI, don't create duplicates
- **STILL ADD** success/cancel routes

**If PARTIAL - Cart icon exists but no cart page:**

- Keep existing cart icon, wire it to `<Link to="/cart">`
- Use installed `cart.tsx` page
- Wrap app with `<CartProvider>`

**If NO - No cart at all:**

- Use installed `cart-context.tsx` for state
- Wrap app with `<CartProvider>`
- Add cart icon to header linking to `/cart`

---

### 🚨 CRITICAL: CartProvider Order

**Error if wrong:** `"useCart must be used within a CartProvider"`

**🔴 MANDATORY: Add CartProvider to App.tsx FIRST, before using useCart() anywhere.**

```tsx
// App.tsx - MUST BE DONE FIRST
import { CartProvider } from './contexts/cart-context';

function App() {
  return (
    <CartProvider>
      <Router>
        <Routes>...</Routes>
      </Router>
    </CartProvider>
  );
}
```

**Only AFTER CartProvider is in App.tsx:**

```tsx
// In header/pages - use the hook
import { useCart } from './contexts/cart-context';
const { cartCount, addToCart } = useCart();
```

---

### Cart Icon (in header)

**⚠️ Add to existing header (not fixed position). Always visible, badge only when items > 0.**

```tsx
import { Link } from 'react-router-dom';
import { useCart } from './contexts/cart-context';

const { cartCount } = useCart();

<Link to="/cart" className="ml-auto relative p-2">
  🛒
  {cartCount > 0 && (
    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
      {cartCount}
    </span>
  )}
</Link>;
```

---

## Checklist Before Done

**For ALL apps (even if existing cart):**

- [ ] **Routes added:** `/cart`, `/checkout/success`, `/checkout/cancel` ← REQUIRED
- [ ] View Details button on EVERY card
- [ ] Detail Modal added at end of component
- [ ] handleCheckout function added
- [ ] Subscribe/Buy Now button on cards
- [ ] CartProvider wrapping app in App.tsx
- [ ] Add to Cart button on cards
- [ ] Cart icon in header (links to /cart)

---

## Testing

**Tell user:** "Open preview in new tab. Test card: 4242 4242 4242 4242"
