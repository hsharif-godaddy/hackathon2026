# §3 Feature: Admin Bookings

Gives the admin a complete view of all bookings — list, detail, status management, and cancellation.

---

## Enable

In `src/appointment-features.json`:

```json
{
  "features": {
    "admin": {
      "bookings": { "enabled": true }
    }
  }
}
```

That's it. The route `/admin/bookings`, the list page, and the detail page are immediately available.

---

## What it unlocks

| UI | What it does |
|---|---|
| `/admin/bookings` | Full list of all bookings, sortable and filterable |
| `/admin/bookings/:id` | Booking detail — customer info, service, time, status |
| Dashboard widget | Upcoming bookings shown on `/admin` home |
| Status management | Mark as confirmed, completed, no-show, or cancelled |

The admin dashboard (`/admin`) always shows a summary widget (count + next few appointments). The full list page (`/admin/bookings`) requires this flag.

---

## Customize

### Status labels
Edit `lib/app-config.ts` — the `bookingStatuses` field maps internal status codes to display labels.

### Columns shown in the list
Edit `pages/admin/bookings/index.tsx` — the columns array defines which fields are displayed.

### Date/time format
Edit `lib/app-config.ts` — `dateFormat` and `timeFormat` fields (uses `date-fns` format strings).

---

## ⚠️ Booking flow UI — read and redesign these components

The booking wizard steps (date, time, confirmation) ship as functional but visually generic. They must be redesigned to match the business's visual identity. Load §17 UI Design and read each component file before making changes.

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/17-ui-design' })
```

**Components to read and redesign:**

- `src/components/booking/BookingWizard.tsx` — the wizard container and step transitions
- `src/components/booking/StepIndicator.tsx` — progress indicator
- `src/components/booking/DatePicker.tsx` — date selection step
- `src/components/booking/TimeSlotPicker.tsx` — time slot selection step
- `src/components/booking/BookingDetailsForm.tsx` — customer details form
- `src/components/booking/BookingConfirmation.tsx` — confirmation screen

Each component has specific design guidance in §17. The date picker, time slot picker, and confirmation screen in particular ship as stock components — they must be redesigned to feel native to this specific business, not generic. See §17 for what each component should become.

---

## API endpoints (admin-authenticated)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/appointments/admin/bookings` | List all bookings (paginated) |
| GET | `/api/appointments/admin/bookings/upcoming` | Next N bookings |
| GET | `/api/appointments/admin/bookings/summary` | Stats for dashboard widget |
| GET | `/api/appointments/admin/bookings/:id` | Single booking detail |
| PATCH | `/api/appointments/admin/bookings/:id` | Update status |
| DELETE | `/api/appointments/admin/bookings/:id` | Cancel booking |

**Critical:** All admin endpoints are at `/api/appointments/admin/...` NOT `/api/admin/...`. If you get 404, check the URL prefix.
