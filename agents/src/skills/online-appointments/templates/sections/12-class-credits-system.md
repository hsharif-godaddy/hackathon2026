## § Class Credits System

**Full implementation for class packages (yoga studio, fitness, etc.).**

**Schema extension required.** `classPackages` is **not** in the shipped
`AppointmentsConfigSchema`. Before any of this works, add the `ClassPackageSchema` and
optional `classPackages` field to `templates/lib/appointments.ts` — see § 2.3 for the
exact snippet. Without that extension, Zod strips `classPackages` from the loaded config
and `config.classPackages?.find(...)` is always `undefined`.

The same applies if you also want auth-tied credit balances: you'll need to add a `credits`
column to the Better Auth `user` table and a `creditTransactions` table, both of which the
shipped database schema does not include.

### 12.1 Credits Purchase Page

**File: `src/pages/PurchaseCredits.tsx`** (Vite + React Router; register at
`/credits/purchase`. No `'use client'` directive.)

```typescript
import { useState, useEffect } from 'react';
import { formatMoney } from '@/lib/appointments';

export default function PurchaseCreditsPage() {
  const [config, setConfig] = useState(null);
  const [selectedPackage, setSelectedPackage] = useState(null);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then(setConfig);
  }, []);

  async function handlePurchase() {
    const res = await fetch('/api/credits/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: selectedPackage.label }),
    });

    const data = await res.json();
    window.location.href = data.checkoutUrl; // Redirect to payment
  }

  if (!config || !config.classPackages) return <div>Loading...</div>;

  return (
    <main className="purchase-credits">
      <h1>Buy Class Credits</h1>
      <div className="packages">
        {config.classPackages.map((pkg) => (
          <div
            key={pkg.label}
            className={`package ${selectedPackage?.label === pkg.label ? 'selected' : ''}`}
            onClick={() => setSelectedPackage(pkg)}
          >
            <h3>{pkg.label}</h3>
            <p>{pkg.credits} credits</p>
            <p>{formatMoney(pkg.amount, config.currency)}</p>
            {pkg.credits > 1 && (
              <p className="savings">
                {formatMoney(Math.round(pkg.amount / pkg.credits), config.currency)} per class
              </p>
            )}
          </div>
        ))}
      </div>
      {selectedPackage && (
        <button onClick={handlePurchase} className="checkout-btn">
          Buy {selectedPackage.label}
        </button>
      )}
    </main>
  );
}
```

### 12.2 Credits Purchase API

**File: `src/server/api/credits/purchase/POST.ts`**

The shipped payment-provider factory is `getPaymentProvider(baseUrl)`, and the session it
returns is `{ paymentUrl, orderId }` (not `{ checkoutUrl, id }`). Store the `orderId`
(draftOrderId) on the transaction row and let the **success page** poll
`getOrderStatus(orderId)` to credit the user — there are no webhooks.

```typescript
import type { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../../../db/client';
import { creditTransactions } from '../../../db/schema';
import { getPaymentProvider } from '../../../utils/payment-provider-factory';
import { getConfig } from '../../../../lib/appointments';
import { requireAuth } from '../../../middleware/auth';

export default async function handler(req: Request, res: Response) {
  await requireAuth(req, res);

  const { packageId } = req.body as { packageId: string };
  const userId = req.user.id;

  const config = await getConfig();
  const pkg = config.classPackages?.find((p) => p.label === packageId);
  if (!pkg) {
    return res.status(400).json({ error: 'Invalid package' });
  }

  const transactionId = nanoid();
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const provider = getPaymentProvider(baseUrl);

  const session = await provider.createPaymentSession({
    amount: pkg.amount,
    currency: config.currency, // advisory; GoDaddy uses the SKU's currency at checkout
    description: `${pkg.label} - ${pkg.credits} credits`,
    returnUrl: `${baseUrl}/credits/purchase`,
    successUrl: `${baseUrl}/credits/success?transactionId=${transactionId}`,
    skuId: pkg.skuId,
  });

  // Pending transaction: 'pending' until the success page verifies payment via getOrderStatus.
  await db.insert(creditTransactions).values({
    id: transactionId,
    userId,
    amount: pkg.credits,
    type: 'purchase',
    status: 'pending',
    orderId: session.orderId,        // draftOrderId from provider
    createdAt: new Date(),
  });

  return res.json({
    checkoutUrl: session.paymentUrl,  // shape parity with /api/appointments
    orderId: session.orderId,
    transactionId,
  });
}
```

### 12.3 Credits Success Page (no webhooks)

GoDaddy Commerce does not deliver webhooks. The success page at `/credits/success?transactionId=...`
is the only place credits are added to the user. Flow:

1. Read `transactionId` from the query string.
2. Look up the row in `creditTransactions`; if `status !== 'pending'`, treat as already
   processed and exit (idempotent).
3. Call `provider.getOrderStatus(transaction.orderId)`. If `status === 'paid'`, atomically:
   - `UPDATE creditTransactions SET status = 'completed' WHERE id = ?`
   - `UPDATE user SET credits = credits + ? WHERE id = ?` (in a transaction)
4. Render confirmation; redirect back to `/account` after a short delay.

This is the credits analogue of `§ 8.4 Success Page`. Reuse the same pattern: poll status,
update state on a typed `'paid'` response, no separate webhook endpoint.

### 12.4 Credit-Based Booking

**Modify `src/server/api/appointments/POST.ts` to require credits when `config.classPackages`
is set.** Real templates use the singular `appointment` table and `startTime`/`endTime`
timestamps; the credit branch must do the same — **and it must run the same
slot-availability check as the paying-via-checkout branch**, otherwise a credit-paying
customer can race a checkout-paying customer and double-book the slot.

The cleanest fix is to extract the slot conflict check from the shipped `POST.ts` (it
currently lives in STEP 1 of the transaction at `templates/server/api/appointments/POST.ts:162-203`)
into a shared helper — e.g. `assertSlotAvailable(tx, parsedDate, time)` — and call it from
both branches. The credit branch then becomes:

```typescript
if (config.classPackages) {
  await requireAuth(req, res);
  const userId = req.user.id;

  await db.transaction(async (tx) => {
    // Same slot-availability check the paying branch uses — extract to a shared helper
    // (see § 8.3 STEP 1) and call it here. Without this, two clients can grab the same
    // slot when one pays via Commerce and the other pays with credits.
    await assertSlotAvailable(tx, parsedDate, body.time);

    const rows = await tx.select({ credits: user.credits })
      .from(user).where(eq(user.id, userId)).limit(1);

    if (rows.length === 0 || rows[0].credits < 1) {
      throw new Error('Insufficient credits');
    }

    await tx.update(user)
      .set({ credits: rows[0].credits - 1 })
      .where(eq(user.id, userId));

    await tx.insert(creditTransactions).values({
      id: nanoid(),
      userId,
      amount: -1,
      type: 'booking',
      status: 'completed',
      appointmentId: id,
      createdAt: new Date(),
    });

    await tx.insert(appointment).values({
      id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      startTime,
      endTime,
      status: 'confirmed',
      requiresPayment: false,         // paying with credits, not Commerce
      amount: null,
      orderId: null,
      createdAt: new Date(),
    });
  });

  await sendConfirmationEmail({
    customerEmail: req.user.email,
    customerName: req.user.name,
    startTime,
    endTime,
    duration: config.duration,
  });

  return res.json({ id, status: 'confirmed' });
}
```
