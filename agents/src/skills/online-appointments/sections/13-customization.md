# §13 Customization

All labels, colors, and branding can be customized without modifying feature flags. This section covers the most common customization points.

---

## Labels and Copy

The `AppConfigContext` provides a centralized place to customize user-facing labels. Edit `src/lib/app-config.ts`:

```typescript
export const defaultAppConfig: AppConfig = {
  labels: {
    bookNowButton: "Book Now",
    appointmentNoun: "Appointment",
    serviceNoun: "Service",
    staffNoun: "Staff Member",
    clientNoun: "Client",
    cancelButton: "Cancel Booking",
    rescheduleButton: "Reschedule",
  },
  // ... other config
};
```

**Common customizations:**
- Change "Appointment" → "Session" or "Booking" or "Reservation"
- Change "Staff Member" → "Provider" or "Practitioner" or "Therapist"
- Change "Client" → "Customer" or "Patient" or "Guest"

The `useAppConfig()` hook provides access to these labels throughout the app. Use it instead of hardcoding text:

```tsx
const { labels } = useAppConfig();
return <Button>{labels.bookNowButton}</Button>;
```

---

## Colors and Branding

### Tailwind Config

Edit `tailwind.config.js` to change the primary color palette:

```js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          // ... full palette
          900: '#0c4a6e',
        },
      },
    },
  },
};
```

### CSS Variables (shadcn theme)

Edit `src/index.css` to change semantic colors:

```css
:root {
  --primary: 221.2 83.2% 53.3%;
  --primary-foreground: 210 40% 98%;
  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;
  /* ... other variables */
}
```

These variables control shadcn UI components (buttons, cards, inputs).

### Logo

Upload a logo via the admin settings panel (`/admin/settings` → Business Info tab) if `admin.settings.business_info` is enabled. The logo appears in:
- Public booking page header
- Admin dashboard header
- Email templates (if configured)

Alternatively, edit `src/components/layout/Header.tsx` to hardcode a logo image.

---

## Typography

Edit `tailwind.config.js` to change fonts:

```js
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Poppins', 'sans-serif'],
      },
    },
  },
};
```

Then import the fonts in `src/index.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap');
```

Use the custom font classes in components:

```tsx
<h1 className="font-heading text-3xl">Your Heading</h1>
```

---

## Homepage Hero

Edit `src/pages/index.tsx` to customize the homepage:

```tsx
export default function HomePage() {
  return (
    <div className="hero">
      <h1>Welcome to [Business Name]</h1>
      <p>Book your appointment in minutes</p>
      <Button onClick={() => navigate('/book')}>Get Started</Button>
    </div>
  );
}
```

**Common customizations:**
- Change hero text and subheading
- Add a background image or gradient
- Add feature highlights (icons + short descriptions)
- Add testimonials or trust badges

---

## Email Templates

Edit `src/server/email.ts` (or the equivalent email utility file) to customize email content:

```typescript
export function sendBookingConfirmation(booking: Booking) {
  const subject = `Your appointment is confirmed`;
  const html = `
    <h1>Booking Confirmed</h1>
    <p>Hi ${booking.customerName},</p>
    <p>Your ${booking.serviceName} appointment is scheduled for:</p>
    <p><strong>${formatDate(booking.date)} at ${formatTime(booking.time)}</strong></p>
    <p>We look forward to seeing you!</p>
  `;
  // ... send email
}
```

**Common customizations:**
- Add business logo to email header
- Change email tone (formal vs casual)
- Add cancellation policy text
- Add social media links in footer
- Add "Add to Calendar" links

---

## SEO and Meta Tags

Edit `src/seo-routes.ts` to set per-route meta tags:

```typescript
export const seoConfig = {
  '/': {
    title: 'Book Your Appointment | [Business Name]',
    description: 'Book appointments online in minutes. Choose from [service types].',
    keywords: 'appointments, booking, [business type], [location]',
  },
  '/book': {
    title: 'Browse Services | [Business Name]',
    description: 'View our full service menu and book online.',
  },
  // ... other routes
};
```

Then use `<Helmet>` in layouts:

```tsx
import { Helmet } from 'react-helmet-async';

export function Layout() {
  const seo = seoConfig[location.pathname] || {};
  return (
    <>
      <Helmet>
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <meta name="keywords" content={seo.keywords} />
      </Helmet>
      {/* ... rest of layout */}
    </>
  );
}
```

---

## Booking Wizard Steps

To customize the booking wizard steps (add/remove/reorder), edit `src/components/booking/BookingWizard.tsx`:

```tsx
const steps = [
  { id: 'date', label: 'Pick a date', component: DatePicker },
  { id: 'time', label: 'Pick a time', component: TimePicker },
  { id: 'details', label: 'Your details', component: DetailsForm },
  { id: 'confirmation', label: 'Confirm', component: Confirmation },
];
```

**Common customizations:**
- Add a "Pick a staff member" step (if `admin.staff` is enabled)
- Add a "Pick a location" step (for multi-location businesses)
- Reorder steps (e.g. details before time)

---

## Admin Dashboard Widgets

Edit `src/pages/admin/index.tsx` to customize the dashboard:

```tsx
export default function AdminDashboard() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <StatCard title="Today's Bookings" value={stats.today} />
      <StatCard title="This Week" value={stats.week} />
      <StatCard title="Total Revenue" value={formatCurrency(stats.revenue)} />
      <UpcomingBookingsWidget />
      <RecentClientsWidget />
    </div>
  );
}
```

**Common customizations:**
- Add/remove stat cards
- Add charts (revenue over time, bookings by service)
- Add quick actions (e.g. "Add new service" button)
- Change widget order

---

## Date and Time Formatting

Edit `src/lib/date-utils.ts` to change date/time display formats:

```typescript
export function formatDate(date: Date): string {
  return format(date, 'MMMM d, yyyy'); // "June 15, 2024"
}

export function formatTime(time: Date): string {
  return format(time, 'h:mm a'); // "2:30 PM"
}
```

Use `date-fns` format tokens to customize:
- `'MM/dd/yyyy'` → "06/15/2024"
- `'dd/MM/yyyy'` → "15/06/2024"
- `'HH:mm'` → "14:30" (24-hour)

---

## Cancellation Policy Text

Edit `src/components/booking/BookingDetails.tsx` (or wherever the cancellation policy is shown):

```tsx
<p className="text-sm text-muted-foreground">
  You can cancel up to 24 hours before your appointment.
  Cancellations within 24 hours may incur a fee.
</p>
```

Also edit the `CANCELLATION_WINDOW_HOURS` constant in the server-side cancellation handler to match the policy.

---

## Custom Domains and Routing

If you want the booking system at a custom path (e.g. `yourdomain.com/appointments` instead of root), edit `vite.config.ts`:

```typescript
export default defineConfig({
  base: '/appointments/',
});
```

Then update all route definitions in `src/App.tsx` to be relative.

---

## Important Notes

- **Always restart the dev server** after editing `tailwind.config.js`, `vite.config.ts`, or `.env` files
- **Clear browser cache** after changing colors or fonts
- **Test responsive design** — use Chrome DevTools to test mobile, tablet, and desktop
- **Email styling is limited** — most email clients don't support modern CSS, so keep email templates simple

---

## Quick Reference: Where to Edit

| Customization | File |
|---|---|
| Labels (button text, nouns) | `src/lib/app-config.ts` |
| Primary color palette | `tailwind.config.js` |
| Semantic UI colors | `src/index.css` (CSS variables) |
| Fonts | `tailwind.config.js` + `src/index.css` |
| Logo | Admin settings panel OR `src/components/layout/Header.tsx` |
| Homepage hero | `src/pages/index.tsx` |
| Email templates | `src/server/email.ts` |
| SEO meta tags | `src/seo-routes.ts` + layouts |
| Booking wizard steps | `src/components/booking/BookingWizard.tsx` |
| Admin dashboard widgets | `src/pages/admin/index.tsx` |
| Date/time formats | `src/lib/date-utils.ts` |
| Cancellation policy | `src/components/booking/BookingDetails.tsx` |
