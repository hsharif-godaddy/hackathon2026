# §11 Seeding

Seed real data so the UI shows something meaningful immediately after install. A temporary admin account is created to authenticate the seeding API calls, then deleted so the real user can claim admin cleanly.

**Prerequisites:**

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/02-install-and-configure' })
skill({ action: 'loadReference', path: 'online-appointments/sections/14-admin-system' })
```

---

## Discovery questions for seeding

Ask these before starting — do not ask for admin credentials:

```typescript
askQuestion({
  questions: [
    {
      question: "What's your business name?",
      type: 'text',
      suggestions: [],
      allowOther: true,
      multiSelect: false,
    },
    {
      question: "What timezone are you in?",
      subtitle: 'e.g. America/New_York, Europe/London, Asia/Kolkata',
      type: 'chips_single',
      suggestions: ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata'],
      allowOther: true,
      multiSelect: false,
    },
    {
      question: "List the services you want to start with",
      subtitle: 'e.g. "Deep Tissue Massage | 60 min | $80"',
      type: 'text',
      suggestions: [],
      allowOther: true,
      multiSelect: false,
    },
  ]
})
```

---

## Seeding steps

### Step 1 — Create temporary admin

Call `POST /api/appointments/admin/auth/setup` with a throwaway name, email, and password. Keep the credentials internal — never share them with the user. Store the returned token for all subsequent requests.

### Step 2 — Configure business settings

Call `PATCH /api/appointments/admin/business-settings` with the business name and IANA timezone from discovery answers.

### Step 3 — Set business hours

Call `PATCH /api/appointments/admin/availability` with the hours from discovery. Use `dayOfWeek` 0–6 (0 = Sunday). Set `isOpen: false` for days the business is closed.

### Step 4 — Create services

For each service from discovery, call `POST /api/appointments/admin/services`.

**Critical rules:**
- `duration` must be ISO 8601 format: `"PT30M"`, `"PT60M"`, `"PT90M"` — never a plain number. A plain number causes an infinite loop in slot generation.
- `cost` is a decimal major-unit value as a string. $50 → `"50"`, $120 → `"120"`, ₹800 → `"800"`. Free = `"0"` with `cost_type: "free"`. Do NOT multiply by 100 — the DB column is `decimal(10, 2)`, not an integer cents column.
- Always set `recurrence_type: "business_hours"` for standard services.

**Sanity check before submitting each service:** read the cost string as a direct price. If it looks unrealistic for the service type and market, fix it before sending.

Use prices from the user's discovery answers when provided. If no price was given, use your knowledge of typical market rates for that service type and geography — seed data should look like a real business, not a placeholder.

### Step 5 — Categories, staff, coupons (if enabled)

If `admin.categories` is enabled: create categories via `POST /api/appointments/admin/categories`, then assign services via `PATCH /api/appointments/admin/services/:id`.

If `admin.staff` is enabled: create staff via `POST /api/appointments/admin/staff` with name, email, bio, and serviceIds.

If `admin.coupons` is enabled: create a welcome coupon via `POST /api/appointments/admin/coupons`.

### Step 6 — Generate service images

Every service's imageUrl is null after seeding. Fix this before the booking page is shown.

```typescript
skill({ action: 'load', skill: 'media-image' })
```

Generate one image per service using a prompt matched to the business type and service name. Then patch each service via `PATCH /api/appointments/admin/services/:id` to set its image.

**Critical:** The PATCH body field is `image_url` (snake_case) — not `imageUrl`. Sending camelCase is silently ignored. The value accepts relative paths (e.g. `/airo-assets/images/services/hair`) or full URLs. Confirm each patch returned the updated `imageUrl` in the response before moving on.

---

## Step 7 — Delete the temporary admin account (mandatory)

The first-user strategy stores admin credentials in `business_setting` as `_admin_email` and `_admin_password_hash`. Remove them by creating and running a temporary script that uses the app's existing Drizzle client — no need to handle credentials manually.

**Step 7a — create the script** at `src/cleanup-temp-admin.ts`:

```typescript
import { db } from './server/db/client.js';
import { businessSetting } from './server/db/schema.js';
import { inArray } from 'drizzle-orm';

await db
  .delete(businessSetting)
  .where(inArray(businessSetting.key, ['_admin_email', '_admin_password_hash']));

console.log('Temp admin removed. Setup is now claimable.');
process.exit(0);
```

**Step 7b — run it** from the app's `src/` directory:

```bash
cd src && npx tsx cleanup-temp-admin.ts
```

Expected output: `Temp admin removed. Setup is now claimable.`

**Step 7c — delete the script:**

```bash
rm src/cleanup-temp-admin.ts
```

**Step 7d — confirm setup is claimable:**

Call `GET /api/appointments/admin/auth/setup`. Response must be `{ "ready": true }`.

- `ready: true` — no admin exists, setup IS claimable ✓
- `ready: false` — rows still present, re-run the script

Do not proceed to Step 8 until `ready: true`.

---

## Step 8 — Wire the claim-admin flow

The user must be able to claim admin through the UI with zero manual URL typing. Wire these two things:

**1. Staff Login button on the customer login page**

Read `src/pages/login.tsx`. Add a "Staff Login" button that navigates to `/admin/login`. If a button already exists, confirm it points to the correct path.

**2. Auto-redirect from login to setup**

Read `src/pages/admin/login.tsx`. It must call `checkSetupRequired()` inside a `useEffect` on mount and redirect to `/admin/setup` if it returns `true`. The template ships with this logic — verify it is present. If missing or broken, add it.

The complete flow the user experiences:
1. Clicks "Staff Login" → `/admin/login`
2. Page auto-detects no admin exists → immediately redirects to `/admin/setup`
3. User enters name, email, password → submits
4. Account created, token stored, auto-redirected to `/admin` dashboard

**Test this flow before confirming setup is complete.** Do not tell the user to "go to /admin/setup" — the button and redirect must take them there automatically.

---

## After seeding

Verify in this order:
1. `GET /api/appointments/admin/auth/setup` returns `ready: true` — confirms no admin exists and setup is claimable (ready: true = ready for first user to claim)
2. `/book` shows the service grid with seeded services and images
3. Click "Staff Login" → `/admin/login` → auto-redirects to `/admin/setup` — confirm the redirect fires automatically
4. Complete setup as the real user, land on dashboard, confirm seeded data is visible

---

## Next — load these sections now

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/04-feature-services' })
skill({ action: 'loadReference', path: 'online-appointments/sections/12-user-journeys' })
skill({ action: 'loadReference', path: 'online-appointments/sections/17-ui-design' })
```
