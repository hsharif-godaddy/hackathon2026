# §7 Feature: Coupons

Two flags that work as a pair: the admin creates coupon codes, and customers can apply them during booking.

---

## Enable

### Admin side — manage coupons

```json
{
  "features": {
    "admin": {
      "coupons": { "enabled": true }
    }
  }
}
```

Enables `/admin/coupons` where the admin creates, edits, and deactivates coupon codes.

### Customer side — apply coupons at checkout

```json
{
  "features": {
    "customer": {
      "booking_flow": {
        "enabled": true,
        "coupons": { "enabled": true }
      }
    }
  }
}
```

Enables the coupon input field in booking wizard step 3 (Details). Customers type a code; the system validates it and shows the discount applied.

### Both flags are needed for the end-to-end coupon experience

Admin-only: useful if you want to test coupons before exposing the field to customers.
Customer-only without admin: the coupon field appears but you'd have to create coupons via API.

---

## What it unlocks

| Flag | UI | What it does |
|---|---|---|
| `admin.coupons` | `/admin/coupons` | Coupon list |
| `admin.coupons` | `/admin/coupons/:id` | Create/edit coupon (code, type, amount, expiry, usage limit) |
| `customer.booking_flow.coupons` | Booking wizard step 3 | Coupon code input + validation + discount display |

---

## Coupon types supported

| Type | Description | Example |
|---|---|---|
| `percentage` | % off the total | SAVE20 → 20% off |
| `fixed` | Fixed amount off | FIRST10 → $10 off |

Coupon fields: code (unique), discount type, discount value, expiry date (optional), max uses (optional), current use count.

---

## How to enable — step by step

1. Set both flags to `true` in `src/appointment-features.json`
2. Restart the app
3. Go to `/admin/coupons` → click "New Coupon"
4. Create a code (e.g. `WELCOME20`, 20% off, no expiry, 100 max uses)
5. Share the code with customers
6. Customers enter the code in the booking wizard — discount is applied instantly

---

## Customize

### Coupon input label
Edit `components/booking/BookingDetailsForm.tsx` — change the label and placeholder text for the coupon field.

### Discount display format
Edit `components/booking/BookingConfirmation.tsx` — change how the applied discount is shown in the confirmation step.

### Coupon validation error messages
Edit `lib/app-config.ts` — `couponMessages` field for invalid/expired/used-up messages.

---

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/appointments/admin/coupons` | List all coupons |
| POST | `/api/appointments/admin/coupons` | Create coupon |
| PATCH | `/api/appointments/admin/coupons/:id` | Update coupon |
| DELETE | `/api/appointments/admin/coupons/:id` | Delete coupon |
| POST | `/api/appointments/public/coupons/validate` | Validate a coupon code (public, no auth) |
| POST | `/api/appointments/customer/coupons/:code/incrementUse` | Record coupon used |
| POST | `/api/appointments/customer/coupons/:code/decrementUse` | Undo usage (booking cancelled) |

---

## Notes

- Coupon validation is real-time — the customer sees "✓ 20% discount applied" immediately on entering the code
- If a booking is cancelled after a coupon was applied, the use count is decremented automatically
- Max uses of `null` = unlimited
- Expired coupons are automatically rejected (server-side check)
