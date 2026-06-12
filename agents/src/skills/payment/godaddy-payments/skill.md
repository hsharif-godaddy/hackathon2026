---
name: godaddy-payments
description: Provider flow for GoDaddy Payments setup and hosted checkout. Owns payment setup tools plus checkout/order-status templates for non-catalog payments, buy buttons, and cart checkout.
whenToUse: Loaded by the payment router when the user selects or explicitly requests GoDaddy Payments.
post-install-notes: 'GoDaddy Payments checkout/order-status routes and server helpers are included in the templates. Do NOT create src/server/api/commerce/checkout/POST.ts, src/server/api/commerce/order-status/GET.ts, or replacement Commerce checkout helpers manually. Build UI against the installed routes/helpers.'
---

# GoDaddy Payments Provider Flow

This is a provider-specific payment workflow. It is loaded by `payment` only. Do not use it as a top-level skill match, and do not re-ask provider selection after this skill is loaded.

GoDaddy Payments uses a GoDaddy Commerce store and an Airo App Builder channel under the hood, but this skill is self-contained for payment flows. Do not load `commerce` for non-catalog payments or buy-button checkout unless the user also needs catalog/product/inventory management.

## Activation Contract

This skill has templates, but it is not safe to install them immediately after load. Generic activation workflows may say to load and then install template skills; for this provider, installation is gated by the setup workflow below.

Required order:

1. Load this skill.
2. Call `godaddy-payments__setup`.
3. If setup returns a `storeId`, call `godaddy-payments__store_channel_ensure`.
4. Write the returned store/channel/base-url/currency env values.
5. Install `payment/godaddy-payments` templates.
6. Implement UI/server code that calls the installed routes.

If setup, channel ensure, or env writing cannot be completed, stop. Do not install templates, do not render checkout UI against missing env vars, and do not invent placeholder store/channel IDs.

After `godaddy-payments__store_channel_ensure` succeeds, do not list or read `src/server`, do not create API files, and do not implement checkout. First write the env vars, then call:

```typescript
skill({ action: 'install', skill: 'payment/godaddy-payments' });
```

## Ownership Boundary

| Skill | Purpose |
| --- | --- |
| `payment/godaddy-payments` | GoDaddy Payments provider setup, hosted checkout route, order-status route, non-catalog checkout, SKU buy buttons, cart checkout handoff |
| `commerce` | Product/catalog/inventory/order/admin operations through Commerce MCP |
| `commerce/ui` | Catalog, product detail, and cart UI templates. It does not install checkout routes. |

## Absolute Rules

1. Use this skill's own tools: `godaddy-payments__setup`, then `godaddy-payments__store_channel_ensure` when setup returns a `storeId`. Exception: if `commerce` just resolved and ensured the store/channel in the same flow for catalog work, reuse that context and skip duplicate setup.
2. Do not load `commerce` for appointment deposits, event tickets, donations, tips, custom invoices, service deposits, reservation fees, registration fees, pay-what-you-want, or other one-time/non-catalog payments.
3. Do not create catalog products or SKUs for non-catalog payment flows. Use `lineItemData` directly.
4. For a buy button, use an existing `skuId` if one is already known. If the user needs to create/find/manage products or SKUs, load `commerce` for that catalog work, then return to this skill for checkout.
5. For a browsable storefront or cart UI, install `commerce/ui` for catalog/cart UI and install this skill for checkout. Do not load `commerce/ui` as a router; if catalog/product work is needed, load `commerce` first.
6. Do not load `payment/stripe` from this flow. If the user changes providers, return to the `payment` router.
7. Do not expose internal skill or tool names to the user. Explain the outcome in plain language.

## GoDaddy Payments MCP Tools

This skill exposes only the setup/store/channel tools needed for GoDaddy Payments:

- `godaddy-payments__setup` — discover/create/connect the store that backs GoDaddy Payments.
- `godaddy-payments__store_channel_ensure` — bind the required Airo App Builder channel to the current app.
- `godaddy-payments__store_list` — list available stores for debugging or explicit user selection.
- `godaddy-payments__store_get` — inspect one store.
- `godaddy-payments__store_channels_get` — inspect channels for a store.

There is intentionally no generic `search_tools` or `execute_tool` here. Catalog/product/inventory operations belong to `commerce`.

## Setup Workflow

**Never ask the user anything before calling `godaddy-payments__setup`.** Always call it first with no params to discover store state. The response determines what to ask.

### Airo App Builder Channel Contract

<godaddy_payments_ready_contract>
A GoDaddy Payments-backed store is ready for Airo App Builder only after `godaddy-payments__store_channel_ensure` returns a channel for the current app with:
<required_channel_type>ONLINE</required_channel_type>
<required_channel_subtype>airo.ai.builder</required_channel_subtype>
<required_app_binding>current `context.metadata.appId`</required_app_binding>
</godaddy_payments_ready_contract>

<mandatory_sequence id="setup_then_channel_ensure">
<trigger>`godaddy-payments__setup` returns a `storeId`.</trigger>
<required_next_action>Call `godaddy-payments__store_channel_ensure` with that `storeId` before installing templates, writing env vars, implementing checkout UI, or telling the user payments are ready.</required_next_action>
<store_choice_flow>If setup returns `storeChoiceRequired`, wait for the user's choice, call `godaddy-payments__setup` again with the chosen `storePreference` or `storeId`, then ensure the channel on the resolved `storeId`.</store_choice_flow>
<failure_behavior>If channel ensure fails or returns a non-matching channel, stop the payment flow and explain in plain language that this app could not be connected to GoDaddy Payments.</failure_behavior>
</mandatory_sequence>

### Step 1 — Call `godaddy-payments__setup` with no params

### Step 2 — Handle the response

**`businessChoiceRequired: true`** — customer has multiple GoDaddy businesses.
The response includes a `businesses` array. Call `askQuestion` with `multiSelect: false`, `allowOther: false`, one suggestion per business (`text = businessName`, `value = businessId`). Do NOT use `suggestedResponse`. After the user answers, use the `value` from their selection as the `businessId` to pass to `godaddy-payments__setup`. Do not retry without a `businessId`.

**`storeChoiceRequired: true`** — customer has 2 or more stores under the scoped business.
The response includes an `existingStores` array. Call `askQuestion` with `multiSelect: false`, `allowOther: false`, one suggestion per store formatted as `"Store Name (Business Name)"`, plus a final "Create a new store" option. Do NOT use `suggestedResponse`. Do not retry setup again in the same turn — wait for the user's answer first.

**1 business / 1 store** — tool auto-proceeds and returns `storeId` directly. No choice required, no `askQuestion` needed.

**`needsOwnerIdentity: true`** — creating a new store requires owner details.
Call `askQuestion`: "To set up payments, I need a few details — what's your first name, last name, and email address?" Do NOT display, quote, or include the raw JSON or any field names (`firstName`, `lastName`, `missingFields`, `needsOwnerIdentity`) in your message. Retry with `storePreference: "new"` plus the provided `firstName`, `lastName`, `email`.

**`noExistingStoreFound: true`** — no stores exist on this account.
Ask for first name, last name, and email, then retry with `storePreference: "new"`.

**`storeProvisioningInProgress: true`** — a store setup is already in progress.
Tell the user payment setup is still finishing and do NOT call setup again.

**`paymentsManualSetupRequired: true`** — store created/connected but GoDaddy Payments needs manual setup.
Tell the user in plain language: their store is connected but they need to finish GoDaddy Payments setup in Commerce Home. Include the `manageUrl` from the response as a link.

### Step 3 — After successful setup

When setup returns a `storeId`, immediately call `godaddy-payments__store_channel_ensure` with that `storeId`. Reuse the returned `storeId`, `channelId`, `locationId`, currency, and API environment for the rest of the flow. Do NOT call setup again in the same flow to recover values.

When `godaddy-payments__store_channel_ensure` succeeds, the immediate next actions are env write, then template install. Do not inspect or create `src/server/api/commerce/*` files before installing this skill's templates.

Write these env vars after setup/channel ensure:

| Key | Description |
| --- | --- |
| `VITE_GODADDY_STORE_ID` | The connected store id. |
| `VITE_GODADDY_CHANNEL_ID` | The Airo App Builder channel id for this app. |
| `GODADDY_API_BASE_URL` | Full URL including scheme. Copy verbatim from `GODADDY_API_BASE_URL` in the agents runtime, e.g. `https://api.dev-godaddy.com`. |
| `VITE_GODADDY_CURRENCY_CODE` | ISO 4217 currency code for display/default direct checkout currency. Defaults to `USD` if omitted. |

`GODADDY_OAUTH_CLIENT_ID` and `GODADDY_OAUTH_CLIENT_SECRET` are read server-side from `/local/config.json`. Never ask the user for the secret and never add it to `.env.example`.

## Install Templates

After setup and channel ensure, install this provider's checkout templates:

```typescript
skill({ action: 'install', skill: 'payment/godaddy-payments' });
```

The install copies:

| Installed path | Purpose |
| --- | --- |
| `src/lib/commerce/create-checkout-session.ts` | Server-only checkout session orchestrator. |
| `src/lib/commerce/get-order-status.ts` | Server-only draft order status query. |
| `src/lib/commerce/checkout-subgraph.ts` | Checkout types, OAuth helper, and input builders. |
| `src/lib/commerce/order-subgraph.ts` | Order status query and draft order status types. |
| `src/lib/commerce/config.ts` | Server-only config reader. |
| `src/lib/commerce/gql.ts` | Commerce GraphQL transport helpers. |
| `src/server/api/commerce/checkout/POST.ts` | Browser-facing hosted checkout route. |
| `src/server/api/commerce/order-status/GET.ts` | Browser-facing order-status polling route. |

Routes under `templates/server/api/commerce/**/*.ts` are copied into `src/server/api/commerce/**/*.ts` and auto-registered in `src/server/entry.ts` by the skill loader. Do not wire routes manually.

After install, read the route docblocks before calling them. They document request/response shape.

If the requested experience is a donation page, event checkout, service deposit, buy button, or other direct payment, still install these templates first. The app page can be custom, but checkout creation and order-status polling must use the installed files.

## Calling Checkout from Other Server Code

If another server handler needs a checkout session or order status check, import the lib function directly and call it in-process. Never `fetch('/api/commerce/...')` from inside another server route because that strips inbound cookies/auth context and adds a pointless local HTTP hop.

```ts
import { createCheckoutSession } from '../../lib/commerce/create-checkout-session';
import { getOrderStatus } from '../../lib/commerce/get-order-status';

const session = await createCheckoutSession({
  lineItemData: {
    name: 'Appointment deposit',
    priceData: { unitAmount: 2500, currencyCode: 'USD' },
  },
  quantity: 1,
  returnUrl: `${origin}/appointments`,
  successUrl: `${origin}/appointments/success?bookingId=${bookingId}`,
});
// session: { url, id, draftOrderId }

const status = await getOrderStatus(draftOrderId);
// status: { id, status, amount, currency, createdAt, updatedAt, lineItems }
```

## Checkout Routes

All browser code calls same-origin routes. The browser never sees store headers, client secrets, or OAuth tokens.

| Method | Path | Purpose | Response |
| --- | --- | --- | --- |
| `POST` | `/api/commerce/checkout` | Create hosted checkout session from a draft order, SKU buy button, or direct line item | `{ url, id, draftOrderId }` |
| `GET` | `/api/commerce/order-status?orderId=...` | Poll payment/order status | `{ success: true, order: { id, status, amount, currency, createdAt?, updatedAt?, lineItems? } }` |

Error response shapes:

- `400`: `{ error: string }`
- `500` exception path: `{ error: string, message: string }`
- `500` non-exception path: `{ error: string }`

Do not show raw upstream `message` text to end users.

## Payment Flows

### Non-Catalog Checkout

Use this for appointment deposits, partial payments, custom service quotes, event tickets with dynamic pricing, donations, tips, pay-what-you-want, one-off invoices, registration fees, reservation fees, and anything with no catalog entry.

Call `POST /api/commerce/checkout` with:

```ts
{
  lineItemData: {
    name: 'Workshop registration',
    priceData: { unitAmount: 4500, currencyCode: 'USD' }
  },
  quantity: 1,
  returnUrl,
  successUrl
}
```

Rules:

- `unitAmount` is in the currency's smallest unit.
- `quantity` defaults to 1.
- `lineItemData` is mutually exclusive with `skuId` and `draftOrderId`; include exactly one.
- The API forces `fulfillmentMode` to `PURCHASE`. No shipping, no inventory tracking.
- The response is `{ url, id, draftOrderId: null }`. There is no draft order in this flow. Use a pre-generated correlation ID embedded in `successUrl` to identify the transaction after redirect.
- Do NOT call product, SKU, catalog, cart, or inventory endpoints before this flow.

### Buy Button / Single SKU Checkout

Use this when there is an existing `skuId` and the user wants a button that sends the customer directly to hosted checkout.

Call `POST /api/commerce/checkout` with:

```ts
{ skuId, quantity, returnUrl, successUrl }
```

The route creates the draft order server-side and returns `{ url, id, draftOrderId }`. Because `successUrl` is sent before the response arrives, use either a pre-generated correlation ID in `successUrl` or look up the order server-side using the checkout session `id`.

If the SKU does not exist yet, load `commerce`, create/find the catalog SKU there, then return to this flow for checkout wiring.

### Cart Checkout

Use this when `commerce/ui` has created a cart/draft order.

Call `POST /api/commerce/checkout` with:

```ts
{ draftOrderId, returnUrl, successUrl }
```

Embed `draftOrderId` into `successUrl` before sending, e.g. `${origin}/checkout/success?orderId=${draftOrderId}`. GoDaddy's hosted checkout does not append it.

On the success page, read `orderId` from the query string, verify paid status server-side with `getOrderStatus(orderId)`, then clear persisted cart state.

## Checkout Session Defaults

The checkout route applies these defaults to every session if not explicitly overridden:

| Flag | Default | Notes |
| --- | --- | --- |
| `paymentMethods` | `{ card: { processor: 'godaddy', checkoutTypes: ['standard'] } }` | Standard card checkout |
| `enablePaymentMethodCollection` | `true` | |
| `enableBillingAddressCollection` | `true` | |
| `enableShipping` | `false` | Physical-goods stores must set to `true`. |
| `enableShippingAddressCollection` | `false` | Physical-goods stores must set to `true`. |
| `enableLocalPickup` | `false` | |
| `enablePhoneCollection` | `false` | |
| `enableTaxCollection` | `false` | |

## Common Mistakes

1. Creating a catalog product or SKU before a non-catalog checkout. `lineItemData` is checkout-session-only and does not need catalog data.
2. Importing checkout/OAuth helpers into client code. Client code uses `fetch('/api/commerce/checkout')`; server code imports `createCheckoutSession`.
3. Asking for `GODADDY_OAUTH_CLIENT_SECRET`. It is platform-mounted server config.
4. Treating success redirect as proof of payment. Always verify status server-side before fulfilling.
5. Forgetting to install this skill when `commerce/ui` is used for cart UI. `commerce/ui` does not install checkout routes.
