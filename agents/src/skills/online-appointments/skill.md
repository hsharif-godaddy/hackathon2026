---
name: online-appointments
description: Full-featured appointment/booking system for service businesses. Includes date/time selection with availability checking, customer intake form, optional GoDaddy Commerce payment integration (free or paid appointments), email confirmations with calendar invites, admin dashboard for appointment management, and customer portal. Supports single pricing (e.g., "$100 consultation") or multiple pricing tiers (e.g., 30min/$50, 60min/$90, 90min/$120). Handles business hours, working days, timezone-aware scheduling, buffer time between appointments, and customizable appointment durations.
whenToUse: Load IMMEDIATELY for ANY new booking, appointment, scheduling, or reservation intent — do not evaluate fit or gaps. The skill itself will determine whether to use its templates or recommend custom implementation. Do NOT load for bug fixes, modifications, or integrating external products. Keywords - "booking", "appointment", "schedule", "reservation", "calendar", "time slot", "class booking". Covers services, classes, consultations, rentals, class credits or any time-slot reservations.
dependencies:
  - date-fns
  - date-fns-tz
  - zod
intents:
  - booking/appointments/scheduling/reservation/time slots/class booking/book a spot/waitlist/classes
---

# Online Appointments Skill

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

## 🚨 CRITICAL: Implementation Style

**Discovery → Confirm → Implement.** Do Step 1 (Discovery), then Step 2 (Review &
Confirm), and only after the customer says yes do you start touching files.

- **One business-level confirmation, then no more approval prompts.** Step 2 is the
  customer's chance to correct everything in plain English. Once they confirm, just build
  it — do not re-ask about technical implementation choices.
- **Do NOT discuss technical details** with the user (API endpoints, file edits, schemas, etc.)
- **Assume users are NOT technical** — they don't need to know about APIs, database
  schemas, or code structure.
- **Only ask clarifying questions** if discovery answers were unclear or missing, or if
  the customer rejected the Step 2 summary.

**What to show users:**
- ✅ The Step 2 summary (plain English, every captured value, ends with yes/no question).
- ✅ Progress updates: "Setting up booking page...", "Configuring payment...", "Testing the booking flow..."
- ✅ Final result: "Booking system is ready at /book"
- ✅ Business-level decisions during discovery: "Do you want email confirmations?"

**What NOT to show users:**
- ❌ Technical implementation details: "I'll create an API endpoint at /api/appointments/POST.ts"
- ❌ Code explanations: "The schema uses a paymentStatus field..."
- ❌ File-by-file narration: "Now editing src/components/BookingForm.tsx"

**Exception:** Only discuss technical details if the user explicitly asks technical questions or is clearly a developer.

---

## How to load detailed sections

Detailed implementation lives in `templates/sections/`. Each `## §` section is a separate
file named `NN-slug.md`. Load only the section you need.

```text
Read agents/src/skills/online-appointments/templates/sections/08-payment-integration.md
```

When this skill.md says **"→ Read `templates/sections/NN-name.md`"**, read that file directly.
`templates/IMPLEMENTATION.md` is now a thin index pointing to each section file.

---

## Implementation Flow

Discovery → Review & Confirm (**gate** — do not proceed without explicit yes) → Configure
→ Install Templates → Database (+ Auth if needed) → UI Components → Booking Page → Payment
⚠️ (conditional) → Class Credits ⚠️ (conditional) → Email → Admin Dashboard (optional) →
Customer Portal (conditional).

---

## Step 1: Discovery ✓

**For full conversational scripts:** → Read `templates/sections/01-discovery-questions.md`.

### Quick Discovery Checklist

Gather the answers below. The shipped `AppointmentsConfigSchema` validates
`serviceName`, `duration`, `businessHoursStart`/`businessHoursEnd`, `workingDays`,
`timezone`, `currency`, and optional `pricingTiers[]` (each with `label`, `duration`,
`amount`, **`skuId`**). Anything else listed below is either a per-booking input (not
stored on config) or requires a schema extension before it can be used. See
`templates/sections/02-configuration-examples.md` § 2.0 for the authoritative table.

1. **Business type:** "What type of appointments are you offering?"
   → Used by discovery to pick suggestions; not stored on config.

2. **Service name:** "What's the name as customers will see it?"
   → Stored in `config.serviceName`.

3. **Duration:** "How long does each appointment take? (minutes)"
   → Stored in `config.duration`. Per-tier duration overrides this.

4. **Buffer time:** "Time between appointments for prep/cleanup? (minutes, or 0)"
   → **Schema extension required.** Not in the shipped schema; the slot generator does not
   subtract a buffer.

5. **Business hours:** "What days and times are you open?"
   → Stored in `config.workingDays` (0=Sun..6=Sat), `businessHoursStart`,
   `businessHoursEnd`.

6. **Timezone (ALWAYS ASK):** Auto-detect from browser, then confirm:
   "I've detected your timezone as {{detected_timezone}}. Is this correct for your
   business hours?"
   → Stored in `config.timezone` as IANA format (e.g., `'America/New_York'`).
   → All business hours and slot availability are calculated in this timezone.
   → Customers see times labeled with this timezone.

7. **Payment (CRITICAL — ALWAYS ASK):** "Do customers pay when they book? (Yes or No)"
   → If yes, this is expressed as `pricingTiers[]` on config (one entry for fixed price).
   The booking request body sends `requiresPayment: true` and `amount: <tier.amount>`. There
   is no `config.requiresPayment`.
   → If any price is mentioned at any point, treat payment as required.

8. **Pricing structure (if payment required):**
   - Fixed price → `pricingTiers: [{ label, duration, amount, skuId }]` (one entry; `amount`
     in the smallest unit of the chosen currency — see step 9).
   - Variable pricing → `pricingTiers[]` with one entry per option. `skuId` is required on
     every tier.
   - Class packages → **Schema extension required** (`classPackages[]`). See § 12.

9. **Currency (CRITICAL when payment is required):** "What currency are your prices in?"
   → Stored in `config.currency` as an ISO 4217 code (`'USD'`, `'EUR'`, `'GBP'`, `'JPY'`,
   etc.). Defaults to `'USD'`.
   → **Must match the currency the SKUs are priced in inside your GoDaddy Commerce
   store.** GoDaddy derives the actual checkout currency from the SKU; this config field
   drives display formatting only.
   → `amount` values on `pricingTiers` are in the smallest unit of this currency: cents
   for USD/EUR/GBP, yen for JPY, fils for KWD.

10. **Free first consultation (conditional):** If coaching/consulting AND payment required
    → **Schema extension required.** Add `freeFirstAppointment: boolean` to
    `AppointmentsConfigSchema` before relying on it.

The full `templates/sections/01-discovery-questions.md` section covers conversational scripts, context-aware
suggestions per service type, payment detection patterns, and edge cases.

---

## Step 2: Review & Confirm with Customer ✓

**This step is a gate. Do not start any setup, file edits, or skill installs until the
customer has explicitly confirmed the summary below.** It exists to catch
mishearings/misnamings before they get baked into config, SKUs, and emails.

### What to do

1. Read every captured discovery answer back to the customer in a single, plain-English
   summary. No code, no field names, no file paths — they're not technical.
2. Use only what was actually captured — never invent defaults, never paper over a missing
   answer with "we'll figure it out". If something is missing, ask it now and re-summarise.
3. Quote money in the customer's currency using the right symbol (`$80`, `€80`, `£80`,
   `¥8,000`) — never raw cents.
4. End with a direct yes/no question. Wait for confirmation before proceeding.

### Summary template

> Here's what I'm setting up for you. Please tell me if anything is wrong:
>
> - **Business:** {{serviceName}} ({{serviceType}})
> - **Service length:** {{duration}} minutes per appointment{{#if bufferTime}}, with {{bufferTime}} minutes between bookings{{/if}}
> - **Hours:** {{businessHoursStart}}–{{businessHoursEnd}}, {{workingDaysReadable}} ({{timezone}})
> - **Payment:** {{#if requiresPayment}}Yes — customers pay when they book{{else}}No — bookings are free{{/if}}
> - **Price:** {{priceSummaryReadable}}  ← e.g. "$80 per session", "tiers of $50/$90/$140 by length", "class packs of $20 / $90 / $150", or "Free"
> - **Currency:** {{currency}}{{#if requiresPayment}} (your GoDaddy Commerce SKUs must be priced in {{currency}}){{/if}}
> - **Free first appointment:** {{#if freeFirstAppointment}}Yes — first session is on the house, follow-ups are paid{{else}}No{{/if}}
> - **Customer accounts:** {{#if requiresCustomerPortal or classPackages}}Yes — customers will need to sign in{{else}}No — anyone can book without an account{{/if}}
> - **Admin dashboard:** {{#if requiresAdminDashboard}}Yes — you'll have a private page to manage bookings{{else}}No{{/if}}
>
> Does this match what you want? **(yes / no — and if no, tell me what to change)**

Hide fields the customer didn't mention rather than printing "n/a" or `undefined` — empty
rows look like bugs. Render `workingDays` as human days ("Monday to Friday", "Tuesday
through Sunday") rather than `[1,2,3,4,5]`.

### What NOT to do here

- Do not show technical details (no SKU IDs, no `pricingTiers` objects, no schema field
  names, no file paths).
- Do not auto-progress on silence. If the customer doesn't answer, prompt once more.
- Do not split the summary into multiple messages — keep it scannable.

---

## Step 3: Configuration Examples

**→ Read `templates/sections/02-configuration-examples.md`.**

Shows:
- Single fixed price config (coaching at $80/session)
- Variable pricing config (massage with 3 tiers)
- Class packages config (yoga with credit packs)
- Free service config (restaurant reservations)

---

## Step 4: Database Setup 📖

**CRITICAL: Install database skill FIRST - templates depend on it.**

```typescript
skill({ action: 'install', skill: 'database' });
```

This installs MySQL + Drizzle ORM. The database skill creates:
- `src/server/db/client.ts` - Database connection (exports `db`)
- `src/server/db/config.ts` - Configuration loader
- `src/server/db/schema.ts` - Schema definitions (you'll add the `appointment` table here)
- `drizzle.config.ts` - Drizzle configuration

**After database skill is installed, add the `appointment` table to `src/server/db/schema.ts`.**

**For the authoritative schema + migrations:** → Read `templates/sections/03-database-setup.md`.
The columns mirror what `templates/server/api/appointments/POST.ts` and `GET.ts` write.

**CRITICAL CONCEPT: orderId is the draft-order handle**

- GoDaddy Commerce `createPaymentSession` returns `{ paymentUrl, orderId }` where `orderId` is the **draftOrderId** of an unpaid order.
- Store that value directly in `appointment.orderId`.
- Final paid status is fetched on demand via `provider.getOrderStatus(orderId)` — there is no separate "real orderId" written back to the row.
- **Free-first check:** any prior row for the same email with `orderId IS NOT NULL` AND `provider.getOrderStatus(orderId).status === 'paid'` counts as a paid appointment.

**For authentication tables (only if needed for credits/portal):**
→ Read `templates/sections/04-authentication-integration.md`.

Then run: `npx drizzle-kit generate && npx drizzle-kit migrate`

---

## Step 5: Install Templates ✓

**After database is set up, install appointment templates:**

```typescript
skill({ action: 'install', skill: 'online-appointments' });
```

This installs:
- `src/lib/appointments.ts` - Utility functions, types, config schema
- `src/lib/appointments-client.ts` - API client
- `src/server/api/appointments/availability/GET.ts` - Get available slots
- `src/server/api/appointments/POST.ts` - Create appointment (imports `db` from `../../db/client`)
- `src/server/api/appointments/GET.ts` - List appointments with optional payment-status enrichment
- `src/server/utils/payment-provider.ts` and `godaddy-commerce-provider.ts` - Provider abstraction

**Templates import from `src/server/db/client` - the database skill must be installed first.**

---

## Step 6: UI Components ✓

**→ Read `templates/sections/06-ui-components.md`.**

### Components to Create

1. **PricingTierSelector** (variable pricing only) - Show pricing options
2. **Calendar** - Calendar with working day filtering
3. **TimeSlotPicker** - Fetch and display available slots
4. **BookingForm** - Customer info + submission

Place under `src/components/appointments/` (Vite + React Router; no `'use client'` directive).

---

## Step 7: Booking Page Flow ✓

**→ Read `templates/sections/07-booking-page-flow.md`.**

**Flow:** Select Date → Time → Fill Form → Confirmation. Variable pricing prepends a
"Select Tier" step.

The v8 template uses Vite + React Router. Create the page at `src/pages/BookAppointment.tsx`
and register it as the `/book` route in `src/App.tsx`. Do **not** use Next.js `app/page.tsx`
or `'use client'` directives.

---

## Step 8: Payment Integration ⚠️ COMPLEX

**ONLY if `requiresPayment === true` OR `pricingTiers` exists.**

**CRITICAL: Payment is complex. Read the full section before implementing.**

**→ Read `templates/sections/08-payment-integration.md` (REQUIRED).**

### Key Concepts (Read Full Section First!)

1. **No webhooks.** GoDaddy Commerce does not deliver webhooks. The success page is the
   confirmation point — it polls `provider.getOrderStatus(orderId)` and updates the row.

2. **`createPaymentSession` returns `{ paymentUrl, orderId }`** (not `{ id, checkoutUrl }`).
   Redirect the browser to `paymentUrl`; persist `orderId` to `appointment.orderId`.

3. **No `customer` field on `CreatePaymentSessionParams`.** The shipped provider does not
   forward customer info to checkout. Do not pre-fill name/email/phone via the payment
   session.

4. **sessionStorage is required across the redirect**:
   - Before `window.location.href = data.paymentUrl`, store both `appointmentId` and
     `orderId` (which is the draftOrderId).
   - On the success page, read them back and call the confirm endpoint.

5. **Free-first appointment check (server side):**
   - Look up prior rows for the same `customerEmail` with `orderId IS NOT NULL`.
   - For each, call `provider.getOrderStatus(orderId)`; only count `status === 'paid'`.
   - Abandoned drafts therefore do not give the customer another free slot.

6. **Currency is determined by the SKU, not by our request body.** GoDaddy Commerce uses
   the SKU's native currency at checkout. The `currency` field on `CreatePaymentSessionParams`
   is advisory and is ignored by the GoDaddy provider; we keep it for parity with
   non-GoDaddy providers (Stripe, etc.). Use `config.currency` for display formatting via
   `formatMoney(amount, config.currency)` from `lib/appointments`.

### Quick Setup Steps

1. Install commerce skill: `skill({ action: 'install', skill: 'commerce-one-time-payment' })`
2. Set `config.currency` to the same ISO 4217 code (e.g. `'EUR'`) the merchant's GoDaddy
   Commerce store SKUs are priced in. The store catalog is the source of truth at checkout
   time; this field drives display formatting on our side.
3. Create SKUs for each tier with the `commerce` skill: call `commerce__search_tools`
   to find the product/SKU creation tool, then call `commerce__execute_tool` with the
   MCP tool name and arguments. Price those SKUs **in that currency**. Each
   `pricingTiers[]` entry **requires** a `skuId` — Zod rejects the config otherwise. Tier
   amounts are integers in the smallest unit of the chosen currency:
   ```typescript
   pricingTiers: [
     // EUR example — 80,00 € is 8000 cents (EUR has 2 decimals).
     { label: '60-min Coaching', duration: 60, amount: 8000, skuId: '<set-after-commerce-skill>' },
     // JPY example would be `amount: 8000` for ¥8,000 (JPY has 0 decimals).
   ],
   ```
4. Wire the booking form to redirect to `paymentUrl` after `POST /api/appointments`
5. Create success/cancel pages
6. Implement the first-appointment check endpoint (if `freeFirstAppointment === true` —
   requires schema extension; see § 8.7)

---

## Step 9: Email Notifications ✓

**→ Read `templates/sections/09-email-notifications.md`.**

### Quick Setup

1. Install email skill: `skill({ action: 'install', skill: 'email' })`
2. The email skill is a recipe (nodemailer + local SMTP relay) — it does not export a
   shared `sendEmail` module. Each consumer constructs its own `nodemailer.createTransport`
   call inline, as documented in the email skill's `skill.md`.
3. Generate an .ics calendar invite (helper in `§ 9.1`) and attach it to the confirmation
   email.

**Timing:**
- Free appointments → Send immediately after creation
- Paid appointments → Send after the success page has confirmed `getOrderStatus === 'paid'`

---

## Step 10: Admin Dashboard 📖 (Optional)

**→ Read `templates/sections/10-admin-dashboard.md`.**

Shows:
- Appointment list view (uses `GET /api/appointments?includeOrderStatus=true` for live payment status)
- Order details modal (handles both paid and free appointments)
- Admin authentication setup

**Admin seed:** → Read `templates/sections/05-admin-user-seed.md`.

---

## Step 11: Customer Portal 📖 (Conditional)

**Only if `requiresCustomerPortal === true`.**

**→ Read `templates/sections/11-customer-portal.md`.**

Features:
- Login/signup pages (provided by authentication skill)
- View upcoming/past appointments
- Cancel appointments
- Credit balance (if class packages)

---

## Step 12: Class Credits System ⚠️ (Conditional)

**Only if `classPackages` array exists.**

**CRITICAL: Read the full section before implementing.**

**→ Read `templates/sections/12-class-credits-system.md`.**

Shows:
- Purchase flow for class packages (redirect to GoDaddy Commerce)
- Credit balance tracking
- Booking with credits instead of payment
- Atomic credit deduction on the success page after polling `getOrderStatus`

---

## Troubleshooting

**→ Read `templates/sections/13-troubleshooting.md`.**

Covers:
- Race-condition double-booking
- Customer charged but appointment not confirmed (success-page polling failed)
- Free first appointment not working
- Timezone issues
- Build failures

---

## Quick Decisions

- **Section index:** `templates/IMPLEMENTATION.md` lists every section file; per-step "→ Read"
  pointers in this skill.md jump straight to the right one.
- **Payment required?** YES iff `config.pricingTiers` has ≥1 entry. There is no
  `config.requiresPayment` — for a fixed price, write a single-entry `pricingTiers` array.
- **Authentication required?** YES if any of `requiresCustomerPortal`,
  `requiresAdminDashboard`, or `classPackages` is set. Otherwise anonymous booking only.
- **Free first appointment:** see `templates/sections/08-payment-integration.md` § 8.7 for
  the authoritative `getOrderStatus`-based check.

---

## After Setup Complete

### Completion Message

Tailor message based on configuration:

**For paid appointments:**

> "Appointment booking is now set up!
>
> - **Booking page:** `/book`
> - **Service:** {{serviceName}}
> - **Price:** {{formatMoney(tier.amount, config.currency)}} (or tiers list)
> - **Hours:** {{businessHoursStart}}-{{businessHoursEnd}} on {{workingDays}}
>
> Payment integration is live with GoDaddy Commerce. Customers will receive email confirmations with calendar invites."

**For free appointments:**

> "Appointment booking is now set up!
>
> - **Booking page:** `/book`
> - **Service:** {{serviceName}}
> - **Price:** Free
> - **Hours:** {{businessHoursStart}}-{{businessHoursEnd}} on {{workingDays}}
>
> Customers will receive email confirmations with calendar invites."

---

## Key Takeaways

1. **Discovery is critical** - Use full scripts from `templates/sections/01-discovery-questions.md`
2. **Always confirm before building** - Step 2 reads every captured answer back in plain
   English and waits for an explicit yes. Do not start file edits or skill installs until
   the customer confirms.
3. **ALWAYS ask about payment AND currency** - When payment is required, also ask the
   currency; it must match what the merchant's GoDaddy Commerce SKUs are priced in
4. **Payment is complex** - Read the full payment section before implementing
5. **`orderId` column = draftOrderId** - Store what `createPaymentSession` returns; the row never holds a separate "real" orderId
6. **Currency is SKU-driven** — GoDaddy Commerce uses the SKU's native currency at
   checkout. `config.currency` is for display only; use `formatMoney(amount, currency)`
   from `lib/appointments` for all UI/email money rendering
7. **Authentication is conditional** - Only needed for portals or class credits
8. **Email skill is a recipe** - Construct the nodemailer transport inline; do not import a `sendEmail` module
9. **`templates/sections/` is your detailed guide** - Load each `## §` section by its file path

---

## Implementation Notes

### Section Loading

Sections under `templates/sections/` are loaded on demand by file path. Each section is
self-contained. Read only the file you need; do not pre-load all of them.

**Approximate context cost:**
- Skill.md only: ~5K tokens
- Skill.md + payment section: ~10K tokens
- All sections combined: ~19K tokens (only if needed)

### When This Skill Applies

- **DO use** for: Creating NEW appointment/booking systems
- **DON'T use** for: Bug fixes, integrations with existing systems, 3rd-party booking tools

### Edge Cases Covered

All edge cases documented in `templates/sections/13-troubleshooting.md`:
- Race-condition double-booking prevention
- Success-page polling and the lack of webhooks
- Free-first appointment edge cases (verifies via `getOrderStatus`, not draft presence)
- Timezone handling across regions
- Build failures and debugging
