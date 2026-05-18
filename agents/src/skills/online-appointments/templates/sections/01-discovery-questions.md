## § Discovery Questions

### Full Question Scripts with Examples

This section provides complete conversational scripts for gathering requirements.

#### 1.1 Understanding the Business

**Ask conversationally:**

> "Great! I'll help you set up appointment booking. First, what type of appointments are you offering? For example: tutoring sessions, yoga classes, haircuts, consultations, restaurant reservations, etc."

**Store the answer** (used by discovery to pick suggestions; not stored on config):

```typescript
const serviceType = '<user_answer>';
```

**Then ask about service name and multiple types:**

> "What's the name of this service or business as customers will see it? For example: 'Sarah Chen Coaching', 'Bella Salon', 'Yoga Studio', 'Web Design Services'
>
> **Note:** This system supports multiple service types with different durations and pricing (e.g., a personal trainer offering 30-min sessions AND 60-min sessions). We'll ask about pricing options in the next step."

**Store the answer:**

```typescript
const serviceName = '<user_answer>';
```

#### 1.2 Duration & Schedule Details

**Ask about timing:**

> "How long does each {{service_name}} take? Just give me a number in minutes."

**Store the answer:**

```typescript
const duration = <number_in_minutes>;
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
// Captured for discovery only — bufferTime is NOT in AppointmentsConfigSchema.
// To honor it, extend the schema and adapt the slot generator in templates/lib/appointments.ts.
const bufferTime = <number_in_minutes>;
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

**Ask about business hours:**

> "What are your business hours? I'll need:
>
> 1. What days are you open? (e.g., Monday-Friday, Monday-Saturday, Tuesday-Sunday)
> 2. What time do you open? (e.g., 9:00 AM)
> 3. What time do you close? (e.g., 5:00 PM)"

**Store the answers:**

```typescript
const workingDays = [1, 2, 3, 4, 5]; // 0=Sun..6=Sat (per the schema's z.number().min(0).max(6))
const businessHoursStart = '09:00';
const businessHoursEnd = '17:00';
```

**Timezone handling:**

Detect timezone from user's browser and confirm:

> "I've detected your timezone as {{detected_timezone}}. Is this correct for your business hours?"

**How to detect timezone:**
The user's browser timezone is available in the conversation context.

**If user confirms** (capture for messaging only — `timezone` is NOT in
`AppointmentsConfigSchema`; date math runs in local-server time unless you extend the
schema and slot generator together):

```typescript
const timezone = '<detected_timezone>';
```

**If user says no:**

Ask: "What timezone are your business hours in?"

Convert user input to IANA format:
- US Central Time / CDT / Chicago → "America/Chicago"
- US Eastern Time / EDT / New York → "America/New_York"
- US Mountain Time / MDT / Denver → "America/Denver"
- US Pacific Time / PDT / Los Angeles → "America/Los_Angeles"

```typescript
const timezone = '<IANA_timezone>';
```

**Help them decide - examples by service type:**

- Office/consultation: Mon-Fri 9am-5pm
- Retail/salon: Mon-Sat 10am-6pm
- Fitness: Mon-Sun 6am-8pm
- Restaurant: Tue-Sun 11am-10pm

#### 1.3 Payment Detection

**CRITICAL: ALWAYS ask about payment - this is required, not optional.**

**Ask with clear yes/no question:**

> "Do customers need to pay when they book? (Yes or No)"

**Listen for:**

- Explicit "yes" or "no"
- Price mentions like "$80", "50 dollars", "€100" → This means YES, requires_payment = true
- "Free" or "no charge" → This means NO, requires_payment = false
- Vague answers like "maybe" or "depends" → Ask again: "To set this up correctly, I need to know: will customers complete a payment as part of booking? Yes or No"

**Store the answer:**

```typescript
// `requiresPayment` is per-booking (set on each POST body), not stored on config.
// Capture the answer here so later code knows whether to define `pricingTiers`.
const requiresPayment = true;  // user said yes / mentioned a price
// const requiresPayment = false;  // user said no / "free"
```

**Confirm back to user:**

- If YES: > "Got it - I'll set up payment processing for bookings."
- If user mentioned price like "$80": > "Perfect - customers will pay $80 when booking. I'll integrate payment processing."
- If NO: > "Understood - bookings will be free, no payment required."

**IMPORTANT:**

- If the user mentions ANY price/amount (like "$80 per session") at ANY point during discovery, immediately set `requires_payment = true`
- This question must be asked for ALL appointment types - consulting, fitness, salon, restaurant, etc.
- Never assume free appointments, even for consultations or trials

#### 1.4 Free First Consultation (Conditional)

**If `requiresPayment === true` AND service type is consulting/tutoring/therapy/coaching:**

> "Do you offer a free first consultation or trial session, with payment required for follow-up appointments?"

**Store the answer:**

```typescript
// Schema extension required — see § 8.7. Without extending AppointmentsConfigSchema,
// Zod silently strips this field at parse time.
const freeFirstAppointment = true;  // user said yes
// const freeFirstAppointment = false;  // user said no
```

**If yes:**

> "Got it! First appointments will be free, and follow-up appointments will require payment."

#### 1.5 Currency

**If `requiresPayment === true`, ALWAYS ask the currency BEFORE pricing.** This determines
the smallest unit you'll quote prices in (cents for USD/EUR, yen for JPY, etc.) and must
match the currency of the SKUs the merchant has in their GoDaddy Commerce store.

> "What currency are your prices in? (For example: USD, EUR, GBP, CAD, AUD, JPY.)"

**Detect from price hints already given:**

- "$80" / "USD" / "dollars" → `'USD'`
- "€80" / "EUR" / "euros"   → `'EUR'`
- "£80" / "GBP" / "pounds"  → `'GBP'`
- "¥1000" / "JPY" / "yen"   → `'JPY'`
- If the user already gave a price with a recognisable symbol, confirm rather than re-ask:
  > "Got it — prices in EUR. Confirming?"

**Store** (ISO 4217 three-letter code; this goes directly into `config.currency`):

```typescript
const currency = 'EUR'; // for example
```

**Confirm back to user:**

> "Perfect — I'll set up your booking system with prices in {{currency}}. Make sure the
> products you create in your GoDaddy Commerce store are also priced in {{currency}}."

#### 1.6 Pricing Structure

**If `requiresPayment === true`, ask about pricing structure:**

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

**Store** as a single-entry `pricingTiers` array (the schema has no `paymentAmount` field;
fixed-price services express price as one tier). `amount` is in the smallest unit of
`config.currency` — cents for USD/EUR/GBP, yen for JPY, fils for KWD:

```typescript
const pricingTiers = [
  {
    label: '<service_name>',
    duration: <number_in_minutes>,
    amount: <the_price_in_minor_units>, // e.g. $80.00 → 8000 (USD); ¥8,000 → 8000 (JPY); 5.000 KWD → 5000
    skuId: '<set-after-commerce-skill>', // REQUIRED — fill in after creating the SKU
  },
];
```

> "Perfect! Customers will pay {{formatMoney(amount, currency)}} when they book. I'll integrate payment processing with GoDaddy Commerce."

**If Variable Pricing (Option 2):**

> "What are your pricing tiers? For example:
>
> - 30 minutes: $25
> - 60 minutes: $50
> - 90 minutes: $100
>
> Please list each tier with its duration and price."

**Store as array** (amounts in the smallest unit of `config.currency`; `skuId` required on
every tier — fill in after the commerce skill creates the SKUs):

```typescript
// Example for USD/EUR/GBP (2 decimals): 25.00 → 2500
const pricingTiers = [
  { label: '30 minutes', duration: 30, amount: 2500,  skuId: '<set-after-commerce-skill>' },
  { label: '60 minutes', duration: 60, amount: 5000,  skuId: '<set-after-commerce-skill>' },
  { label: '90 minutes', duration: 90, amount: 10000, skuId: '<set-after-commerce-skill>' },
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

**Store as array** (amounts in the smallest unit of `config.currency`; `skuId` required on
every package — fill in after the commerce skill creates the SKUs). **Schema extension
required:** add a `ClassPackageSchema` and `classPackages` field to
`AppointmentsConfigSchema` first (§ 12), otherwise Zod strips this at parse time.

```typescript
const classPackages = [
  { label: 'Single Class',  credits: 1,  amount: 2000,  skuId: '<set-after-commerce-skill>' },
  { label: '5-Class Pass',  credits: 5,  amount: 9000,  skuId: '<set-after-commerce-skill>' },
  { label: '10-Class Pass', credits: 10, amount: 15000, skuId: '<set-after-commerce-skill>' },
];
```

**Implementation note:** Customers purchase packages (via commerce), credits are added to their account, and they use credits to book appointments. Requires customer portal for credit tracking and authentication for account management.

**Payment timing:** Payment happens BEFORE booking is confirmed. This reserves the slot and reduces no-shows.
