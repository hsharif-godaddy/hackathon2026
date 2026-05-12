---
name: online-appointments
description: Full-featured appointment/booking system for service businesses. Includes date/time selection with availability checking, customer intake form, optional GoDaddy Commerce payment integration (free or paid appointments), email confirmations with calendar invites, admin dashboard for appointment management, and customer portal. Supports single pricing (e.g., "$100 consultation") or multiple pricing tiers (e.g., 30min/$50, 60min/$90, 90min/$120). Handles business hours, working days, timezone-aware scheduling, buffer time between appointments, and customizable appointment durations.
whenToUse: User wants ANY appointment booking, scheduling, reservation, or time-slot system for service businesses. Use for consultations, tutoring, coaching, therapy, fitness classes, yoga, salon/spa appointments, medical appointments, restaurant reservations, service calls (plumber/electrician), or any scenario where customers book time slots. Supports free appointments (no payment), single-price appointments ($X per session), variable pricing (different durations/prices), or class credit packages. Includes admin features (view/manage appointments, availability control) and customer features (booking portal, appointment history). Keywords - "booking", "appointment", "schedule", "reservation", "book a time", "availability", "time slots", "calendar", "book online", "schedule a session", "make an appointment", "reserve a spot", "book a service", "appointment system", "scheduling system", "needs payment when booking", "paid appointments", "free consultation", "pricing tiers", "customer portal", "admin dashboard", "email confirmations".
dependencies:
  - date-fns
  - zod
---

# Online Appointments Skill

Appointment booking system for service businesses with support for single or multiple pricing tiers. Ask discovery questions to understand requirements, then build the booking system with date/time selection, customer form, availability checking, and optional payment integration.

---

## Quick Reference

| Item               | Details                          |
| ------------------ | -------------------------------- |
| **Booking URL**    | `/book`                          |
| **API Base**       | `/api/appointments`              |
| **Database Table** | `appointment`                    |
| **Config**         | `src/lib/appointments.config.ts` |

---

## Step 1: Discovery & Configuration

Ask the user questions to understand their business requirements. Store their answers in variables that will be used to configure the system in later steps.

**Pattern:** After each question, store the user's answer in a variable:

```typescript
let serviceName = '<user_answer>';
let duration = <number_in_minutes>;
let bufferTime = <number_in_minutes>;
// etc.
```

### Step 1.1: Understand Their Business

Start by understanding WHAT they're booking appointments for. Ask conversationally:

> "Great! I'll help you set up appointment booking. First, what type of appointments are you offering? For example: tutoring sessions, yoga classes, haircuts, consultations, restaurant reservations, etc."

**Store the answer:**

```typescript
let serviceType = '<user_answer>';
```

**Then ask about service name and multiple types:**

> "What's the name of this service or business as customers will see it? For example: 'Sarah Chen Coaching', 'Bella Salon', 'Yoga Studio', 'Web Design Services'
>
> **Note:** This system supports multiple service types with different durations and pricing (e.g., a personal trainer offering 30-min sessions AND 60-min sessions). We'll ask about pricing options in the next step."

**Store the answer:**

```typescript
let serviceName = '<user_answer>';
```

### Step 1.2: Duration & Schedule

Ask about timing in a natural way:

> "How long does each {{service_name}} take? Just give me a number in minutes."

**Store the answer:**

```typescript
let duration = <number_in_minutes>;
```

**Suggest defaults:**

- Consultations/meetings: 30 or 60 minutes
- Fitness classes: 60 or 90 minutes
- Restaurant reservations: 120 minutes
- Quick services (haircut): 30 minutes

**Then ask about buffer/interval time:**

> "Do you need time between appointments for preparation, travel, or cleanup? If not, just say 'no' or '0'."

**Store the answer:**

```typescript
let bufferTime = <number_in_minutes>;
```

**Provide context-aware suggestions based on service type:**

- **Coaching/Tutoring/Consulting:** "Most professionals take 10-15 minutes between sessions to prepare notes and reset for the next client."
- **On-site Services (Plumber/Electrician/Repair):** "Consider adding 30-60 minutes for travel time and potential job overruns."
- **Medical/Health (Massage/Physical Therapy):** "Most health providers need 10-20 minutes for room cleanup and preparation between patients."
- **Salon/Spa:** "Typical cleanup and station preparation takes 10 minutes between appointments."
- **Fitness Classes/Restaurant:** "Usually no gap needed - classes/tables are back-to-back."

**Examples by use case:**

- Coach with 45-min sessions + 15-min break → slots every 60 minutes (9:00, 10:00, 11:00...)
- Plumber with 60-min jobs + 30-min travel → slots every 90 minutes (9:00, 10:30, 12:00...)
- Massage with 90-min sessions + 20-min cleanup → slots every 110 minutes (9:00, 10:50, 12:40...)

**Then ask:**

> "What are your business hours? I'll need:
>
> 1. What days are you open? (e.g., Monday-Friday, Monday-Saturday, Tuesday-Sunday)
> 2. What time do you open? (e.g., 9:00 AM)
> 3. What time do you close? (e.g., 5:00 PM)"

**Store the answers:**

```typescript
let workingDays = [1, 2, 3, 4, 5]; // Example: Mon-Fri (1=Mon, 7=Sun)
let businessHoursStart = '09:00';
let businessHoursEnd = '17:00';
```

**Important:** Detect timezone from user's browser and confirm it:

> "I've detected your timezone as {{detected_timezone}}. Is this correct for your business hours?"

**How to detect timezone:**

The user's browser timezone is available in the conversation context. Use it to infer and confirm.

**If user confirms:** Store the detected timezone:

```typescript
let timezone = '<detected_timezone>';
```

**If user says no or provides a different location:**

Ask: "What timezone are your business hours in?"

Then convert and store:

```typescript
// Convert user input to IANA format if needed:
// US Central Time / CDT / Chicago → "America/Chicago"
// US Eastern Time / EDT / New York → "America/New_York"
// US Mountain Time / MDT / Denver → "America/Denver"
// US Pacific Time / PDT / Los Angeles → "America/Los_Angeles"

let timezone = '<IANA_timezone>';
```

**Help them decide:** Provide examples based on service type

- Office/consultation: Mon-Fri 9am-5pm
- Retail/salon: Mon-Sat 10am-6pm
- Fitness: Mon-Sun 6am-8pm
- Restaurant: Tue-Sun 11am-10pm

### Step 1.3: Business Model & Features

**CRITICAL: ALWAYS ask about payment - this is a required question, not optional.**

Now ask about the business model and features. Ask ALL users about payment regardless of service type.

#### A. Payment (ALWAYS ASK)

**First, always ask about payment with a clear yes/no question:**

> "Do customers need to pay when they book? (Yes or No)"

**Listen for:**

- Explicit "yes" or "no"
- Price mentions like "$80", "50 dollars", "€100" → This means YES, requires_payment = true
- "Free" or "no charge" → This means NO, requires_payment = false
- Vague answers like "maybe" or "depends" → Ask again: "To set this up correctly, I need to know: will customers complete a payment as part of booking? Yes or No"

**Store the answer:**

```typescript
// If user says yes OR mentions a price:
let requiresPayment = true;

// If user says no or "free":
let requiresPayment = false;
```

**Confirm back to user:**

- If YES: > "Got it - I'll set up payment processing for bookings."
- If user mentioned price like "$80": > "Perfect - customers will pay $80 when booking. I'll integrate payment processing."
- If NO: > "Understood - bookings will be free, no payment required."

**IMPORTANT:**

- If the user mentions ANY price/amount (like "$80 per session") at ANY point during discovery, immediately set `requires_payment = true`
- This question must be asked for ALL appointment types - consulting, fitness, salon, restaurant, etc.
- Never assume free appointments, even for consultations or trials (those are handled separately in next step)

#### B. Free First Consultation (Conditional - Only if payment is required)

**If `requiresPayment === true` AND service type is consulting/tutoring/therapy/coaching**, then ask:

> "Do you offer a free first consultation or trial session, with payment required for follow-up appointments?"

**Store the answer:**

```typescript
let freeFirstAppointment = true; // If yes
let freeFirstAppointment = false; // If no
```

**If yes:**

> "Got it! First appointments will be free, and follow-up appointments will require payment."

**If `requiresPayment === true`:**

Ask about pricing structure:

> "How is pricing structured for {{service_name}}?"
>
> Options:
>
> 1. Fixed price - same price for all appointments
> 2. Variable pricing - different prices for different durations or tiers
> 3. Class packages - customers buy credits (e.g., 10-class pass) and use them to book
>
> (If free_first_appointment === true: "This pricing will apply to follow-up appointments after the first free one.")

**If Fixed Price (Option 1):**

> "What's the price for {{service_name}}?"

**After capturing price, store the value:**

```typescript
let paymentAmount = <the_price>;
```

> "Perfect! Customers will pay ${{payment_amount}} when they book. I'll integrate payment processing with GoDaddy Commerce."

**If Variable Pricing (Option 2):**

> "What are your pricing tiers? For example:
>
> - 30 minutes: $25
> - 60 minutes: $50
> - 90 minutes: $100
>
> Please list each tier with its duration and price."

**Store as an array:**

```typescript
let pricingTiers = [
  { label: '30 minutes', duration: 30, amount: 25.0 },
  { label: '60 minutes', duration: 60, amount: 50.0 },
  { label: '90 minutes', duration: 90, amount: 100.0 },
];
```

**If Class Packages (Option 3):**

> "What class packages do you want to offer? For example:
>
> - Single class: $20 (1 credit)
> - 5-class pass: $90 (5 credits, $18/class)
> - 10-class pass: $150 (10 credits, $15/class)
>
> Please list each package with credits and price."

**Store as an array:**

```typescript
let classPackages = [
  { label: 'Single Class', credits: 1, amount: 20.0 },
  { label: '5-Class Pass', credits: 5, amount: 90.0 },
  { label: '10-Class Pass', credits: 10, amount: 150.0 },
];
```

**Implementation:** Customers purchase packages (via commerce), credits are added to their account, and they use credits to book appointments. Requires customer portal for credit tracking and authentication for account management.

**Payment timing:** Payment happens BEFORE booking is confirmed. This reserves the slot and reduces no-shows.

**Then ask about cancellation policy:**

> "For prepaid appointments, do you want customers to be able to request cancellations that you can approve? This lets them request a cancellation/reschedule, and you decide whether to approve it."

**Store the answer:**

```typescript
let allowCancellationRequests = true; // If yes
let allowCancellationRequests = false; // If no
```

**If yes:**

> "Got it! Customers can request cancellations from their portal, and you'll see them in your admin dashboard to approve or reschedule."

**If `requiresPayment === false`:**

Simply acknowledge and move to next section:

> "Got it - appointments will be free to book."

#### C. Customer Portal (Landing Page)

Ask about customer needs:

> "After booking, do customers need a personal page to:
>
> - View their upcoming appointments
> - See past appointments
> - Access materials or homework (for tutoring/classes)
> - Track progress
>
> Or is just the booking page enough?"

**Store the answer:**

```typescript
let requiresCustomerPortal = true; // If yes
let requiresCustomerPortal = false; // If no
```

**Examples by type:**

- **Tutoring/Education:** Yes - students need to see assignments and schedule
- **Fitness/Yoga:** Maybe - see class schedule and attendance history
- **Consulting:** Maybe - see meeting notes and documents
- **Salon/Spa:** Usually No - just book and show up
- **Restaurant:** No - just reservation confirmation

**If yes**, capture additional details:

> "What should customers see on their portal?"

**Store as an array:**

```typescript
let portalFeatures = ['upcoming-appointments', 'past-history', 'materials', 'progress'];
```

#### D. Admin Dashboard

Ask about business owner needs:

> "Do you need an admin dashboard to:
>
> - View all appointments
> - Manage availability
> - Cancel/reschedule appointments
> - See customer information
>
> Or will you manage this another way?"

**Store the answer:**

```typescript
let requiresAdminDashboard = true; // If yes
let requiresAdminDashboard = false; // If no
```

**Default:** Usually Yes for service businesses
**Skip if:** Restaurant reservations (they typically use external systems)

#### E. Email Confirmations

> "Should customers and you receive email confirmations when appointments are booked?"

**Store the answer:**

```typescript
let sendEmailConfirmations = true; // If yes (default)
let sendEmailConfirmations = false; // If no
```

**Default to Yes** - this is expected behavior

**If yes:**

> "What email address should receive notifications? (Your business email)"

**Store the answer:**

```typescript
let adminEmail = '<user_email>';
```

**Explain:**

> "I'll set up automatic emails that include:
>
> - Confirmation details
> - Calendar invite (.ics file) they can add to Google Calendar, Outlook, etc.
> - Both customer and you will receive the confirmation"

---

## Step 2: Validate User Input

### Single Pricing Configuration

| Field              | Type     | Validation                         |
| ------------------ | -------- | ---------------------------------- |
| serviceName        | string   | 1-100 characters, non-empty        |
| duration           | number   | Integer between 5-480 minutes      |
| paymentAmount      | number or null | Positive number (dollars) or null for free |
| freeFirstAppointment | boolean | true if first appointment free (requires paymentAmount !== null) |
| bufferTime         | number   | Integer 0-60 minutes (default 0)   |
| businessHoursStart | string   | 24-hour format HH:mm (e.g., 09:00) |
| businessHoursEnd   | string   | 24-hour format HH:mm (e.g., 17:00) |
| workingDays        | number[] | Array of 0-6 (0=Sun, 6=Sat)        |

### Variable Pricing Configuration

| Field              | Type     | Validation                         |
| ------------------ | -------- | ---------------------------------- |
| serviceName        | string   | 1-100 characters, non-empty        |
| pricingTiers       | array    | 1-10 tiers, each with label, duration (5-480 min), amount (positive number) |
| bufferTime         | number   | Integer 0-60 minutes (default 0)   |
| businessHoursStart | string   | 24-hour format HH:mm (e.g., 09:00) |
| businessHoursEnd   | string   | 24-hour format HH:mm (e.g., 17:00) |
| workingDays        | number[] | Array of 0-6 (0=Sun, 6=Sat)        |

---

## Step 3: Install Skill Templates

```typescript
skill({ action: 'install', skill: 'online-appointments' });
```

This installs the backend:

- `src/lib/appointments.ts` - Utility functions, types, and config schema
- `src/lib/appointments-client.ts` - API client class
- `src/server/api/appointments/availability/GET.ts` - Availability endpoint
- `src/server/api/appointments/POST.ts` - Create appointment endpoint

---

## Step 4: Create Configuration File

Create `src/lib/appointments.config.ts` with Zod validation. **Use the variables gathered in Step 1** (from memory or discovery).

**Determine which config format to use:**
- If `pricingTiers` exists (array) → Use Option B (Variable Pricing)
- If `duration` and `paymentAmount` exist → Use Option A (Single Pricing)

### Option A: Single Pricing (Fixed duration and price)

```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
  serviceName: z.string().min(1).max(100),
  duration: z.number().int().min(5).max(480),
  paymentAmount: z.number().positive().nullable(), // in dollars, null = free
  freeFirstAppointment: z.boolean().default(false), // true if first appointment is free
  skuId: z.string().optional(), // SKU ID for payment integration (only if paymentAmount !== null)
  bufferTime: z.number().int().min(0).max(60).default(0),
  businessHoursStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  businessHoursEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1),
  timezone: z.string().default('America/Chicago'),
});

// Use variables from Step 1
export const config = ConfigSchema.parse({
  serviceName: serviceName,
  duration: duration,
  paymentAmount: paymentAmount, // null if free
  freeFirstAppointment: freeFirstAppointment,
  skuId: skuId || '<SKU_ID_HERE>', // Set after creating SKU in Step 8
  bufferTime: bufferTime,
  businessHoursStart: businessHoursStart,
  businessHoursEnd: businessHoursEnd,
  workingDays: workingDays,
  timezone: timezone,
});
```

### Option B: Variable Pricing (Multiple tiers)

```typescript
import { z } from 'zod';

const PricingTierSchema = z.object({
  label: z.string().min(1).max(100),
  duration: z.number().int().min(5).max(480),
  amount: z.number().positive(), // in dollars
  skuId: z.string().optional(), // for commerce integration
});

const ConfigSchema = z.object({
  serviceName: z.string().min(1).max(100),
  pricingTiers: z.array(PricingTierSchema).min(1).max(10),
  bufferTime: z.number().int().min(0).max(60).default(0),
  businessHoursStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  businessHoursEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1),
  timezone: z.string().default('America/Chicago'),
});

// Use variables from Step 1
export const config = ConfigSchema.parse({
  serviceName: serviceName,
  pricingTiers: pricingTiers, // Array from Step 1
  bufferTime: bufferTime,
  businessHoursStart: businessHoursStart,
  businessHoursEnd: businessHoursEnd,
  workingDays: workingDays,
  timezone: timezone,
});
```

**Working day values:** Mon-Fri = `[1,2,3,4,5]`, Mon-Sat = `[1,2,3,4,5,6]`, Tue-Sat = `[2,3,4,5,6]`

**Timezone:** Use IANA format (e.g., 'America/Chicago', 'America/New_York', 'America/Los_Angeles')

---

## Step 5: Add Database Schema

Add to `src/server/db/schema.ts`:

```typescript
export const appointment = mysqlTable('appointment', {
  id: varchar('id', { length: 50 }).primaryKey(),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  customerEmail: varchar('customer_email', { length: 255 }).notNull(),
  customerPhone: varchar('customer_phone', { length: 50 }),
  
  // Appointment timing
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  
  // Multi-tier support
  selectedTier: varchar('selected_tier', { length: 100 }), // e.g., "60 minutes" (null for single-tier)
  duration: int('duration').notNull(), // actual duration in minutes
  
  // Payment support
  amount: int('amount'), // amount in cents (null if free)
  paymentStatus: varchar('payment_status', { length: 20 }), // 'pending', 'completed', 'failed' (null if free)
  paymentIntentId: varchar('payment_intent_id', { length: 255 }), // Commerce order/payment ID (null if free, populated if paid)
  
  status: varchar('status', { length: 20 }).default('confirmed'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

**Schema notes:**
- `selectedTier` - Stores which tier was chosen (only for variable pricing)
- `duration` - Actual appointment duration (from config or selected tier)
- `amount` - Payment amount in cents (null if free)
- `paymentStatus` - Payment tracking (null if no payment required)
- `paymentIntentId` - Commerce order/payment ID. **CRITICAL:** Must be populated for ALL paid appointments (including those after a free first appointment). Used to determine if customer has paid before when `freeFirstAppointment=true`.

**Do NOT run migrations yet** - authentication tables (if needed) must be added first in Step 5a.

---

## Step 5a: Authentication Setup (Conditional)

**Only complete this step if:**
- Customer portal is required (`requiresCustomerPortal === true`), OR
- Admin dashboard is required (`requiresAdminDashboard === true`)

Otherwise, skip to Step 5b (migrations).

**Note:** Use the `requiresCustomerPortal` and `requiresAdminDashboard` variables from Step 1.

### Add Authentication Tables

Add authentication tables to `src/server/db/schema.ts`:

```typescript
export const user = mysqlTable('user', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').default(false),
  image: text('image'),
  isAdmin: boolean('is_admin').default(false),
  credits: int('credits').default(0), // For class credits system
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const session = mysqlTable('session', {
  id: varchar('id', { length: 36 }).primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const account = mysqlTable('account', {
  id: varchar('id', { length: 36 }).primaryKey(),
  accountId: varchar('account_id', { length: 255 }).notNull(),
  providerId: varchar('provider_id', { length: 255 }).notNull(),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: varchar('password', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const verification = mysqlTable('verification', {
  id: varchar('id', { length: 36 }).primaryKey(),
  identifier: varchar('identifier', { length: 255 }).notNull(),
  value: varchar('value', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});
```

### Configure Better Auth

Edit `src/server/auth.ts` to enable email/password authentication:

```typescript
emailAndPassword: { enabled: true },
```

The auth secret (`BETTER_AUTH_SECRET`) should already be configured from the authentication skill installation.

### Create Auth Pages

Create login and signup pages as route entries:

```typescript
// In router configuration
{ path: '/login', element: <AuthPage mode="login" /> },
{ path: '/signup', element: <AuthPage mode="signup" /> },
```

**Authentication skill details:** See `agents/src/skills/authentication/skill.md` for complete authentication system documentation.

---

## Step 5b: Run Migrations

**CRITICAL: Run migrations now that all schemas (appointment + auth if needed) are added.**

```bash
npm run db:generate
npm run db:migrate
```

**Verify tables exist** before proceeding.

---

## Step 5c: Create Admin User Seed (Conditional)

**Only complete this step if admin dashboard is required** (`requiresAdminDashboard === true`).

### Create Seed File

Create `src/server/db/seed-admin.ts`:

```typescript
import { db } from './connection';
import { user, account } from './schema';
import { eq } from 'drizzle-orm';

async function seedAdmin() {
  const adminEmail = '{{admin_email}}'; // From discovery (jtbd.appointments.admin_email or ask user)

  // Password is provided by agent via environment variable (agent generates and displays to user)
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('ADMIN_PASSWORD environment variable is required');
  }

  // Check if admin already exists
  const existing = await db.select().from(user).where(eq(user.email, adminEmail));
  if (existing.length > 0) {
    console.log('Admin user already exists');
    return;
  }

  // Create admin user (emailVerified: false - requires email confirmation to prevent typo DoS)
  const [adminUser] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      email: adminEmail,
      name: 'Admin',
      isAdmin: true,
      emailVerified: false, // Requires verification - prevents registration DoS from typos
    })
    .returning();

  // Use BetterAuth password hashing (documented stable API)
  const { getAuth } = await import('../auth');
  const auth = getAuth(); // Synchronous singleton factory
  const ctx = await auth.$context; // Promise<AuthContext> - documented stable API
  const hashedPassword = await ctx.password.hash(adminPassword);

  // Create credential account
  await db.insert(account).values({
    id: crypto.randomUUID(),
    userId: adminUser.id,
    accountId: adminEmail,
    providerId: 'credential',
    password: hashedPassword,
  });

  console.log('✅ Admin account created! Email verification required before login');
}

seedAdmin().catch((err) => {
  // Only log error message to avoid leaking query parameters (including password) to Loki
  console.error('Admin seed failed:', err.message);
  process.exit(1);
});
```

### Add Seed Script

Add to `package.json`:

```json
{
  "scripts": {
    "db:seed": "tsx src/server/db/seed-admin.ts"
  }
}
```

### Run Seed with Generated Password

**AGENT INSTRUCTIONS:**

```typescript
// 1. Use adminEmail variable from Step 1
// If not set, ask user
if (!adminEmail) {
  // Ask user: "What email address should the admin account use?"
  // Store answer in adminEmail variable
}

// 2. Generate cryptographically secure password (144 bits entropy)
const adminPassword = crypto.randomBytes(24).toString('base64url');

// 3. Run seed with password as env var (no file I/O needed)
const seedResult = await bash(`ADMIN_PASSWORD='${adminPassword}' npm run db:seed`);

// 4. Check seed result before displaying credentials
if (seedResult.exitCode !== 0) {
  // Seed failed - do NOT show password
  // Show to user:
  // ❌ Admin seed failed. Please check:
  // - Database migrations completed successfully (npm run db:migrate)
  // - No existing admin with email ${adminEmail}
  //
  // Error: ${seedResult.stderr || seedResult.stdout}
  return;
}

// 5. Display credentials prominently to user (only if seed succeeded)
// Show to user in chat:
// ✅ Admin dashboard is ready!
//
// Login credentials (save these now):
// - Email: ${adminEmail}
// - Password: ${adminPassword}
//
// ⚠️ You won't see these again!
//
// To access:
// 1. Go to /login
// 2. Log in with the credentials above
// 3. Navigate to /admin/appointments
//
// IMPORTANT: Change your password after first login from your account settings.
```

---

## Step 6: Create UI Components

Create the following components in `src/components/appointments/`. Match the site's existing design patterns and styling.

**Component Creation Strategy:**
- Check config: `'pricingTiers' in config` → Create TierSelector + multi-step flow
- Otherwise → Skip TierSelector, use simple flow

### TierSelector Component (Variable Pricing Only)

**Only create this component if config has `pricingTiers` array (variable pricing mode).**

Create a tier selection component showing available pricing options.

**Props:**

- `tiers: PricingTier[]` - Array of pricing tiers from config
- `selectedTier: PricingTier | null` - Currently selected tier
- `onSelect: (tier: PricingTier) => void` - Callback when tier is selected

**Features:**

- Display each tier as a card/button with duration and price
- Visual indication of selected tier
- Clear pricing information

**Example UI:**

```tsx
<div className="grid gap-4">
  {tiers.map((tier) => (
    <button
      key={tier.label}
      onClick={() => onSelect(tier)}
      className={selectedTier?.label === tier.label ? 'selected' : ''}
    >
      <div className="font-medium">{tier.label}</div>
      <div className="text-2xl">${tier.amount}</div>
      <div className="text-sm text-muted">{tier.duration} minutes</div>
    </button>
  ))}
</div>
```

### DatePicker Component

Create a calendar component for date selection.

**Props:**

- `selectedDate: Date | null` - Currently selected date
- `onSelect: (date: Date) => void` - Callback when date is selected
- `minDate?: Date` - Minimum selectable date (default: today)

**Features:**

- Month navigation (prev/next)
- Working day filtering using `isWorkingDay()` from `@/lib/appointments`
- Past date blocking
- Visual indication of selected date

**Integration:**

```typescript
import { isWorkingDay } from '@/lib/appointments';
```

### TimeSlotPicker Component

Create a time slot selection component that fetches availability from the API.

**Props:**

- `date: Date` - The selected date
- `selectedTime: string | null` - Currently selected time (HH:mm format)
- `onSelect: (time: string) => void` - Callback when time is selected
- `duration: number` - Appointment duration in minutes (from config or selected tier)
- `selectedTier?: string` - Selected tier label (for variable pricing)

**Features:**

- Fetch available slots from API on date change
- Display slots as buttons/cards showing available/unavailable state
- Loading state while fetching
- Error handling

**Integration:**

```typescript
import { appointmentsClient } from '@/lib/appointments-client';

// Fetch availability (pass tier for variable pricing)
const params = selectedTier 
  ? { date: format(date, 'yyyy-MM-dd'), tier: selectedTier }
  : { date: format(date, 'yyyy-MM-dd') };
  
const { slots } = await appointmentsClient.getAvailability(params);
// slots = [{ time: "09:00", available: true }, { time: "10:00", available: false }, ...]
```

### BookingForm Component

Create a customer information form.

**Props:**

- `selectedDate: Date` - The selected date
- `selectedTime: string` - The selected time (HH:mm format)
- `selectedTier?: PricingTier` - The selected tier (for variable pricing)
- `onSubmit: (data: BookingData) => Promise<void>` - Submit callback
- `onBack: () => void` - Go back callback

**Fields:**

- `customerName` (required) - Text input
- `customerEmail` (required) - Email input
- `customerPhone` (optional) - Phone input
- `notes` (optional) - Textarea

**Display booking summary:**
- Show selected date, time, duration
- **Show price:** Only display if `config.paymentAmount !== null` (single) or if variable pricing
- Show tier selection (if variable pricing)

**Features:**

- Form validation
- Submit loading state
- Error display
- Back button

**Integration:**

```typescript
import { appointmentsClient } from '@/lib/appointments-client';
import { formatAppointmentDate, formatAppointmentTime } from '@/lib/appointments';
import { config } from '@/lib/appointments.config';

// Determine duration and amount based on pricing model
const duration = selectedTier?.duration ?? config.duration;
const amount = selectedTier?.amount ?? config.paymentAmount; // null if free appointments

// Submit booking
const result = await appointmentsClient.createAppointment({
  customerName,
  customerEmail,
  customerPhone,
  date: format(selectedDate, 'yyyy-MM-dd'),
  time: selectedTime,
  selectedTier: selectedTier?.label, // null for single pricing
  duration,
  amount, // null for free appointments
  notes,
});
```

### Export Components

Create `src/components/appointments/index.ts`:

```typescript
export { TierSelector } from './TierSelector'; // only if variable pricing
export { DatePicker } from './DatePicker';
export { TimeSlotPicker } from './TimeSlotPicker';
export { BookingForm } from './BookingForm';
```

---

## Step 7: Create Booking Page

Create `src/pages/BookAppointment.tsx` with a multi-step flow.

**For Single Pricing:**

1. **Step 1:** Select date (DatePicker)
2. **Step 2:** Select time (TimeSlotPicker)
3. **Step 3:** Fill form (BookingForm)
4. **Step 4:** Show confirmation

**For Variable Pricing:**

1. **Step 1:** Select tier (TierSelector)
2. **Step 2:** Select date (DatePicker)
3. **Step 3:** Select time (TimeSlotPicker)
4. **Step 4:** Fill form (BookingForm)
5. **Step 5:** Show confirmation

**Use the created components and utilities:**

```typescript
import { TierSelector, DatePicker, TimeSlotPicker, BookingForm } from '@/components/appointments';
import { config, formatAppointmentDate, formatAppointmentTime } from '@/lib/appointments';

// Check if variable pricing
const hasVariablePricing = 'pricingTiers' in config;

// State management
const [selectedTier, setSelectedTier] = useState<PricingTier | null>(null);
const [selectedDate, setSelectedDate] = useState<Date | null>(null);
const [selectedTime, setSelectedTime] = useState<string | null>(null);
const [step, setStep] = useState(hasVariablePricing ? 'tier' : 'date');

// Get current duration (from tier or config)
const duration = selectedTier?.duration ?? config.duration;
```

Add route to `src/routes.tsx` at path `/book`.

---

## API Reference

| Endpoint                                         | Method | Description              |
| ------------------------------------------------ | ------ | ------------------------ |
| `/api/appointments/availability?date=YYYY-MM-DD&tier=TIER_LABEL` | GET | Get available time slots |
| `/api/appointments`                              | POST   | Create appointment       |

**Availability Request:**

```typescript
GET /api/appointments/availability?date=2024-01-15
// For variable pricing, include tier:
GET /api/appointments/availability?date=2024-01-15&tier=60%20minutes
```

**Availability Response:**

```typescript
{ 
  date: string, 
  duration: number, // calculated from config or tier
  slots: Array<{ time: string, available: boolean }> 
}
```

**Create Request:**

```typescript
{
  customerName: string,
  customerEmail: string,
  customerPhone?: string,
  date: string, // YYYY-MM-DD
  time: string, // HH:mm
  selectedTier?: string, // tier label (only for variable pricing)
  duration: number, // minutes
  amount?: number, // dollars (null if free)
  notes?: string
}
```

**Create Response:**

```typescript
{
  id: string,
  customerName: string,
  customerEmail: string,
  date: string,
  time: string,
  endTime: string,
  selectedTier?: string, // only for variable pricing
  duration: number,
  amount?: number, // in dollars, only present if payment required, null/undefined if free
  status: string,
  serviceName: string
}
```

---

## Step 8: Payment Integration (Conditional)

**ONLY complete this step if appointments require payment.**

Check the config:
- **Single pricing:** If `config.paymentAmount !== null`, payment is required
- **Variable pricing:** If `config.pricingTiers` exists, payment is always required (all tiers have amounts)

**If `paymentAmount === null` (free appointments), skip this entire step.**

### A. Install Commerce Skill

```typescript
skill({ action: 'install', skill: 'commerce-one-time-payment' });
```

### B. Create SKUs for Each Tier

**For single pricing:**

```typescript
const result = await commerce__manage_products({
  action: 'createProduct',
  storeId,
  label: config.serviceName,
  type: 'DIGITAL',
  defaultSku: {
    name: `${slugify(config.serviceName)}-${config.paymentAmount * 100}`,
    prices: [{ currencyCode: 'USD', value: config.paymentAmount * 100 }],
  }
});

// Store skuId in config file
const skuId = result.data.createSkuGroup.skus.edges[0].node.id;

// Update src/lib/appointments.config.ts:
// Change: skuId: '<SKU_ID_HERE>',
// To: skuId: '<actual_sku_id_from_commerce>',
```

**For variable pricing:**

```typescript
for (const tier of config.pricingTiers) {
  const result = await commerce__manage_products({
    action: 'createProduct',
    storeId,
    label: `${config.serviceName} - ${tier.label}`,
    type: 'DIGITAL',
    defaultSku: {
      name: `${slugify(config.serviceName)}-${tier.label}-${tier.amount * 100}`,
      prices: [{ currencyCode: 'USD', value: tier.amount * 100 }],
    }
  });
  
  // Store skuId in config
  tier.skuId = result.data.createSkuGroup.skus.edges[0].node.id;
}
```

### C. Create Payment Integration API Endpoint

**Create `src/server/api/appointments/payment/create-session/POST.ts`:**

```typescript
import type { Request, Response } from 'express';
import { getPaymentProvider } from '@/server/utils/payment-provider-factory';
import { PaymentProviderError } from '@/server/utils/payment-provider';

export async function POST(req: Request, res: Response) {
  try {
    const { skuId, amount, currency, returnUrl, successUrl } = req.body;
    
    if (!skuId || !amount || !currency || !returnUrl || !successUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: skuId, amount, currency, returnUrl, successUrl'
      });
    }
    
    // Get payment provider (GoDaddy Commerce by default)
    const paymentProvider = getPaymentProvider();
    
    // Create payment session
    // For GoDaddy: returns { paymentUrl, orderId: draftOrderId }
    const session = await paymentProvider.createPaymentSession({
      skuId,
      amount: amount * 100, // Convert dollars to cents
      currency,
      description: 'Appointment booking',
      returnUrl,
      successUrl,
    });
    
    return res.json({
      success: true,
      paymentUrl: session.paymentUrl,
      orderId: session.orderId, // draftOrderId for GoDaddy Commerce
    });
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      return res.status(400).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    
    return res.status(500).json({
      success: false,
      error: 'Failed to create payment session',
    });
  }
}
```

**Create `src/server/api/appointments/payment/status/GET.ts`:**

```typescript
import type { Request, Response } from 'express';
import { getPaymentProvider } from '@/server/utils/payment-provider-factory';
import { PaymentProviderError } from '@/server/utils/payment-provider';

export async function GET(req: Request, res: Response) {
  try {
    const { orderId } = req.query;
    
    if (!orderId || typeof orderId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: orderId'
      });
    }
    
    // Get payment provider (GoDaddy Commerce by default)
    const paymentProvider = getPaymentProvider();
    
    // Check order status
    // For GoDaddy: orderId is the draftOrderId, which becomes real orderId on payment
    const status = await paymentProvider.getOrderStatus(orderId);
    
    return res.json({
      success: true,
      status: status.status, // 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled'
      orderId: status.orderId,
      amount: status.amount, // in cents
      currency: status.currency,
    });
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      return res.status(400).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    
    return res.status(500).json({
      success: false,
      error: 'Failed to get payment status',
    });
  }
}
```

### D. Update Booking Flow

**IMPORTANT: Use the payment-provider abstraction, NOT direct Commerce API calls.**

The payment-provider handles:
- GoDaddy Commerce (default): `draftOrderId` flow
- Future providers (Stripe, etc.): Different implementations, same interface

**Modify the BookingForm component:**

```typescript
async function handleSubmit(formData: BookingFormData) {
  // Check if payment is required
  const requiresPayment = 'pricingTiers' in config || config.paymentAmount !== null;
  
  if (requiresPayment) {
    // Check if this is the first appointment (and freeFirstAppointment is enabled)
    let isFirstAppointment = false;
    if (config.freeFirstAppointment) {
      const response = await fetch(`/api/appointments/check-first?email=${encodeURIComponent(formData.customerEmail)}`);
      const data = await response.json();
      isFirstAppointment = data.isFirst;
    }
    
    if (isFirstAppointment) {
      // First appointment is free - create directly with no payment
      // NO SKU needed, NO payment-provider call, paymentIntentId stays NULL
      await appointmentsClient.createAppointment({
        ...formData,
        date: format(selectedDate, 'yyyy-MM-dd'),
        time: selectedTime,
        selectedTier: selectedTier?.label,
        duration,
        amount: null, // first appointment free
        paymentStatus: null, // no payment
        paymentIntentId: null, // no order ID
      });
      
      // Show confirmation with message about free first appointment
      setStep('confirmation');
      showMessage('Your first appointment is free!');
    } else {
      // 1. Create payment session via payment-provider
      const skuId = selectedTier?.skuId ?? config.skuId; // SKU from config
      const amount = selectedTier?.amount ?? config.paymentAmount; // in dollars
      
      const paymentResult = await fetch('/api/appointments/payment/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skuId,
          amount,
          currency: 'USD',
          returnUrl: `${window.location.origin}/book/cancel`,
          successUrl: `${window.location.origin}/book/success`,
        }),
      });
      
      const { paymentUrl, orderId } = await paymentResult.json();
      
      // 2. Create appointment record with pending payment
      // orderId is draftOrderId for GoDaddy Commerce
      const appointmentResult = await appointmentsClient.createAppointment({
        ...formData,
        date: format(selectedDate, 'yyyy-MM-dd'),
        time: selectedTime,
        selectedTier: selectedTier?.label,
        duration,
        amount,
        paymentStatus: 'pending',
        paymentIntentId: orderId, // Store orderId (draftOrderId for GoDaddy)
      });
      
      // Store appointment ID in session storage for confirmation page
      sessionStorage.setItem('pendingAppointmentId', appointmentResult.id);
      
      // 3. Redirect to payment checkout
      window.location.href = paymentUrl;
    }
  } else {
    // Free appointment - create directly
    await appointmentsClient.createAppointment({
      ...formData,
      date: format(selectedDate, 'yyyy-MM-dd'),
      time: selectedTime,
      selectedTier: selectedTier?.label,
      duration,
      amount: null, // explicitly null for free
    });
    
    // Show confirmation
    setStep('confirmation');
  }
}
```

### E. Create Payment Success Page

Create `/book/success` page to handle payment completion:

```tsx
// src/pages/BookAppointmentSuccess.tsx
import { useEffect, useState } from 'react';

export function BookAppointmentSuccess() {
  const [status, setStatus] = useState<'checking' | 'success' | 'error'>('checking');
  const [appointment, setAppointment] = useState<any>(null);
  
  useEffect(() => {
    async function verifyPayment() {
      try {
        // Get appointment ID from session storage
        const appointmentId = sessionStorage.getItem('pendingAppointmentId');
        if (!appointmentId) {
          setStatus('error');
          return;
        }
        
        // Get appointment record (includes orderId/draftOrderId in paymentIntentId field)
        const aptResponse = await fetch(`/api/appointments/${appointmentId}`);
        const apt = await aptResponse.json();
        
        // Check payment status via payment-provider abstraction
        const statusResponse = await fetch(`/api/appointments/payment/status?orderId=${apt.paymentIntentId}`);
        const statusData = await statusResponse.json();
        
        if (statusData.success && statusData.status === 'paid') {
          // Payment successful - update appointment status
          await fetch(`/api/appointments/${appointmentId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paymentStatus: 'completed',
              status: 'confirmed',
            }),
          });
          
          setAppointment(apt);
          setStatus('success');
          sessionStorage.removeItem('pendingAppointmentId');
        } else {
          // Payment not yet completed or failed
          setStatus('error');
        }
      } catch (error) {
        console.error('Payment verification failed:', error);
        setStatus('error');
      }
    }
    
    verifyPayment();
  }, []);
  
  if (status === 'checking') {
    return <div>Verifying payment...</div>;
  }
  
  if (status === 'error') {
    return <div>Payment verification failed. Please contact support.</div>;
  }
  
  return (
    <div>
      <h1>Appointment Confirmed!</h1>
      <p>Your appointment has been booked and payment processed.</p>
      <p>Date: {appointment.date}</p>
      <p>Time: {appointment.time}</p>
      <p>Confirmation email sent to {appointment.customerEmail}</p>
    </div>
  );
}
```

**Add routes:**
```tsx
{ path: '/book/success', element: <BookAppointmentSuccess /> },
{ path: '/book/cancel', element: <BookAppointmentCancel /> },
```

**CRITICAL CONCEPTS:**

1. **Use payment-provider abstraction** - Don't call Commerce APIs directly
2. **PaymentSession.orderId** - For GoDaddy Commerce, this is `draftOrderId`
3. **Payment flow:**
   - Create session → get `orderId` (draftOrderId for GoDaddy)
   - Store `orderId` as `paymentIntentId` with `paymentStatus: 'pending'`
   - User pays → GoDaddy converts `draftOrderId` to real `orderId`
   - Success page polls via payment-provider `getOrderStatus(orderId)`
   - If status === 'paid', update appointment to `paymentStatus: 'completed'`

4. **First appointment check** - Queries `paymentIntentId IS NOT NULL` to find paid appointments

### F. Create First Appointment Check Endpoint

**Only needed if `config.freeFirstAppointment === true`.**

Create `src/server/api/appointments/check-first/GET.ts`:

```typescript
import type { Request, Response } from 'express';
import { db } from '@/server/db/connection';
import { appointment } from '@/server/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

export async function GET(req: Request, res: Response) {
  const { email } = req.query;
  
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email required' });
  }
  
  // Check if this email has any PAID appointments (paymentIntentId is not null)
  // Free first appointment means: first PAID appointment is free
  // We check for existing paid appointments, not all appointments
  const paidAppointments = await db
    .select({ id: appointment.id })
    .from(appointment)
    .where(
      and(
        eq(appointment.customerEmail, email),
        isNotNull(appointment.paymentIntentId) // Has completed payment
      )
    )
    .limit(1);
  
  const isFirst = paidAppointments.length === 0;
  
  return res.json({ 
    isFirst, 
    message: isFirst 
      ? 'First paid appointment - eligible for free booking' 
      : 'Customer has previous paid appointments'
  });
}
```

**Logic:** A customer's "first appointment" means they have NO previous appointments with a `paymentIntentId`. This prevents gaming the system and ties directly to payment records.

---

---

## Step 9: Email Notifications with Calendar Invite

**IMPORTANT: Email confirmations are part of the core booking flow, not optional.**

### A. Install Email Skill

```typescript
skill({ action: 'install', skill: 'email' });
```

### B. Create Calendar Invite Generator

Create `src/lib/appointments/calendar-invite.ts`:

```typescript
/**
 * Generate .ics calendar file for appointment
 */
export function generateICS(appointment: {
  id: string;
  serviceName: string;
  customerName: string;
  customerEmail: string;
  startTime: Date;
  endTime: Date;
  notes?: string;
  location?: string;
}): string {
  const startDate = formatDateForICS(appointment.startTime);
  const endDate = formatDateForICS(appointment.endTime);
  const now = formatDateForICS(new Date());
  
  // Escape special characters in text fields
  const escape = (str: string) => str.replace(/[,;\\]/g, '\\$&').replace(/\n/g, '\\n');
  
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Appointment Booking//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${appointment.id}@appointments.local`,
    `DTSTAMP:${now}`,
    `DTSTART:${startDate}`,
    `DTEND:${endDate}`,
    `SUMMARY:${escape(appointment.serviceName)}`,
    `DESCRIPTION:${escape(`Appointment with ${appointment.customerName}${appointment.notes ? '\\n\\nNotes: ' + appointment.notes : ''}`)}`,
    `ATTENDEE;CN=${escape(appointment.customerName)}:mailto:${appointment.customerEmail}`,
    `ORGANIZER:mailto:noreply@appointments.local`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
  ];
  
  if (appointment.location) {
    lines.push(`LOCATION:${escape(appointment.location)}`);
  }
  
  lines.push('END:VEVENT', 'END:VCALENDAR');
  
  return lines.join('\r\n');
}

/**
 * Format date for ICS file (YYYYMMDDTHHMMSSZ in UTC)
 */
function formatDateForICS(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}
```

### C. Create Email Notification Function

Create `src/lib/appointments/email-notification.ts`:

```typescript
import { generateICS } from './calendar-invite';
import { config } from '../appointments.config';

/**
 * Send appointment confirmation email with .ics attachment
 */
export async function sendAppointmentConfirmation(appointment: {
  id: string;
  customerName: string;
  customerEmail: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  selectedTier?: string;
  amount?: number; // in cents, null if free
  notes?: string;
}) {
  // Generate .ics calendar invite
  const icsContent = generateICS({
    id: appointment.id,
    serviceName: config.serviceName,
    customerName: appointment.customerName,
    customerEmail: appointment.customerEmail,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    notes: appointment.notes,
  });
  
  // Format appointment details
  const dateStr = appointment.startTime.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = appointment.startTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: config.timezone,
  });
  
  const priceStr = appointment.amount 
    ? `$${(appointment.amount / 100).toFixed(2)}`
    : 'Free';
  
  // Send email via email skill
  // Note: Email skill provides sendEmail function via template installation
  const { sendEmail } = await import('@/server/email');
  
  await sendEmail({
    to: appointment.customerEmail,
    subject: `Appointment Confirmed: ${config.serviceName}`,
    html: `
      <h2>Your appointment is confirmed!</h2>
      
      <p><strong>Service:</strong> ${config.serviceName}${appointment.selectedTier ? ` - ${appointment.selectedTier}` : ''}</p>
      <p><strong>Date:</strong> ${dateStr}</p>
      <p><strong>Time:</strong> ${timeStr}</p>
      <p><strong>Duration:</strong> ${appointment.duration} minutes</p>
      <p><strong>Price:</strong> ${priceStr}</p>
      
      ${appointment.notes ? `<p><strong>Notes:</strong> ${appointment.notes}</p>` : ''}
      
      <p>A calendar invite is attached - add it to your calendar so you don't miss your appointment!</p>
      
      <p>If you need to cancel or reschedule, please contact us.</p>
    `,
    attachments: [
      {
        filename: 'appointment.ics',
        content: icsContent,
        contentType: 'text/calendar; charset=utf-8; method=REQUEST',
      },
    ],
  });
  
  // Also send notification to business owner (if configured)
  // Check if admin_email is in memory from JTBD discovery
  const adminEmailResult = await memoryRead({ key: 'jtbd.appointments.admin_email' });
  const adminEmail = adminEmailResult?.value;
  
  if (adminEmail) {
    await sendEmail({
      to: adminEmail,
      subject: `New Appointment: ${appointment.customerName}`,
      html: `
        <h2>New appointment booked</h2>
        
        <p><strong>Customer:</strong> ${appointment.customerName}</p>
        <p><strong>Email:</strong> ${appointment.customerEmail}</p>
        <p><strong>Service:</strong> ${config.serviceName}${appointment.selectedTier ? ` - ${appointment.selectedTier}` : ''}</p>
        <p><strong>Date:</strong> ${dateStr}</p>
        <p><strong>Time:</strong> ${timeStr}</p>
        <p><strong>Duration:</strong> ${appointment.duration} minutes</p>
        <p><strong>Price:</strong> ${priceStr}</p>
        
        ${appointment.notes ? `<p><strong>Notes:</strong> ${appointment.notes}</p>` : ''}
      `,
      attachments: [
        {
          filename: 'appointment.ics',
          content: icsContent,
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        },
      ],
    });
  }
}
```

### D. Integrate into Appointment Creation

**Update `src/server/api/appointments/POST.ts` to send email after creating appointment:**

```typescript
import { sendAppointmentConfirmation } from '@/lib/appointments/email-notification';

export async function POST(req: Request, res: Response) {
  try {
    // ... create appointment logic ...
    
    const newAppointment = await db.insert(appointment).values({
      // ... appointment data ...
    }).returning();
    
    // Send confirmation email with .ics attachment
    await sendAppointmentConfirmation({
      id: newAppointment.id,
      customerName: newAppointment.customerName,
      customerEmail: newAppointment.customerEmail,
      startTime: newAppointment.startTime,
      endTime: newAppointment.endTime,
      duration: newAppointment.duration,
      selectedTier: newAppointment.selectedTier,
      amount: newAppointment.amount,
      notes: newAppointment.notes,
    });
    
    return res.json({ success: true, appointment: newAppointment });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create appointment' });
  }
}
```

**Also update payment success page (`BookAppointmentSuccess.tsx`) to send email after payment confirmation:**

```typescript
// After updating appointment status to 'completed'
await fetch(`/api/appointments/${appointmentId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    paymentStatus: 'completed',
    status: 'confirmed',
  }),
});

// Send confirmation email
await fetch(`/api/appointments/${appointmentId}/send-confirmation`, {
  method: 'POST',
});
```

**Create endpoint for sending confirmation after payment:**

Create `src/server/api/appointments/[id]/send-confirmation/POST.ts`:

```typescript
import type { Request, Response } from 'express';
import { db } from '@/server/db/connection';
import { appointment } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { sendAppointmentConfirmation } from '@/lib/appointments/email-notification';

export async function POST(req: Request, res: Response) {
  try {
    const { id } = req.params;
    
    // Fetch appointment
    const apt = await db
      .select()
      .from(appointment)
      .where(eq(appointment.id, id))
      .limit(1);
    
    if (!apt[0]) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    
    // Send confirmation email
    await sendAppointmentConfirmation(apt[0]);
    
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to send confirmation' });
  }
}
```

### E. Email Notification Flow

**For free appointments (including free first):**
1. Create appointment
2. Send confirmation email immediately
3. Show success message

**For paid appointments:**
1. Create appointment with `paymentStatus: 'pending'`
2. Redirect to payment
3. On payment success, update status to `completed`
4. Send confirmation email (via `/send-confirmation` endpoint)
5. Show success message

**IMPORTANT:** Always send email with .ics attachment so customers can add to their calendar.

---

## Step 10: Admin Dashboard (Optional)

**Create admin dashboard for managing appointments and viewing order details.**

### A. Create Admin Dashboard Page

Create `src/pages/admin/Appointments.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-client';

interface Appointment {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  startTime: string;
  endTime: string;
  selectedTier?: string;
  duration: number;
  amount?: number; // in cents, null if free
  paymentStatus?: string; // 'pending' | 'completed' | null
  paymentIntentId?: string; // orderId, null if free
  status: string;
  notes?: string;
  createdAt: string;
}

export function AdminAppointments() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [orderDetails, setOrderDetails] = useState<any>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);
  
  // Require admin access
  if (!user?.isAdmin) {
    return <div>Access denied. Admin only.</div>;
  }
  
  useEffect(() => {
    async function loadAppointments() {
      const response = await fetch('/api/appointments/admin/list');
      const data = await response.json();
      setAppointments(data.appointments);
    }
    loadAppointments();
  }, []);
  
  async function fetchOrderDetails(appointment: Appointment) {
    if (!appointment.paymentIntentId) {
      // No payment - show free appointment message
      setOrderDetails({ free: true });
      return;
    }
    
    setLoadingOrder(true);
    try {
      // Fetch order status via payment-provider abstraction
      const response = await fetch(`/api/appointments/payment/status?orderId=${appointment.paymentIntentId}`);
      const data = await response.json();
      
      if (data.success) {
        setOrderDetails(data);
      } else {
        setOrderDetails({ error: data.error });
      }
    } catch (error) {
      setOrderDetails({ error: 'Failed to fetch order details' });
    } finally {
      setLoadingOrder(false);
    }
  }
  
  return (
    <div>
      <h1>Appointments</h1>
      
      <table>
        <thead>
          <tr>
            <th>Date/Time</th>
            <th>Customer</th>
            <th>Service</th>
            <th>Amount</th>
            <th>Payment Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((apt) => (
            <tr key={apt.id}>
              <td>{new Date(apt.startTime).toLocaleString()}</td>
              <td>
                {apt.customerName}
                <br />
                <small>{apt.customerEmail}</small>
              </td>
              <td>
                {apt.selectedTier || `${apt.duration} min`}
              </td>
              <td>
                {apt.amount ? `$${(apt.amount / 100).toFixed(2)}` : 'Free'}
              </td>
              <td>
                {apt.paymentStatus === 'completed' && <span className="badge-success">Paid</span>}
                {apt.paymentStatus === 'pending' && <span className="badge-warning">Pending</span>}
                {!apt.paymentStatus && <span className="badge-info">Free</span>}
              </td>
              <td>
                {apt.paymentIntentId && (
                  <button
                    onClick={() => {
                      setSelectedAppointment(apt);
                      fetchOrderDetails(apt);
                    }}
                  >
                    Order Details
                  </button>
                )}
                {!apt.paymentIntentId && (
                  <button
                    onClick={() => {
                      setSelectedAppointment(apt);
                      setOrderDetails({ free: true });
                    }}
                  >
                    View Details
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {/* Order Details Modal */}
      {selectedAppointment && (
        <div className="modal">
          <div className="modal-content">
            <h2>Appointment Details</h2>
            
            <div>
              <h3>Customer Information</h3>
              <p>Name: {selectedAppointment.customerName}</p>
              <p>Email: {selectedAppointment.customerEmail}</p>
              {selectedAppointment.customerPhone && (
                <p>Phone: {selectedAppointment.customerPhone}</p>
              )}
            </div>
            
            <div>
              <h3>Appointment Information</h3>
              <p>Date: {new Date(selectedAppointment.startTime).toLocaleString()}</p>
              <p>Duration: {selectedAppointment.duration} minutes</p>
              {selectedAppointment.selectedTier && (
                <p>Tier: {selectedAppointment.selectedTier}</p>
              )}
              {selectedAppointment.notes && (
                <p>Notes: {selectedAppointment.notes}</p>
              )}
            </div>
            
            {loadingOrder && <p>Loading order details...</p>}
            
            {orderDetails && orderDetails.free && (
              <div>
                <h3>Payment Information</h3>
                <p className="badge-info">Free Appointment - No payment required</p>
              </div>
            )}
            
            {orderDetails && !orderDetails.free && !orderDetails.error && (
              <div>
                <h3>Payment Information</h3>
                <p>Order ID: {orderDetails.orderId}</p>
                <p>Status: <span className={`badge-${orderDetails.status === 'paid' ? 'success' : 'warning'}`}>
                  {orderDetails.status}
                </span></p>
                <p>Amount: ${(orderDetails.amount / 100).toFixed(2)} {orderDetails.currency}</p>
                {selectedAppointment.paymentIntentId && (
                  <p>
                    <small>Payment Intent ID: {selectedAppointment.paymentIntentId}</small>
                  </p>
                )}
              </div>
            )}
            
            {orderDetails && orderDetails.error && (
              <div>
                <h3>Payment Information</h3>
                <p className="text-error">Error: {orderDetails.error}</p>
                {selectedAppointment.paymentIntentId && (
                  <p>
                    <small>Payment Intent ID: {selectedAppointment.paymentIntentId}</small>
                  </p>
                )}
              </div>
            )}
            
            <button onClick={() => {
              setSelectedAppointment(null);
              setOrderDetails(null);
            }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

### B. Create Admin API Endpoint

Create `src/server/api/appointments/admin/list/GET.ts`:

```typescript
import type { Request, Response } from 'express';
import { db } from '@/server/db/connection';
import { appointment } from '@/server/db/schema';
import { desc } from 'drizzle-orm';

export async function GET(req: Request, res: Response) {
  try {
    // TODO: Add admin auth check
    // const { user } = await getAuth(req);
    // if (!user?.isAdmin) {
    //   return res.status(403).json({ error: 'Forbidden' });
    // }
    
    // Fetch all appointments, newest first
    const appointments = await db
      .select()
      .from(appointment)
      .orderBy(desc(appointment.startTime));
    
    return res.json({ appointments });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch appointments'
    });
  }
}
```

### C. Add Route

In `src/routes.tsx`:

```tsx
{ path: '/admin/appointments', element: <AdminAppointments /> },
```

### D. Key Features

**Order Details Button Logic:**
- **If `paymentIntentId === null`** → Show "Free Appointment" badge, no payment-provider call
- **If `paymentIntentId !== null`** → Fetch order status via payment-provider abstraction
- **Display:**
  - Order ID (the actual orderId from GoDaddy after payment)
  - Status (pending, paid, failed, refunded, cancelled)
  - Amount and currency
  - Payment Intent ID (original draftOrderId stored at booking time)

**CRITICAL:** Admin console must handle NULL `paymentIntentId` gracefully:
- Don't call payment-provider for free appointments
- Display "Free Appointment" instead of payment status
- Don't show "Order Details" button for appointments without payment

---

## Step 11: Customer Portal (Conditional)

**ONLY complete this step if `requires_customer_portal === true` in memory.**

Check memory:
```typescript
const customerPortalResult = await memoryRead({ key: 'jtbd.appointments.requires_customer_portal' });
const requiresCustomerPortal = customerPortalResult?.value === true;
```

**If false, skip this entire step.**

### A. Install Authentication Skill (if not already installed)

```typescript
skill({ action: 'install', skill: 'authentication' });

requestSecrets({
  title: 'Authentication Setup',
  description: 'Configuring authentication for customer portal',
  secrets: [
    {
      name: 'BETTER_AUTH_SECRET',
      description: 'Session encryption key (auto-generated)',
      required: true,
      defaultValue: 'auto:hex64',
    },
  ],
  mode: 'add',
  autoSubmit: true,
});
```

### B. Create Portal Pages

**Create `/portal/login` - Customer login:**

```tsx
// src/pages/portal/Login.tsx
import { AuthPage } from '@/components/auth/AuthPage';

export function PortalLogin() {
  return <AuthPage mode="login" redirectTo="/portal/dashboard" />;
}
```

**Create `/portal/signup` - Customer registration:**

```tsx
// src/pages/portal/Signup.tsx
import { AuthPage } from '@/components/auth/AuthPage';

export function PortalSignup() {
  return <AuthPage mode="signup" redirectTo="/portal/dashboard" />;
}
```

**Create `/portal/dashboard` - Customer dashboard:**

```tsx
// src/pages/portal/Dashboard.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-client';

export function PortalDashboard() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  
  useEffect(() => {
    async function loadAppointments() {
      const response = await fetch(`/api/appointments/my-appointments`);
      const data = await response.json();
      setAppointments(data.appointments);
    }
    loadAppointments();
  }, []);
  
  if (!user) {
    return <div>Please log in to view your appointments.</div>;
  }
  
  return (
    <div>
      <h1>My Appointments</h1>
      
      <h2>Upcoming Appointments</h2>
      {appointments.filter(apt => new Date(apt.startTime) >= new Date()).map(apt => (
        <div key={apt.id}>
          <p>Date: {new Date(apt.startTime).toLocaleString()}</p>
          <p>Service: {apt.selectedTier || config.serviceName}</p>
          <p>Duration: {apt.duration} minutes</p>
          {apt.amount && <p>Amount: ${(apt.amount / 100).toFixed(2)}</p>}
          <button onClick={() => handleCancel(apt.id)}>Cancel</button>
        </div>
      ))}
      
      <h2>Past Appointments</h2>
      {appointments.filter(apt => new Date(apt.startTime) < new Date()).map(apt => (
        <div key={apt.id}>
          <p>Date: {new Date(apt.startTime).toLocaleString()}</p>
          <p>Service: {apt.selectedTier || config.serviceName}</p>
        </div>
      ))}
    </div>
  );
}
```

### C. Create Customer API Endpoints

**Create `src/server/api/appointments/my-appointments/GET.ts`:**

```typescript
import type { Request, Response } from 'express';
import { db } from '@/server/db/connection';
import { appointment } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { getAuth } from '@/server/auth';

export async function GET(req: Request, res: Response) {
  try {
    const { user } = await getAuth(req);
    
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Fetch appointments for logged-in user
    const appointments = await db
      .select()
      .from(appointment)
      .where(eq(appointment.customerEmail, user.email))
      .orderBy(appointment.startTime);
    
    return res.json({ appointments });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch appointments' });
  }
}
```

### D. Add Routes

```tsx
{ path: '/portal/login', element: <PortalLogin /> },
{ path: '/portal/signup', element: <PortalSignup /> },
{ path: '/portal/dashboard', element: <PortalDashboard /> },
```

---

## Step 12: Class Credits System (Conditional)

**ONLY complete this step if `class_packages` exists in memory.**

Check memory:
```typescript
const classPackagesResult = await memoryRead({ key: 'jtbd.appointments.class_packages' });
const classPackages = classPackagesResult?.value; // Array or undefined
```

**If undefined, skip this entire step.**

### A. Update Database Schema

Add credits field to user table in `src/server/db/schema.ts`:

```typescript
export const user = mysqlTable('user', {
  // ... existing fields from authentication skill
  credits: int('credits').default(0),
});
```

Run migrations: `npm run db:generate && npm run db:migrate`

### B. Create SKUs for Class Packages

```typescript
// Create SKU for each package
for (const pkg of classPackages) {
  const result = await commerce__manage_products({
    action: 'createProduct',
    storeId,
    label: `${config.serviceName} - ${pkg.label}`,
    type: 'DIGITAL',
    defaultSku: {
      name: `${slugify(config.serviceName)}-${pkg.label}`,
      prices: [{ currencyCode: 'USD', value: pkg.amount * 100 }],
    }
  });
  
  // Store skuId in config
  pkg.skuId = result.data.createSkuGroup.skus.edges[0].node.id;
}
```

### C. Create Purchase Flow

**Create `/portal/packages` page:**

```tsx
// src/pages/portal/Packages.tsx
export function Packages() {
  const { user } = useAuth();
  
  return (
    <div>
      <h1>Class Packages</h1>
      <p>Your credits: {user.credits || 0}</p>
      
      <div className="grid gap-4">
        {classPackages.map(pkg => (
          <div key={pkg.label}>
            <h3>{pkg.label}</h3>
            <p>{pkg.credits} credits</p>
            <p>${pkg.amount}</p>
            <button onClick={() => purchasePackage(pkg)}>Purchase</button>
          </div>
        ))}
      </div>
    </div>
  );
}

async function purchasePackage(pkg) {
  // Create payment session
  const response = await fetch('/api/appointments/payment/create-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      skuId: pkg.skuId,
      amount: pkg.amount,
      currency: 'USD',
      returnUrl: `${window.location.origin}/portal/packages`,
      successUrl: `${window.location.origin}/portal/packages/success?credits=${pkg.credits}`,
    }),
  });
  
  const { paymentUrl } = await response.json();
  window.location.href = paymentUrl;
}
```

### D. Update Booking Flow to Use Credits

**Modify booking flow to check and deduct credits:**

```typescript
// In BookingForm component, before payment check:
if (classPackages && user) {
  // Check if user has credits
  const { credits } = user;
  
  if (credits > 0) {
    // Use 1 credit
    await fetch('/api/appointments/use-credit', {
      method: 'POST',
      body: JSON.stringify({ appointmentId: newAppointment.id })
    });
    
    // Show confirmation
    setStep('confirmation');
    showMessage(`Appointment booked! ${credits - 1} credits remaining.`);
    return;
  } else {
    // No credits - redirect to purchase
    showMessage('You need to purchase a class package first.');
    router.push('/portal/packages');
    return;
  }
}
```

**Create credit usage endpoint `src/server/api/appointments/use-credit/POST.ts`:**

```typescript
import type { Request, Response } from 'express';
import { db } from '@/server/db/connection';
import { user, appointment } from '@/server/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { getAuth } from '@/server/auth';

export async function POST(req: Request, res: Response) {
  try {
    const { user: authUser } = await getAuth(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { appointmentId } = req.body;
    
    // Deduct 1 credit atomically
    const result = await db
      .update(user)
      .set({ credits: sql`${user.credits} - 1` })
      .where(
        and(
          eq(user.id, authUser.id),
          gt(user.credits, 0)
        )
      );
    
    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Insufficient credits' });
    }
    
    // Update appointment to mark as credit-based
    await db
      .update(appointment)
      .set({ paymentStatus: 'credit' })
      .where(eq(appointment.id, appointmentId));
    
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to use credit' });
  }
}
```

### E. Add Credits to Portal Dashboard

Update portal dashboard to show credit balance:

```tsx
<div className="credits-badge">
  <p>Credits: {user.credits || 0}</p>
  <button onClick={() => router.push('/portal/packages')}>
    Buy More Credits
  </button>
</div>
```

---

## Step 13: Run Type Check

```bash
npm run type-check
```

Verify all TypeScript errors are resolved before testing the booking flow.

---

## After Setup Complete

### For Single Pricing

Determine the message based on `config.paymentAmount`:

**If `config.paymentAmount !== null` (paid appointments):**

> "Appointment booking is now set up!
>
> - **Booking page:** `/book`
> - **Service:** {{serviceName}} ({{duration}} minutes)
> - **Price:** ${{paymentAmount}}
> - **Hours:** {{businessHoursStart}}-{{businessHoursEnd}} on {{workingDaysReadable}}
>
> **Would you like me to add any enhancements?**
>
> 1. Email notifications
> 2. Admin dashboard (with authN / authZ)
> 3. Cancellation/rescheduling
> 4. Google Calendar sync"

**If `config.paymentAmount === null` (free appointments):**

> "Appointment booking is now set up!
>
> - **Booking page:** `/book`
> - **Service:** {{serviceName}} ({{duration}} minutes)
> - **Price:** Free
> - **Hours:** {{businessHoursStart}}-{{businessHoursEnd}} on {{workingDaysReadable}}
>
> **Would you like me to add any enhancements?**
>
> 1. Email notifications
> 2. Admin dashboard (with authN / authZ)
> 3. Cancellation/rescheduling
> 4. Google Calendar sync"

### For Variable Pricing

**Variable pricing always has payment amounts (all tiers include prices):**

> "Appointment booking is now set up with multiple pricing tiers!
>
> - **Booking page:** `/book`
> - **Service:** {{serviceName}}
> - **Tiers:**
>   {{#each pricingTiers}}
>   - {{label}}: {{duration}} min - ${{amount}}
>   {{/each}}
> - **Hours:** {{businessHoursStart}}-{{businessHoursEnd}} on {{workingDaysReadable}}
>
> **Would you like me to add any enhancements?**
>
> 1. Email notifications
> 2. Admin dashboard (with authN / authZ)
> 3. Cancellation/rescheduling
> 4. Google Calendar sync"

---
