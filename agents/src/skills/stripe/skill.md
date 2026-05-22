---
name: stripe
description: Add Stripe payment integration for one-time purchases and subscriptions.
whenToUse: User explicitly mentions Stripe for payments. Phrases like "add Stripe", "Stripe checkout", "Stripe payments", "Stripe subscription". Only use this skill when the user specifically asks for Stripe — for general e-commerce requests, use the commerce skill instead.
enablementId: stripe
dependencies:
  - stripe@^20.2.0
skill-deps:
  i18n:
    templates: true
    instructions: false
    overwrite: false
intents:
  - Stripe (only when user explicitly says Stripe)
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

**⚠️ FOLLOW STEPS IN EXACT ORDER - Do not skip or reorder steps**

## Step 1: Install Templates

```typescript
const result = await skill({ action: 'install', skill: 'stripe' });
```

**Installs:**

- API routes, Products.tsx, cart.tsx, success/cancel pages, cart-context.tsx
- **i18n dependencies** (automatic via skill-deps)

**Result will include:**

```json
{
  "success": true,
  "filesInstalled": 15,
  "skillDependenciesInstalled": ["i18n"]
}
```

**⚠️ Templates use `t('stripe.*')` - you MUST add translations in Step 2!**

---

## Step 2: Add i18n Translations (MANDATORY)

**Stripe templates use `t('stripe.*')` for all UI text.**

### Configure i18n (Already Installed)

**i18n was installed in Step 1** (check `skillDependenciesInstalled: ["i18n"]`).

Files created:

- ✅ `src/lib/i18n/config.ts`
- ✅ `src/lib/i18n/index.ts`

### Add Stripe Translations

**Check if locale files exist in `src/locales/`:**

**Case A: Locale files ALREADY exist** (e.g., `en.json`, `es.json`, `ja.json`):

- i18n is already configured ✓
- **Add `stripe` namespace to ALL existing locale files**
- Translate keys to match each file's language
- Verify `src/lib/i18n/index.ts` imports are added/uncommented

**Case B: NO locale files exist** (new i18n setup):

1. **Detect app language:**
   - Scan 2-3 existing app pages (`.tsx` files in `src/`)
   - Identify primary language (e.g., `en`, `es`, `ja`, `fr`)
   - If unclear, default to `en` (English)

2. **Configure i18n** (files were created by skill-deps):
   - Update `src/lib/i18n/config.ts`:
     - Set `defaultLanguage` to detected language
     - Update `supportedLanguages` array
   - Add `import './lib/i18n';` to `src/main.tsx`

3. **Create locale file and register it:**
   - Create `src/locales/{detected-lang}.json` (e.g., `en.json` for English)
   - Add `stripe` namespace with translations in detected language
   - **Register in `src/lib/i18n/index.ts`**:
     - Uncomment/add import: `import en from '../../locales/en.json';` (match your language)
     - Uncomment/add to resources: `en: { translation: en },` (match your language)

#### Stripe Namespace Keys (43 total):

Add the `stripe` namespace with these keys to locale file(s):

```json
{
  "stripe": {
    "error_loading_products": "Error loading products",
    "no_products_title": "No Products Available",
    "no_products_message": "Check back later for new products.",
    "page_title": "Our Products",
    "page_subtitle": "Choose from our selection of products and services",
    "btn_view_details": "View Details",
    "btn_add_to_cart": "Add to Cart",
    "btn_subscribe": "Subscribe",
    "btn_buy_now": "Buy Now",
    "btn_processing": "Processing...",
    "btn_subscribe_now": "Subscribe Now",
    "modal_description_title": "Description",
    "badge_subscription": "Subscription",
    "link_continue_shopping": "Continue Shopping",
    "cart_title": "Shopping Cart",
    "item_singular": "item",
    "items_plural": "items",
    "empty_cart_title": "Your cart is empty",
    "empty_cart_message": "Add some items to get started!",
    "btn_browse_store": "Browse Store",
    "order_summary_title": "Order Summary",
    "subtotal_label": "Subtotal",
    "total_label": "Total",
    "btn_proceed_to_checkout": "Proceed to Checkout",
    "btn_clear_cart": "Clear Cart",
    "verifying_payment_title": "Verifying Payment...",
    "verifying_payment_message": "Please wait while we confirm your payment with Stripe.",
    "payment_failed_title": "Payment Verification Failed",
    "btn_try_again": "Try Again",
    "btn_return_home": "Return Home",
    "reference_label": "Reference",
    "payment_success_title": "Payment Successful!",
    "payment_success_message": "Thank you for your purchase. You will receive a confirmation email shortly.",
    "detail_name_label": "Name",
    "detail_total_label": "Total",
    "detail_status_label": "Status",
    "detail_status_verified": "Verified ✓",
    "btn_continue_shopping": "Continue Shopping",
    "order_reference_label": "Order reference",
    "payment_cancelled_title": "Payment Cancelled",
    "payment_cancelled_message": "Your payment was cancelled and no charges were made. Your cart items are still saved.",
    "btn_go_home": "Go Home",
    "need_help_text": "Need help?",
    "contact_support_link": "Contact support"
  }
}
```

**Above is English** - translate all values to match each locale file's language.

#### Examples:

**Example A** (existing locales - app already has `en.json`, `es.json`):

```bash
# Add stripe namespace to BOTH files:
src/locales/en.json  # Add with English translations
src/locales/es.json  # Add with Spanish translations
```

**Example B** (no existing locales - new i18n setup, detected Japanese app):

```bash
# Create ONE file only:
src/locales/ja.json  # Add with Japanese translations
```

---

## Step 3: Request Keys

```typescript
requestSecrets({
  title: 'Stripe API Key',
  description: 'Get your Secret Key from dashboard.stripe.com/apikeys',
  secrets: [{ name: 'STRIPE_SECRET_KEY', required: true }],
  mode: 'add',
});
```

**⚠️ MANDATORY STOP - Wait for user to confirm they saved secrets**

## Step 4: Product Source (ASK USER)

**🛑 MANDATORY - Ask this question in chat. Do NOT skip:**

> "How should I set up products?
>
> 1. **Register app products** → I'll register your existing products with Stripe
> 2. **Use Stripe products** → Skip registration, use products already in your Stripe dashboard"

**🛑 MANDATORY STOP - Wait for answer. Do NOT skip:**

### Option 1: Register Products

**🔴 Register ONE product at a time via terminal:**

```bash
cd /app && npx tsx src/scripts/stripe-register-products.ts '{"name":"Product Name","description":"...","price":29.99,"currency":"usd"}'
```

**For subscriptions, add recurring:**

```bash
cd /app && npx tsx src/scripts/stripe-register-products.ts '{"name":"Monthly Plan","price":9.99,"currency":"usd","recurring":{"interval":"month"}}'
```

**Required fields:** name, price, currency (same as app)
**Optional:** description, recurring (for subscriptions)

**✅ RECOMMENDED: Skip images in Stripe registration.** Keep app's existing product images - they work with any URL (local, relative, data URLs). Only use Stripe for checkout via `priceId`.

**🚨 PRICE FORMAT: Send actual price as displayed to customer (script handles conversion)**

- $8.99 → `8.99` ✅ | ¥2,980 → `2980` ✅ | ₹298.00 → `298` ✅
- ❌ NOT `899` for $8.99

**Each call returns JSON:**

```json
{
  "product": {
    "priceId": "price_xxx",
    "price": 2999, // ← Use this (in cents)
    "currency": "usd"
  }
}
```

**🔴 IMPORTANT: Run terminal for EACH product separately. Collect priceIds from each response.**

**Show progress after EACH registration:**

```
✅ Registered: Starter Plan

✅ Registered: Pro Plan

✅ Registered: Enterprise
```

**🚫 DO NOT show priceIds to user** - they're technical and meaningless to them.

**Save priceIds internally for checkout buttons.**

### Option 2: Use Stripe Products

**🔴 Run the list script via terminal:**

```bash
cd /app && npx tsx src/scripts/stripe-list-products.ts
```

**Returns JSON with products:**

```json
{
  "products": [{ "priceId": "price_xxx", "price": 2999, "currency": "usd" }]
}
```

**Use returned `price` values (in cents), NOT input values.** Embed in product arrays.

---

## Step 5: Set Up Pages

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
3. Use products embedded in code (not runtime API fetch)
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
