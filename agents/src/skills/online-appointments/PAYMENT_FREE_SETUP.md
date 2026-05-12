# Payment-Free Appointment Booking

This guide explains how to use the online-appointments skill **WITHOUT any payment functionality** for users who just want simple, free appointment booking.

## TL;DR

**The skill works perfectly without payment configuration.** Just don't set payment-related environment variables, and only create free appointments.

## Zero Configuration Required

For payment-free booking, you need **ZERO payment configuration**:

- ❌ No `VITE_GODADDY_STORE_ID` needed
- ❌ No OAuth credentials needed
- ❌ No commerce-one-time-payment skill needed
- ❌ No Stripe keys needed

**The system automatically detects** when no payment provider is configured and only allows free appointments.

## Creating Free Appointments

### API Request

```bash
curl -X POST http://localhost:3000/api/appointments \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "John Doe",
    "customerEmail": "john@example.com",
    "customerPhone": "555-1234",
    "date": "2025-01-21",
    "time": "09:00",
    "notes": "First time customer"
  }'
```

**Notice:** No `requiresPayment` field needed (defaults to `false`)

### Response

```json
{
  "id": "apt-123",
  "customerName": "John Doe",
  "customerEmail": "john@example.com",
  "date": "2025-01-21",
  "time": "09:00",
  "endTime": "10:00",
  "status": "confirmed",
  "serviceName": "Consultation",
  "duration": 60,
  "requiresPayment": false
}
```

## Listing Appointments

```bash
curl http://localhost:3000/api/appointments
```

### Response

```json
{
  "appointments": [
    {
      "id": "apt-123",
      "customerName": "John Doe",
      "customerEmail": "john@example.com",
      "date": "2025-01-21",
      "time": "09:00",
      "endTime": "10:00",
      "status": "confirmed",
      "requiresPayment": false,
      "displayStatus": "Confirmed (Free)",
      "serviceName": "Consultation",
      "duration": 60
    }
  ]
}
```

## What Happens If Someone Tries to Create Paid Appointment?

If no payment provider is configured and someone tries to create a paid appointment:

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

### Response (400 Bad Request)

```json
{
  "error": "Payment Not Configured",
  "message": "Payment is required but no payment provider is configured. Please contact the administrator.",
  "messageKey": "appointments.error.paymentNotConfigured"
}
```

**The system protects against this** - you can't accidentally create paid appointments without proper payment setup.

## Configuration Summary

### Payment-Free Setup (Simple)

```env
# Only basic configuration needed
# No payment-related vars
```

### With Payments (Advanced)

```env
# GoDaddy Commerce
VITE_GODADDY_STORE_ID=your-store-id
GODADDY_API_BASE_URL=https://api.godaddy.com

# OR Stripe
USE_STRIPE=true
STRIPE_SECRET_KEY=sk_test_...
```

## Database Schema

The appointment table includes payment fields but they're **all optional**:

```typescript
{
  // Required fields (always present)
  id: string;
  customerName: string;
  customerEmail: string;
  startTime: Date;
  endTime: Date;
  status: 'confirmed' | 'cancelled' | 'completed';

  // Optional fields (only for paid appointments)
  requiresPayment: boolean;  // Defaults to false
  amount?: number;           // Null for free appointments
  orderId?: string;          // Null for free appointments

  // Always optional
  customerPhone?: string;
  notes?: string;
}
```

## Frontend Integration

### Simple Free Booking Form

```html
<form id="booking-form">
  <input type="text" name="customerName" required />
  <input type="email" name="customerEmail" required />
  <input type="tel" name="customerPhone" />
  <input type="date" name="date" required />
  <input type="time" name="time" required />
  <textarea name="notes"></textarea>
  <button type="submit">Book Appointment</button>
</form>

<script>
  document.getElementById('booking-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);

    const response = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: formData.get('customerName'),
        customerEmail: formData.get('customerEmail'),
        customerPhone: formData.get('customerPhone'),
        date: formData.get('date'),
        time: formData.get('time'),
        notes: formData.get('notes'),
        // No requiresPayment field = free appointment
      }),
    });

    if (response.ok) {
      alert('Appointment booked successfully!');
    }
  });
</script>
```

**That's it!** No payment logic needed.

## Progressive Enhancement

You can start with free appointments and add payments later without changing appointment logic:

### Phase 1: Launch with Free Appointments

- Deploy with no payment configuration
- Users book free appointments
- All appointments have `requiresPayment: false`

### Phase 2: Add Payment Option Later

- Set `VITE_GODADDY_STORE_ID` environment variable
- Deploy commerce-one-time-payment skill
- Update frontend to include payment option
- Existing free appointments continue working
- New appointments can be paid or free

**No migration needed!** The schema already supports both.

## Testing Payment-Free Flow

### 1. Verify No Payment Configuration

```bash
# Check that payment provider is NOT configured
curl http://localhost:3000/api/appointments/config
# Should show: paymentConfigured: false
```

### 2. Create Multiple Free Appointments

```bash
# Morning slot
curl -X POST http://localhost:3000/api/appointments \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Alice",
    "customerEmail": "alice@example.com",
    "date": "2025-01-21",
    "time": "09:00"
  }'

# Afternoon slot
curl -X POST http://localhost:3000/api/appointments \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Bob",
    "customerEmail": "bob@example.com",
    "date": "2025-01-21",
    "time": "14:00"
  }'
```

### 3. List All Appointments

```bash
curl http://localhost:3000/api/appointments
```

All should show `"displayStatus": "Confirmed (Free)"`

### 4. Verify Paid Appointment is Rejected

```bash
curl -X POST http://localhost:3000/api/appointments \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Charlie",
    "customerEmail": "charlie@example.com",
    "date": "2025-01-21",
    "time": "15:00",
    "requiresPayment": true,
    "amount": 5000
  }'
```

Should return 400 error: "Payment Not Configured"

## Common Questions

### Q: Do I need to install commerce-one-time-payment skill?

**A: No.** For payment-free booking, you don't need any payment-related skills.

### Q: Will the skill break if payment configuration is missing?

**A: No.** The skill gracefully handles missing payment configuration and only allows free appointments.

### Q: Can I mix free and paid appointments?

**A: Yes.** Once payment is configured, you can create both:

- Free appointments: `requiresPayment: false` (or omit field)
- Paid appointments: `requiresPayment: true, amount: 5000`

### Q: What if I want to charge later?

**A: Easy.** Just:

1. Set `VITE_GODADDY_STORE_ID` environment variable
2. Deploy commerce-one-time-payment skill
3. Start creating paid appointments

Existing free appointments continue working unchanged.

### Q: Do I need to update the database schema?

**A: No.** The schema is designed to support both free and paid from the start. The payment fields (`requiresPayment`, `amount`, `orderId`) are optional and default to safe values.

## Summary: Payment is TRULY Optional

✅ **Works perfectly without payment configuration**  
✅ **No payment-related dependencies required**  
✅ **Graceful error handling if payment requested but not configured**  
✅ **Can add payment later without breaking changes**  
✅ **Database schema supports both from day one**

The online-appointments skill is designed as a **progressive enhancement**: start simple with free bookings, add payments when needed.
