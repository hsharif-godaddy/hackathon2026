# §18 Feature: Payments

Accept payments for appointments. Admin manages payment providers, views transaction history, and customers pay through integrated checkout during booking.

---

## Setup

Before enabling the flags, configure Stripe:

1. Load the Stripe payment skill:
   ```typescript
   skill({ action: 'load', skill: 'payment/stripe' })
   ```
2. Follow the Stripe setup flow (it will configure keys automatically)
3. Add webhook raw body middleware to `src/server/entry.ts` BEFORE `app.use(express.json())`:
   ```typescript
   type RequestWithRawBody = Request & { rawBody?: Buffer };
   
   app.post(
     "/api/appointments/payments/webhook",
     express.raw({ type: "application/json" }),
     (req, _res, next) => {
       (req as RequestWithRawBody).rawBody = req.body as Buffer;
       next();
     },
     paymentsWebhookPost,
   );
   ```
   Import at the top:
   ```typescript
   import paymentsWebhookPost from "./api/appointments/payments/webhook/POST";
   ```
4. Request the webhook secret from the user:
   ```typescript
   requestSecrets({
     secrets: [{
       key: 'STRIPE_WEBHOOK_SECRET',
       description: 'Stripe webhook signing secret. Find in Stripe Dashboard > Developers > Webhooks > [your endpoint] > Signing secret.',
       required: true
     }]
   })
   ```
   Webhook endpoint: `https://<your-app-domain>/api/appointments/payments/webhook`
5. Register the provider:
   ```bash
   POST /api/appointments/admin/payment-providers
   {
     "provider": "stripe"
   }
   ```

That's it. Now enable the flags below.

---

## Enable

### Admin side — payment dashboard & provider config

```json
{
  "features": {
    "admin": {
      "payments": { "enabled": true },
      "settings": {
        "enabled": true,
        "payment": { "enabled": true }
      }
    }
  }
}
```

Enables `/admin/payments` (transaction dashboard) and payment provider toggle in `/admin/settings`.

### Customer side — payment at checkout

```json
{
  "features": {
    "customer": {
      "booking_flow": {
        "enabled": true,
        "payment": { "enabled": true }
      }
    }
  }
}
```

Adds payment step to booking wizard. After confirming details, customer is redirected to payment checkout.

### Both flags are needed for the end-to-end payment experience

Admin-only: useful for testing transactions before exposing payment to customers.
Customer-only without admin: customers can pay but admin can't view transactions or manage providers.

---

## What it unlocks

| Flag | UI | What it does |
|---|---|---|
| `admin.payments` | `/admin/payments` | Transaction dashboard with filters, pagination, status badges |
| `admin.settings.payment` | `/admin/settings` | Enable/disable payment providers |
| `customer.booking_flow.payment` | Booking wizard | Payment checkout redirect after booking confirmation |
| — | `/book/payment-success` | Success page after payment completes |
| — | `/book/payment-cancel` | Cancel page if user abandons checkout |

---

## Customize

### Payment success message
Edit `pages/book/payment-success.tsx` — change confirmation text, add custom CTA buttons, or redirect logic.

### Payment cancel message
Edit `pages/book/payment-cancel.tsx` — customize the abandonment message and retry flow.

### Transaction dashboard
Edit `pages/admin/payments/index.tsx` — modify columns, add export functionality, or change filter options.

---

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/appointments/admin/payment-providers` | List payment providers |
| POST | `/api/appointments/admin/payment-providers` | Create payment provider |
| PATCH | `/api/appointments/admin/payment-providers/:id` | Update provider (enable/disable) |
| DELETE | `/api/appointments/admin/payment-providers/:id` | Delete provider |
| GET | `/api/appointments/admin/payments/transactions` | List transactions (paginated, filterable by status) |
| POST | `/api/appointments/payments/create-checkout-session` | Create checkout session |
| POST | `/api/appointments/payments/webhook` | Payment webhook handler (signature verification) |

---

## Notes

- Payment provider must be configured via its dedicated skill before enabling these flags
- Payment step only appears in booking flow when flag is enabled — no code changes needed
- Webhook at `/api/appointments/payments/webhook` updates booking status from `unpaid` to `paid` after successful payment
- Transaction dashboard shows all attempts (succeeded, pending, expired)
- If webhook fails (network issue), booking stays unpaid and transaction stays pending — admin can manually update in `/admin/bookings`
- Bookings without payment enabled skip checkout entirely — they remain unpaid and can be fulfilled offline
