# Database Schema

The budget-service uses PostgreSQL with a single `budgets` table and two custom enum types.

## Entity Relationship

```
┌─────────────────────────────────────────────────────────────────────┐
│                              budgets                                 │
├─────────────────────────────────────────────────────────────────────┤
│ id                       UUID PRIMARY KEY (auto-generated)          │
│ subscription_id          VARCHAR(21) NOT NULL                       │
│ type                     budget_type NOT NULL                       │
│ label                    VARCHAR(255) NOT NULL                      │
│ max_credits              NUMERIC(20,6) NOT NULL (> 0)               │
│ current_value            NUMERIC(20,6) NOT NULL                     │
│ conversion_factor        DECIMAL(10,4) NOT NULL DEFAULT 1.0 (> 0)   │
│ expiration_or_reset_date TIMESTAMPTZ NOT NULL                       │
│ reset_interval           reset_interval (nullable)                  │
│ created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()         │
│ updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()         │
├─────────────────────────────────────────────────────────────────────┤
│ INDEXES:                                                            │
│   idx_budgets_subscription (subscription_id)                        │
│   idx_budgets_sub_expiration (subscription_id, expiration_or_reset) │
└─────────────────────────────────────────────────────────────────────┘
```

## Enum Types

### budget_type

| Value      | Description                                    |
| ---------- | ---------------------------------------------- |
| `interval` | Budget resets periodically (daily/monthly)     |
| `burndown` | One-time budget that depletes until expiration |

### reset_interval

| Value     | Description                                 |
| --------- | ------------------------------------------- |
| `daily`   | Budget resets every day at the reset date   |
| `monthly` | Budget resets every month at the reset date |

## Column Details

### id

- **Type**: UUID
- **Default**: `gen_random_uuid()`
- **Purpose**: Unique identifier for each budget

### subscription_id

- **Type**: VARCHAR(21)
- **Purpose**: Links budget to a subscription in the main application
- **Indexed**: Yes (for fast lookups)

### type

- **Type**: `budget_type` enum
- **Purpose**: Determines budget behavior (resetting vs one-time)

### label

- **Type**: VARCHAR(255)
- **Purpose**: Human-readable name for the budget (e.g., "Monthly AI Credits", "Bonus Credits")

### max_credits

- **Type**: NUMERIC(20,6)
- **Constraint**: Must be > 0
- **Purpose**: Maximum credit capacity of the budget
- **Precision**: Supports up to 14 whole digits and 6 decimal places (e.g., `12345678901234.567890`)

### current_value

- **Type**: NUMERIC(20,6)
- **Purpose**: Current available credits
- **Note**: Can go negative when soft limits are exceeded (OverBudget flag set)
- **Precision**: Same as max_credits - 6 decimal places

### conversion_factor

- **Type**: DECIMAL(10,4)
- **Default**: 1.0
- **Constraint**: Must be > 0
- **Purpose**: Multiplier applied to credit requests (e.g., 0.9 means 90 credits cost 100 from budget)

### expiration_or_reset_date

- **Type**: TIMESTAMPTZ
- **Purpose**:
  - For `burndown`: Date when budget expires and becomes unusable
  - For `interval`: Next reset date (updated after each reset)

### reset_interval

- **Type**: `reset_interval` enum (nullable)
- **Purpose**: Reset frequency for interval budgets
- **Note**: Required for `interval` type, NULL for `burndown` type

### created_at / updated_at

- **Type**: TIMESTAMPTZ
- **Default**: NOW()
- **Purpose**: Audit timestamps

## Indexes

### idx_budgets_subscription

```sql
CREATE INDEX idx_budgets_subscription ON budgets(subscription_id);
```

Optimizes lookups by subscription ID (used by all spend/release operations).

### idx_budgets_sub_expiration

```sql
CREATE INDEX idx_budgets_sub_expiration ON budgets(subscription_id, expiration_or_reset_date);
```

Optimizes queries that need budgets ordered by expiration date (soonest-expiring-first allocation).

## Constraints

| Constraint                | Column            | Rule              |
| ------------------------- | ----------------- | ----------------- |
| `positive_max_credits`    | max_credits       | Value must be > 0 |
| `valid_conversion_factor` | conversion_factor | Value must be > 0 |

## Migrations

The schema is managed through incremental migrations:

| Migration                   | Description                                    |
| --------------------------- | ---------------------------------------------- |
| `001_create_budgets.sql`    | Initial schema with BIGINT credits             |
| `002_precision_credits.sql` | Convert credits to NUMERIC(20,6) for precision |

Apply migrations in order:

```bash
psql budget_service < migrations/001_create_budgets.sql
psql budget_service < migrations/002_precision_credits.sql
```

## Precision Credits

Credit values (`max_credits`, `current_value`) use `NUMERIC(20,6)` to support:

- **6 decimal places** for precise fractional credits
- **All arithmetic in PostgreSQL** to avoid floating-point errors
- **String serialization** in Go to preserve precision

When querying, use casts for proper handling:

```sql
-- Get precise value as string
SELECT max_credits::TEXT, current_value::TEXT FROM budgets;

-- Get rounded integer for display
SELECT ROUND(max_credits)::BIGINT, ROUND(current_value)::BIGINT FROM budgets;
```

## Query Patterns

### Get all budgets for a subscription (ordered by expiration)

```sql
SELECT
    id, subscription_id, type, label,
    max_credits::TEXT, current_value::TEXT,
    ROUND(max_credits)::BIGINT AS max_credits_rounded,
    ROUND(current_value)::BIGINT AS current_value_rounded,
    conversion_factor::TEXT,
    expiration_or_reset_date, reset_interval, created_at, updated_at
FROM budgets
WHERE subscription_id = $1
ORDER BY expiration_or_reset_date ASC;
```

### Atomic spend operation

```sql
UPDATE budgets
SET current_value = current_value - ($1::NUMERIC * conversion_factor),
    updated_at = NOW()
WHERE id = $2
RETURNING current_value::TEXT, ROUND(current_value)::BIGINT;
```

### Atomic release operation

```sql
UPDATE budgets
SET current_value = current_value + ($1::NUMERIC * conversion_factor),
    updated_at = NOW()
WHERE id = $2
RETURNING current_value::TEXT, ROUND(current_value)::BIGINT;
```

### Lazy reset for interval budgets

```sql
UPDATE budgets
SET current_value = max_credits,
    expiration_or_reset_date = expiration_or_reset_date +
      CASE reset_interval
        WHEN 'daily' THEN INTERVAL '1 day'
        WHEN 'monthly' THEN INTERVAL '1 month'
      END,
    updated_at = NOW()
WHERE id = $1;
```
