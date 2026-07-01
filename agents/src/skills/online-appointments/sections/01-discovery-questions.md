# §1 Discovery Questions

Discovery is the most critical stage. A complete picture of the user's business ensures the right features are enabled, the right seed data is created, and the system is configured correctly from the start.

---

## Step 1 — Generate questions

Call `generateDiscoveryQuestions` with the full conversation so far as `userRequirements`.

The tool returns 12 questions covering two areas:

**Foundation** (questions 1–6): business type, location, services, pricing/duration, hours/timezone, team size.
**Feature discovery** (questions 7–12): staff scheduling, coupons, customer portal, categories, intake questions, cancellation policy.

---

## Step 2 — Select and ask 4–5 critical questions

Do **not** ask all 12 at once. Analyse the returned questions against what you already know from the conversation and select the 4–5 that are most critical to unlock the next step.

**Selection rules:**
- Always include at least one Foundation question if the business type, timezone, or service list is unknown.
- Prioritise questions whose answer directly gates a feature flag (staff scheduling → `admin.staff`, coupons → `admin.coupons`, customer portal → `customer.my_bookings`).
- Skip questions already answered in the conversation.
- Prefer questions with chips options over open-text questions — they're faster for the user.

Pass the selected subset to `askQuestion`.

---

## Step 3 — Evaluate answers and decide whether to ask more

After the user responds, assess coverage:

| Gap | Action |
|---|---|
| Business type or timezone still unknown | Call `generateDiscoveryQuestions` again with updated context; ask 2–3 follow-ups |
| Service list vague (e.g. "massages" with no duration/price) | Ask a targeted follow-up text question |
| Staff answer implies team but no scheduling details | Ask one follow-up about per-staff schedules |
| All foundation + at least 3 feature answers collected | Proceed to Step 4 |

You may invoke `generateDiscoveryQuestions` more than once — each call re-reads `appointment-features.json` and re-reasons with the latest context.

---

## Step 4 — Confirm the plan with the user

Once you have enough information, present a plain-English summary:

```
Here's what I'll set up for your [business type]:

✓ Booking page where customers can browse services and book appointments
✓ Admin dashboard to manage all bookings
✓ Services: [list from answers with duration and price]
✓ Timezone: [timezone], open [hours]
✓ [If team: Multiple staff members — each can manage their own schedule]
✓ [If coupons: Discount codes — you'll be able to create and share promo codes]
✓ [If customer portal: Customer accounts — customers can log in and manage their bookings]
✓ [If categories: Services grouped into categories]
✓ [If intake questions: Custom questions in the booking form]
✓ Cancellation policy: [policy from answers]

Does this look right? Say yes and I'll get everything set up.
```

Wait for explicit **yes** (or equivalent) before proceeding to §2.

---

## Feature flag mapping (internal — never show to user)

| Answer | Feature to enable |
|---|---|
| Multiple staff members / each has their own schedule | `admin.staff`, `staff.exception_times` |
| Wants discount / coupon codes | `admin.coupons`, `customer.booking_flow.coupons` |
| Wants customer login / booking history portal | `customer.my_bookings` |
| Wants to group services into categories | `admin.categories` |
| Wants custom intake questions in booking form | `admin.questions` |
| Mentions timezone or specific working hours | `admin.settings.timezone`, `admin.availability` |
| Wants business info / address in settings | `admin.settings`, `admin.settings.business_info`, `admin.settings.business_location` |
| Mentions booking slot length / interval | `admin.settings.booking_interval` |
| Mentions cancellation window | `admin.settings` |

Always enable by default (core experience):
- `admin.bookings`, `admin.services`, `admin.clients`
- `customer.booking_flow`, `public.services_browse`
- `admin.settings` (at minimum)

Always disable by default unless explicitly requested:
- `customer.my_bookings` — adds login friction; only enable if user asks

---

## Next — load these sections now

Discovery is complete. Immediately load the following before continuing:

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/02-install-and-configure' })
skill({ action: 'loadReference', path: 'online-appointments/sections/04-feature-services' })
skill({ action: 'loadReference', path: 'online-appointments/sections/03-feature-bookings' })
```
