# Payment Integration Architecture

This document explains the payment abstraction layer in the online-appointments skill and how to extend it for different payment providers.

> **📖 For payment-free usage:** If you just want simple appointment booking without ANY payment functionality, see [PAYMENT_FREE_SETUP.md](./PAYMENT_FREE_SETUP.md). Payment is completely optional!

## Overview

The appointment booking system supports optional payment integration through a **provider-agnostic abstraction layer**. This design allows:

- ✅ **Free appointments** (no payment required, zero configuration)
- ✅ Paid appointments with GoDaddy Commerce (default when configured)
- ✅ Easy swapping to Stripe or other providers
- ✅ Same user experience regardless of payment backend
- ✅ **Works perfectly without any payment setup**

## Architecture

### Core Components

```
online-appointments/
├── templates/
│   ├── server/
│   │   ├── api/appointments/
│   │   │   ├── POST.ts              # Create appointment (with payment)
│   │   │   └── GET.ts               # List appointments (with order status)
│   │   └── utils/
│   │       ├── payment-provider.ts           # Interface definition
│   │       ├── godaddy-commerce-provider.ts  # GoDaddy implementation
│   │       └── payment-provider-factory.ts   # Provider selector
│   └── lib/
│       └── appointments.ts          # Types and schemas

commerce-one-time-payment/
└── templates/
    └── server/api/commerce/
        ├── create-checkout-session/POST.ts  # Checkout creation
        └── order-status/GET.ts              # Order status query
```

### Payment Provider Interface

All providers implement this interface:

```typescript
interface PaymentProvider {
  createPaymentSession(params: CreatePaymentSessionParams): Promise<PaymentSession>;
  getOrderStatus(orderId: string): Promise<OrderStatus>;
}
```

**Benefits:**

- Appointment logic doesn't know about specific providers
- Swap providers by updating one file (factory)
- Easy to test with mock providers

## Database Schema Changes

The appointment schema needs these additional fields:

```typescript
// Add to your Drizzle schema
export const appointment = sqliteTable('appointment', {
  // ... existing fields ...
  requiresPayment: integer('requires_payment', { mode: 'boolean' }).default(false),
  amount: integer('amount'), // Amount in cents
  orderId: text('order_id'), // Payment provider's order/transaction ID
});
```

**Migration:**

```sql
ALTER TABLE appointment ADD COLUMN requires_payment INTEGER DEFAULT 0;
ALTER TABLE appointment ADD COLUMN amount INTEGER;
ALTER TABLE appointment ADD COLUMN order_id TEXT;
```

## Data Flow

### Creating a Paid Appointment

```
1. Client → POST /api/appointments
   {
     customerName: "John Doe",
     date: "2025-01-21",
     time: "09:00",
     requiresPayment: true,
     amount: 5000  // $50.00
   }

2. Server checks slot availability

3. If requiresPayment:
   - Call getPaymentProvider().createPaymentSession()
   - Provider creates checkout session
   - Returns { paymentUrl, orderId }

4. Insert appointment with orderId

5. Return to client:
   {
     id: "apt-123",
     checkoutUrl: "https://checkout.commerce.godaddy.com/...",
     orderId: "draft-order-123"
   }

6. Client redirects to checkoutUrl
```

### Listing Appointments (Admin)

```
1. Admin → GET /api/appointments?includeOrderStatus=true

2. Server fetches all appointments from DB

3. For each appointment with orderId:
   - Call getPaymentProvider().getOrderStatus(orderId)
   - Enrich appointment with payment status

4. Return unified display status:
   - "Confirmed (Paid)"
   - "Pending Payment"
   - "Confirmed (Free)"
   - "Payment Failed"
```

## Configuration

### Payment-Free Usage (Zero Config)

**For simple, free appointment booking with NO payment functionality:**

```env
# No payment-related environment variables needed!
# The skill works perfectly without payment configuration
```

All appointments will be free (`requiresPayment: false`). If someone tries to create a paid appointment without payment configured, they'll get a clear error message.

See [PAYMENT_FREE_SETUP.md](./PAYMENT_FREE_SETUP.md) for complete payment-free usage guide.

### Environment Variables

**GoDaddy Commerce (when payments needed):**

The `VITE_GODADDY_STORE_ID` environment variable is **automatically configured** when you use the `commerce` skill to set up your store. The commerce setup workflow writes this to your `.env` file along with other required credentials.

**Manual configuration (if needed):**

```env
VITE_GODADDY_STORE_ID=your-store-id
GODADDY_API_BASE_URL=https://api.godaddy.com
```

OAuth credentials are read from `/local/config.json` (system-managed - automatically configured by the platform):

```json
{
  "GODADDY_OAUTH_CLIENT_ID": {
    "SYSTEM_MANAGED": true,
    "VALUE": "actual-client-id"
  },
  "GODADDY_OAUTH_CLIENT_SECRET": {
    "SYSTEM_MANAGED": true,
    "VALUE": "actual-client-secret"
  }
}
```

**Note:** If you're using the JTBD appointments flow with payment enabled, all environment variables are automatically configured - no manual setup required.

## Adding Stripe Support

When a user requests Stripe instead of GoDaddy Commerce, follow these steps:

### 1. Create Stripe Provider

Create `templates/server/utils/stripe-provider.ts`:

```typescript
import type {
  PaymentProvider,
  PaymentSession,
  OrderStatus,
  CreatePaymentSessionParams,
} from './payment-provider';
import Stripe from 'stripe';

export class StripeProvider implements PaymentProvider {
  private stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2024-12-18.acacia',
    });
  }

  async createPaymentSession(params: CreatePaymentSessionParams): Promise<PaymentSession> {
    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            product_data: {
              name: params.description,
            },
            unit_amount: params.amount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: params.successUrl,
      cancel_url: params.returnUrl,
    });

    return {
      paymentUrl: session.url!,
      orderId: session.payment_intent as string,
    };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const paymentIntent = await this.stripe.paymentIntents.retrieve(orderId);

    return {
      orderId,
      status: this.mapStripeStatus(paymentIntent.status),
      amount: paymentIntent.amount,
      currency: paymentIntent.currency.toUpperCase(),
      createdAt: new Date(paymentIntent.created * 1000).toISOString(),
    };
  }

  private mapStripeStatus(status: string): OrderStatus['status'] {
    switch (status) {
      case 'succeeded':
        return 'paid';
      case 'processing':
      case 'requires_action':
      case 'requires_confirmation':
        return 'pending';
      case 'canceled':
        return 'cancelled';
      case 'requires_payment_method':
        return 'failed';
      default:
        return 'pending';
    }
  }
}
```

### 2. Update Factory

Edit `templates/server/utils/payment-provider-factory.ts`:

```typescript
import type { PaymentProvider } from './payment-provider';
import { GoDaddyCommerceProvider } from './godaddy-commerce-provider';
import { StripeProvider } from './stripe-provider';

export function getPaymentProvider(): PaymentProvider {
  // Check which provider is configured
  const useStripe = process.env.USE_STRIPE === 'true';

  if (useStripe) {
    return new StripeProvider(process.env.STRIPE_SECRET_KEY!);
  }

  // Default: GoDaddy Commerce
  return new GoDaddyCommerceProvider(process.env.VITE_GODADDY_STORE_ID, process.env.API_BASE_URL || '');
}
```

### 3. Add Environment Variables

```env
USE_STRIPE=true
STRIPE_SECRET_KEY=sk_test_...
```

### 4. Install Dependencies

```bash
npm install stripe
```

**That's it!** The appointment logic remains unchanged. All payment operations now use Stripe.

## Testing

### Test Free Appointments

```bash
curl -X POST http://localhost:3000/api/appointments \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "John Doe",
    "customerEmail": "john@example.com",
    "date": "2025-01-21",
    "time": "09:00",
    "requiresPayment": false
  }'
```

### Test Paid Appointments

```bash
curl -X POST http://localhost:3000/api/appointments \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Jane Smith",
    "customerEmail": "jane@example.com",
    "date": "2025-01-21",
    "time": "10:00",
    "requiresPayment": true,
    "amount": 5000
  }'
```

Expected response includes `checkoutUrl` for payment.

### Test Listing with Payment Status

```bash
curl http://localhost:3000/api/appointments?includeOrderStatus=true
```

## Error Handling

The system gracefully degrades when payment operations fail:

- **Payment session creation fails**: Returns 500 error, appointment not created
- **Order status query fails**: Shows "Payment Unknown" status, appointment still visible
- **Provider not configured**: Throws clear error message

## Benefits of This Design

### For Users

- Flexible payment options
- Consistent booking experience
- Clear payment status visibility

### For Developers

- Easy to add new providers
- Clean separation of concerns
- Testable with mock providers
- Provider-agnostic appointment logic

### For AI Agents

- **Clear extension point**: Factory function is the single place to modify
- **Interface contract**: New providers just implement PaymentProvider
- **Minimal changes**: Agent only updates factory + creates provider class
- **No logic changes**: Appointment creation/listing code stays the same

## Pricing Configuration

All paid appointments use a **unified pricing tier system**:

- **Fixed price**: Single-item `pricingTiers` array
- **Variable pricing**: Multi-item `pricingTiers` array
- **Free appointments**: No `pricingTiers` needed

This keeps the logic simple and consistent - there's only one code path for all paid appointments.

### Free Appointments

**No payment configuration needed:**

```typescript
// src/lib/appointments.config.ts
export const config = {
  serviceName: 'Free Consultation',
  duration: 60,
  businessHoursStart: '09:00',
  businessHoursEnd: '17:00',
  workingDays: [1, 2, 3, 4, 5],
  // No pricingTiers = free appointments
};
```

### Fixed Price Appointments

**Setup**: Agent creates ONE SKU with your configured price

**Configuration:**

```typescript
// src/lib/appointments.config.ts
export const config = {
  serviceName: 'Web Design Consultation',
  duration: 60,
  businessHoursStart: '09:00',
  businessHoursEnd: '17:00',
  workingDays: [1, 2, 3, 4, 5],
  pricingTiers: [
    {
      label: 'Web Design Consultation',
      duration: 60,
      amount: 5000, // $50.00 in cents
      skuId: 'sku_xxxxxxxxxxxxx',
    },
  ],
};
```

**SKU naming**: `web-design-consultation-5000` (service name + amount in cents)

### Variable Pricing Example

**Setup**: Agent creates ONE SKU per tier

**Configuration:**

```typescript
// src/lib/appointments.config.ts
export const config = {
  serviceName: 'Tutoring Session',
  duration: 60, // Duration of first/default tier
  businessHoursStart: '09:00',
  businessHoursEnd: '17:00',
  workingDays: [1, 2, 3, 4, 5],
  pricingTiers: [
    { label: '30 minutes', duration: 30, amount: 2500, skuId: 'sku_tier1' },
    { label: '60 minutes', duration: 60, amount: 5000, skuId: 'sku_tier2' },
    { label: '90 minutes', duration: 90, amount: 10000, skuId: 'sku_tier3' },
  ],
};
```

**SKU naming**: `tutoring-session-2500`, `tutoring-session-5000`, `tutoring-session-10000`

### Payment Flow

1. User selects a pricing tier in the booking UI (or the only tier for fixed-price)
2. Appointment POST endpoint finds matching tier: `config.pricingTiers.find(t => t.amount === body.amount)`
3. Passes tier's `skuId` to payment provider
4. Customer is charged the exact tier price via correct SKU

### Manual SKU Setup (Advanced)

If you need to add or modify pricing tiers after initial setup:

1. Create additional SKUs in your Commerce store (via Commerce dashboard or `commerce__manage_products` tool)
2. Add the tier to your `appointments.config.ts`:

```typescript
pricingTiers: [
  // ...existing tiers
  { label: '2 hours', duration: 120, amount: 15000, skuId: 'sku_new_tier' },
],
```

3. Update your booking UI to offer the new tier option

**Naming convention:** SKUs are named `{service-slug}-{amount_in_cents}` where service-slug is the lowercase, hyphenated service name:

- `web-design-consultation-5000` for $50 Web Design Consultation
- `tutoring-session-2500` for $25 Tutoring Session
- `yoga-class-3000` for $30 Yoga Class

This makes SKUs readable, searchable, and tied to the specific service.

## Troubleshooting

### Payment session creation fails

Check:

1. `VITE_GODADDY_STORE_ID` environment variable is set (automatically configured by commerce skill)
2. `GODADDY_API_BASE_URL` environment variable is set
3. OAuth credentials exist in `/local/config.json` (system-managed)
4. commerce-one-time-payment skill is installed
5. Commerce store was set up via `commerce` skill before installing appointment booking
6. **Commerce store has an "appointment-booking" SKU created** (or customize the hard-coded SKU ID)
7. Network connectivity to Commerce API

### Order status shows "Unknown"

- Payment provider credentials may be expired
- Order ID may be invalid (check format)
- Network issues with order API
- Provider-specific errors (check logs)

### Customer charged wrong amount

- Verify all tiers in `appointments.config.ts` have correct `skuId` values
- Confirm each SKU in Commerce has the correct price (amount in config must match SKU price)
- Check that booking UI correctly passes the selected tier's amount to the API
- Look for logs with `appointments.payment.session_failed` to see if SKU lookup failed
- Common issue: Amount passed from frontend doesn't match any tier in config (e.g., passing 5000 but config only has 2500 and 10000)

## Future Enhancements

Potential additions:

- Webhook handlers for payment status updates
- Automatic refund support
- Multiple payment methods per provider
- Payment retry logic
- Installment/subscription support
