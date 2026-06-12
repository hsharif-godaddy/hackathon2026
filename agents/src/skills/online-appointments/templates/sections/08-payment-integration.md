## § Payment Integration ⚠️ COMPLEX

**PREREQUISITES: Complete Commerce setup, then GoDaddy Payments setup**

```typescript
skill({ action: 'load', skill: 'commerce' });
// Follow the Commerce setup workflow for store/channel context and SKU/cart setup.
skill({ action: 'load', skill: 'payment/godaddy-payments' });
// Follow the loaded setup workflow, reusing Commerce store/channel context where available.
skill({ action: 'install', skill: 'payment/godaddy-payments' });
```

Install only after the Commerce plus GoDaddy Payments setup/channel workflow has produced
store/channel env values. This provides:
- Payment provider abstraction (`getPaymentProvider`)
- GoDaddy Payments checkout integration
- Required environment variables

**Environment variables needed (provided by GoDaddy Payments setup):**
- `VITE_GODADDY_STORE_ID` - Your GoDaddy Commerce store ID
- `VITE_GODADDY_CHANNEL_ID` - Airo App Builder channel ID
- `GODADDY_API_BASE_URL` - Commerce API URL
- GoDaddy OAuth credentials from platform-mounted config

**The GoDaddy Payments skill handles provider checkout configuration.** The payment-provider factory in online-appointments templates will automatically detect the configured provider.

---

**CRITICAL CONCEPTS:**

- **No webhooks.** GoDaddy Commerce does not deliver webhooks. The success page polls
  `provider.getOrderStatus(orderId)` and is the only place an appointment becomes truly
  confirmed.
- **`orderId` = draftOrderId.** `createPaymentSession` returns the GoDaddy draftOrderId as
  `orderId`; that value is written to `appointment.order_id` and never replaced. There is no
  separate "real orderId" in the row.
- **sessionStorage** → Store `appointmentId` + `orderId` (the draftOrderId) before redirect,
  retrieve on the success page.
- **Free first appointment logic** → For each prior row with `orderId IS NOT NULL`, call
  `provider.getOrderStatus(orderId)` and only count rows whose status is `'paid'`. Abandoned
  draft orders therefore do not count against the free slot.
- **Currency comes from the SKU.** The GoDaddy provider derives the customer-facing
  currency from the SKU's catalog price; the `currency` field on
  `CreatePaymentSessionParams` is advisory. Set `config.currency` to match the SKU
  currency so all our display formatting uses the right symbol/format. See § 8.8 for the
  full multi-currency contract.

### 8.1 Payment Provider Interface

**Already exists in templates:** `src/server/utils/payment-provider.ts`. The shipped
interface is:

```typescript
export interface CreatePaymentSessionParams {
  amount: number;
  currency: string;
  description: string;
  returnUrl: string;
  successUrl: string;
  skuId: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentSession {
  /** URL to redirect user for payment */
  paymentUrl: string;
  /** Provider's order/payment tracking ID (draftOrderId for GoDaddy) */
  orderId: string;
}

export interface OrderStatus {
  orderId: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled';
  amount: number;
  currency: string;
}

export interface PaymentProvider {
  createPaymentSession(params: CreatePaymentSessionParams): Promise<PaymentSession>;
  getOrderStatus(orderId: string): Promise<OrderStatus>;
}
```

There is no `customer` field on `CreatePaymentSessionParams`. The shipped GoDaddy provider
does not forward customer name/email/phone to checkout — do not pretend it does.

### 8.2 GoDaddy Commerce Implementation

**Already exists:** `src/server/utils/godaddy-commerce-provider.ts`

**Key points:**

- Uses the in-process checkout helpers installed by the GoDaddy Payments skill.
- `createPaymentSession()` returns `{ paymentUrl, orderId }` where `orderId` is the
  GoDaddy **draftOrderId**.
- That value is stored in `appointment.order_id`. The row is **not** updated with a
  different "real" order id when the customer pays — `getOrderStatus(orderId)` is the source
  of truth.
- **No webhooks.** The success page is what confirms the booking — see § 8.4.
- GoDaddy does **not** append the orderId to `successUrl`. The booking form must persist
  `orderId` to `sessionStorage` before redirect so the success page can poll status.

### 8.3 Appointment Creation with Payment

**File: `src/server/api/appointments/POST.ts`** (already shipped by this skill — these notes
exist so you can extend it, not so you rewrite it from scratch).

**Flow (matches the real handler):**

1. Validate input with `AppointmentInputSchema`.
2. Reject past dates / past time slots.
3. Compute `startTime`/`endTime` from `date` + `time` + service duration.
4. Pre-check that the payment provider is configured if `requiresPayment` is true.
5. **STEP 1 (transaction):** read existing rows for the day, recompute available slots, and
   insert the appointment row with `orderId: null` to reserve the slot. The transaction holds
   the SQLite write lock; do **not** make external HTTP calls inside it.
6. **STEP 2 (outside transaction):** look up the matching `pricingTiers` SKU, call
   `paymentProvider.createPaymentSession(...)`, get back `{ paymentUrl, orderId }`. On
   failure, delete the reserved row and return a typed payment error.
7. **STEP 3 (separate quick update):** `UPDATE appointment SET order_id = ? WHERE id = ?`.
8. Respond with `{ id, ..., requiresPayment, checkoutUrl?, orderId? }`.

The free-vs-paid branch is selected by `body.requiresPayment` (boolean). Free appointments
skip steps 4–7 entirely and return immediately.

**Redirect flow:**

```
Client                          Server                      GoDaddy Commerce
  |                               |                               |
  |--POST /api/appointments------>|                               |
  |                               |--createPaymentSession()------>|
  |                               |<--{ paymentUrl, orderId }-----|
  |<--{ id, checkoutUrl, orderId }|                               |
  |                               |                               |
  |--Redirect to checkoutUrl-------------------------------------->|
  |                          (Customer pays)                      |
  |<--Redirect to successUrl---------------------------------------|
  |--GET /appointments/success--->|                               |
  |                               |--getOrderStatus(orderId)----->|
  |                               |<--{ status: 'paid', ... }-----|
```

**Imports the shipped handler actually uses:**

```typescript
import { db } from '../../db/client';                              // database skill
import { appointment } from '../../db/schema';                     // singular table
import { getPaymentProvider, isPaymentProviderConfigured }
  from '../../utils/payment-provider-factory';
import { PaymentProviderError, PaymentProviderErrorCode }
  from '../../utils/payment-provider';
```

**If you need to extend the handler** (e.g. to add a free-first check before step 5), the
column you read is `orderId` (not `paymentIntentId`).

**Schema extension required.** `freeFirstAppointment` is **not** in
`AppointmentsConfigSchema`; add it to `templates/lib/appointments.ts` first:

```typescript
export const AppointmentsConfigSchema = z.object({
  // ...existing fields...
  freeFirstAppointment: z.boolean().optional().default(false),
});
```

Then the handler can read `config.freeFirstAppointment` and only count rows whose order has
actually paid:

```typescript
const priorRows = await db
  .select({ id: appointment.id, orderId: appointment.orderId })
  .from(appointment)
  .where(and(
    eq(appointment.customerEmail, body.customerEmail),
    isNotNull(appointment.orderId),
  ));

let alreadyPaid = false;
for (const row of priorRows) {
  if (!row.orderId) continue;
  const orderStatus = await paymentProvider.getOrderStatus(row.orderId);
  if (orderStatus.status === 'paid') {
    alreadyPaid = true;
    break;
  }
}

if (!alreadyPaid && config.freeFirstAppointment) {
  body.requiresPayment = false;
  body.amount = undefined;
}
```

**Successful response shape (from the real handler):**

```typescript
{
  id,
  customerName,
  customerEmail,
  date,                  // 'YYYY-MM-DD'
  time,                  // 'HH:mm'
  endTime,               // 'HH:mm'
  status: 'confirmed',
  serviceName,
  duration,
  requiresPayment,
  // Only present when payment was created:
  checkoutUrl,           // = session.paymentUrl
  orderId,               // = session.orderId (the draftOrderId)
}
```

### 8.4 Success Page (Return from Payment)

**File: `src/pages/AppointmentSuccess.tsx`** (Vite + React Router; register at
`/appointments/success`).

**Purpose:** Customer lands here after payment. Check payment status and finalize the
booking.

**CRITICAL:** GoDaddy Commerce does **NOT** have webhooks. The success page must:
1. Retrieve `appointmentId` and the `orderId` (= draftOrderId) from `sessionStorage`
   (stored by the booking form before redirect).
2. Check payment status via the GoDaddy Payments `order-status` endpoint.
3. If `status === 'paid'`, POST `{ orderId }` to `/api/appointments/:id/confirm-payment`,
   which sends the confirmation email with the `.ics` invite. The `appointment.orderId`
   row is already populated from booking time — there is no separate id to write back.

```typescript
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function SuccessPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'checking' | 'confirmed' | 'failed'>('checking');
  const [appointment, setAppointment] = useState<any>(null);

  useEffect(() => {
    async function verifyPayment() {
      try {
        // Get appointmentId and draftOrderId from sessionStorage
        // (Stored by booking form before redirecting to checkout)
        const appointmentId = sessionStorage.getItem('pending-appointment-id');
        const draftOrderId = sessionStorage.getItem('pending-draft-order-id');
        
        if (!appointmentId || !draftOrderId) {
          setStatus('failed');
          return;
        }

        // Check payment status via the GoDaddy Payments order-status route.
        const statusRes = await fetch(`/api/commerce/order-status?orderId=${draftOrderId}`);
        const statusData = await statusRes.json();

        if (!statusData.success) {
          setStatus('failed');
          return;
        }

        // If payment is complete, finalize the appointment (sends confirmation email).
        // `orderId` here is the same draftOrderId we stored before redirect — there is no
        // separate "real orderId" to pass back; the row already has it.
        if (statusData.status === 'paid') {
          const updateRes = await fetch(`/api/appointments/${appointmentId}/confirm-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: draftOrderId }),
          });

          if (updateRes.ok) {
            const aptData = await updateRes.json();
            setAppointment(aptData);
            setStatus('confirmed');
            
            // Clear sessionStorage
            sessionStorage.removeItem('pending-appointment-id');
            sessionStorage.removeItem('pending-draft-order-id');
          } else {
            setStatus('failed');
          }
        } else {
          // Payment not complete yet - poll or show pending
          setStatus('failed');
        }
      } catch (error) {
        console.error('Payment verification failed:', error);
        setStatus('failed');
      }
    }

    verifyPayment();
  }, []);

  if (status === 'checking') {
    return (
      <main className="success-page">
        <h1>Verifying Payment...</h1>
        <p>Please wait while we confirm your booking.</p>
      </main>
    );
  }

  if (status === 'failed') {
    return (
      <main className="success-page">
        <h1>Payment Verification Failed</h1>
        <p>Your booking could not be confirmed. Please contact support.</p>
        <button onClick={() => navigate('/book')}>Return to Booking</button>
      </main>
    );
  }

  return (
    <main className="success-page">
      {status === 'processing' && (
        <>
          <h1>Processing Your Payment...</h1>
          <p>Please wait while we confirm your booking.</p>
        </>
      )}
      {status === 'confirmed' && (
        <>
          <h1>Booking Confirmed!</h1>
          <p>Check your email for confirmation details.</p>
          <a href="/">Book Another Appointment</a>
        </>
      )}
      {status === 'failed' && (
        <>
          <h1>Payment Failed</h1>
          <p>Your booking could not be confirmed. Please try again.</p>
          <a href="/">Return to Booking</a>
        </>
      )}
    </main>
  );
}
```

### 8.5 Confirm Payment Endpoint

**File: `src/server/api/appointments/[id]/confirm-payment/POST.ts`**

> **Route registration:** the v8 template has no auto-router for nested `api/` directories.
> After creating this file, register the route explicitly in `src/server/entry.ts`:
> `app.post('/api/appointments/:id/confirm-payment', confirmPayment)`. The `[id]` directory
> name is convention only — the actual binding to `:id` happens in `entry.ts`.

**Purpose:** Called by the success page after it has verified payment via the provider.
The booking row already has `orderId` (the draftOrderId) — there is no separate "real
orderId" to write back; the row exists, payment is confirmed externally, and this endpoint
exists to (a) sanity-check the orderId the client posts back and (b) trigger the
confirmation email.

```typescript
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../../../db/client';
import { appointment } from '../../../../db/schema';
import { sendConfirmationEmail } from '../../../utils/appointment-email';

export default async function handler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { orderId } = req.body as { orderId: string };

    const rows = await db
      .select()
      .from(appointment)
      .where(eq(appointment.id, id))
      .limit(1);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const apt = rows[0];

    // The orderId the success page posts back must match the row's stored draftOrderId
    if (apt.orderId !== orderId) {
      return res.status(400).json({ error: 'Invalid order ID for this appointment' });
    }

    // Send confirmation email with calendar invite (idempotent: send once per row).
    // Payment status itself is verified by the success page via getOrderStatus before
    // calling this endpoint; this endpoint does not re-check it.
    await sendConfirmationEmail({
      customerEmail: apt.customerEmail,
      customerName: apt.customerName,
      startTime: apt.startTime,
      endTime: apt.endTime,
      duration: Math.round((apt.endTime.getTime() - apt.startTime.getTime()) / 60000),
      amount: apt.amount ?? undefined,
      notes: apt.notes ?? undefined,
    });

    return res.json({
      id: apt.id,
      status: apt.status,
      customerName: apt.customerName,
      customerEmail: apt.customerEmail,
    });
  } catch (error) {
    console.error('Confirm payment failed:', error);
    return res.status(500).json({ error: 'Failed to confirm payment' });
  }
}
```

### 8.6 Update Booking Form to Store IDs

**Modify the booking form to store `appointmentId` and `orderId` (the draftOrderId returned
by `POST /api/appointments`) before redirecting to checkout.**

Note the response field names: the real `POST.ts` returns `id` (the appointment id) and
`orderId` (the draftOrderId). It does **not** return `appointmentId` or `draftOrderId`.

```typescript
async function handleSubmit(formData: BookingFormData) {
  // ... existing validation ...

  if (requiresPayment && !isFirstAppointment) {
    const response = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: formData.customerName,
        customerEmail: formData.customerEmail,
        customerPhone: formData.customerPhone,
        date: format(selectedDate, 'yyyy-MM-dd'),
        time: selectedTime,
        amount: (selectedTier ?? config.pricingTiers?.[0])?.amount,
        requiresPayment: true,
      }),
    });

    const data = await response.json() as {
      id: string;
      checkoutUrl?: string;
      orderId?: string;
    };

    if (data.checkoutUrl && data.orderId) {
      // Store IDs in sessionStorage BEFORE redirecting — GoDaddy does not append them
      // to the success URL, so the success page reads them back from here.
      sessionStorage.setItem('pending-appointment-id', data.id);
      sessionStorage.setItem('pending-draft-order-id', data.orderId);

      window.location.href = data.checkoutUrl;
    } else {
      alert('Failed to create payment session');
    }
  } else {
    // Free appointment - create directly
    // ... existing free booking logic ...
  }
}
```

### 8.7 Free First Appointment Logic

**Schema extension required.** `freeFirstAppointment` is **not** in the shipped
`AppointmentsConfigSchema`. Extend the schema in `templates/lib/appointments.ts` (see § 8.3
for the snippet) before relying on `config.freeFirstAppointment` here — otherwise Zod
silently strips the field and this branch never fires.

**Key insight:** the `orderId` column alone does not prove payment — it stores the
draftOrderId, which exists for both completed and abandoned checkouts. A draft that the
customer never paid for must not count against the free slot.

**Implementation:** for each prior row with a non-null `orderId`, call
`provider.getOrderStatus(orderId)` and only count `status === 'paid'`.

```typescript
if (config.freeFirstAppointment && body.requiresPayment) {
  const priorRows = await db
    .select({ id: appointment.id, orderId: appointment.orderId })
    .from(appointment)
    .where(and(
      eq(appointment.customerEmail, body.customerEmail),
      isNotNull(appointment.orderId),
    ));

  let alreadyPaid = false;
  for (const row of priorRows) {
    if (!row.orderId) continue;
    const orderStatus = await paymentProvider.getOrderStatus(row.orderId);
    if (orderStatus.status === 'paid') {
      alreadyPaid = true;
      break;
    }
  }

  if (!alreadyPaid) {
    body.requiresPayment = false;
    body.amount = undefined;
  }
}
```

### 8.8 Multi-currency support

The system supports any ISO 4217 currency. The contract:

| Layer | What it does |
| --- | --- |
| `config.currency` | Display currency. Three-letter ISO 4217 (`'USD'`, `'EUR'`, `'GBP'`, `'JPY'`, `'CAD'`, `'AUD'`, `'KWD'`...). Default `'USD'`. |
| `pricingTiers[].amount` | Integer in the smallest unit of `config.currency`. Cents for USD/EUR/GBP/CAD/AUD; whole yen for JPY (no decimals); fils for KWD (3 decimals). |
| GoDaddy SKU currency | **Source of truth at checkout.** Must match `config.currency`. GoDaddy reads the price from the SKU and bills in that currency regardless of what we pass in `CreatePaymentSessionParams.currency`. |
| `provider.getOrderStatus()` | Returns the SKU's currency on the read path (success page, admin dashboard). Use that value when you need authoritative post-payment currency. |
| `formatMoney(amount, currency, locale?)` | Single source for display. Uses `Intl.NumberFormat` so per-currency fraction digits are correct (no decimals for JPY, three for KWD, two for the rest). |

**Setup checklist for a non-USD merchant:**

1. Load `commerce` and complete store/channel setup for the app.
2. Set `config.currency: 'EUR'` (or whatever ISO code).
3. Use the `commerce` skill to create SKUs **priced in that currency**: call
   `commerce__search_tools` to find the product/SKU creation tool, then call
   `commerce__execute_tool` with the MCP tool name and arguments.
4. Fill `pricingTiers[].skuId` with the resulting SKU IDs and `pricingTiers[].amount` in
   the smallest unit of that currency.
5. Load/install `payment/godaddy-payments` for checkout routes/helpers. All UI templates
   already call `formatMoney(...)` — no further display changes needed.

**Sanity checks:**

- Mismatch between `config.currency` and the SKU currency does **not** error at session
  creation (the GoDaddy provider doesn't forward our currency hint). It surfaces only on
  the success page where `getOrderStatus().currency` will disagree with `config.currency`.
  If you want a hard guard, compare the two values in the success-page handler and fail
  loudly if they differ.
- Don't manually multiply/divide `amount` by 100 anywhere. Let `formatMoney` use CLDR's
  per-currency fraction-digits — that's the only path that handles JPY (0 decimals) and
  KWD (3 decimals) correctly.
- If `pricingTiers` cross currencies for some reason (you shouldn't), the schema's "unique
  amounts" refinement is per-array-of-numbers and won't catch the issue. Stick to one
  currency per `appointments.config.ts`.
