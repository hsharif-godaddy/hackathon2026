---
name: stripe
description: Add Stripe payment integration for one-time purchases and subscriptions. When platform provisioning is enabled for the shopper, Airo provisions a Stripe sandbox automatically; otherwise the user supplies their own Stripe keys.
whenToUse: Loaded by the payment router when the user explicitly requests Stripe.
enablementId: stripe
dependencies:
  - stripe@^20.2.0
skill-deps:
  i18n:
    templates: true
    instructions: false
    overwrite: false
---

# Stripe Payment Integration

## 🔀 First: which flow are you in?

**Call `stripe__setup()` without arguments first — its response tells you which flow to use:**

- **Returns `sandboxId` → Auto-provisioned flow.** Keys are auto-provisioned into the app; **never** call `requestSecrets` for any `STRIPE_*` key. MCP catalog tools (`stripe__create_product`, `stripe__list_products`, etc.) are available for product setup.
- **Returns `{ autoProvisionedFlow: true, needsInputs: true }` → Auto-provisioned, but needs country.** Ask the user for their country (e.g. "US"), then call `stripe__setup({ country })` again.
- **Returns `{ autoProvisioningUnavailable: true }` → Manual key flow.** Platform provisioning is not enabled for this shopper. Collect their Stripe keys via `requestSecrets`.

Both flows install the **same** checkout templates; only key acquisition (Step 1) and product registration (Step 4) differ.

## ⚠️ ABSOLUTE RULES (both flows)

1. **NEVER print/log API keys**
2. **NEVER call the Stripe API directly with `STRIPE_SECRET_KEY`** from the agent — no `terminalCommand`, no `node -e`, no curl. That key is for the customer app's runtime only, not for agent-initiated operations.
3. **NEVER probe endpoints or narrate HTTP status codes to the user.** Do not run ad-hoc checks against the app's API routes (`/api/stripe/*`) and do not report raw results like "401 is expected since it requires auth context" or "the endpoint is responding." Describe state in user terms — "Your checkout flow is ready to test" — never protocol details.
4. **ALWAYS add View Details button** — every product card MUST have it
5. **ALWAYS add Detail Modal** — required for all apps
6. **ALWAYS add Cart** — required for all apps (uses `/cart` page)

## ⚠️ ABSOLUTE RULES (Auto-provisioned flow only — when `stripe__setup` returned `sandboxId`)

7. **NEVER call `requestSecrets` for any `STRIPE_*` key** — keys are already in the env, pushed by `stripe__setup`. Calling `requestSecrets` here is always wrong.
8. **Use `stripe__*` MCP tools for all agent-initiated Stripe writes** (create_product, create_price, etc.) — never terminal scripts.

---

## Quick Decision

| Has product/pricing page? | Action                                                      |
| ------------------------- | ----------------------------------------------------------- |
| **YES**                   | ENHANCE existing page (add checkout + View Details + modal) |
| **NO**                    | USE Products.tsx template                                   |

---

**⚠️ FOLLOW STEPS IN EXACT ORDER — do not skip or reorder steps.**

## Step 1: Get Stripe keys into the app

### Auto-provisioned branch (`stripe__setup` returned `sandboxId`)

```typescript
// Step 1a: call without inputs to determine flow
const probe = await stripe__setup({});
// If probe.autoProvisionedFlow + probe.needsInputs → ask user for country, then:
const sandbox = await stripe__setup({ country });
```

- If the user already provided country in their message, pass it directly — skip the probe call.
- `stripe__setup` is server-side idempotent on `appId`: re-calling returns the same sandbox + same `claimUrl`. Safe to retry if the user lost the URL.

**The sandbox is immediately usable for testing.** Test-mode keys power the full Stripe API surface — Hosted Checkout, Embedded Checkout, Elements, products/prices, subscriptions — in test mode. End-to-end purchase flows work against Stripe's test card numbers (e.g. `4242 4242 4242 4242`) without the user touching the claim URL.

**The `claimUrl` is for going live, not for unlocking testing.** It opens Stripe's hosted claim flow where the user takes ownership and can later convert to live (real-money) mode. Save-for-later breadcrumb.

**Do NOT sequence the next step as "claim first, then I'll integrate."** That mischaracterizes Stripe's flow. Treat the sandbox as ready; treat the claim URL as a bookmark for later.

Sample framing for the chat reply after `stripe__setup` succeeds:

> Your Stripe sandbox is ready. You can build and test payment flows with Stripe's test cards (e.g. `4242 4242 4242 4242`) right now.
> Save this URL for when you're ready to take real payments — you'll claim the sandbox here: \<claimUrl>
> Setting up the checkout pages now.

**🛑 At this point the runtime keys are already in the env.** `stripe__setup` pushes `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_MCP_KEY` into the alloc env via hosting before it returns. **Do NOT** call `requestSecrets` for any Stripe key. Proceed directly to Step 2 (install templates).

### Sandbox + claim-link expiry (auto-provisioned flow)

Stripe enforces two clocks on a claimable sandbox; the response from `stripe__setup` and `stripe__status` carries both as RFC3339 strings:

- **`expiresAt` — sandbox hard-expiry, ~60 days from creation.** Stripe deletes the sandbox if the user never claims it. Stripe also emails the user at day 53 (7 days before expiry). Mention this proactively only when there are ≤14 days left — earlier mentions are noise. Sample: "Your Stripe sandbox expires on \<date>; if you want to take real payments you'll need to complete the claim at \<claimUrl> before then."
- **`claimUrlExpiresAt` — onboarding-link expiry, ~7 days from creation/last refresh.** The platform auto-renews the URL when you re-call `stripe__setup` on an existing sandbox. **If the user reports "the claim link doesn't work" or "Stripe says my link expired"**, call `stripe__setup({})` (no inputs) — it will return a freshly minted `claimUrl` you can hand back. If the user clicked the expired link before returning to Airo, Stripe redirects them back to the main Airo page — they just need to open a chat and ask for a new link.
- **Don't act on `undefined` for either field.** Sandboxes provisioned before this schema landed have neither — treat as "unknown, no warning needed."

### MCP-tool access ends 7 days after claim

The `STRIPE_MCP_KEY` Stripe issues with the sandbox is valid until **7 days after the user *claims* the sandbox** (or until they complete the full claim+install→live transition, whichever comes first). After that, MCP tools (`stripe__create_product`, `stripe__list_products`, etc.) will start returning 401 errors.

- The happy path is fast: claim → install → live in one session, and at that point the platform deletes `STRIPE_MCP_KEY` deliberately (MCP is sandbox-only) and the agent directs the user to the Stripe dashboard for product management.
- The hazardous window is **claimed-but-not-installed for >7 days**: the merchant clicked the claim link, completed identity verification, but never finished installing the GoDaddy app in their live account. MCP tool calls will start 401-ing.
- **If a `stripe__*` MCP call fails with an auth/key error** (the tool surfaces a structured `{ error: 'stripe_mcp_key_expired' }` response), tell the user: "Your Stripe authentication has expired. Please finish setting up your live account at \<claimUrl> — once that's complete I can manage products again." Do **not** retry the MCP call until the user confirms.

### Graceful degradation

If `stripe__setup` returns `{stripeProvisioningUnavailable: true}` with a `message`, the upstream Stripe API is unavailable — usually because the platform Stripe API isn't enabled for this project yet. Tell the user the literal `message`. **Do not** retry within the same conversation; suggest they try again later.

### Manual key branch (`stripe__setup` returned `autoProvisioningUnavailable: true`)

Collect the user's own Stripe keys — this is the only flow where `requestSecrets` for Stripe keys is correct:

```typescript
requestSecrets({
  title: 'Stripe API Keys',
  description: 'Get your keys from dashboard.stripe.com/apikeys. Use test keys (sk_test_, pk_test_) for now.',
  secrets: [
    { name: 'STRIPE_SECRET_KEY', required: true },
    { name: 'STRIPE_PUBLISHABLE_KEY', required: true },
  ],
  mode: 'add',
});
```

**🛑 MANDATORY STOP — wait for the user to confirm they saved the keys**, then continue to Step 2. Everything after Step 1 is identical to the Auto-provisioned branch — the checkout templates read `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` from the env regardless of how they got there.

---

## Step 2: Install Templates

```typescript
const result = await skill({ action: 'install', skill: 'payment/stripe' });
```

**Installs:**

- API routes: `server/api/stripe/create-checkout-session/POST.ts`, `server/api/stripe/session/[sessionId]/GET.ts`
- Pages: `pages/Products.tsx`, `pages/cart.tsx`, `pages/checkout/success.tsx`, `pages/checkout/cancel.tsx`
- Contexts: `contexts/cart-context.tsx`, `contexts/use-cart.ts`
- Library: `lib/stripe/format.ts` (browser-safe) + `lib/stripe/stripe.ts` (server SDK helper, legacy flow)
- Manual key scripts: `scripts/stripe-register-products.ts`, `scripts/stripe-list-products.ts` — used only in the Manual key flow (Step 4); harmless/unused in Auto-provisioned mode.
- **i18n dependencies** (automatic via skill-deps)

**⚠️ Templates use `t('stripe.*')` — you MUST add translations in Step 3.**

Templates read `STRIPE_SECRET_KEY` (server-only) and `STRIPE_PUBLISHABLE_KEY` (client) from the alloc env via `getSecret`. Those values are present from Step 1 — auto-provisioned or supplied by the user via `requestSecrets` (Legacy).

---

## Step 3: Add i18n Translations (MANDATORY)

**Stripe templates use `t('stripe.*')` for all UI text.**

### Configure i18n (Already Installed)

**i18n was installed in Step 2** (check `skillDependenciesInstalled: ["i18n"]`).

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

**Above is English** — translate all values to match each locale file's language.

---

## Step 4: Populate Products

**Both flows end the same way: edit the embedded `PRODUCTS` array in `src/pages/Products.tsx`.** Only *how you obtain* each product's `priceId` differs:

- **Auto-provisioned:** use the MCP tools (`stripe__create_product` / `stripe__create_price` / `stripe__list_products`) — Option 1/2 below.
- **Manual key (no MCP tools):** register via the bundled scripts instead — see "Manual key: register via scripts" at the end of this step — then paste the returned `priceId`s into `PRODUCTS` exactly as below.

When the sandbox is provisioned and the agent has `STRIPE_MCP_KEY` in its environment, Stripe MCP tools auto-load: `stripe__create_product`, `stripe__create_price`, `stripe__list_products`, etc. Check your active tool list — if those tools are present, use them directly for all Stripe writes.

**🛑 MANDATORY — ask the user how to set up products:**

> "How should I set up products?
>
> 1. **Register new products** → I'll create products and prices in your Stripe sandbox.
> 2. **Use existing Stripe products** → I'll list what's already in your sandbox."

**🛑 Mandatory STOP — wait for answer.**

### Option 1: Register new products

For each product the user names, call `stripe__create_product` then `stripe__create_price`. For subscriptions, set `recurring: { interval: 'month' }` (or `'year'`, etc.) on the price.

**🚨 PRICE FORMAT:** prices use the smallest currency unit (cents for USD, yen as integer for JPY, etc.). MCP tool inputs document the expected shape — follow them. The customer-app's `formatPrice` helper handles display conversion.

**✅ RECOMMENDED: Skip images in Stripe registration.** Keep the app's existing product images (any URL — local, relative, data URL). Use Stripe only for checkout via `priceId`.

After each successful create, **edit `src/pages/Products.tsx`** and append to the embedded `PRODUCTS` array. **Match the `Product` interface declared at the top of the file exactly** — the runtime accesses `product.images[0]` and `product.amount`, so wrong field names will break the page even with loose typing:

```tsx
const PRODUCTS: Product[] = [
  // ... existing entries ...
  {
    id: 'prod_xxx',                                    // Stripe product ID returned by stripe__create_product
    priceId: 'price_xxx',                              // Stripe price ID returned by stripe__create_price
    name: 'Pro Plan',
    description: 'Full access to all features',         // string | null
    images: ['/images/pro.png'],                        // string[] — array, even if empty: []
    amount: 2999,                                       // smallest currency unit (cents for USD)
    currency: 'usd',
    recurring: { interval: 'month', intervalCount: 1 }, // {...} | null — null for one-time payment
  },
];
```

Field-name pitfalls: it's `id` (not omitted), `images` (array, not `image`), `amount` (not `price`), and `recurring` requires both `interval` and `intervalCount` (or the whole field set to `null`). Do **not** add a runtime fetch from Stripe — products are read from the embedded constant for static-export compatibility and to avoid a Stripe round-trip on first paint.

**Show progress after each registration:**

```
✅ Registered: Starter Plan
✅ Registered: Pro Plan
✅ Registered: Enterprise
```

**🚫 Do NOT show priceIds to the user** — they're internal and meaningless to merchants.

### Option 2: Use existing products

Call the list-shape MCP tool (e.g. `stripe__list_products` — verify the exact name in your tool list). Map each returned product to the `Product` interface declared at the top of `pages/Products.tsx` and embed it into the `PRODUCTS` array — same field names as Option 1 (`id`, `priceId`, `name`, `description`, `images: string[]`, `amount` (smallest currency unit), `currency`, `recurring: { interval, intervalCount } | null`). Use the price value Stripe returns, not any user-typed value.

### Manual key: register via scripts (`stripe__*` MCP tools absent)

When provisioning isn't enabled there are no MCP tools. Register products with the bundled script — **one product per invocation**:

```bash
cd /app && npx tsx src/scripts/stripe-register-products.ts '{"name":"Pro Plan","description":"...","price":29.99,"currency":"usd"}'
# subscriptions: add recurring
cd /app && npx tsx src/scripts/stripe-register-products.ts '{"name":"Monthly","price":9.99,"currency":"usd","recurring":{"interval":"month"}}'
```

**🚨 PRICE FORMAT for the script:** pass the price **as displayed** (`29.99`, not `2999`) — the script converts to the smallest unit. Each call returns `{ product: { priceId, price, currency } }` where `price` is in the smallest unit. To list what's already in the account, run `npx tsx src/scripts/stripe-list-products.ts`. Then edit `src/pages/Products.tsx` and append to `PRODUCTS` using the **same `Product` interface as Option 1** (`id`, `priceId`, `images: string[]`, `amount` = the returned smallest-unit `price`, `currency`, `recurring`).

---

## Step 5: Set Up Pages

### Option A: NO existing page → Use Products.tsx

The installed `Products.tsx` already includes View Details, Detail Modal, and a cart-aware Buy/Subscribe button. Set:

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
4. **DO NOT create new cart if one exists** → enhance existing cart with Stripe checkout
5. **DO NOT create new checkout if one exists** → wire Stripe to the existing checkout button
6. ONLY ADD: priceId, Stripe checkout calls, View Details button, Detail Modal

**⚠️ BEFORE adding cart/checkout, CHECK if app already has:**

- Cart icon/button → wire it to link to `/cart`
- "Checkout" button → add Stripe checkout call to the existing button
- Cart page → enhance it, don't create a duplicate

**Add routes:**

```tsx
{ path: '/cart', element: <CartPage /> },
{ path: '/checkout/success', element: <CheckoutSuccess /> },
{ path: '/checkout/cancel', element: <CheckoutCancel /> },
```

**Map priceId to existing products (keep app's images):**

```tsx
const products = existingProducts.map((p) => ({ ...p, priceId: stripePriceIds[p.name] }));
```

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

**⚠️ Style to match existing buttons. Keep responsive — must NOT overflow the card.**

**🔴 VERIFY: Search for "View Details" in the file. If not found, you missed it!**

#### B4. Add Buy/Subscribe Button

```tsx
<button onClick={() => handleCheckout(product.priceId)}>Buy Now</button>
```

#### B5. Add Detail Modal (at end of component)

**Import `formatPrice` from `@/lib/stripe/format` only.** Do NOT import from `@/lib/stripe/stripe` — that path pulls Node deps into the browser bundle.

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
        {selectedProduct.images[0] && (
          <img src={selectedProduct.images[0]} className="w-full h-48 object-cover rounded-lg mb-4" />
        )}
        <p className="text-gray-600 mb-4">{selectedProduct.description}</p>
        <p className="text-3xl font-bold mb-6">
          {formatPrice(selectedProduct.amount, selectedProduct.currency)}
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

**If YES — full cart exists:**

- Find existing checkout button → add Stripe checkout call
- Keep existing UI, don't create duplicates
- **STILL ADD** success/cancel routes

**If PARTIAL — cart icon exists but no cart page:**

- Keep existing cart icon, wire it to `<Link to="/cart">`
- Use installed `cart.tsx` page
- Wrap app with `<CartProvider>`

**If NO — no cart at all:**

- Use installed `cart-context.tsx` for state
- Wrap app with `<CartProvider>`
- Add cart icon to header linking to `/cart`

---

### 🚨 CRITICAL: CartProvider Order

**Error if wrong:** `"useCart must be used within a CartProvider"`

**🔴 MANDATORY: add CartProvider to App.tsx FIRST, before using `useCart()` anywhere.**

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
- [ ] Cart icon in header (links to `/cart`)

---

## Testing

**Tell user:** "Open preview in a new tab. Test card: `4242 4242 4242 4242`."

---

## Reference: when MCP tools are absent

If only `stripe__setup` and `stripe__status` show in your tool list (no create/list/etc.):

1. If sandbox isn't provisioned yet, call `stripe__setup` first.
2. If it is and MCP tools are still missing, tell the user the Stripe MCP tools aren't available in this session and ask them to start a new conversation. The agent process picks up `STRIPE_MCP_KEY` on restart and `onLoad` will re-fetch the tools.
3. **Do NOT** attempt to create products, prices, or any Stripe objects via terminal commands, `node -e` scripts, or curl. Wait for the user.
4. **MCP tools are sandbox-only.** When `stripe__status` returns `claimStatus: 'live'`, the MCP product/price tools are no longer available — the account has moved to live mode and MCP access has been removed to keep the live account secure. If the user asks to create or manage products/prices in live mode, guide them to their Stripe Dashboard: `https://dashboard.stripe.com/products`. The checkout integration continues to work normally; only agent-initiated product creation via MCP is unavailable.

## Reference: status and idempotency

- **`stripe__setup`** — idempotent on `appId`. Re-running returns the same sandbox + claim URL. Safe if the user lost the URL.
- **`stripe__status`** — read-only. Returns `{hasStripe: false}` when no sandbox, or `{hasStripe: true, sandboxId, claimStatus, liveAccountId?}`. `claimStatus` advances `provisioned` → `claimed` → `live`.
