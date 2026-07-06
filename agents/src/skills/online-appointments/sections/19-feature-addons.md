# §19 Feature: Add-ons

A flag that enables optional service add-ons (extras) that customers can select during booking.

---

## Enable

### Admin side — manage add-ons

```json
{
  "features": {
    "admin": {
      "addons": { "enabled": true }
    }
  }
}
```

Enables `/admin/addons` where the admin creates, edits, and manages add-on items that can be linked to services.

### Customer side — select add-ons at booking

```json
{
  "features": {
    "customer": {
      "booking_flow": {
        "enabled": true,
        "addons": { "enabled": true }
      }
    }
  }
}
```

Enables the add-on selector in the booking flow. When a customer selects a service, they can choose optional extras. Selected add-ons are added to the booking's price; their durations are shown as informational extras but do not change the reserved time slot.

### Both flags are needed for the end-to-end add-on experience

Admin-only: useful if you want to set up add-ons before exposing the selector to customers.
Customer-only without admin: the add-on selector appears but you'd have to create add-ons via API.

---

## What it unlocks

| Flag | UI | What it does |
|---|---|---|
| `admin.addons` | `/admin/addons` | Add-on list |
| `admin.addons` | `/admin/addons/:id` | Create/edit add-on (title, description, price, duration) |
| `admin.addons` | `/admin/services/:id` | Link add-ons to specific services |
| `customer.booking_flow.addons` | Booking details step | Add-on selector showing available extras for the selected service |

---

## Add-on use cases

| Type | Description | Example |
|---|---|---|
| **Extended duration** | Add extra time to the appointment | "Extended session (+30 min, +$25)" |
| **Premium upgrade** | Enhanced version of the base service | "Premium massage oils (+$15)" |
| **Additional service** | Separate service added on | "Add aromatherapy (+15 min, +$20)" |
| **Equipment rental** | Optional equipment or supplies | "Yoga mat rental (+$5)" |

Add-on fields: title, description (optional), price (can be 0), duration (ISO-8601 format, e.g. PT30M), active status.

---

## How add-ons work

1. **Admin creates add-ons** at `/admin/addons` (e.g. "Extended session", +30 min, +$25)
2. **Admin links add-ons to services** at `/admin/services/:id` — select which add-ons are available for each service
3. **Customer selects service** in booking flow
4. **System shows available add-ons** for that service
5. **Customer selects optional add-ons** — the price breakdown updates to include them (add-on durations are shown for information only)
6. **Booking is created** with selected add-ons — add-on details are snapshot into `booking_addon` table

---

## How to enable — step by step

1. Set both flags to `true` in `src/appointment-features.json`
2. Restart the app
3. Go to `/admin/addons` → click "New Add-on"
4. Create an add-on (e.g. "Extended session", "Add 30 minutes to any appointment", PT30M duration, $25 price)
5. Go to `/admin/services/:id` for a service → link the add-on to that service
6. Customers booking that service will now see the add-on as an optional extra

---

## Customize

### Add-on selector layout
Edit `components/addons/AddonSelector.tsx` — change how add-ons are displayed in the booking flow.

### Add-on price display format
Edit `components/booking/BookingConfirmation.tsx` — change how selected add-ons appear in the price breakdown.

### Add-on duration display
Edit `formatDuration` in `components/booking/service-utils.ts` — controls how add-on duration increases are formatted (e.g. `PT30M` → "30 min"). Used by `AddonSelector`.

---

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/appointments/admin/addons` | List all add-ons |
| POST | `/api/appointments/admin/addons` | Create add-on |
| GET | `/api/appointments/admin/addons/:id` | Get single add-on |
| PUT | `/api/appointments/admin/addons/:id` | Update add-on |
| DELETE | `/api/appointments/admin/addons/:id` | Soft delete add-on |
| GET | `/api/appointments/admin/services/:id/addons` | List add-ons linked to a service |
| POST | `/api/appointments/admin/services/:id/addons` | Link add-on to service |
| DELETE | `/api/appointments/admin/services/:id/addons/:addonId` | Unlink add-on from service |
| GET | `/api/appointments/public/services/:id/addons` | Get active add-ons for a service (public) |

---

## Technical notes

- **Maximum add-ons per account:** 50 (enforced in `create.service.ts`)
- **Soft delete:** Deleted add-ons remain in database with `deletedAt` timestamp
- **Service linking:** Junction table `service_addon` tracks which add-ons are available for which services
- **Booking snapshot:** When a booking is created, selected add-on details (title, price, duration) are copied into `booking_addon` table so historical bookings aren't affected by future add-on changes
- **Active filtering:** Only add-ons with `active = true` appear in the public booking flow
- **Price calculation:** Selected add-on prices are snapshotted per booking in `booking_addon` and summed with the base service price in the customer price breakdown and the admin booking total.
- **Duration display:** Add-on durations are shown to the customer as informational extras (e.g. "+30 min"). The reserved appointment slot uses the base service duration only — add-on durations do not extend the booked time or affect availability.

---

## Database tables

- `addon` — Master add-on catalog
- `service_addon` — Junction table linking services to available add-ons
- `booking_addon` — Snapshot of add-ons selected for each booking
