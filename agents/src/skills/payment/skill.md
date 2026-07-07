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

### Step 1 — Gather routing inputs

Do NOT rely on the market hint in your prompt; the user's answers are the source of truth. If the user explicitly named Stripe, honor that choice and skip to its flow. If the user explicitly named GoDaddy Payments, still determine or confirm their selling country before loading it; never load GoDaddy Payments until you know the merchant sells from the US or Canada. Otherwise ask both questions in a single `askQuestion`:

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

### Step 2 — Route to a provider

- **Recurring payments needed** → **Stripe** (GoDaddy Payments does not support recurring in this integration).
- **Not recurring AND country is US or CA** → **GoDaddy Payments**.
- **Otherwise** (non-US/Canada, or recurring) → **Stripe**.

When routing to Stripe for a non-US/Canada merchant, briefly explain why:

> GoDaddy Payments is only available for businesses in the US and Canada. I'll set you up with Stripe, which works for your region.

When you load `payment/godaddy-payments`, pass the confirmed country as `sellingCountry` — e.g. `skill({ action: "load", skill: "payment/godaddy-payments", sellingCountry: "US" })`. The loader enforces the US/Canada restriction against that country; if it still reports the skill is unavailable, do not retry — fall back to Stripe. If Stripe also does not support their country, do not load a provider — recommend integrating a locally supported third-party payment processor manually.

Do not load sub-skills until routing is decided.

## Provider Flows

### GoDaddy Payments

Load `payment/godaddy-payments`, passing the confirmed `sellingCountry` (e.g. `skill({ action: "load", skill: "payment/godaddy-payments", sellingCountry: "US" })`), and follow its setup flow through env write and template install before implementing payment UI or server code.

### Stripe

Load `payment/stripe`
