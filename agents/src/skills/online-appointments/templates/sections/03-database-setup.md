## § Database Setup

**PREREQUISITE: Install database skill first**

```typescript
skill({ action: 'install', skill: 'database' });
```

This creates `src/server/db/schema.ts` where you'll add the appointment table.

### 3.1 Complete Schema

**Add to `src/server/db/schema.ts` (created by database skill).** This must match the columns
read and written by `templates/server/api/appointments/POST.ts` and `GET.ts`:

> **Dialect:** the database skill picks the dialect (SQLite, MySQL, or Postgres) and owns
> the `drizzle-orm/*-core` import. Mirror its imports and column-type helpers — the example
> below uses `mysql-core` for illustration; in a SQLite-backed app the same shape uses
> `sqlite-core` (`text` instead of `varchar`, `integer` with `mode: 'timestamp'`, etc.).

```typescript
import { mysqlTable, varchar, timestamp, int, text, boolean } from 'drizzle-orm/mysql-core';

export const appointment = mysqlTable('appointment', {
  id: varchar('id', { length: 50 }).primaryKey(),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  customerEmail: varchar('customer_email', { length: 255 }).notNull(),
  customerPhone: varchar('customer_phone', { length: 50 }),

  // Appointment timing — timestamps, not separate date/time columns
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),

  // Payment — only `requiresPayment`, `amount`, and `orderId` exist on the row.
  // Authoritative payment status is fetched on demand via provider.getOrderStatus(orderId);
  // there is no separate payment_status column.
  requiresPayment: boolean('requires_payment').default(false).notNull(),
  amount: int('amount'),                                   // smallest unit of config.currency; null if free
  orderId: varchar('order_id', { length: 255 }),           // GoDaddy draftOrderId; null until payment session created

  status: varchar('status', { length: 20 }).default('confirmed'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

**Schema notes:**
- Table name: `appointment` (singular) — matches template code.
- Uses MySQL types via `drizzle-orm/mysql-core`.
- `startTime`/`endTime` are timestamps; the booking API formats them to `date`/`time` strings on the response.
- `orderId` stores the GoDaddy Commerce **draftOrderId** returned by `createPaymentSession`. Final paid status is read on demand from the provider — the row is not updated when the customer pays.
- `requiresPayment` is a boolean column written by `POST.ts` so list/detail handlers can branch without re-reading the original request.
- `amount` is an integer in the smallest unit of `config.currency` (cents for USD/EUR/GBP, yen for JPY, fils for KWD). Use `formatMoney(amount, currency)` for display — never divide by 100 manually.

### 3.2 Running Migrations

**IMPORTANT: The database skill already handles migrations.**

After adding the appointment table to `src/server/db/schema.ts`, generate and run migrations:

```bash
# Generate migration from schema changes
npx drizzle-kit generate

# Apply migrations to database
npx drizzle-kit migrate
```

The database skill's `src/server/db/client.ts` already exports the `db` connection - no additional setup needed.

**Verify the table was created:**

```typescript
// Use database skill tool to check
database__listTables();
// Should show: { success: true, tables: ["appointment", ...] }
```
