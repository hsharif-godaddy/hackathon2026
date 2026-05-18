## § Booking Page Flow

### 7.1 Complete Booking Page (Fixed Price)

**Create: `src/pages/BookAppointment.tsx`** (Vite + React Router; the v8 template does not
use Next.js, so there is no `app/` directory and no `'use client'` directive). Register the
component as the `/book` route in `src/App.tsx`.

```typescript
import { useState, useEffect } from 'react';
import { Calendar } from '@/components/appointments/Calendar';
import { TimeSlotPicker } from '@/components/appointments/TimeSlotPicker';
import { formatMoney } from '@/lib/appointments';
import { format } from 'date-fns';

export default function BookingPage() {
  const [config, setConfig] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [bookedSlots, setBookedSlots] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load config
  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then(setConfig);
  }, []);

  // Load slots when date selected
  useEffect(() => {
    if (!selectedDate) return;
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    fetch(`/api/slots?date=${dateStr}`)
      .then((res) => res.json())
      .then((data) => {
        setAvailableSlots(data.available);
        setBookedSlots(data.booked);
      });
  }, [selectedDate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Fixed-price service: tier 0 holds the only price.
      // The handler validates the amount/SKU pair server-side, so we just send what
      // the tier says.
      const tier = config.pricingTiers?.[0];
      const requiresPayment = !!tier;

      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: format(selectedDate, 'yyyy-MM-dd'),
          time: selectedTime,
          customerName,
          customerEmail,
          customerPhone,
          requiresPayment,
          ...(tier ? { amount: tier.amount } : {}),
        }),
      });

      const data = await res.json();

      if (requiresPayment && data.checkoutUrl) {
        // Persist appointmentId + orderId (= draftOrderId) for the success page poll
        sessionStorage.setItem('pending-appointment-id', data.id);
        sessionStorage.setItem('pending-draft-order-id', data.orderId);
        window.location.href = data.checkoutUrl;
      } else {
        alert('Booking confirmed! Check your email for details.');
        window.location.reload();
      }
    } catch (error) {
      alert('Booking failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!config) return <div>Loading...</div>;

  // Derive payment-needed from `pricingTiers` — there is no `config.requiresPayment`.
  const requiresPayment = !!config.pricingTiers?.length;
  const fixedTier = config.pricingTiers?.[0];

  return (
    <main className="booking-page">
      <h1>Book Your {config.serviceName}</h1>

      <form onSubmit={handleSubmit}>
        <section>
          <h2>Select Date</h2>
          <Calendar
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            workingDays={config.workingDays}
          />
        </section>

        {selectedDate && (
          <section>
            <h2>Select Time</h2>
            <TimeSlotPicker
              slots={availableSlots}
              selectedTime={selectedTime}
              onSelectTime={setSelectedTime}
              bookedSlots={bookedSlots}
            />
          </section>
        )}

        {selectedTime && (
          <section>
            <h2>Your Information</h2>
            <input
              type="text"
              placeholder="Full Name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
            />
            <input
              type="email"
              placeholder="Email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              required
            />
            <input
              type="tel"
              placeholder="Phone (optional)"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </section>
        )}

        {selectedTime && (
          <section>
            <h2>Summary</h2>
            <p>Date: {format(selectedDate, 'MMMM d, yyyy')}</p>
            <p>Time: {selectedTime}</p>
            <p>Service: {config.serviceName}</p>
            {fixedTier && <p>Total: {formatMoney(fixedTier.amount, config.currency)}</p>}
            <button type="submit" disabled={isSubmitting}>
              {requiresPayment ? 'Proceed to Payment' : 'Confirm Booking'}
            </button>
          </section>
        )}
      </form>
    </main>
  );
}
```

**Note:** the shipped `Calendar` component does not need a `timezone` prop — there is no
`config.timezone`. Date math is local-server time; if you need cross-timezone behaviour,
extend the schema and the slot generator together.

### 7.2 Variable Pricing Flow Modification

**Add before calendar:**

```typescript
const [selectedTier, setSelectedTier] = useState(null);

// ... in JSX:
{
  config.pricingTiers && (
    <section>
      <h2>Select Service Type</h2>
      <PricingTierSelector tiers={config.pricingTiers} selectedTier={selectedTier} onSelectTier={setSelectedTier} />
    </section>
  );
}
```

**Modify slots API call:**

```typescript
fetch(`/api/slots?date=${dateStr}&duration=${selectedTier.duration}`)
```

**Modify submit:**

```typescript
body: JSON.stringify({
  // ...existing customer/date/time fields
  requiresPayment: true,
  amount: selectedTier.amount, // server matches this to the tier's skuId
}),
```

The shipped `POST.ts` derives the SKU from `body.amount` against `config.pricingTiers` —
the request does not need to include `duration` or `pricingTier` (those aren't read).
