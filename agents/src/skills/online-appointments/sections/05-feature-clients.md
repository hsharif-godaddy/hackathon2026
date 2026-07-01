# §5 Feature: Clients

Gives the admin a CRM view of all customers who have made bookings.

---

## Enable

In `src/appointment-features.json`:

```json
{
  "features": {
    "admin": {
      "clients": { "enabled": true }
    }
  }
}
```

---

## What it unlocks

| UI | What it does |
|---|---|
| `/admin/clients` | List of all clients (name, email, phone, booking count) |
| `/admin/clients/:id` | Client detail — contact info + full booking history |

Clients are created automatically when a booking is made. The admin cannot manually create clients — they come from the booking flow.

---

## Customize

### Columns shown
Edit `pages/admin/clients/index.tsx` — the columns array controls which fields appear in the list.

### Client detail fields
Edit `pages/admin/clients/[id].tsx` — add or remove fields shown on the detail page.

### Search behavior
The list supports text search by name or email. Search logic lives in the API handler: `server/api/appointments/admin/clients/`.

---

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/appointments/admin/clients` | List all clients (paginated, searchable) |
| GET | `/api/appointments/admin/clients/:id` | Client detail + booking history |
| PATCH | `/api/appointments/admin/clients/:id` | Update client notes |
| DELETE | `/api/appointments/admin/clients/:id` | Remove client record |

---

## Notes

- This is a read-mostly view — admins can add notes but not create clients
- Client records persist even if their bookings are cancelled
- If `customer.my_bookings` is enabled (§10), the same customer can log in and see their own view
