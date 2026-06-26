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

First-time setup is a multi-step process. Complete every step in order — do not skip or reorder.

## First: which flow are you in?

Call `stripe__setup()` with no arguments first; the response shape tells you which mode:

- **`{ mode: "managed", sandboxId, ... }`** → Managed mode (auto-provisioned sandbox).
- **`{ autoProvisionedFlow: true, needsInputs: true }`** → Ask the user for country, then call `stripe__setup({ country })` again. Proceed to Step 2.
- **`{ mode: "legacy", message }`** → Legacy mode (pre-existing user-pasted keys). Surface `message`, skip the rest of Step 1, proceed to Step 2.

Both modes install the **same** checkout templates; only key handling (Step 1) and product registration (Step 4) differ.

**Before answering any state, status, or go-live question** ("is it live?", "will it accept real payments?", "how do I go live?"), read `references/concepts.md`. Those replies must come from the definitions there — the platform-managed go-live flow does not work the way standard Stripe integrations do, and the LLM's default priors about activation and live keys are wrong here.

---

## Absolute Rules

`references/concepts.md` is the source of truth for how the integration behaves. These are the mechanical bans where getting it wrong is most damaging:

1. Never print or log API keys.
2. Never call the Stripe API directly with `STRIPE_SECRET_KEY` from the agent — no `terminalCommand`, no `node -e`, no curl. That key is for the customer app's runtime only.
3. Never probe `/api/stripe/*` endpoints or narrate HTTP status codes. Describe state in user terms ("Your checkout flow is ready to test"), not protocol details.
4. Inside the `stripe__setup` flow, never call `requestSecrets` for any `STRIPE_*` key. Managed mode populates them via `stripe__setup`; legacy mode reuses keys the user already pasted. (Key rotation outside this flow is separate — for legacy users `requestSecrets` is correct; for managed users direct them to `dashboard.stripe.com`.)
5. For agent-initiated Stripe writes, use the bundled `stripe-register-products.ts` script (Step 4). It works in both modes and on both test and live keys. Don't call the Stripe API any other way.
6. In managed mode, always include `claimUrl` in your reply after `stripe__setup` succeeds. Without it the user cannot reach live mode and the sandbox is deleted if never claimed. If the link is missing or expired, re-call `stripe__setup({})` to mint a fresh one — never refer them to support.
7. Always add a View Details button on every product card, a Detail Modal at the end of the component, and a Cart (uses the `/cart` page).

---

## Quick Decision

| Has product/pricing page? | Action                                                      |
| ------------------------- | ----------------------------------------------------------- |
| **YES**                   | ENHANCE existing page (add checkout + View Details + modal) |
| **NO**                    | USE Products.tsx template                                   |

---

## Step 1: Provision the Stripe sandbox (or detect legacy mode)

```typescript
// Step 1a: call without inputs to determine flow
const probe = await stripe__setup({});
// If probe.autoProvisionedFlow + probe.needsInputs → ask user for country, then:
const sandbox = await stripe__setup({ country });
```

- If the user already provided country in their message, pass it directly — skip the probe call.
- `stripe__setup` is server-side idempotent on `appId`: re-calling returns the same sandbox and a fresh `claimUrl`. Safe to retry.
- **Legacy response (`{ mode: 'legacy', message }`)** — surface `message`, skip the rest of this step, and proceed to Step 2 (`skill install` is idempotent).

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
- Product scripts: `scripts/stripe-register-products.ts`, `scripts/stripe-list-products.ts` — the product-registration path for both modes (Step 4). Both read `STRIPE_SECRET_KEY` from the env.
- i18n dependencies (automatic via skill-deps)

Templates use `t('stripe.*')` for all UI text — you must add translations in Step 3.

Templates read `STRIPE_SECRET_KEY` (server-only) and `STRIPE_PUBLISHABLE_KEY` (client) from the alloc env via `getSecret`. Those values are present from Step 1 — pushed by `stripe__setup` in managed mode, or already in the env from the user's pre-existing paste in legacy mode.

---

## Step 3: Add i18n Translations (mandatory)

i18n was installed in Step 2 (check `skillDependenciesInstalled: ["i18n"]`), creating `src/lib/i18n/config.ts` and `src/lib/i18n/index.ts`.

The full 44-key English `stripe` namespace lives in `references/i18n-en.md`. Add it to the app's locale files, translating values to match each file's language.

**Case A: locale files already exist** (e.g., `en.json`, `es.json`, `ja.json`):

- Add the `stripe` namespace to **all** existing locale files, translated to each language.
- Verify `src/lib/i18n/index.ts` imports are added/uncommented.

**Case B: no locale files exist** (new i18n setup):

1. Detect the app language — scan 2-3 existing app pages (`.tsx` files in `src/`) and identify the primary language; default to `en` if unclear.
2. Configure i18n (files were created by skill-deps): in `src/lib/i18n/config.ts` set `defaultLanguage` and `supportedLanguages`. Initialize i18n on **both** render paths — add `import './lib/i18n';` to `src/main.tsx` (client) **and** `src/entry-server.tsx` (SSR). The template renders from two entry points; importing only `main.tsx` leaves the SSR pass rendering raw `stripe.*` keys and risks a hydration mismatch.
3. Create `src/locales/{lang}.json` with the `stripe` namespace from `references/i18n-en.md` (translated), then register it in `src/lib/i18n/index.ts` (uncomment/add the import and the resources entry).

---

## Step 4: Populate Products

Both modes register products the same way: run the bundled `stripe-register-products.ts` script, then edit the embedded `PRODUCTS` array in `src/pages/Products.tsx` with the values it returns. The script reads `STRIPE_SECRET_KEY` from the env, so it works whether that key is `sk_test_*` (provisioned / claimed) or `sk_live_*` (live).

**Ask the user how to set up products, then stop and wait for the answer:**

> "How should I set up products?
>
> 1. **Register new products** → I'll create products and prices in your Stripe account.
> 2. **Use existing Stripe products** → I'll list what's already there and wire them up."

### Option 1: Register new products

Invoke the script — one product per invocation:

```bash
cd /app && npx tsx src/scripts/stripe-register-products.ts '{"name":"Pro Plan","description":"Full access to all features","price":29.99,"currency":"usd"}'
# subscription: add recurring
cd /app && npx tsx src/scripts/stripe-register-products.ts '{"name":"Monthly","price":9.99,"currency":"usd","recurring":{"interval":"month"}}'
```

**Price format:** pass the price **as displayed** (`29.99`, not `2999`). The script converts to the smallest unit Stripe expects. Each call returns `{ product: { productId, priceId, name, price, currency, recurring? } }` where `price` is the smallest-unit integer (cents for USD, yen as integer for JPY, etc.). The customer app's `formatPrice` helper handles display conversion.

**Skip images in Stripe registration** (recommended). Keep the app's existing product images (any URL — local, relative, data URL). Use Stripe only for checkout via `priceId`.

After each successful create, edit `src/pages/Products.tsx` and append to the embedded `PRODUCTS` array. Match the `Product` interface declared at the top of the file exactly — the runtime accesses `product.images[0]` and `product.amount`, so wrong field names break the page even with loose typing:

```tsx
const PRODUCTS: Product[] = [
  // ... existing entries ...
  {
    id: 'prod_xxx',                                    // productId field returned by the script
    priceId: 'price_xxx',                              // priceId field returned by the script
    name: 'Pro Plan',
    description: 'Full access to all features',         // string | null
    images: ['/images/pro.png'],                        // string[] — array, even if empty: []
    amount: 2999,                                       // smallest currency unit (cents for USD)
    currency: 'usd',
    recurring: { interval: 'month', intervalCount: 1 }, // {...} | null — null for one-time payment
  },
];
```

Field-name pitfalls: it's `id` (not omitted), `images` (array, not `image`), `amount` (not `price`), and `recurring` requires both `interval` and `intervalCount` (or the whole field set to `null`). Do not add a runtime fetch from Stripe — products are read from the embedded constant for static-export compatibility and to avoid a Stripe round-trip on first paint.

Show progress after each registration, but **do not show priceIds to the user** — they're internal and meaningless to merchants:

```
✅ Registered: Starter Plan
✅ Registered: Pro Plan
✅ Registered: Enterprise
```

### Option 2: Use existing Stripe products

List what's already in the account, then wire each entry into `PRODUCTS`:

```bash
cd /app && npx tsx src/scripts/stripe-list-products.ts
```

Map each returned product to the `Product` interface above. Use the price values Stripe returns (smallest-unit integer for `amount`), not any user-typed value.

---

## Step 5: Set Up Pages

### Option A: NO existing page → use Products.tsx

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

### Option B: HAS existing page → enhance it

Do not rebuild the page — add Stripe checkout, View Details, and the Detail Modal to what's there, reusing any existing cart/checkout.

→ Read `references/enhance-existing-page.md` for the full enhancement steps (rules, routes, state, `startTrackedCheckout` wiring, View Details, Detail Modal, cart decision tree).

### CartProvider placement (both options)

The installed `Products.tsx` (and `cart.tsx`, `checkout/success.tsx`) call `useCart()`, which throws `"useCart must be used within a CartProvider"` unless the provider is an ancestor. The provider has to wrap **both** render paths.

The template renders from two entry points that build parallel route trees off the same `routes` + `RootLayout`: the client (`src/App.tsx`, `createBrowserRouter`) and SSR (`src/entry-server.tsx`, `createStaticHandler`). `entry-server.tsx` does **not** import `App.tsx`, so wrapping `App.tsx` alone fixes the client but lets the SSR pass throw the same error.

Wrap the shared layout `src/layouts/RootLayout.tsx` — it is rendered by both trees, so one wrap covers client, SSR, and the cart icon in the header:

```tsx
// src/layouts/RootLayout.tsx
import { CartProvider } from '@/contexts/cart-context';

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <CartProvider>
      <Website>{/* Helmet, ScrollRestoration, Header, {children}, Footer */}</Website>
    </CartProvider>
  );
}
```

`CartProvider` is SSR-safe — it touches `localStorage` only inside `useEffect` — so it renders cleanly on the server. If a given app has no shared layout, add the wrap to both `App.tsx` and `entry-server.tsx` instead.

### Cart icon (in header)

Add to the existing header (not fixed position). Always visible; badge only when items > 0.

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

## Step 6: Verify it renders

`npm run type-check` is necessary but **not sufficient** here — the two most common breakages are runtime, not type, errors, and type-check passes clean for both: a missing `CartProvider` (throws `useCart must be used within a CartProvider` when a cart page mounts) and unwired i18n (pages render raw `stripe.*` keys). Verify all four:

1. `cd /app && npm run type-check` passes — catches wrong `PRODUCTS` field names (Step 4) and bad imports (e.g. `formatPrice` path).
2. `CartProvider` wraps the shared layout (`RootLayout`), per Step 5 — not just `App.tsx`.
3. `import './lib/i18n';` is present in **both** `src/main.tsx` and `src/entry-server.tsx`, and `src/locales/<lang>.json` exists with the `stripe` namespace.
4. Load the products page in preview: confirm real text renders (e.g. "Our Products"), not `stripe.page_title`, and no error overlay appears.

Fix and re-verify until all four hold before telling the user to test.

---

## Checklist Before Done

For all apps (even when a cart already existed):

- [ ] Routes added: `/cart`, `/checkout/success`, `/checkout/cancel`
- [ ] View Details button on every card
- [ ] Detail Modal added at end of component
- [ ] handleCheckout function added
- [ ] Subscribe/Buy Now button on cards
- [ ] CartProvider wraps the shared layout (`RootLayout`) — covers client + SSR
- [ ] Add to Cart button on cards
- [ ] Cart icon in header (links to `/cart`)
- [ ] i18n initialized in **both** `main.tsx` and `entry-server.tsx`; `locales/<lang>.json` has the `stripe` namespace
- [ ] Step 6 verification passes (type-check + CartProvider + i18n + page renders real text)

---

## Testing

Tell the user: "Open preview in a new tab. Test card: `4242 4242 4242 4242`."

---

## Reference: Stripe Dashboard for live-mode product management

Once `claimStatus: 'live'`, the customer's real Stripe account is in the loop. The bundled `stripe-register-products.ts` script keeps working against the live key, but ongoing product management (price updates, deactivations, inventory) is usually easier in the user's own Stripe Dashboard: `https://dashboard.stripe.com/products`. The checkout integration continues to work regardless of where products are managed.

## Reference: status and idempotency

- **`stripe__setup`** — idempotent on `appId`. Re-running returns the same sandbox + claim URL. Safe if the user lost the URL.
- **`stripe__status`** — read-only. Returns `{hasStripe: false}` when no sandbox, or `{hasStripe: true, sandboxId, claimStatus, realPaymentsEnabled, liveAccountId?, expiresAt?, claimUrlExpiresAt?}`. `claimStatus` advances `provisioned` → `claimed` → `live`. `realPaymentsEnabled` is true only at `live`. `expiresAt` and `claimUrlExpiresAt` are only returned at `provisioned` (Stripe nulls `expires_at` on claim; neither field applies once the sandbox is live).
