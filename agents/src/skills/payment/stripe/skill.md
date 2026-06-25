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

First time setup is a multi-step process. Make sure to follow all steps in their entirety during first time setup.

## 🔀 First: which flow are you in?

Call `stripe__setup()` with no arguments first; the response shape tells you which mode:

- **`{ mode: "managed", sandboxId, ... }`** → Managed mode (auto-provisioned sandbox).
- **`{ autoProvisionedFlow: true, needsInputs: true }`** → Ask the user for country, then call `stripe__setup({ country })` again. Proceed to Step 2.
- **`{ mode: "legacy", message }`** → Legacy mode (pre-existing user-pasted keys). Surface `message`, skip the rest of Step 1, proceed to Step 2.

Both modes install the **same** checkout templates; only key handling (Step 1) and product registration (Step 4) differ. Read **Concepts** below before responding to any state, status, or go-live question — those replies must come from the definitions there, not from prior assumptions about how Stripe normally works.

---

## Concepts

These definitions ground every reply about the integration. If the user asks "is it live?", "will it accept real payments?", or "how do I go live?", answer from this section.

### Sandbox

A **sandbox** is a real Stripe account running in test mode, provisioned on the user's behalf by GoDaddy. The full Stripe API surface works against test card numbers (e.g. `4242 4242 4242 4242`) — Hosted Checkout, Embedded Checkout, Elements, products, prices, subscriptions — but no real money moves. The sandbox hard-expires ~60 days after creation if it is never claimed; Stripe permanently deletes it (all products, prices, payment history) and emails the user at day 53.

`stripe__setup` pushes two keys into the alloc env before returning, both `*_test_*`:

- **`STRIPE_SECRET_KEY`** (`sk_test_*`) — server-side runtime key used by the customer app. The agent never calls Stripe with it directly; product registration goes through the bundled `stripe-register-products.ts` script which reads this key from the env (Step 4).
- **`STRIPE_PUBLISHABLE_KEY`** (`pk_test_*`) — client-side key used by Stripe.js / Elements.

### Test mode vs live mode

These are Stripe-native terms:

- **Test mode** — the sandbox runs in test mode. Test card numbers only; no real money; full API surface.
- **Live mode** — real-money payments using **live keys** (`sk_live_*`, `pk_live_*`). Live keys are provisioned **only by the platform**, never collected from the user. There is no "switch to live keys" the user does manually in the Stripe dashboard.

The integration flips from test to live when the user (1) claims the sandbox **and** (2) installs the GoDaddy app in their live Stripe account. Stripe webhooks notify the platform, which writes the live keys into the alloc env. Both steps are required — claiming alone does not enable real payments.

### `claimUrl`

A Stripe-hosted onboarding URL (Stripe-side: `onboarding_link_details.url`) that walks the user through the two-step go-live flow: claim the sandbox (links it to a new or existing Stripe account), then install the GoDaddy app in their live account (which is what triggers live-key provisioning). Returned by `stripe__setup` and `stripe__status`. The link expires ~7 days after issue; calling `stripe__setup({})` on an existing sandbox returns a freshly minted URL.

The link is **stateful** — Stripe redirects the user to whichever step they have not yet completed. If the user already claimed but never installed the GoDaddy app, clicking the same URL drops them at the install step. Re-handing them the URL is the right move regardless of where they left off.

The `claimUrl` is the only way for the user to ever accept real money on the site, and the only way to prevent sandbox deletion at the 60-day mark. It is not a dashboard link, not a settings page, not a support URL.

### `claimStatus` (the sandbox state machine)

`stripe__status` returns `claimStatus`, advancing through three values. (Stripe's underlying field is `status`; our tool renames `unclaimed` → `provisioned` and otherwise mirrors Stripe's values.) The tool also returns a derived `realPaymentsEnabled` boolean — true only at `live` — which is the direct answer to "is the site accepting real money?". For any status or "is it live?" question, call `stripe__status` first and answer from the row that matches `claimStatus`:

| `claimStatus` | Keys in the production alloc env                                | Real payments on production site? | Next step the user owes                                                       |
| ------------- | --------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `provisioned` | Test keys (`sk_test_*`, `pk_test_*`)                            | **No — test mode only**           | Open `claimUrl` and complete claim + install in Stripe.                       |
| `claimed`     | Still test keys (claim alone does not change anything in the env) | **No — still test mode**          | Open `claimUrl` again and complete the **Install the GoDaddy app** step inside Stripe. That single action is what flips the integration to live. |
| `live`        | **Live keys** in both preview and publish variants: `STRIPE_SECRET_KEY = sk_live_*`, `STRIPE_PUBLISHABLE_KEY = pk_live_*`. | **Yes — real payments are enabled** | Nothing in this app. The bundled product script keeps working against the live key, but for ongoing product management direct the user to `https://dashboard.stripe.com`. |

#### How the live transition actually happens

When the user installs the GoDaddy app in their live Stripe account, Stripe sends a webhook to `stripe-service`. The service then:

1. Calls Stripe's `apiKeys.create` on the user's live account to mint `sk_live_*` and `pk_live_*`.
2. Upserts `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` with the live values into hosting via `UpdateSecrets` — to **both** the `preview` and `publish` variants, so post-publish auto-sync of non-system-managed secrets doesn't clobber the live values.
3. Advances the sandbox row to `claim_status = live` in `stripe-service`'s DDB.

After this, every customer-facing environment of the app — preview and published — runs on live keys and accepts real payments. There is no env in this app that is still on test keys; if the user wants to test with `4242 4242 4242 4242` after going live, they have to use Stripe's test-mode dashboard or a separate test integration, not Airo's preview.

#### Misconceptions to override (the LLM has wrong priors here)

These are things that are true in standard Stripe integrations but **not in this platform-managed flow**. Do not propose them, do not echo them back, do not hedge:

- ❌ "Activate your Stripe account at `dashboard.stripe.com` to enable live payments." — There is no separate "activation" step beyond the claim + install flow Stripe walks the user through via `claimUrl`. Activation, if any, is captured inside that flow.
- ❌ "Toggle off Test mode in the dashboard and grab your live keys." — Live keys are minted by `stripe-service` automatically and pushed into the env on the install webhook. The user never copies a key, and there is no dashboard step where they should.
- ❌ "Let me pull up the secrets form so you can paste in your live keys." — Never. `requestSecrets` is wrong here regardless of how the user phrases it.
- ❌ "The site is still in sandbox/test mode" when `claimStatus === 'live'`. — At `live`, the published site is on live keys. The word "sandbox" refers to a Stripe object that has now reached terminal state; it no longer governs the runtime keys.
- ❌ Treating `claimed` as "almost live" / "live except for keys." — `claimed` is fully test mode. The single thing that flips it is the GoDaddy-app install inside Stripe — not anything the user does on `dashboard.stripe.com` and not anything the user pastes into Airo.

### Modes (`managed` vs `legacy`)

- **`managed`** — Default for new apps. Auto-provisioned sandbox with `sk_test_*` and `pk_test_*` in the env. Going live is platform-managed via the `claimUrl` flow above.
- **`legacy`** — Pre-existing integration where the user pasted their own Stripe keys before auto-provisioning existed. No sandbox; `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` are already in the env from the user's earlier paste. Going live is the user's own concern (their keys, their Stripe account); this skill does not orchestrate it.

Product registration uses the same bundled `stripe-register-products.ts` script in both modes (Step 4) — the script reads `STRIPE_SECRET_KEY` from the env, which resolves to whichever key is current for the state.

---

## ⚠️ Absolute Rules

The Concepts section is the source of truth; these are the few mechanical bans where getting it wrong is most damaging.

1. **NEVER print or log API keys.**
2. **NEVER call the Stripe API directly with `STRIPE_SECRET_KEY` from the agent** — no `terminalCommand`, no `node -e`, no curl. That key is for the customer app's runtime only.
3. **NEVER probe `/api/stripe/*` endpoints or narrate HTTP status codes to the user.** Describe state in user terms ("Your checkout flow is ready to test"), never protocol details.
4. **Inside the `stripe__setup` flow, NEVER call `requestSecrets` for any `STRIPE_*` key.** Managed mode populates them via `stripe__setup`; legacy mode reuses keys the user already pasted. Key rotation outside this flow is a separate concern — for legacy users `requestSecrets` is the right tool; for managed users direct them to `dashboard.stripe.com`.
5. **For agent-initiated Stripe writes, use the bundled `stripe-register-products.ts` script (Step 4).** It works in both managed and legacy modes and on both test and live keys. Don't call the Stripe API any other way from the agent.
6. **In managed mode, ALWAYS include `claimUrl` in your reply after `stripe__setup` succeeds.** Without it the user cannot reach live mode and the sandbox is deleted if never claimed. If the user reports the link is missing or expired, re-call `stripe__setup({})` to mint a fresh one — never refer them to support.
7. **ALWAYS add View Details button on every product card, Detail Modal at the end of the component, and Cart (uses `/cart` page).**

---

## Quick Decision

| Has product/pricing page? | Action                                                      |
| ------------------------- | ----------------------------------------------------------- |
| **YES**                   | ENHANCE existing page (add checkout + View Details + modal) |
| **NO**                    | USE Products.tsx template                                   |

---

**⚠️ FOLLOW STEPS IN EXACT ORDER AND COMPLETE ALL STEPS — do not skip or reorder steps.**

## Step 1: Provision the Stripe sandbox (or detect legacy mode)

```typescript
// Step 1a: call without inputs to determine flow
const probe = await stripe__setup({});
// If probe.autoProvisionedFlow + probe.needsInputs → ask user for country, then:
const sandbox = await stripe__setup({ country });
```

- If the user already provided country in their message, pass it directly — skip the probe call.
- `stripe__setup` is server-side idempotent on `appId`: re-calling returns the same sandbox and a fresh `claimUrl`. Safe to retry.
- **Legacy response (`{ mode: 'legacy', message }`)** — surface `message` to the user, skip the rest of this step, and proceed to Step 2 (`skill install` is idempotent).

After managed-mode setup succeeds, the two sandbox keys (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`) are already in the alloc env. Your reply must include the `claimUrl` (Rule 6); a workable template:

> Your Stripe sandbox is ready. You can build and test payment flows with Stripe's test cards (e.g. `4242 4242 4242 4242`) right now.
>
> When you're ready to accept real payments, you'll need to claim this sandbox — save this URL:
> \<claimUrl>
>
> Claiming is how you connect it to your own Stripe account and go live. The sandbox expires in ~60 days if unclaimed, so keep this link handy.
>
> Setting up the checkout pages now.

### Recovery: expired claim link

If the user reports the claim link doesn't work or Stripe says it expired, call `stripe__setup({})` (no inputs) — it returns a freshly minted `claimUrl`. The platform auto-renews on re-call.

### Recovery: expiry warnings

`stripe__setup` / `stripe__status` carry `expiresAt` (sandbox hard-expiry, ~60 days) and `claimUrlExpiresAt` (~7 days) as RFC3339 strings. Surface `expiresAt` proactively only when there are ≤14 days left — earlier is noise. Treat `undefined` for either field as "unknown, no warning needed" (pre-schema sandboxes).

### Graceful degradation

If `stripe__setup` returns `{ stripeProvisioningUnavailable: true }` with a `message`, the upstream Stripe API isn't enabled for this project. Tell the user the literal `message` and don't retry in the same conversation.

---

## Step 2: Install Templates

```typescript
const result = await skill({ action: 'install', skill: 'payment/stripe' });
```

**Installs:**

- API routes: `server/api/stripe/create-checkout-session/POST.ts`, `server/api/stripe/session/[sessionId]/GET.ts`
- Pages: `pages/Products.tsx`, `pages/cart.tsx`, `pages/checkout/success.tsx`, `pages/checkout/cancel.tsx`
- Contexts: `contexts/cart-context.tsx`, `contexts/use-cart.ts`
- Analytics: `lib/analytics/track.ts`, `lib/analytics/funnel-session.ts`, `lib/analytics/checkout.ts` — commerce-funnel instrumentation. `startTrackedCheckout()` (from `checkout.ts`) is the single source of truth for the checkout flow + events; the page templates call it, and so must any hand-enhanced page (Step 5 Option B).
- Library: `lib/stripe/format.ts` (browser-safe) + `lib/stripe/stripe.ts` (server SDK helper, used by legacy mode)
- Product scripts: `scripts/stripe-register-products.ts`, `scripts/stripe-list-products.ts` — the product-registration path for both managed and legacy modes (Step 4). Both read `STRIPE_SECRET_KEY` from the env.
- **i18n dependencies** (automatic via skill-deps)

**⚠️ Templates use `t('stripe.*')` — you MUST add translations in Step 3.**

Templates read `STRIPE_SECRET_KEY` (server-only) and `STRIPE_PUBLISHABLE_KEY` (client) from the alloc env via `getSecret`. Those values are present from Step 1 — pushed by `stripe__setup` in auto-provisioned mode, or already in the env from the user's pre-existing paste in legacy mode.

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

Both modes — managed and legacy — register products the same way: run the bundled `stripe-register-products.ts` script, then edit the embedded `PRODUCTS` array in `src/pages/Products.tsx` with the values it returns. The script reads `STRIPE_SECRET_KEY` from the env, so it works whether that key is `sk_test_*` (provisioned / claimed) or `sk_live_*` (live).

**🛑 MANDATORY — ask the user how to set up products:**

> "How should I set up products?
>
> 1. **Register new products** → I'll create products and prices in your Stripe account.
> 2. **Use existing Stripe products** → I'll list what's already there and wire them up."

**🛑 Mandatory STOP — wait for answer.**

### Option 1: Register new products

Invoke the script — **one product per invocation**:

```bash
cd /app && npx tsx src/scripts/stripe-register-products.ts '{"name":"Pro Plan","description":"Full access to all features","price":29.99,"currency":"usd"}'
# subscription: add recurring
cd /app && npx tsx src/scripts/stripe-register-products.ts '{"name":"Monthly","price":9.99,"currency":"usd","recurring":{"interval":"month"}}'
```

**🚨 PRICE FORMAT:** pass the price **as displayed** (`29.99`, not `2999`). The script converts to the smallest unit Stripe expects. Each call returns `{ product: { productId, priceId, name, price, currency, recurring? } }` where `price` is the smallest-unit integer (cents for USD, yen as integer for JPY, etc.). The customer-app's `formatPrice` helper handles display conversion.

**✅ RECOMMENDED: Skip images in Stripe registration.** Keep the app's existing product images (any URL — local, relative, data URL). Use Stripe only for checkout via `priceId`.

After each successful create, **edit `src/pages/Products.tsx`** and append to the embedded `PRODUCTS` array. **Match the `Product` interface declared at the top of the file exactly** — the runtime accesses `product.images[0]` and `product.amount`, so wrong field names will break the page even with loose typing:

```tsx
const PRODUCTS: Product[] = [
  // ... existing entries ...
  {
    id: 'prod_xxx',                                    // Stripe product ID returned by the script (productId field)
    priceId: 'price_xxx',                              // Stripe price ID returned by the script (priceId field)
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

### Option 2: Use existing Stripe products

List what's already in the account, then wire each entry into `PRODUCTS`:

```bash
cd /app && npx tsx src/scripts/stripe-list-products.ts
```

Map each returned product to the `Product` interface above. Use the price values Stripe returns (smallest-unit integer for `amount`), not any user-typed value.

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

**Call the installed `startTrackedCheckout()` helper — do NOT hand-write the `fetch`.** The helper fires the commerce-funnel events (`checkout_begin` → `checkout_redirect` / `checkout_error`), saves the funnel snapshot, and redirects to Stripe. Hand-writing the fetch would silently drop these events, so the enhanced page would not match the `Products.tsx` template (Option A).

```tsx
import { startTrackedCheckout } from '@/lib/analytics/checkout';

const handleCheckout = async (product: Product) => {
  const result = await startTrackedCheckout('products_buy_now', [{
    productId: product.id,
    name: product.name,
    priceId: product.priceId,
    amount: product.amount,   // smallest currency unit (e.g. 2999 = $29.99)
    currency: product.currency,
    quantity: 1,
  }]);
  if (!result.success) {
    // Surface result.error via the page's existing error state, e.g. setError(result.error).
  }
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
<button onClick={() => handleCheckout(product)}>Buy Now</button>
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
            handleCheckout(selectedProduct);
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

- Wire the existing checkout button to `startTrackedCheckout('cart', items)` — map each existing cart entry to `{ productId, name, priceId, amount (smallest currency unit), currency, quantity }`. Do NOT hand-write the fetch/track; the helper emits `checkout_begin`/`checkout_redirect`/`checkout_error` and redirects.
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

## Reference: Stripe Dashboard for live-mode product management

Once `claimStatus: 'live'`, the customer's real Stripe account is in the loop. The bundled `stripe-register-products.ts` script keeps working against the live key, but ongoing product management (price updates, deactivations, inventory, etc.) is usually easier in the user's own Stripe Dashboard: `https://dashboard.stripe.com/products`. The checkout integration continues to work normally regardless of where products are managed.

## Reference: status and idempotency

- **`stripe__setup`** — idempotent on `appId`. Re-running returns the same sandbox + claim URL. Safe if the user lost the URL.
- **`stripe__status`** — read-only. Returns `{hasStripe: false}` when no sandbox, or `{hasStripe: true, sandboxId, claimStatus, realPaymentsEnabled, liveAccountId?, expiresAt?, claimUrlExpiresAt?}`. `claimStatus` advances `provisioned` → `claimed` → `live`. `realPaymentsEnabled` is true only at `live`. `expiresAt` and `claimUrlExpiresAt` are only returned at `provisioned` (Stripe nulls `expires_at` on claim; neither field applies once the sandbox is live).
