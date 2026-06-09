---
name: payment
description: Help user choose and integrate the right payment solution for their app.
whenToUse: Trigger for any payment-related request — accept payments, checkout, buy now, charge customers, Stripe, subscriptions, payment page.
intents:
  - accept payments / payment page / buy now / checkout / one-time payment / charge customers
  - Stripe / Stripe checkout / Stripe payments / Stripe subscription
---

# Payment Skill

Router only — load sub-skills, never implement payments directly.

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

Load `payment/commerce-one-time-payment`.

### Stripe

Load `payment/stripe`

