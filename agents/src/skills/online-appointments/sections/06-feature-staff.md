# §6 Feature: Staff

Two related flags: admin manages staff members, and staff members can block their own calendar.

---

## Enable

In `src/appointment-features.json`:

```json
{
  "features": {
    "admin": {
      "staff": { "enabled": true }
    },
    "staff": {
      "exception_times": { "enabled": true }
    }
  }
}
```

Enable `admin.staff` to let the admin create and manage staff. Enable `staff.exception_times` so staff members can log in and block time on their own schedules (vacations, personal appointments, etc.).

Enable both for the full multi-staff experience. You can enable `admin.staff` alone if exception times aren't needed.

---

## What it unlocks

| Flag | UI | What it does |
|---|---|---|
| `admin.staff` | `/admin/staff` | Admin list + create/edit/delete staff members |
| `admin.staff` | `/admin/services/:id` | Assign staff to specific services |
| `staff.exception_times` | Staff portal | Staff member logs in and marks times as unavailable |

Staff members have: name, email, bio, photo, and assigned services. When a customer books a service, the system checks staff availability before offering time slots.

---

## Staff login flow

Staff members do not use the admin login. They have a separate login (uses the customer auth system) and are redirected to the exception times management page after login.

The system distinguishes staff from regular customers via a `role` field in the database.

---

## Customize

### Staff card in admin list
Edit `pages/admin/staff/index.tsx` — controls how each staff member is displayed.

### Staff profile fields
Edit `server/api/appointments/admin/staff/` — add fields to the schema and API handlers.

### Exception time UI
Edit the staff portal page — controls how staff block time (day ranges, time ranges, recurring blocks).

---

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/appointments/admin/staff` | List all staff |
| POST | `/api/appointments/admin/staff` | Create staff member |
| PATCH | `/api/appointments/admin/staff/:id` | Update staff member |
| DELETE | `/api/appointments/admin/staff/:id` | Remove staff member |
| GET | `/api/appointments/staff/exception-times` | Staff: get own exception times |
| POST | `/api/appointments/staff/exception-times` | Staff: add exception time block |
| DELETE | `/api/appointments/staff/exception-times/:id` | Staff: remove exception time block |

---

## Notes

- Staff availability is factored into the booking wizard time slot calculation
- If no staff are assigned to a service, the service uses general business hours (from `admin.availability`)
- Seed at least one staff member before seeding bookings that should be assigned to a specific person (see §11)
