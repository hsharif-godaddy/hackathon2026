---
name: godaddy-payments
description: Provider flow for GoDaddy Payments setup and hosted checkout. Owns payment setup tools plus checkout/order-status templates for non-catalog payments, buy buttons, and cart checkout.
whenToUse: Loaded by the payment router when the user selects or explicitly requests GoDaddy Payments.
post-install-notes: 'GoDaddy Payments checkout/order-status routes and server helpers are included in the templates. Do NOT create src/server/api/commerce/checkout/POST.ts, src/server/api/commerce/order-status/GET.ts, or replacement Commerce checkout helpers manually. Build UI against the installed routes/helpers.'
---

# GoDaddy Payments Provider Flow

This is a provider-specific payment workflow. It is loaded by `payment` only. Do not use it as a top-level skill match, and do not re-ask provider selection after this skill is loaded.

GoDaddy Payments uses a GoDaddy Commerce store and an Airo App Builder channel under the hood. This skill is self-contained for all payment flows.

## Activation Contract

This skill has templates, but it is not safe to install them immediately after load. Generic activation workflows may say to load and then install template skills; for this provider, installation is gated by the setup workflow below.

Required order:

1. Load this skill.
2. Call `godaddy-payments__provision`.
3. If provision returns a `needs_*` status, ask the required question and re-call `godaddy-payments__provision` with the answer.
4. When provision returns `status: "ready"`, install `payment/godaddy-payments` templates.
5. Implement UI/server code that calls the installed routes.

If provisioning or env writing cannot be completed, stop. Do not install templates, do not render checkout UI against missing env vars, and do not invent placeholder store/channel IDs.

After `godaddy-payments__provision` returns `status: "ready"`, do not list or read `src/server`, do not create API files, and do not implement checkout. First call:

```typescript
skill({ action: 'install', skill: 'payment/godaddy-payments' });
```

## Ownership Boundary

| Skill                      | Purpose                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `payment/godaddy-payments` | GoDaddy Payments provider setup, hosted checkout route, order-status route, non-catalog checkout, SKU buy buttons, cart checkout handoff |
| `commerce`                 | Product/catalog/inventory/order/admin operations through Commerce MCP                                                                    |
| `commerce/ui`              | Catalog, product detail, and cart UI templates. It does not install checkout routes.                                                     |

## Absolute Rules

1. Use `godaddy-payments__provision` for all GoDaddy Payments store/channel/env setup. It reuses any existing Commerce `channel_ready` binding for this app and verifies payment readiness before returning `ready`.
2. A `ready` response means GoDaddy Payments infrastructure is ready. It does not mean catalog products, SKUs, inventory, carts, storefront UI, or `commerce/ui` exist.
3. Do not load `commerce` for appointment deposits, event tickets, donations, tips, custom invoices, service deposits, reservation fees, registration fees, pay-what-you-want, or other one-time/non-catalog payments.
4. Do not create catalog products or SKUs for non-catalog payment flows. Use `lineItemData` directly.
5. For a buy button, use an existing `skuId` if one is already known. If the user needs to create/find/manage products or SKUs, load `commerce` for that catalog work, then return to this skill for checkout.
6. For a browsable storefront or cart UI, install `commerce/ui` for catalog/cart UI and install this skill for checkout. Do not load `commerce/ui` as a router; if catalog/product work is needed, load `commerce` first.
7. Do not load `payment/stripe` from this flow. If the user changes providers, return to the `payment` router.
8. Do not expose internal skill or tool names to the user. Explain the outcome in plain language.
9. When reporting a connected GoDaddy Payments store to the user, include full Store ID, Channel ID, and Business ID when available. Do not abbreviate or truncate UUIDs.
10. If `/api/commerce/checkout` returns `Failed to create checkout session` after provision returned `ready`, do not say this is expected in preview and do not tell the user publishing will fix it. Read the route response `message`, inspect server logs, inspect `src/lib/commerce/config.ts`, and verify the checkout request body shape.
11. Never hardcode Store ID, Channel ID, API base URL, OAuth client id, or OAuth secret into application source as a fallback. These values must come from `godaddy-payments__provision`, `.env`, runtime env, or `/local/config.json` through `readCommerceConfig()`.
12. Frontend checkout code must redirect to the `url` field returned by `POST /api/commerce/checkout`, e.g. `window.location.assign(data.url)`. The response does not include `redirectUrl`; do not write UI code that checks `data.redirectUrl`.

## Non-Catalog Provisioning Contract

`godaddy-payments__provision` provisions payment infrastructure only. It is valid for non-catalog payments and does not require a catalog, product, SKU, inventory, cart, storefront, or `commerce/ui`.

For appointment deposits, donations, event tickets, registrations, custom fees, tips, pay-what-you-want payments, service deposits, reservation fees, retainers, custom invoices, user-entered amounts, and one-off payments:

- call `godaddy-payments__provision`
- install `payment/godaddy-payments`
- call `/api/commerce/checkout` with `lineItemData`
- do not load `commerce`, do not install `commerce/ui`, do not call catalog/product/SKU tools, and do not create products or SKUs

The non-catalog checkout body must use this exact shape. Do not use `unitPrice`, `amount`, `price`, or a top-level `description` in place of `priceData`.

```ts
{
  lineItemData: {
    name: 'Donation - General Fund',
    priceData: { unitAmount: 5000, currencyCode: 'USD' },
  },
  quantity: 1,
  returnUrl,
  successUrl,
}
```

Successful checkout creation returns `{ url, id, draftOrderId }`. Browser code must redirect to `data.url`; there is no `redirectUrl` field.

## GoDaddy Payments Tools

This skill exposes a single provisioning tool plus read-only store diagnostics:

- `godaddy-payments__provision` — discover/create/select a store, ensure the Airo App Builder channel, verify payment readiness, persist the binding, and write env vars.
- `godaddy-payments__store_list` — list available stores for debugging or explicit user selection.
- `godaddy-payments__store_get` — inspect one store.
- `godaddy-payments__store_channels_get` — inspect channels for a store.

## Setup Workflow

**Never ask the user anything before calling `godaddy-payments__provision`.** Always call it first with no params. If Commerce already provisioned this app, the tool resumes from that persisted binding and does not ask the user to choose/create a store again. The response determines what to ask.

### Airo App Builder Channel Contract

<godaddy_payments_ready_contract>
A GoDaddy Payments-backed store is ready for Airo App Builder only after `godaddy-payments__provision` returns `status: "ready"` with a channel for the current app with:
<required_channel_type>ONLINE</required_channel_type>
<required_channel_subtype>airo.ai.builder</required_channel_subtype>
<required_app_binding>current `context.metadata.appId`</required_app_binding>
</godaddy_payments_ready_contract>

<mandatory_sequence id="setup_then_channel_ensure">
<trigger>`godaddy-payments__provision` returns any status other than `ready`.</trigger>
<required_next_action>Follow that status exactly and re-call `godaddy-payments__provision` with the user's answer. Do not call store setup or channel ensure tools directly.</required_next_action>
<store_choice_flow>If provision returns `needs_store_choice`, wait for the user's choice. If the response includes `resumeInput`, merge it into the next `godaddy-payments__provision` call. If the user chooses an existing store, call with the chosen `storeId`. If the user chooses to create a new store, call with `storePreference: "new"` and omit `storeId` and `storeUrl`.</store_choice_flow>
<failure_behavior>If provision fails or returns a non-matching channel, stop the payment flow and explain in plain language that this app could not be connected to GoDaddy Payments.</failure_behavior>
</mandatory_sequence>

### Step 1 — Call `godaddy-payments__provision` with no params

### Step 2 — Handle the response

**`status: "needs_business_choice"`** — customer has multiple GoDaddy businesses.
The response includes a `businesses` array. Call `askQuestion` with `multiSelect: false`, `allowOther: false`, one suggestion per business (`text = businessName`, `value = businessId`). Do NOT use `suggestedResponse`. After the user answers, use the `value` from their selection as the `businessId` to pass to `godaddy-payments__provision`. Do not retry without a `businessId`.

**`status: "needs_store_choice"`** — customer has one or more stores under the scoped business.
The response includes a `stores` array. Call `askQuestion` with `multiSelect: false`, `allowOther: false`. For each store set `text` to "Store Name (Business Name)" and `value` to the bare `storeId` UUID. Unless the response includes `conflict: "store_creation_conflict"`, add a create option: `text` = "Create a new store", `value` = "new". Do NOT use `suggestedResponse`. Do not retry setup again in the same turn — wait for the user's answer first.

After the user answers — two cases, no others:
- **Value is a UUID**: call `godaddy-payments__provision` with that `storeId` plus `resumeInput` when provided.
- **Value is `"new"`**: call `godaddy-payments__provision` with `storePreference: "new"` plus `resumeInput` when provided. Omit `storeId` and `storeUrl`.

**`status: "needs_identity"`** — creating a new store requires owner details, or no stores exist on this account.
Call `askQuestion`: "To set up payments, I need a few details — what's your first name, last name, and email address?" Do NOT display raw field names or JSON in your message. Retry with `storePreference: "new"` plus the provided `firstName`, `lastName`, `email`, merged with `resumeInput` when provided.

**`status: "provisioning_in_progress"`** — a store setup is already in progress.
Tell the user payment setup is still finishing and do NOT call setup again.

**`status: "payments_manual_required"`** — store created/connected but GoDaddy Payments needs manual setup.
Tell the user in plain language: their store is connected but they need to finish GoDaddy Payments setup in Commerce Home. Include the `manageUrl` from the response as a link.

### Step 3 — After successful setup

When provision returns `status: "ready"`, reuse the returned `storeId`, `channelId`, currency, API environment, and `selectedCommerceResources` for the rest of the flow. Do NOT call lower-level setup tools to recover values.

When `godaddy-payments__provision` succeeds, the immediate next action is template install. Do not inspect or create `src/server/api/commerce/*` files before installing this skill's templates.

`godaddy-payments__provision` writes these env vars before returning `status: "ready"`:

| Key                          | Description                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GODADDY_STORE_ID`           | Server-runtime connected store id.                                                                                              |
| `GODADDY_CHANNEL_ID`         | Server-runtime Airo App Builder channel id for this app.                                                                        |
| `VITE_GODADDY_STORE_ID`      | The connected store id.                                                                                                         |
| `VITE_GODADDY_CHANNEL_ID`    | The Airo App Builder channel id for this app.                                                                                   |
| `GODADDY_API_BASE_URL`       | Full URL including scheme. Copy verbatim from `GODADDY_API_BASE_URL` in the agents runtime, e.g. `https://api.dev-godaddy.com`. |
| `GODADDY_CURRENCY_CODE`      | Server-runtime ISO 4217 currency code.                                                                                          |
| `VITE_GODADDY_CURRENCY_CODE` | ISO 4217 currency code for display/default direct checkout currency. Defaults to `USD` if omitted.                              |

`src/lib/commerce/config.ts` is server-only and reads non-secret store/channel values from runtime env or the app `.env` file. It does not rely on `import.meta.env` for server checkout routes. `GODADDY_OAUTH_CLIENT_ID` and `GODADDY_OAUTH_CLIENT_SECRET` are read server-side from `/local/config.json`. Never ask the user for the secret and never add it to `.env.example`.

## Install Templates

After setup and channel ensure, install this provider's checkout templates:

```typescript
skill({ action: 'install', skill: 'payment/godaddy-payments' });
```

The install copies:

| Installed path                                | Purpose                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/lib/commerce/create-checkout-session.ts` | Server-only checkout session orchestrator.                                    |
| `src/lib/commerce/get-order-status.ts`        | Server-only draft order status query.                                         |
| `src/lib/commerce/checkout-subgraph.ts`       | Checkout types, OAuth helper, and input builders.                             |
| `src/lib/commerce/order-subgraph.ts`          | Order status query and draft order status types.                              |
| `src/lib/commerce/config.ts`                  | Server-only config reader.                                                    |
| `src/lib/commerce/gql.ts`                     | Commerce GraphQL transport helpers.                                           |
| `src/server/api/commerce/checkout/POST.ts`    | Browser-facing hosted checkout route.                                         |
| `src/server/api/commerce/order-status/GET.ts` | Browser-facing order-status polling route.                                    |

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

| Method | Path                                     | Purpose                                                                                | Response                                                                                         |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST` | `/api/commerce/checkout`                 | Create hosted checkout session from a draft order, SKU buy button, or direct line item | `{ url, id, draftOrderId }`; frontend redirects to `data.url`, never `data.redirectUrl`           |
| `GET`  | `/api/commerce/order-status?orderId=...` | Poll payment/order status                                                              | `{ success: true, order: { id, status, amount, currency, createdAt?, updatedAt?, lineItems? } }` |

Error response shapes:

- `400`: `{ error: string }`
- `500` exception path: `{ error: string, message: string }`
- `500` non-exception path: `{ error: string }`

Do not show raw upstream `message` text to end users.

If checkout fails during preview after provision returned `ready`, treat it as a bug to diagnose. The preview route should be able to create a hosted checkout session when OAuth config is mounted and provisioning wrote env vars. Check, in order:

1. The POST body uses exactly one of `draftOrderId`, `skuId`, or `lineItemData`.
2. Non-catalog `lineItemData` is `{ name, priceData: { unitAmount, currencyCode } }`.
3. `src/lib/commerce/config.ts` reads Store ID, Channel ID, API base URL, and currency from runtime env or `.env` through `readCommerceConfig()`.
4. `.env` contains the values written by provision.
5. `/local/config.json` contains OAuth client id and secret entries with `.VALUE`.

Do not hardcode known IDs into source to make preview pass. Fix the config reader, provision/env write, or request body.

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
- The only supported non-catalog price shape is `priceData: { unitAmount, currencyCode }`. Do not send `unitPrice`, `amount`, `price`, or `description` as siblings of `name`.
- The API forces `fulfillmentMode` to `PURCHASE`. No shipping, no inventory tracking.
- The response is `{ url, id, draftOrderId: null }`. Browser code must redirect to `data.url`; do not check `data.redirectUrl`. There is no draft order in this flow. Use a pre-generated correlation ID embedded in `successUrl` to identify the transaction after redirect.
- Do NOT call product, SKU, catalog, cart, or inventory endpoints before this flow.

### Buy Button / Single SKU Checkout

Use this when there is an existing `skuId` and the user wants a button that sends the customer directly to hosted checkout.

Call `POST /api/commerce/checkout` with:

```ts
{
  skuId,
  quantity,
  returnUrl,
  successUrl,
}
```

The route creates the draft order server-side and returns `{ url, id, draftOrderId }`. Because `successUrl` is sent before the response arrives, use either a pre-generated correlation ID in `successUrl` or look up the order server-side using the checkout session `id`.

If the SKU does not exist yet, the user needs to create it before using this flow.

### Cart Checkout

Use this when a cart/draft order already exists.

Call `POST /api/commerce/checkout` with:

```ts
{
  draftOrderId,
  returnUrl,
  successUrl,
}
```

Embed `draftOrderId` into `successUrl` before sending, e.g. `${origin}/checkout/success?orderId=${draftOrderId}`. GoDaddy's hosted checkout does not append it.

The response is `{ url, id, draftOrderId }`. Browser code must redirect to `data.url`; do not render a replacement shipping/payment checkout page and do not check `data.redirectUrl`.

On the success page, read `orderId` from the query string, verify paid status server-side with `getOrderStatus(orderId)`, then clear persisted cart state.

## Checkout Session Defaults

The checkout route applies these defaults to every session if not explicitly overridden:

| Flag                              | Default                                                                                                        | Notes                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `paymentMethods`                  | `{ card: { processor: 'godaddy', checkoutTypes: ['standard'] } }`                                              | Standard card checkout                                     |
| `enablePaymentMethodCollection`   | `true`                                                                                                         |                                                            |
| `enableBillingAddressCollection`  | `true`                                                                                                         |                                                            |
| `enableShipping`                  | `false`                                                                                                        | Physical-goods stores must set to `true`.                  |
| `enableShippingAddressCollection` | `false`                                                                                                        | Physical-goods stores must set to `true`.                  |
| `enableLocalPickup`               | `false`                                                                                                        |                                                            |
| `enablePhoneCollection`           | `false`                                                                                                        |                                                            |
| `enableTaxCollection`             | `false`                                                                                                        |                                                            |

## Common Mistakes

1. Creating a catalog product or SKU before a non-catalog checkout. `lineItemData` is checkout-session-only and does not need catalog data.
2. Importing checkout/OAuth helpers into client code. Client code uses `fetch('/api/commerce/checkout')`; server code imports `createCheckoutSession`.
3. Asking for `GODADDY_OAUTH_CLIENT_SECRET`. It is platform-mounted server config.
4. Treating success redirect as proof of payment. Always verify status server-side before fulfilling.
5. Forgetting to install this skill when cart UI exists. Cart UI does not install checkout routes.
6. Dismissing preview checkout failures as expected. After provision returns `ready`, debug the route response and server config instead.
7. Hardcoding Store ID, Channel ID, API base URL, or OAuth values in app source. Provision and `readCommerceConfig()` own those values.
8. Checking `data.redirectUrl` after calling `/api/commerce/checkout`. The installed route returns `url`, so checkout buttons must redirect to `data.url`.
