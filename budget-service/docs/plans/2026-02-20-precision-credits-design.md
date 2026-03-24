# Precision Credits Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update budget service to store credits with 6 decimal places precision, perform all math in PostgreSQL, and return rounded whole numbers in API responses.

**Architecture:** Use PostgreSQL NUMERIC type for precise decimal storage, string types in Go to avoid float64 precision loss, and PostgreSQL ROUND() for API output values.

**Tech Stack:** Go, PostgreSQL NUMERIC(20,6), database/sql with string scanning

---

## Requirements

1. **Storage precision**: 6 decimal places for credit values
2. **All math in PostgreSQL**: No arithmetic in Go code
3. **Rounded output**: API returns whole numbers (0 decimal places) rounded by PostgreSQL
4. **Decimal input**: Accept decimal amounts in spend/release requests

## Schema Changes

```sql
-- Migration: 002_precision_credits.sql
ALTER TABLE budgets
  ALTER COLUMN max_credits TYPE NUMERIC(20,6),
  ALTER COLUMN current_value TYPE NUMERIC(20,6);

ALTER TABLE budgets DROP CONSTRAINT positive_max_credits;
ALTER TABLE budgets ADD CONSTRAINT positive_max_credits CHECK (max_credits > 0);
```

- `NUMERIC(20,6)` = 14 whole digits + 6 decimal places
- Existing BIGINT values convert cleanly (e.g., `1000` → `1000.000000`)
- Conversion factor stays `DECIMAL(10,4)`

## Go Model Changes

```go
// pkg/models/budget.go
type Budget struct {
    ID                    uuid.UUID      `json:"budgetId"`
    SubscriptionID        string         `json:"subscriptionId"`
    Type                  BudgetType     `json:"type"`
    Label                 string         `json:"label"`

    // Precise values (string to preserve NUMERIC precision)
    MaxCredits            string         `json:"maxCredits"`
    CurrentValue          string         `json:"currentValue"`

    // Rounded values (PostgreSQL ROUND() result)
    MaxCreditsRounded     int64          `json:"maxCreditsRounded"`
    CurrentValueRounded   int64          `json:"currentValueRounded"`

    ConversionFactor      string         `json:"conversionFactor"`
    ExpirationOrResetDate time.Time      `json:"expirationOrResetDate"`
    ResetInterval         *ResetInterval `json:"resetInterval,omitempty"`
    CreatedAt             time.Time      `json:"createdAt"`
    UpdatedAt             time.Time      `json:"updatedAt"`
}

type CreateBudgetRequest struct {
    SubscriptionID        string        `json:"subscriptionId"`
    Type                  BudgetType    `json:"type"`
    Label                 string        `json:"label"`
    MaxCredits            string        `json:"maxCredits"`       // Decimal string
    ConversionFactor      string        `json:"conversionFactor"` // Decimal string
    ExpirationOrResetDate time.Time     `json:"expirationOrResetDate"`
    ResetInterval         ResetInterval `json:"resetInterval,omitempty"`
}

type SpendRequest struct {
    BudgetID *uuid.UUID `json:"budgetId,omitempty"`
    Amount   string     `json:"amount"` // Decimal string, e.g., "50.123456"
}

type ReleaseRequest struct {
    BudgetID uuid.UUID `json:"budgetId"`
    Amount   string    `json:"amount"` // Decimal string
}
```

## Repository Changes

### Query Columns

```go
var budgetColumns = []string{
    "id", "subscription_id", "type", "label",
    "max_credits::TEXT", "current_value::TEXT",
    "ROUND(max_credits)::BIGINT AS max_credits_rounded",
    "ROUND(current_value)::BIGINT AS current_value_rounded",
    "conversion_factor::TEXT", "expiration_or_reset_date",
    "reset_interval", "created_at", "updated_at",
}
```

### DecrementBalance

```go
func (r *PostgresRepository) DecrementBalance(ctx context.Context, id uuid.UUID, amount string) (precise string, rounded int64, err error) {
    query := `UPDATE budgets
        SET current_value = current_value - ($1::NUMERIC * conversion_factor),
            updated_at = NOW()
        WHERE id = $2
        RETURNING current_value::TEXT, ROUND(current_value)::BIGINT`

    err = r.db.QueryRowContext(ctx, query, amount, id).Scan(&precise, &rounded)
    return
}
```

### IncrementBalance

```go
func (r *PostgresRepository) IncrementBalance(ctx context.Context, id uuid.UUID, amount string) (precise string, rounded int64, err error) {
    query := `UPDATE budgets
        SET current_value = current_value + ($1::NUMERIC * conversion_factor),
            updated_at = NOW()
        WHERE id = $2
        RETURNING current_value::TEXT, ROUND(current_value)::BIGINT`

    err = r.db.QueryRowContext(ctx, query, amount, id).Scan(&precise, &rounded)
    return
}
```

### Create

```go
// Insert with decimal string, PostgreSQL handles NUMERIC conversion
query := `INSERT INTO budgets (..., max_credits, current_value, conversion_factor, ...)
    VALUES (..., $1::NUMERIC, $1::NUMERIC, $2::NUMERIC, ...)
    RETURNING ...`
```

## API Response Format

```json
{
  "budgetId": "550e8400-e29b-41d4-a716-446655440000",
  "subscriptionId": "sub-123",
  "type": "burndown",
  "label": "AI Credits",
  "maxCredits": "1000.500000",
  "currentValue": "847.123456",
  "maxCreditsRounded": 1001,
  "currentValueRounded": 847,
  "conversionFactor": "1.0000",
  "expirationOrResetDate": "2026-12-31T00:00:00Z"
}
```

- Precise string values for auditing/debugging
- Rounded int64 values for client display
- PostgreSQL `ROUND()` uses "round half away from zero"

## Key Constraints

1. **Go never performs credit arithmetic** - all math in PostgreSQL
2. **String types in Go** - avoids float64 precision loss during JSON marshal/unmarshal
3. **Cast to NUMERIC in SQL** - input amounts cast with `$1::NUMERIC`
4. **ROUND in PostgreSQL** - all rounding done server-side, cast to BIGINT for Go

## File Changes Summary

| File                                   | Change                                      |
| -------------------------------------- | ------------------------------------------- |
| `migrations/002_precision_credits.sql` | New migration                               |
| `pkg/models/budget.go`                 | int64 → string, add rounded fields          |
| `pkg/models/requests.go`               | int64/float64 → string for amounts          |
| `internal/budget/repository.go`        | Update queries with ::TEXT, ::NUMERIC casts |
| `internal/spend/engine.go`             | Update to use string amounts                |
| `internal/api/handlers.go`             | Update request/response handling            |
