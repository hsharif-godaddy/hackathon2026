## § Troubleshooting

### 13.1 Common Issues

#### Issue: "This slot is already booked" but calendar shows it available

**Cause:** Race condition between client availability check and server booking creation.

**Fix:** Always check for conflicts in `POST /api/appointments` before creating the row.
The shipped handler already does this inside a transaction; if you're extending it, the
column names are `startTime` / `endTime` / `status` on the singular `appointment` table:

```typescript
const dayStart = startOfDay(parsedDate);
const dayEnd = endOfDay(parsedDate);

const existing = await db
  .select({
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
  })
  .from(appointment)
  .where(and(
    gte(appointment.startTime, dayStart),
    lte(appointment.startTime, dayEnd),
    ne(appointment.status, 'cancelled'),
  ));
```

#### Issue: Customer gets charged but appointment is not confirmed

**Cause:** GoDaddy Commerce has no webhooks, so confirmation lives entirely in the
success page. If `getOrderStatus` succeeds but the `confirm-payment` POST silently fails,
the row remains in its pre-payment state and no email goes out.

**Fix:**

1. On the success page, only show "Confirmed" after the `confirm-payment` POST returns 2xx.
2. Treat the success-page poll as retryable: if `getOrderStatus(orderId)` returns `'pending'`,
   poll a few times with backoff before giving up.
3. Log the `orderId` and the appointment id on every failure so support can manually
   reconcile.
4. Provide a re-poll fallback: a `/appointments/:id/check-payment` endpoint that calls
   `getOrderStatus(appointment.orderId)` and triggers the confirmation email if status is
   `'paid'`. This is the support hatch for customers who closed the success page early.

#### Issue: Free first appointment not working

**Check:**

1. `freeFirstAppointment: true` in config.
2. The lookup queries `appointment.orderId` (the only column on the row that points at
   payment), and then verifies each prior `orderId` with `getOrderStatus`:

```typescript
const priorRows = await db
  .select({ orderId: appointment.orderId })
  .from(appointment)
  .where(and(
    eq(appointment.customerEmail, body.customerEmail),
    isNotNull(appointment.orderId),
  ));

let alreadyPaid = false;
for (const row of priorRows) {
  if (!row.orderId) continue;
  const orderStatus = await provider.getOrderStatus(row.orderId);
  if (orderStatus.status === 'paid') { alreadyPaid = true; break; }
}
```

3. Email comparison is case-insensitive:

```typescript
eq(sql`lower(${appointment.customerEmail})`, body.customerEmail.toLowerCase());
```

#### Issue: Time slots not respecting timezone

**Cause:** Client and server using different timezones. The shipped schema has no
`timezone` field — date math runs in local-server time. If you need cross-timezone
support, you need to (a) extend `AppointmentsConfigSchema` with `timezone: z.string()`,
(b) add `date-fns-tz` to the slot generator, and (c) convert client selections at the
boundary.

```typescript
// After adding `timezone` to AppointmentsConfigSchema:
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';

const zonedDate = utcToZonedTime(new Date(`${date}T${time}`), config.timezone);
```

#### Issue: Build fails with "Cannot find module './config/appointments.config'"

**Cause:** Config file not created yet (discovery questions not completed).

**Fix:**

1. Make config import conditional:

```typescript
let config;
try {
  config = await import('./config/appointments.config');
} catch {
  return res.status(500).json({ error: 'Service not configured yet' });
}
```

2. Or provide example config with commented instructions

### 13.2 Testing Checklist

Before going live:

- [ ] Test booking with payment (real card via Commerce test mode)
- [ ] Verify the success page confirms via `getOrderStatus` and triggers the email
- [ ] Check confirmation email sends and contains correct info
- [ ] Test free first appointment (if enabled) — including the "abandoned draft does not count" case
- [ ] Test all pricing tiers (if variable pricing)
- [ ] Test credit purchase and booking (if class packages)
- [ ] Verify timezone handling for cross-timezone customers
- [ ] Test double-booking prevention (open two tabs, try booking same slot)
- [ ] Test admin dashboard cancellation
- [ ] Test edge cases: payment failure, customer closes success page before confirm POST returns

### 13.3 Performance Optimization

For high-traffic services:

1. **Database indexes** — add to the singular `appointment` table on the timestamp + email columns:

```sql
CREATE INDEX idx_appointment_start_time ON appointment(start_time);
CREATE INDEX idx_appointment_customer_email ON appointment(customer_email);
```

2. **Cache available slots** (Redis or in-memory):

```typescript
const cacheKey = `slots:${date}`;
let slots = await redis.get(cacheKey);
if (!slots) {
  slots = await calculateAvailableSlots(date);
  await redis.setex(cacheKey, 60, JSON.stringify(slots)); // Cache 1 min
}
```

3. **Success-page idempotency** — the success page may be reloaded by an impatient
   customer. Make the confirm-payment endpoint idempotent (a duplicate call should not
   send a second email). One approach: store a `confirmedAt` timestamp on the row and
   short-circuit if it is already set. There is no webhook retry to worry about.
