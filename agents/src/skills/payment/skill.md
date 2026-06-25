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

If the user already named a provider, skip to its flow directly. Otherwise, use `askQuestion` to let them choose:

```json
{
  "questions": [{
    "question": "Which payment integration would you like?",
    "type": "chips_single",
    "suggestions": [
      "GoDaddy Payments",
      "Stripe"
    ],
    "subtitle": "GoDaddy Payments: zero-setup, best for one-time purchases. Stripe: best for subscriptions",
    "allowOther": true
  }]
}
```

Do not load sub-skills until the user picks.

## Provider Flows

### GoDaddy Payments

Load `payment/godaddy-payments` and follow its setup flow through env write and template install before implementing payment UI or server code.

### Stripe

Load `payment/stripe`
