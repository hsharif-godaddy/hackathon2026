## § Configuration Examples

### 2.0 What `AppointmentsConfigSchema` actually accepts

`templates/lib/appointments.ts` defines the schema that validates `appointments.config.ts`.
Anything not in the schema is silently stripped at parse time, and `getConfig()` falls back
to `defaultConfig` if Zod rejects the file. The validated shape is exactly:

```typescript
{
  serviceName: string;
  duration: number;                       // minutes, 5..480
  businessHoursStart: string;             // 'HH:mm'
  businessHoursEnd: string;               // 'HH:mm'
  workingDays: number[];                  // 0..6 (Sun..Sat); at least one entry
  currency: string;                       // ISO 4217 (default 'USD'); display formatting + SKU currency hint
  timezone: string;                       // IANA timezone (default 'UTC'); business hours interpreted in this tz
  pricingTiers?: Array<{                  // omit for free-only services
    label: string;
    duration: number;                     // minutes, 5..480
    amount: number;                       // smallest unit of `currency` (cents/yen/fils...)
    skuId: string;                        // REQUIRED — Commerce SKU per tier
  }>;
}
```

Things the docs sometimes mention but the schema does **not** validate:

| Concept                | Where it actually lives                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `requiresPayment`      | Per-booking input on `POST /api/appointments` body (not config).         |
| `amount`               | Per-booking input; must match a `pricingTiers[].amount` server-side.     |
| `timezone`             | In the schema (IANA format, default `'UTC'`). Controls all time math.    |
| `bufferTime`           | Not in the schema. Buffer is whatever the slot generator chooses.        |
| `freeFirstAppointment` | Not in the schema. Requires extending `AppointmentsConfigSchema` (§ 8.7). |
| `classPackages`        | Not in the schema. Requires extending `AppointmentsConfigSchema` (§ 12). |
| `serviceType`          | Used only by discovery for picking suggestions; not stored in config.    |

**About `currency`.** The shipped GoDaddy provider does **not** forward this value to the
checkout API — GoDaddy derives the actual checkout currency from the SKU's price. We keep
`config.currency` because:

1. It must match the currency the merchant's SKUs are priced in. If they create EUR SKUs,
   set `currency: 'EUR'` so all UI and email rendering use the right symbol/format.
2. `lib/appointments` exports `formatMoney(amount, currency, locale?)` which uses
   `Intl.NumberFormat` and respects the currency's correct number of fraction digits
   (cents for USD/EUR, none for JPY, three for KWD).
3. The `currency` field stays on the typed contract for display validation — callers can
   verify the configured currency matches what the merchant's GoDaddy Commerce SKUs are priced in.

The examples below stay within the validated schema. Sections that need additional fields
(free-first, class packages) call out the schema extension explicitly.

### 2.1 Single Fixed Price Configuration

There is no separate `paymentAmount` field. Single-price services express price as a
`pricingTiers` array with one entry — that's the only path the shipped `POST.ts` understands
when `body.requiresPayment` is true (it looks up the SKU by `amount`).

**Example: Personal coaching at $80 per 60-minute session**

```typescript
// src/lib/appointments.config.ts
export const config = {
  serviceName: 'Sarah Chen Coaching',
  duration: 60,
  workingDays: [1, 2, 3, 4, 5], // Mon-Fri (0=Sun..6=Sat)
  businessHoursStart: '09:00',
  businessHoursEnd: '17:00',
  currency: 'USD',            // ISO 4217; must match the currency of the SKUs in your store
  timezone: 'America/New_York', // IANA timezone — business hours interpreted in this tz
  pricingTiers: [
    {
      label: '60-minute Coaching Session',
      duration: 60,
      amount: 8000,           // cents — $80.00 (USD has 2 minor units)
      skuId: 'coaching-60',   // REQUIRED — get via commerce__search_tools + commerce__execute_tool
    },
  ],
};
```

The booking form sends `{ requiresPayment: true, amount: 8000 }` per request; `POST.ts`
finds the matching tier, gets its `skuId`, and creates the Commerce session with that SKU.

### 2.2 Variable Pricing Configuration

**Example: Massage therapy with 3 tiers, priced in EUR**

```typescript
// src/lib/appointments.config.ts
export const config = {
  serviceName: 'Bella Spa',
  duration: 60,                 // default duration; per-booking duration comes from the tier
  workingDays: [2, 3, 4, 5, 6], // Tue-Sat
  businessHoursStart: '10:00',
  businessHoursEnd: '18:00',
  currency: 'EUR',              // EUR has 2 minor units; amounts below are euro cents
  timezone: 'Europe/Berlin',    // IANA timezone — business hours interpreted in this tz
  pricingTiers: [
    { label: '30-minute Swedish Massage', duration: 30, amount: 5000,  skuId: 'massage-30' },
    { label: '60-minute Deep Tissue',     duration: 60, amount: 9000,  skuId: 'massage-60' },
    { label: '90-minute Hot Stone',       duration: 90, amount: 14000, skuId: 'massage-90' },
  ],
};
```

**Notes:**

- Amounts are integers in the smallest unit of `config.currency`. For 2-decimal currencies
  (USD/EUR/GBP) `5000` = 50.00; for JPY (no decimals) `5000` = ¥5,000; for KWD (3 decimals)
  `5000` = 5.000 KWD.
- Each tier needs its own Commerce SKU. Tier `amount` values must be unique — duplicate
  amounts are rejected by the schema's `.refine()` because the lookup-by-amount in `POST.ts`
  would otherwise be ambiguous.
- The shipped slot generator does not subtract a configurable buffer between bookings. If
  you need real buffer/cleanup time, extend the schema and adapt the slot generator in
  `templates/lib/appointments.ts`.

### 2.3 Class Credits Configuration

`classPackages` is **not** in `AppointmentsConfigSchema`. To build a credits flow you need to
extend the schema (and the loader will then pass it through). For example, in
`templates/lib/appointments.ts`:

```typescript
export const ClassPackageSchema = z.object({
  label: z.string().min(1),
  credits: z.number().int().min(1),
  amount: z.number().int().min(0),
  skuId: z.string().min(1),
});

export const AppointmentsConfigSchema = z.object({
  // ...existing fields...
  classPackages: z.array(ClassPackageSchema).optional(),
});
```

**Example config (after the extension above):**

```typescript
// src/lib/appointments.config.ts
export const config = {
  serviceName: 'Zen Yoga Studio',
  duration: 60,
  workingDays: [0, 1, 2, 3, 4, 5, 6], // every day; 0 = Sun
  businessHoursStart: '06:00',
  businessHoursEnd: '20:00',
  currency: 'USD',
  classPackages: [
    { label: 'Single Class',                credits: 1,  amount: 2000,  skuId: 'yoga-1'  },
    { label: '5-Class Pass',                credits: 5,  amount: 9000,  skuId: 'yoga-5'  },
    { label: '10-Class Pass',               credits: 10, amount: 15000, skuId: 'yoga-10' },
    { label: '20-Class Pass (Best Value)',  credits: 20, amount: 26000, skuId: 'yoga-20' },
  ],
};
```

**Flow:**

1. New customer → redirected to `/credits/purchase`.
2. Select package → pay via GoDaddy Commerce → success page polls
   `getOrderStatus(orderId)` and adds credits.
3. Return to booking page → select slot → booking deducts 1 credit (auth required).

### 2.4 Free Service Configuration

For free-only services, omit `pricingTiers` entirely. The booking form sends `requiresPayment: false`
and the handler skips the payment branch.

**Example: Restaurant reservations (no payment)**

```typescript
// src/lib/appointments.config.ts
export const config = {
  serviceName: 'Bella Italian Restaurant',
  duration: 120,                          // 2-hour table reservation
  workingDays: [0, 2, 3, 4, 5, 6],        // Tue-Sun (0 = Sun, no Mon)
  businessHoursStart: '17:00',            // Dinner only
  businessHoursEnd: '22:00',
  // `currency` defaults to 'USD'; you can omit it for free services entirely.
};
```

**What this creates:**

- Simple booking form (no payment step)
- Slots driven by `duration` + business hours
- Confirmation email sent immediately
- No authentication required
