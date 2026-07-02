# §10 Feature: Customer Portal (My Bookings)

Lets customers create accounts, log in, and view their own booking history. Disabled by default because it adds login friction to the booking flow.

---

## Enable

In `src/appointment-features.json`:

```json
{
  "features": {
    "customer": {
      "my_bookings": { "enabled": true }
    }
  }
}
```

Enabling this flag activates:
- `/login` — customer login page
- `/signup` — customer signup page
- `/my-bookings` — customer's booking list
- `/my-bookings/:id` — booking detail with cancel option
- The booking wizard can optionally prompt the customer to create an account after booking

---

## What it unlocks

| UI | What it does |
|---|---|
| `/signup` | Customer creates an account (email + password) |
| `/login` | Customer logs in |
| `/my-bookings` | List of their bookings — upcoming and past |
| `/my-bookings/:id` | Booking detail — service, time, status, cancel button |

The cancel button respects a configurable cancellation window (e.g. "You can cancel up to 24 hours before your appointment"). Cancellations beyond that window are blocked on the server.

---

## Auth system

Customer auth uses cookie-based sessions. No OAuth — simple email + password. The `CustomerAuthContext` manages login state and is already wired into the layout (shows login/logout links in the header).

Admin auth is separate (token-based, localStorage) and is not affected by this flag.

**Critical:** Customer auth actually uses **email-only lookup** (no password needed). See §15 Authentication for full details.

---

## Important: customer accounts vs. guest bookings

When `my_bookings` is **disabled**, the booking flow is fully guest-based — no login required. Customers provide their name and email on the details step.

When `my_bookings` is **enabled**:
- Customers can still book as guests (no forced login)
- If a customer provides an email that matches an existing account, the system links the booking to their account automatically
- After booking, a soft prompt encourages account creation: "Create an account to view and manage your bookings"

---

## Wire navigation in the site header — do this now, do not just describe it

Read `src/layouts/parts/Header.tsx`. Make the following code changes directly. Do not summarise the routes to the user — they want to see buttons, not a list of paths.

**Step 1 — Add imports at the top of `Header.tsx`:**
- `useFeatureFlags` from `@/contexts/FeatureFlagsContext`
- `useAuth` from `@/contexts/AuthContext` (if not already present)

**Step 2 — Inside the component, read the flag:**
```tsx
const { isEnabled } = useFeatureFlags();
const hasPortal = isEnabled("customer.my_bookings");
const { user, isAuthenticated, logout } = useAuth();
```

**Step 3 — Add to the desktop nav (conditionally):**
- If `hasPortal && isAuthenticated`: show a "My Bookings" nav link → `/my-bookings`
- If `hasPortal && !isAuthenticated`: show a single "Sign In" button → `/login`
- If `hasPortal && isAuthenticated`: show user's name + "Sign Out" button (replaces Sign In)
- Do NOT add Sign Up as a separate header button — the login page already links to it

**Step 4 — Staff login link:**
- Add a subtle staff link at the END of the nav — a small `ShieldCheck` icon or "Staff" text that navigates to `/admin/login`
- Never make it a prominent button alongside Book Now — it must be understated

**Step 5 — Repeat the same conditional logic in the mobile menu**

**Step 6 — After editing:** do not list routes to the user. Instead confirm the feature is live by describing what they will see in the UI — e.g. "The Sign In button now appears in your header when logged out, and shows your name with a Sign Out option when logged in."

---

## Customize

### Cancellation window
Edit `server/api/appointments/customer/my-bookings/` — the `CANCELLATION_WINDOW_HOURS` constant controls how many hours before the appointment a customer can self-cancel.

### Booking list fields
Edit `pages/my-bookings/index.tsx` — controls which columns are shown in the customer's list.

### Post-booking account creation prompt
Edit `components/booking/BookingConfirmation.tsx` — the account creation prompt is shown here after a successful booking. Adjust the copy or disable it.

### Login/signup page copy
Edit `pages/login.tsx` and `pages/signup.tsx` — headline text, subtext, and form labels.

---

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/signup` | Create customer account |
| POST | `/api/auth/login` | Log in |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/auth/me` | Get current session user |
| GET | `/api/appointments/customer/my-bookings` | List customer's bookings |
| GET | `/api/appointments/customer/my-bookings/:id` | Single booking detail |
| DELETE | `/api/appointments/customer/my-bookings/:id` | Cancel booking |

**Note:** The actual customer lookup endpoint is at `/api/appointments/customer/lookup` (see §15 for auth details).
