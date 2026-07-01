---
name: online-appointments
description: Full-featured appointment/booking system for service businesses. Includes date/time selection with availability checking, customer intake form, optional GoDaddy Commerce payment integration (free or paid appointments), email confirmations with calendar invites, admin dashboard for appointment management, and customer portal. Supports single pricing (e.g., "$100 consultation") or multiple pricing tiers (e.g., 30min/$50, 60min/$90, 90min/$120). Handles business hours, working days, timezone-aware scheduling, buffer time between appointments, and customizable appointment durations.
whenToUse: Load immediately for ANY request related to appointments, bookings, or scheduling — whether it is a new install, a bug fix, a UI change, a feature request, a data question, an admin question, or a configuration change. This skill is the single source of truth for everything appointments-related. If this skill has already been loaded for this app (visible in applied_skills context), load it again to get the sections needed for the current request rather than solving from general knowledge. Never attempt to build, fix, or explain any part of a booking system without loading this skill first.
dependencies:
  - date-fns
  - date-fns-tz
  - zod
  - uuidv7
  - mysql2
  - drizzle-orm
  - "@dnd-kit/core"
  - "@dnd-kit/sortable"
  - "@dnd-kit/utilities"
  - recharts
intents:
  - booking/appointments/scheduling/reservation/time slots/class booking/book a spot/waitlist/classes
  - add data/seed data/sample data/test data/seed bookings/add sample/populate data/try it out
  - admin/admin login/admin setup/admin password/admin dashboard/admin access/fix admin/improve admin/admin panel/admin layout/admin not working
  - booking system bug/booking error/appointment not working/fix booking/debug appointment/fix/not working/broken/error
  - customer portal/customer login/my bookings/view bookings/cancel booking/booking history
  - business hours/availability/timezone/working days/opening hours
  - services/service/add services/edit services/improve services/update services/fix services/service price/service duration/manage services/services not showing/service cards/service list/service page/service design/service UI/service images/service API
  - staff/staff member/assign staff/staff management/add staff
  - coupon/discount code/promo code/voucher/add coupon
  - booking page/book page/booking form/book now/booking flow
  - improve UI/redesign/make it look better/modernize/UI/styling/theme/branding/booking UI
  - settings/configure/business info/business location/booking interval
---

# Online Appointments Skill

## Communication rule — keep technical details internal

All technical decisions — which files to read, which sections to load, which API endpoints to call, which flags to enable, which components to edit — are **internal reasoning**. Do not narrate them to the user.

Communicate only outcomes and questions. Tell the user what is being built or what you need from them, not how it works under the hood.

| Instead of | Say |
|---|---|
| "I'm loading section 14-admin-system to understand the admin auth flow" | Say nothing — just do it |
| "I need to edit `src/appointment-features.json` to enable `admin.coupons`" | "I'll turn on discount codes for you" |
| "The API endpoint is `/api/appointments/public/services`" | "I'll pull your real services from the system" |
| "I'm setting `customer.my_bookings: true` in the feature flags" | "I'll add the customer login portal" |

When you do speak to the user, use plain business language — the language of their industry, not the language of code.

---

## 🔴 FIRST ACTION — Before anything else

**Execute all of the following in the same turn — do not stop after loading the skill:**

```typescript
skill({ action: 'load', skill: 'online-appointments' })
online_appointments__listSections({})
skill({ action: 'loadReference', path: 'online-appointments/sections/01-discovery-questions' })
skill({ action: 'loadReference', path: 'online-appointments/sections/02-install-and-configure' })
skill({ action: 'loadReference', path: 'online-appointments/sections/04-feature-services' })
skill({ action: 'loadReference', path: 'online-appointments/sections/14-admin-system' })
skill({ action: 'loadReference', path: 'online-appointments/sections/17-ui-design' })
```

Loading the skill without immediately loading these sections is incomplete. All seven calls are a single unit — the skill is not ready to use until all of them have returned.

---

## Reasoning pattern — repeat for every task and every new area within a session

**Check `<applied_skills>` state first.** After `listSections` has been called at least once, the section catalog (slug + title) is persisted in state and visible in every turn's `<applied_skills>` XML:

```xml
<skill name="online-appointments" ...>
  <current_state>
    {"sections":[{"slug":"14-admin-system","title":"Admin System"},{"slug":"07-feature-coupons","title":"Coupons"},...]}
  </current_state>
</skill>
```

**For every task, run these two steps before reading any file or writing any code:**

**Step 1 — List sections**

```typescript
online_appointments__listSections({})
```

**Step 2 — Load the matching section plus any mandatory sections**

Find the section whose title matches the current task and load it. Then check whether the mandatory sections below apply and load those too:

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/<matching-slug>' })
```

**Mandatory sections — always load these when the task involves their area:**

| Task area | Always load |
|---|---|
| New install or any configuration change | `01-discovery-questions`, `02-install-and-configure` |
| Anything in `/admin` — layout, dashboard, sidebar, navigation, bug fixes | `02-install-and-configure`, `14-admin-system` |
| Anything related to bookings — booking flow, booking list, booking status, booking API | `03-feature-bookings` |
| Anything related to services — improve services, service cards, service list, service page, service design, service UI, service images, pricing, duration, service API, services not showing | `04-feature-services` |
| Any UI change — styling, components, layout, theme, spacing, animations | `17-ui-design` |
| Any feature work or bug fix | `02-install-and-configure` |

Step 1 is mandatory every time — do not skip `listSections` and jump straight to `loadReference`. The catalog must be consulted first so you pick the right section. Only after all relevant sections are loaded may you read files or make edits.

This applies to every task, every turn — admin layout, my bookings, coupons, seeding, auth, bug fixes. Every area has its own section with codebase-specific patterns that are not visible from the code alone.

---

Full appointment booking system with payment integration, email confirmations, and admin dashboard.

**Complexity markers:**
- ✓ Simple (straightforward implementation)
- 📖 Medium (optional features, some complexity)
- ⚠️ Complex (payment integration, authentication, requires careful attention)

---

## Quick Reference

| Item               | Details                                        |
| ------------------ | ---------------------------------------------- |
| **Booking URL**    | `/book`                                        |
| **API Base**       | `/api/appointments`                            |
| **Database Table** | `appointment` (singular)                       |
| **Config**         | `src/lib/appointments.config.ts`               |
| **Currency**       | ISO 4217 (USD, EUR, GBP, JPY...) — `config.currency` |

---

## 🚨 CRITICAL: Never validate TypeScript on installed templates

**Do NOT run the validate code tool (typecheck / tsc) on the installed templates at any point.** The templates are pre-built and ship with TypeScript that is intentionally not checked at install time — running typecheck on them will produce false errors, waste time, and may cause the agent to attempt incorrect "fixes" to working code. This prohibition applies at every step: after `skill({ action: 'install' })`, after feature-flag edits, after seeding, and after any other modification within this skill's scope.

---

## Section Reference

All implementation details live in `sections/`. Load sections on demand using `loadReference`.

| Slug | Content |
|---|---|
| `01-discovery-questions` | Feature flag mapping from discovery answers |
| `02-install-and-configure` | Install flow, package setup, DB connection, admin nav, API wiring |
| `03-feature-bookings` | Admin bookings management |
| `04-feature-services` | Service catalog management |
| `05-feature-clients` | Client CRM |
| `06-feature-staff` | Staff management and exception times |
| `07-feature-coupons` | Discount coupon system |
| `08-feature-categories-questions` | Service categories and custom intake questions |
| `09-feature-settings` | Business settings panel |
| `10-feature-customer-portal` | Customer my-bookings portal |
| `11-seeding` | Seeding initial data |
| `12-user-journeys` | Complete user flow documentation |
| `13-customization` | Labels, colors, branding, theme |
| `17-ui-design` | Rich modern UI — reading the theme, creative direction, component styling |
| `14-admin-system` | Admin auth, layout, navigation, troubleshooting |
| `15-authentication` | Customer and admin auth systems |
| `16-database-setup` | drizzle.config.ts, migrations, SSL config, troubleshooting |
| `IMPLEMENTATION` | Section index and minimum install path |

**Do NOT attempt to load any path not in this table.**

---

## Setup sequence — all 8 steps are mandatory

Execute every step in order. The only valid reason to pause between steps is to wait for user input (e.g. discovery answers, a yes/no confirmation). Do not stop, summarise, or ask "what next?" between steps — complete the step and immediately move to the next one. All 8 steps must finish before the setup is considered done.

---

## Step 1: Discovery ✓

### 1a. Register the skill and load core sections

```typescript
online_appointments__listSections({})
skill({ action: 'loadReference', path: 'online-appointments/sections/01-discovery-questions' })
skill({ action: 'loadReference', path: 'online-appointments/sections/02-install-and-configure' })
skill({ action: 'loadReference', path: 'online-appointments/sections/03-feature-bookings' })
skill({ action: 'loadReference', path: 'online-appointments/sections/04-feature-services' })
```

### 1b. Generate and ask discovery questions

```typescript
online_appointments__generateDiscoveryQuestions({ userRequirements: '<user message verbatim>' })
```

Pass the returned `questions` array **directly** to `askQuestion` — do not modify it:

```typescript
askQuestion({ questions: <questions from generateDiscoveryQuestions> })
```

**Stop here.** Wait for the user's answers before proceeding.

### 1c. Review answers with the user

Read every captured answer back in a single plain-English summary (no field names, no code).
End with a direct yes/no question. **Do not touch any file until the user confirms.**

**→ Once the user confirms, immediately proceed to Step 2.**

---

## Step 2: Install Templates + Configure ✓

### 2a. Install templates

```typescript
online_appointments__prepareInstall({})
skill({ action: 'install', skill: 'online-appointments' })
```

### 2b. Install packages

Read `src/.appointments.package.json` and install every package at its exact version
(strip `^`/`~`). Run `dependencies` and `devDependencies` as separate npm calls:

```bash
npm install --save-exact <dep1>@<version> <dep2>@<version> ...
npm install --save-dev --save-exact <devDep1>@<version> ...
```

### 2c. Configure

Follow all instructions in §2 (`loadReference 02-install-and-configure`):
- Edit `src/appointment-features.json` with default flags
- Configure DB connection
- Wire homepage CTA buttons to `/book` — find every "Book Now" or primary CTA on the homepage and ensure it navigates to `/book`; add a "Book Now" link to the site header
- Add admin navigation (customer login page + footer)
- Wire `src/lib/api-client.ts` exports

**→ Immediately proceed to Step 3.**

---

## Step 3: Enable Features ✓

For each feature the user asked for in discovery:

1. Load the relevant section
2. Follow its instructions to enable the feature flag in `src/appointment-features.json`

| User asked for | Load section | Flag to set `true` |
|---|---|---|
| Staff management | `06-feature-staff` | `admin.staff` |
| Discount codes | `07-feature-coupons` | `admin.coupons`, `customer.booking_flow.coupons` |
| Custom intake questions | `08-feature-categories-questions` | `admin.questions` |
| Service categories | `08-feature-categories-questions` | `admin.categories` |
| Business settings | `09-feature-settings` | `admin.settings` |
| Customer booking history portal | `10-feature-customer-portal` | `customer.my_bookings` |
| Clients CRM | `05-feature-clients` | `admin.clients` (already true by default) |

A flag flip in `src/appointment-features.json` is all that's needed — guards and gates are already wired.

**→ Immediately proceed to Step 4.**

---

## Step 4: Database Setup 📖

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/16-database-setup' })
```

Follow all instructions in §16. It loads the database skill internally and covers `drizzle.config.ts`, migrations, SSL configuration, and troubleshooting.

**→ Immediately proceed to Step 5.**

---

## Step 5: Admin System 📖

Ask the user:

```typescript
askQuestion({
  questions: [{
    question: 'Would you like an admin dashboard to manage bookings, services, and clients?',
    type: 'chips_single',
    suggestions: ['Yes, set up admin', 'No thanks'],
    allowOther: false,
    multiSelect: false,
  }]
})
```

If yes:

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/14-admin-system' })
```

Follow all instructions in §14 to build the admin UI and navigation.

**Auto-redirect to setup:** Implement the first-admin redirect pattern described in §14/§15 — when no admin exists, visiting `/admin` or `/admin/login` must redirect to `/admin/setup` automatically. Do **not** tell the user to navigate there manually.

**→ Immediately proceed to Step 6.**

---

## Step 6: Authentication ⚠️

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/15-authentication' })
```

Follow all instructions in §15. Key points:
- **Admin auth:** JWT token in `localStorage`, bcrypt passwords, `Authorization: Bearer` header
- **Customer auth:** HttpOnly cookie session (no password — email-only lookup)
- The auto-redirect to `/admin/setup` (Step 5) is documented in §14/§15 — implement exactly what those sections describe

**→ Immediately proceed to Step 7.**

---

## Step 7: Data Seeding 📖 (Optional)

Ask the user:

```typescript
askQuestion({
  questions: [{
    question: 'Would you like to add some sample data so you can try the booking system right away?',
    type: 'chips_single',
    suggestions: ['Yes, add sample data', 'No, I\'ll add my own'],
    allowOther: false,
    multiSelect: false,
  }]
})
```

If yes:

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/11-seeding' })
```

Use `database__list_tables` (from the database skill) to confirm all tables exist, then use `askQuestion` to gather the details needed for seeding — business name, timezone, and 2–3 services (name, duration, price). Follow §11 to execute the seeding API calls.

**→ Immediately proceed to Step 8.**

---

## Step 8: UI/UX Customisation 📖

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/12-user-journeys' })
skill({ action: 'loadReference', path: 'online-appointments/sections/13-customization' })
skill({ action: 'loadReference', path: 'online-appointments/sections/17-ui-design' })
```

Read the app's existing Tailwind config or CSS variables to identify the current theme (border-radius, font family, colour tokens). Apply §13 instructions to update the booking pages so they match the user's existing site design.

**→ Proceed to the Completion Message.**

---

## Completion Message

After all steps are done, summarise in plain English. **Never mention raw URLs.** Describe how to reach each thing through the UI instead.

> "Your booking system is live!
>
> - Customers can **browse and book** using the Book Now button on your homepage
> - **Staff login** is available via the Staff Login button on the sign-in page [or wherever it was placed]
> - Click Staff Login → you'll be taken straight to the admin setup page to claim your account
> - **Features enabled:** [list what was turned on, in plain language — e.g. "discount codes", "customer booking history", "staff scheduling"]
>
> [Add anything specific to their configuration in plain business language — no paths, no technical terms.]"