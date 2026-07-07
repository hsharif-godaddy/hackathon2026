---
name: payment
description: Help user choose and integrate the right payment solution for their app.
whenToUse: Trigger for any payment-related request — accept payments, checkout, buy now, charge customers, Stripe, subscriptions, payment page, donations, tips, event tickets, deposits, registrations, custom fees, or other non-catalog payments.
intents:
  - accept payments / payment page / buy now / checkout / one-time payment / charge customers
  - donate / donation page / tip jar / event tickets / registration fee / appointment deposit / service deposit / custom invoice / pay what you want
  - GoDaddy Payments / GoDaddy checkout / GoDaddy payment page
  - Stripe / Stripe checkout / Stripe payments / Stripe subscription
---

# Payment Skill

Router only — route to the provider-specific skill flow, never implement payments directly.

This is an instruction-only router. Do not install the `payment` skill itself. If a generic skill activation workflow says to load then install skills, skip installation for this router and follow the provider flow below.

## Choosing a provider

GoDaddy Payments (GDP) is available ONLY to merchants in the United States and Canada and is for **one-time** payments (no recurring/subscriptions). Stripe works in most other regions and supports recurring payments. Work through the steps in order.

### Step 1 — Look up an existing setup before creating a new one

Before asking the merchant anything (country, recurring, provider), do the lookup. Creating a second store/payment config when one already exists risks duplicate setups — so always check first.

This router is instruction-only: `commerce__provision`, `stripe__setup`, and `godaddy-payments__provision` are NOT active until you load the owning skill, so do NOT call them in this step. Use only the signals already present in your context:

1. **App-level GoDaddy binding:** if your context contains a `## Commerce Binding` section, an existing GoDaddy store/channel is already bound to this app → treat as an existing GoDaddy setup.
2. **Stripe config in context:** if a `STRIPE_*` secret is already present in the app's environment → treat as an existing Stripe setup.

If either signal shows an existing setup, ask whether to reuse it with `askQuestion`:

```json
{
  "questions": [{
    "question": "You already have a payment setup connected to your account. Reuse it or set up a new one?",
    "type": "chips_single",
    "suggestions": [
      "Reuse my existing setup",
      "Set up a new one"
    ],
    "subtitle": "Reusing avoids creating a duplicate store and payment configuration.",
    "allowOther": false
  }]
}
```

- **Reuse:** load the owning skill first, then resume its flow, and SKIP Steps 2–3 — the earlier setup's region/eligibility rules already apply, so do not re-route. A GoDaddy store only exists for US/Canada merchants, so reusing one is always region-safe.
  - GoDaddy: load `payment/godaddy-payments` (pass the bound store's country as `sellingCountry` — it is always US or CA), then call `godaddy-payments__provision` with no params; it resumes from the persisted binding.
  - Stripe: load `payment/stripe`, then call `stripe__setup({})`.
- **Set up a new one**, or no existing setup was found → go to Step 2.

> Account-level stores that are not yet bound to this app cannot be discovered from the router (that requires a provider tool). They are surfaced safely later: after you route and load a provider skill, its first provision/setup call returns `needs_store_choice` listing existing stores, so you can reuse one instead of creating a duplicate.

### Step 2 — Gather routing inputs (only when not reusing an existing setup)

Ask the merchant both questions in a single `askQuestion`. Do NOT rely on the market hint in your prompt; the user's answers are the source of truth.

```json
{
  "questions": [
    {
      "question": "Where does your business sell from?",
      "type": "chips_single",
      "suggestions": ["United States", "Canada", "Somewhere else"],
      "subtitle": "This determines which payment providers are available to you.",
      "allowOther": true
    },
    {
      "question": "Do you need recurring payments (subscriptions, memberships, or recurring billing)?",
      "type": "chips_single",
      "suggestions": ["Yes, recurring", "No, one-time only"],
      "allowOther": false
    }
  ]
}
```

Map the country answer to an ISO-3166 alpha-2 code (United States → `US`, Canada → `CA`, Australia → `AU`, United Kingdom → `GB`, etc.).

### Step 3 — Route to a provider

Decide from the country and recurring answers:

- **Recurring payments needed** → **Stripe** (GoDaddy Payments does not support recurring in this integration).
- **Not recurring AND country is US or CA** → **GoDaddy Payments**.
- **Otherwise** (non-US/Canada, or recurring) → **Stripe**.

If the user explicitly named a provider (e.g. "use Stripe"), honor that choice and skip the decision — but still respect the region rule: never set up GoDaddy Payments for a non-US/Canada merchant.

When routing to GoDaddy Payments, explain nothing extra — just proceed. When routing to Stripe for a non-US/Canada merchant, briefly explain why:

> GoDaddy Payments is only available for businesses in the US and Canada. I'll set you up with Stripe, which works for your region.

When you load `payment/godaddy-payments`, pass the confirmed country as `sellingCountry` — e.g. `skill({ action: "load", skill: "payment/godaddy-payments", sellingCountry: "US" })`. The loader enforces the US/Canada restriction against that country; if it still reports the skill is unavailable, do not retry — fall back to Stripe. If Stripe also does not support their country, do not load a provider — recommend integrating a locally supported third-party payment processor manually.

## Provider Flows

### GoDaddy Payments

Load `payment/godaddy-payments` and follow its setup flow through env write and template install before implementing payment UI or server code.

### Stripe

Load `payment/stripe`
