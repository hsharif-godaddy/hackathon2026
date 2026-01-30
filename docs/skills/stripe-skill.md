# Stripe Skill Documentation

## Overview

The Stripe skill enables payment integration for one-time purchases and subscriptions using Stripe Checkout.

## Features

- One-time payments and subscriptions
- Product catalog from Stripe
- Shopping cart with checkout (E-commerce)
- Order history lookup
- Multi-currency support (including zero-decimal currencies)

## Files Installed

| File                                         | Purpose                                          |
| -------------------------------------------- | ------------------------------------------------ |
| `api/stripe/create-checkout-session/POST.ts` | Creates Stripe hosted checkout sessions          |
| `stripe-list-products.ts`                    | Fetches products from Stripe                     |
| `stripe-register-products.ts`                | Registers app products with Stripe               |
| `api/stripe/session/[sessionId]/GET.ts`      | Retrieves checkout session details               |
| `lib/stripe/stripe.ts`                       | Utility functions (order history, subscriptions) |
| `pages/Products.tsx`                         | Product catalog with cart                        |
| `pages/checkout/success.tsx`                 | Post-payment success page                        |
| `pages/checkout/cancel.tsx`                  | Payment cancellation page                        |

## Data Flow Architecture

### 1. Product Registration Flow

```
┌─────────────────┐
│  Agent/User     │
└────────┬────────┘
         │
         │ POST /api/stripe/register-product
         │ { name, price, currency, recurring }
         ↓
┌─────────────────────────────────────────────┐
│  User App Server                            │
│  (register-product/POST.ts)                 │
│                                             │
│  1. Retrieves STRIPE_SECRET_KEY from        │
│     #airo/secrets (server-side only)        │
│  2. Creates Stripe SDK instance             │
│  3. Calls Stripe API                        │
└────────┬────────────────────────────────────┘
         │
         │ stripe.products.create()
         │ stripe.prices.create()
         ↓
┌─────────────────────────────────────────────┐
│  Stripe API (api.stripe.com)                │
│                                             │
│  - Validates API key                        │
│  - Creates product record                   │
│  - Creates price record                     │
│  - Links price to product                   │
└────────┬────────────────────────────────────┘
         │
         │ Returns: { productId, priceId }
         ↓
┌─────────────────┐
│  Agent/User     │
│  Product ready  │
└─────────────────┘
```

**Key Security Points:**
- Secret key never exposed to client
- All product creation happens server-side
- Stripe validates all requests against account

### 2. Product Display Flow

```
┌─────────────────┐
│  Browser        │
│  (Products.tsx) │
└────────┬────────┘
         │
         │ GET /api/stripe/products
         │ (No authentication required)
         ↓
┌─────────────────────────────────────────────┐
│  User App Server                            │
│  (products/GET.ts)                          │
│                                             │
│  1. Retrieves STRIPE_SECRET_KEY             │
│  2. Calls stripe.products.list()            │
│     - active: true                          │
│     - expand: ['data.default_price']        │
│     - limit: 100                            │
└────────┬────────────────────────────────────┘
         │
         │ stripe.products.list()
         ↓
┌─────────────────────────────────────────────┐
│  Stripe API                                 │
│  Returns: Products with prices              │
└────────┬────────────────────────────────────┘
         │
         │ JSON response
         ↓
┌─────────────────┐
│  Browser        │
│  Renders cards  │
└─────────────────┘
```

**Data Returned to Client:**
- Product ID, name, description, images
- Price ID, amount, currency
- Recurring interval (if subscription)
- **NOT returned:** Secret keys, customer data, payment methods

### 3. Checkout Flow (Core Payment Flow)

```
┌─────────────────┐
│  Browser        │
│  User clicks    │
│  "Buy Now"      │
└────────┬────────┘
         │
         │ POST /api/stripe/create-checkout-session
         │ {
         │   priceId: "price_xxx",
         │   successUrl: "https://app.com/checkout/success",
         │   cancelUrl: "https://app.com/checkout/cancel",
         │   quantity: 1,
         │   customerEmail: "user@example.com" (optional)
         │ }
         ↓
┌──────────────────────────────────────────────────┐
│  User App Server                                 │
│  (create-checkout-session/POST.ts)               │
│                                                  │
│  1. Validates request parameters                 │
│  2. Retrieves STRIPE_SECRET_KEY from secrets     │
│  3. Fetches price details from Stripe            │
│     - Determines mode (payment vs subscription)  │
│     - For carts: validates no mixed modes        │
│  4. Creates checkout session                     │
└────────┬─────────────────────────────────────────┘
         │
         │ stripe.checkout.sessions.create({
         │   line_items: [{ price, quantity }],
         │   mode: 'payment' | 'subscription',
         │   success_url: ...,
         │   cancel_url: ...,
         │   billing_address_collection: 'required',
         │   phone_number_collection: { enabled: true }
         │ })
         ↓
┌──────────────────────────────────────────────────┐
│  Stripe API                                      │
│                                                  │
│  - Creates checkout session                      │
│  - Returns hosted checkout URL                   │
│  - Session expires in 24 hours                   │
└────────┬─────────────────────────────────────────┘
         │
         │ { url: "https://checkout.stripe.com/c/pay/cs_xxx",
         │   sessionId: "cs_xxx" }
         ↓
┌─────────────────┐
│  Browser        │
│  Redirects to   │
│  checkout URL   │
└────────┬────────┘
         │
         │ User navigated to checkout.stripe.com
         ↓
┌──────────────────────────────────────────────────┐
│  Stripe Hosted Checkout (checkout.stripe.com)    │
│                                                  │
│  ✓ User enters payment information               │
│  ✓ Card data collected on Stripe's domain        │
│  ✓ PCI DSS compliant environment                 │
│  ✓ 3D Secure / SCA handled automatically         │
│  ✓ Payment processed securely                    │
└────────┬─────────────────────────────────────────┘
         │
         │ After payment completion/cancellation
         │
         ├─── Success ────────────────────────────┐
         │                                        │
         │ Redirect: successUrl?session_id=cs_xxx │
         ↓                                        ↓
┌─────────────────────────────────┐    ┌─────────────────┐
│  Browser                        │    │  Browser        │
│  checkout/success.tsx           │    │  checkout/      │
│                                 │    │  cancel.tsx     │
│  1. Extracts session_id from    │    │                 │
│     URL query param             │    │  Shows cancel   │
│  2. Calls GET /api/stripe/      │    │  message        │
│     session/[sessionId]         │    └─────────────────┘
│  3. Displays order confirmation │
│     with session details        │
└─────────────────────────────────┘
```

**Critical Security Boundaries:**
1. **Client → App Server**: Standard HTTPS, no sensitive data in requests
2. **App Server → Stripe API**: Authenticated with secret key over TLS
3. **Client → Stripe Checkout**: User redirected to Stripe's PCI-compliant domain
4. **Payment Data**: Never touches user's app infrastructure

### 4. Order History Flow

```
┌─────────────────┐
│  Browser        │
│  My Orders page │
└────────┬────────┘
         │
         │ Calls getOrderHistory(customerEmail)
         │ from lib/stripe/stripe.ts
         ↓
┌─────────────────────────────────────────────┐
│  User App Server                            │
│  (stripe.ts - getOrderHistory)              │
│                                             │
│  1. Look up customer by email               │
│     stripe.customers.list({ email })        │
│  2. Fetch sessions for that customer        │
│     stripe.checkout.sessions.list({         │
│       customer: customerId                  │
│     })                                      │
│  3. Filter to completed payments            │
└────────┬────────────────────────────────────┘
         │
         │ Returns order history
         ↓
┌─────────────────┐
│  Browser        │
│  Display orders │
└─────────────────┘
```

## Cart Behavior

### E-commerce Mode (`ENABLE_CART = true`)

- Add to Cart button on products
- Cart modal with quantity controls
- Cart persists in localStorage
- Checkout entire cart at once

### SaaS Mode (`ENABLE_CART = false`)

- Direct Subscribe/Buy Now buttons
- No cart functionality
- Single item checkout only

## Validations

| Validation          | Location                  | Error                                      |
| ------------------- | ------------------------- | ------------------------------------------ |
| Mixed payment modes | `create-checkout-session` | Cannot mix subscription and one-time items |
| Multi-currency cart | `Products.tsx`            | Cannot add items with different currencies |
| Missing API keys    | All API routes            | STRIPE_SECRET_KEY not configured           |

## Currency Handling

**Standard currencies** (USD, EUR, INR, GBP): Price in smallest unit (cents/paise)

- $29.99 → `2999`

**Zero-decimal currencies** (JPY, KRW, VND): Price as-is

- ¥1500 → `1500`

## Security Considerations

### PCI Compliance

This integration uses **Stripe Hosted Checkout** (Level 1):

- ✅ Credit card data collected exclusively on `checkout.stripe.com`
- ✅ Card data never touches user app servers or infrastructure
- ✅ **PCI SAQ-A compliance** (simplest questionnaire, ~20 questions)
- ✅ No card data in logs, databases, or memory
- ❌ No custom credit card input forms
- ❌ No CC data storage or transmission

**Compliance Level:** This implementation qualifies for PCI DSS SAQ-A, the lowest burden compliance path.

### API Key Management

| Key                      | Storage Location | Usage Scope      | Exposure Risk |
| ------------------------ | ---------------- | ---------------- | ------------- |
| `STRIPE_SECRET_KEY`      | `#airo/secrets`  | Server-side only | Never exposed |
| `STRIPE_PUBLISHABLE_KEY` | `#airo/secrets`  | Client-safe      | Public OK     |

**Secret Key Security:**
- Retrieved via `getSecret('STRIPE_SECRET_KEY')` from Airo secrets management
- Never logged, printed, or exposed in responses
- Not stored in code, environment files, or version control
- Only accessible to server-side API routes
- Transmitted to Stripe API over TLS 1.2+

**Publishable Key Security:**
- Safe for client-side use (designed by Stripe for public exposure)
- Cannot create charges or access sensitive data
- Only used for client-side Stripe.js operations (not implemented in this skill)

### Data Flow Security Boundaries

#### 1. Client-Side Security (Browser → User App)

**What's Sent:**
- Product IDs, Price IDs (public data)
- Success/cancel URLs (whitelisted in Stripe Dashboard)
- Customer email (optional, for pre-filling checkout form)
- Quantity (validated server-side)

**What's NOT Sent:**
- Payment information
- Credit card numbers
- Secret keys
- Customer IDs

**Transport:** HTTPS only

**Validation:** All inputs validated server-side before Stripe API calls

#### 2. Server-Side Security (User App → Stripe API)

**Authentication:**
- Bearer token authentication using `STRIPE_SECRET_KEY`
- TLS 1.2+ required
- Stripe SDK handles request signing

**Data Transmitted:**
- Product/price metadata
- Checkout session parameters
- Customer email (if provided)

**Data NOT Transmitted:**
- Payment card data (never enters user's infrastructure)

**Error Handling:**
- Generic error messages returned to client
- Detailed Stripe errors logged server-side only
- No secret key exposure in error responses

#### 3. Payment Collection (User → Stripe Checkout)

**Domain:** `checkout.stripe.com` (Stripe-controlled infrastructure)

**Security Features:**
- PCI DSS Level 1 certified environment
- 3D Secure / Strong Customer Authentication (SCA) automatic
- Fraud detection (Stripe Radar)
- Card data encrypted at rest and in transit
- Automatic CVV/postal code validation

**Data Collected:**
- Card number, expiry, CVV (never seen by user app)
- Billing address (always required)
- Phone number (always collected)
- Email (pre-filled if provided)

**Session Security:**
- Sessions expire after 24 hours
- One-time use (cannot be reused after completion)
- Session ID returned to app is safe to store (contains no payment data)

### Attack Surface Analysis

#### What Could Be Attacked

**❌ Checkout Session Manipulation**
- **Risk:** User modifies `priceId` or `quantity` in client-side code
- **Mitigation:** Server-side validation in `create-checkout-session/POST.ts`
  - Fetches actual price from Stripe API
  - Validates product exists and is active
  - Cannot be bypassed by client manipulation

**❌ Mixed-Mode Cart Injection**
- **Risk:** User attempts to checkout cart with mixed subscription/one-time items
- **Mitigation:** Server validates all prices and rejects mixed-mode carts (lines 78-88)
  - Fetches all price objects from Stripe
  - Checks for `recurring` property on each
  - Returns 400 error if mixed modes detected

**❌ Multi-Currency Cart**
- **Risk:** User adds items with different currencies
- **Mitigation:** Client-side validation prevents adding different currencies to cart
  - Checks currency match before adding (Products.tsx:94-97)
  - Server-side: Stripe will reject multi-currency checkout sessions

**❌ Session ID Replay**
- **Risk:** User reuses session ID to view order details multiple times
- **Mitigation:** Low risk - session details are read-only
  - No financial operations possible with session ID
  - Session ID can be safely stored in URL/localStorage
  - Viewing order details multiple times is acceptable behavior

**❌ Order History Enumeration**
- **Risk:** User provides different emails to view others' order history
- **Mitigation:** Depends on app's authentication layer
  - `getOrderHistory()` requires customer email
  - **Recommendation:** Add authentication check before calling
  - Current implementation trusts calling code to verify user identity

**❌ API Key Exposure**
- **Risk:** Secret key leaked in logs, error messages, or responses
- **Mitigation:**
  - Key retrieved from secure secrets store, not environment
  - Never logged or included in responses
  - Error messages sanitized (generic "Failed to load products")
  - Stripe SDK handles key transmission securely

#### What Cannot Be Attacked

**✅ Payment Card Data**
- Never enters user's infrastructure
- Collected entirely on Stripe's domain
- No attack surface in user app

**✅ Stripe Account Access**
- Secret key required for all operations
- Key never exposed to client
- Stripe API validates all requests

**✅ Price Manipulation**
- Prices stored in Stripe, not user database
- Server fetches authoritative price from Stripe API
- Client cannot modify pricing

### Webhook Security (Not Implemented)

**Note:** This skill does NOT implement Stripe webhooks. For production use, consider adding webhooks for:
- Payment confirmation (`checkout.session.completed`)
- Subscription lifecycle events
- Failed payments

**If implementing webhooks:**
- Verify webhook signatures using `stripe.webhooks.constructEvent()`
- Use webhook signing secret from Stripe Dashboard
- Validate event authenticity before processing
- Use idempotency keys to prevent duplicate processing

### Session Management

**Checkout Sessions:**
- Created with `mode: 'payment'` or `mode: 'subscription'`
- Expire after 24 hours (Stripe-enforced)
- Single-use (cannot be reused after payment)
- Session ID safe to store client-side (contains no sensitive data)

**Session ID Usage:**
- Returned in success URL: `?session_id=cs_xxx`
- Used to fetch order confirmation details
- Read-only access to session metadata
- Cannot be used to initiate refunds or modifications

### Data Storage

**Client-Side (localStorage):**
- Cart contents: Product metadata only (IDs, names, prices, images)
- No payment information
- No customer data
- No session secrets

**Server-Side:**
- No payment data stored
- No customer payment methods
- All data lives in Stripe's infrastructure
- Session IDs can be stored for order tracking (safe)

**Stripe-Side:**
- All payment data (cards, bank accounts)
- Customer records
- Payment history
- Subscription details

### Rate Limiting & Abuse Prevention

**Stripe API Rate Limits:**
- Default: 100 requests/second per account
- Burst allowance for short spikes
- 429 errors returned if exceeded (handled by Stripe SDK)

**Recommended App-Level Protection:**
- Rate limit checkout session creation (prevent spam)
- Add CSRF tokens to checkout requests
- Implement captcha for anonymous checkout
- Monitor for unusual patterns (many failed sessions)

### Logging & Monitoring

**What Should Be Logged:**
- Checkout session creation (session ID, amount, currency)
- Failed API calls (without secret key details)
- Validation errors (mixed modes, multi-currency)

**What Should NOT Be Logged:**
- `STRIPE_SECRET_KEY` value
- Full Stripe API responses (may contain sensitive data)
- Customer payment methods
- Card details (should never enter system)

### Compliance Checklist for Security Review

- [x] **PCI DSS:** Qualifies for SAQ-A (Stripe Hosted Checkout)
- [x] **Secret Management:** Keys stored in secure secrets store
- [x] **TLS:** All Stripe API calls over TLS 1.2+
- [x] **Input Validation:** Server-side validation of all requests
- [x] **Error Handling:** Generic errors returned to client
- [x] **No Payment Data Storage:** Zero card data in app infrastructure
- [x] **Session Security:** One-time use, 24-hour expiration
- [x] **Price Integrity:** Prices fetched from Stripe, not client-provided
- [ ] **Authentication:** Not implemented - app must add auth for order history
- [ ] **Webhook Validation:** Not implemented - optional for basic use
- [ ] **Rate Limiting:** Not implemented - recommended for production

## Testing

- **Test mode**: Use `sk_test_` / `pk_test_` keys
- **Test card**: `4242 4242 4242 4242` (any future date, any CVC)
- **Live mode**: Switch to `sk_live_` / `pk_live_` keys

## API Reference

### POST /api/stripe/create-checkout-session

```json
// Request
{ "priceId": "price_xxx", "successUrl": "...", "cancelUrl": "..." }

// Response
{ "success": true, "url": "https://checkout.stripe.com/...", "sessionId": "cs_xxx" }
```

### POST /api/stripe/register-product

```json
// Request
{ "name": "Product", "price": 2999, "currency": "usd", "recurring": { "interval": "month" } }

// Response
{ "success": true, "productId": "prod_xxx", "priceId": "price_xxx" }
```

### GET /api/stripe/products

```json
// Response
{
  "success": true,
  "products": [
    { "id": "prod_xxx", "name": "...", "priceId": "price_xxx", "amount": 2999 }
  ]
}
```
