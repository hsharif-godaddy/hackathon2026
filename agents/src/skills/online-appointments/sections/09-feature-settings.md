# §9 Feature: Business Settings

The settings panel groups several sub-features. Enable the parent flag plus any sub-flags needed.

---

## Enable

In `src/appointment-features.json`:

```json
{
  "features": {
    "admin": {
      "availability": { "enabled": true },
      "settings": {
        "enabled": true,
        "business_info":     { "enabled": true },
        "business_location": { "enabled": true },
        "timezone":          { "enabled": true },
        "booking_interval":  { "enabled": true }
      }
    }
  }
}
```

Enable `admin.settings` to show the settings navigation item. Then enable only the sub-flags relevant to the business. You can enable all four for a full settings panel, or just one or two.

Enable `admin.availability` separately — it controls business hours (when bookings are accepted).

---

## Sub-features

### `admin.settings.business_info`

Lets the admin set: business name, tagline, phone, email address, website URL, and logo upload.

This data is used in:
- Email notifications (from-name, reply-to)
- Public booking page header
- Admin dashboard header

### `admin.settings.business_location`

Lets the admin set: street address, city, state/province, postal code, country.

Used in:
- Public booking page (shows location for in-person services)
- Email confirmations (location details)

### `admin.settings.timezone`

Lets the admin pick the business timezone (e.g. `America/New_York`, `Europe/London`, `Asia/Kolkata`).

**This is important.** All booking times are stored in UTC and displayed in the business timezone. If the timezone is wrong, customers will see incorrect available times.

Timezone uses IANA format — the UI shows a dropdown of common timezones.

### `admin.settings.booking_interval`

Controls the slot granularity shown to customers:
- **15 min** — slots at :00, :15, :30, :45
- **30 min** — slots at :00, :30
- **60 min** — slots at :00

Pick based on the shortest service duration. If the shortest service is 45 minutes, use 15-min slots so customers see the right options.

---

## Business hours (`admin.availability`)

When enabled, the admin configures which days and hours the business accepts bookings.

Go to `/admin/availability` to set:
- Days open (Mon–Sun checkboxes)
- Opening and closing time per day
- Lunch/break blocks (optional)

This is separate from staff schedules. If staff is enabled (§6), each staff member can also have their own hours that override the business hours for services they're assigned to.

---

## Customize

### Settings page layout
Edit `pages/admin/settings.tsx` — controls which sections appear and their order.

### Timezone dropdown options
Edit `server/api/appointments/admin/business-settings/` — the `SUPPORTED_TIMEZONES` list controls which timezones appear in the dropdown.

---

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/appointments/admin/business-settings` | Get all settings |
| PATCH | `/api/appointments/admin/business-settings` | Update settings (partial) |
| GET | `/api/appointments/admin/availability` | Get business hours |
| PATCH | `/api/appointments/admin/availability` | Update business hours |
| GET | `/api/appointments/public/config` | Public config (name, timezone — used by booking page) |
