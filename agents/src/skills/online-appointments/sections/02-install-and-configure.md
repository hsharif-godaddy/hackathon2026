# §2 Install & Configure

---

## Step 1 — Install the template

```typescript
online_appointments__prepareInstall({})
skill({ action: 'install', skill: 'online-appointments' })
```

This copies all pages, API routes, components, DB schema, and auth into the project.

---

## Step 2 — Install dependencies

Read `src/.appointments.package.json`. Install everything listed in `dependencies` with `--save-exact` and everything in `devDependencies` with `--save-dev --save-exact`. Strip any `^` or `~` from version numbers. Run dependencies and devDependencies as two separate install calls.

---

## Step 3 — Configure feature flags

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/03-feature-bookings' })
skill({ action: 'loadReference', path: 'online-appointments/sections/04-feature-services' })
```

Load these two sections now to understand which flags map to which features before editing.

Read `src/appointment-features.json`. Based on discovery answers, set each feature flag to `true` or `false`. The file is already present after install — only edit the flag values, never the structure. All API guards and UI gates are already wired; a flag change is the only thing needed.

---

## Step 4 — Wire API client exports

Edit `src/lib/api-client.ts` and add a re-export of the appointments client so all appointments API functions are accessible app-wide:

Add `export * from './appointments-client';` to the file.

---

## Step 5 — Wire homepage booking CTA and header navigation

**Read these files first before adding anything:**
- `src/pages/index.tsx` — homepage
- `src/layouts/parts/Header.tsx` (or equivalent) — site header
- `src/pages/login.tsx` — customer login page

**Homepage:** Find every button, link, or call-to-action that should take a customer to the booking flow — labels like "Book Now", "Book Appointment", "Get Started", "Schedule". Ensure each one navigates to `/book`. If none exist, add a prominent CTA.

**Site header — read `src/layouts/parts/Header.tsx` and ensure all of these are present:**

| Button / link | Destination | Notes |
|---|---|---|
| "Book Now" or "Book" | `/book` | Primary CTA — must be prominent, ideally a filled button |
| "Sign In" | `/login` | For customers to log into their portal |
| "Sign Up" | `/signup` | For new customers to create an account |
| "My Bookings" | `/my-bookings` | Show only when the customer is authenticated |
| "Staff Login" or "Staff" | `/admin/login` | Subtle link — icon-only or small text; not a primary CTA |

Check each one: if it already exists, verify it points to the right path. If it's missing, add it. Never duplicate an existing link — read first, then decide.

**Also check the mobile menu** — it must have the same links available, not just the desktop nav.

If no booking CTA exists on the homepage, add one in a prominent position — this is the primary conversion action for the entire site.

---

## Step 6 — Add Staff Login entry points

The header already has a Staff link (Step 5). Add these additional access points so staff can always find their way in:

- **Customer login page (`src/pages/login.tsx`)** — add a "Staff Login" button below the sign-in form, with a `ShieldCheck` icon, navigating to `/admin/login`
- **Footer (`src/layouts/parts/Footer.tsx`)** — add a "For Staff" or "Admin" link

Read each file before adding — if a staff/admin link already exists, update it rather than duplicating it. Never ask the user to type a URL — every entry point must be a visible, clickable element.

---

## Step 7 — Admin system

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/14-admin-system' })
```

Follow §14 to build the admin layout, sidebar navigation, and auth wiring. The admin setup page (`/admin/setup`) must be reachable via a button or redirect — implement the first-run redirect pattern from §14 so unauthenticated visits to `/admin` automatically redirect to `/admin/setup` when no admin exists.

---

## Step 8 — UI customisation and service images

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/17-ui-design' })
skill({ action: 'loadReference', path: 'online-appointments/sections/04-feature-services' })
```

### 7a — Generate service images

Service card images are always empty after install — every `imageUrl` field is null. This must be fixed before the `/book` page looks credible.

Read `src/components/booking/ServiceCard.tsx` to understand the image slot. Then load the media-image skill and generate one image per service:

```typescript
skill({ action: 'load', skill: 'media-image' })
```

For each service seeded or configured, generate an image using a prompt tailored to the business type and service name. Patch each service via the admin API to set its `imageUrl`. Services with no image are a broken experience — do not leave any blank.

### 7b — Redesign the /book flow

§17 UI Design contains the full guidance for every booking component. Follow it in full for the `/book` page and all booking wizard components.

---

## Step 9 — Database setup

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/16-database-setup' })
```

Follow §16 in full — drizzle config, running migrations, verifying all 15 tables exist, and SSL troubleshooting. Do not skip this section; the DB config for this template differs from standard Drizzle setups.

**→ Immediately proceed to seeding after database setup is confirmed.**

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/11-seeding' })
```

---

## Common Mistakes

### "useAdminAuth must be used within AdminAuthProvider" on first load

`entry-server.tsx` only includes public routes — the server renders a 404 for all `/admin/*` paths causing a hydration mismatch. Fix: add `adminRoutes` to the import from `./routes` and spread `...adminRoutes` into the route tree in `entry-server.tsx`. See `src/entry-server.appointments.tsx` for the complete correct version.

### API calls return 404 — `/api/public/services` not found

`appointments-client.ts` has `API_BASE = "/api"` instead of `"/api/appointments"`. Fix: ensure line 1 of `src/lib/appointments-client.ts` reads `const API_BASE = "/api/appointments"`.

### Admin setup page returns "Setup failed"

Required database tables are missing. Verify all 15 tables exist before attempting admin setup (see §16).

---

## Next — load these sections now

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/03-feature-bookings' })
skill({ action: 'loadReference', path: 'online-appointments/sections/04-feature-services' })
skill({ action: 'loadReference', path: 'online-appointments/sections/14-admin-system' })
skill({ action: 'loadReference', path: 'online-appointments/sections/17-ui-design' })
```
