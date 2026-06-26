# Stripe Integration Concepts

These definitions ground every reply about the integration. Read this before responding to any state, status, or go-live question — "is it live?", "will it accept real payments?", "how do I go live?" must be answered from the definitions here, not from prior assumptions about how Stripe normally works.

## Sandbox

A **sandbox** is a real Stripe account running in test mode, provisioned on the user's behalf by GoDaddy. The full Stripe API surface works against test card numbers (e.g. `4242 4242 4242 4242`) — Hosted Checkout, Embedded Checkout, Elements, products, prices, subscriptions — but no real money moves. The sandbox hard-expires ~60 days after creation if it is never claimed; Stripe permanently deletes it (all products, prices, payment history) and emails the user at day 53.

`stripe__setup` pushes two keys into the alloc env before returning, both `*_test_*`:

- **`STRIPE_SECRET_KEY`** (`sk_test_*`) — server-side runtime key used by the customer app. The agent never calls Stripe with it directly; product registration goes through the bundled `stripe-register-products.ts` script which reads this key from the env (Step 4).
- **`STRIPE_PUBLISHABLE_KEY`** (`pk_test_*`) — client-side key used by Stripe.js / Elements.

## Test mode vs live mode

These are Stripe-native terms:

- **Test mode** — the sandbox runs in test mode. Test card numbers only; no real money; full API surface.
- **Live mode** — real-money payments using **live keys** (`sk_live_*`, `pk_live_*`). Live keys are provisioned **only by the platform**, never collected from the user. There is no "switch to live keys" the user does manually in the Stripe dashboard.

The integration flips from test to live when the user (1) claims the sandbox **and** (2) installs the GoDaddy app in their live Stripe account. Stripe webhooks notify the platform, which writes the live keys into the alloc env. Both steps are required — claiming alone does not enable real payments.

## `claimUrl`

A Stripe-hosted onboarding URL (Stripe-side: `onboarding_link_details.url`) that walks the user through the two-step go-live flow: claim the sandbox (links it to a new or existing Stripe account), then install the GoDaddy app in their live account (which is what triggers live-key provisioning). Returned by `stripe__setup` and `stripe__status`. The link expires ~7 days after issue; calling `stripe__setup({})` on an existing sandbox returns a freshly minted URL.

The link is **stateful** — Stripe redirects the user to whichever step they have not yet completed. If the user already claimed but never installed the GoDaddy app, clicking the same URL drops them at the install step. Re-handing them the URL is the right move regardless of where they left off.

The `claimUrl` is the only way for the user to ever accept real money on the site, and the only way to prevent sandbox deletion at the 60-day mark. It is not a dashboard link, not a settings page, not a support URL.

## `claimStatus` (the sandbox state machine)

`stripe__status` returns `claimStatus`, advancing through three values. (Stripe's underlying field is `status`; our tool renames `unclaimed` → `provisioned` and otherwise mirrors Stripe's values.) The tool also returns a derived `realPaymentsEnabled` boolean — true only at `live` — which is the direct answer to "is the site accepting real money?". For any status or "is it live?" question, call `stripe__status` first and answer from the row that matches `claimStatus`:

| `claimStatus` | Keys in the production alloc env                                | Real payments on production site? | Next step the user owes                                                       |
| ------------- | --------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `provisioned` | Test keys (`sk_test_*`, `pk_test_*`)                            | No — test mode only               | Open `claimUrl` and complete claim + install in Stripe.                       |
| `claimed`     | Still test keys (claim alone does not change anything in the env) | No — still test mode          | Open `claimUrl` again and complete the **Install the GoDaddy app** step inside Stripe. That single action is what flips the integration to live. |
| `live`        | **Live keys** in both preview and publish variants: `STRIPE_SECRET_KEY = sk_live_*`, `STRIPE_PUBLISHABLE_KEY = pk_live_*`. | Yes — real payments are enabled | Nothing in this app. The bundled product script keeps working against the live key, but for ongoing product management direct the user to `https://dashboard.stripe.com`. |

### How the live transition actually happens

When the user installs the GoDaddy app in their live Stripe account, Stripe sends a webhook to `stripe-service`. The service then:

1. Calls Stripe's `apiKeys.create` on the user's live account to mint `sk_live_*` and `pk_live_*`.
2. Upserts `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` with the live values into hosting via `UpdateSecrets` — to **both** the `preview` and `publish` variants, so post-publish auto-sync of non-system-managed secrets doesn't clobber the live values.
3. Advances the sandbox row to `claim_status = live` in `stripe-service`'s DDB.

After this, every customer-facing environment of the app — preview and published — runs on live keys and accepts real payments. There is no env in this app that is still on test keys; if the user wants to test with `4242 4242 4242 4242` after going live, they have to use Stripe's test-mode dashboard or a separate test integration, not Airo's preview.

### Misconceptions to override (the LLM has wrong priors here)

These are true in standard Stripe integrations but **not in this platform-managed flow**. Do not propose them, echo them back, or hedge:

- "Activate your Stripe account at `dashboard.stripe.com` to enable live payments." — There is no separate "activation" step beyond the claim + install flow Stripe walks the user through via `claimUrl`. Activation, if any, is captured inside that flow.
- "Toggle off Test mode in the dashboard and grab your live keys." — Live keys are minted by `stripe-service` automatically and pushed into the env on the install webhook. The user never copies a key, and there is no dashboard step where they should.
- "Let me pull up the secrets form so you can paste in your live keys." — Never. `requestSecrets` is wrong here regardless of how the user phrases it.
- "The site is still in sandbox/test mode" when `claimStatus === 'live'`. — At `live`, the published site is on live keys. The word "sandbox" refers to a Stripe object that has now reached terminal state; it no longer governs the runtime keys.
- Treating `claimed` as "almost live" / "live except for keys." — `claimed` is fully test mode. The single thing that flips it is the GoDaddy-app install inside Stripe — not anything the user does on `dashboard.stripe.com` and not anything the user pastes into Airo.

## Modes (`managed` vs `legacy`)

- **`managed`** — Default for new apps. Auto-provisioned sandbox with `sk_test_*` and `pk_test_*` in the env. Going live is platform-managed via the `claimUrl` flow above.
- **`legacy`** — Pre-existing integration where the user pasted their own Stripe keys before auto-provisioning existed. No sandbox; `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` are already in the env from the user's earlier paste. Going live is the user's own concern (their keys, their Stripe account); this skill does not orchestrate it.

Product registration uses the same bundled `stripe-register-products.ts` script in both modes (Step 4) — the script reads `STRIPE_SECRET_KEY` from the env, which resolves to whichever key is current for the state.
