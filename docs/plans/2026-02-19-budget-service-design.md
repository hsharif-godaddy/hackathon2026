# Budget Service Design

**Date:** 2026-02-19
**Status:** Approved
**Author:** Claude + jeichorn

## Problem

AAB needs a service to manage credit budgets for AI agent operations. The service must:

- Support multiple active budgets per subscription
- Handle high volume (>1000 req/sec across many users)
- Apply per-budget conversion factors
- Spend from soonest-expiring budgets first
- Allow soft limits (overspend with alerts)

## Solution

Build a new Go service (`budget-service`) with PostgreSQL that provides:

- Simple HTTP API for budget management and spend tracking
- Direct database updates with PostgreSQL's `RETURNING` clause for atomic operations
- File-based audit logging (shippable to Kinesis)
- Mixed authentication (JWT for customer endpoints, S2S for internal)

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Admin API  │     │   Agents    │     │    App      │
│ (create/    │     │  (spend/    │     │  (display   │
│  manage)    │     │   release)  │     │   status)   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │    S2S Token      │   S2S Token       │  JWT
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────┐
│                  budget-service (Go)                │
│  ┌───────────┐  ┌───────────┐  ┌───────────────┐   │
│  │  HTTP API │  │  Spend    │  │  File Logger  │   │
│  │  (mux)    │  │  Engine   │  │  (audit log)  │   │
│  └───────────┘  └───────────┘  └───────────────┘   │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │ PostgreSQL  │
                   │  (budgets)  │
                   └─────────────┘
```

### Service Directory Structure

```
budget-service/
├── cmd/server/main.go
├── internal/
│   ├── api/           # HTTP handlers, routing
│   ├── auth/          # JWT + S2S validation
│   ├── config/        # Environment config
│   ├── budget/        # Core budget logic, repository
│   ├── spend/         # Spend engine, multi-budget allocation
│   └── logging/       # File-based audit logger
├── pkg/
│   └── models/        # Shared types
├── migrations/        # SQL migrations
└── go.mod
```

## Database Schema

PostgreSQL was chosen over MySQL for:

- `UPDATE ... RETURNING` clause (single round-trip for atomic updates)
- No gap locking on range scans (better read/write concurrency)
- Better MVCC (readers never block writers)

### Schema

```sql
CREATE TYPE budget_type AS ENUM ('interval', 'burndown');
CREATE TYPE reset_interval AS ENUM ('daily', 'monthly');

CREATE TABLE budgets (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id          VARCHAR(21) NOT NULL,
    type                     budget_type NOT NULL,
    label                    VARCHAR(255) NOT NULL,
    max_credits              BIGINT NOT NULL,
    current_value            BIGINT NOT NULL,  -- can go negative (soft limit)
    conversion_factor        DECIMAL(10,4) NOT NULL DEFAULT 1.0,

    -- For burndown: expiration. For interval: next reset date
    expiration_or_reset_date TIMESTAMPTZ NOT NULL,

    -- Interval budgets only
    reset_interval           reset_interval,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT positive_max_credits CHECK (max_credits > 0),
    CONSTRAINT valid_conversion_factor CHECK (conversion_factor > 0)
);

CREATE INDEX idx_budgets_subscription ON budgets(subscription_id);
CREATE INDEX idx_budgets_sub_expiration ON budgets(subscription_id, expiration_or_reset_date);
```

### Design Decisions

| Decision                        | Choice                         | Rationale                                     |
| ------------------------------- | ------------------------------ | --------------------------------------------- |
| Single table                    | `budgets` with `current_value` | Atomic UPDATE...RETURNING, no joins           |
| `current_value` can go negative | Soft limits                    | Allow overspend, return alerts                |
| No reservations table           | Direct update/rollback         | Same DB = no write reduction, adds complexity |
| No spend_log table              | File-based audit               | Simpler, shippable to Kinesis later           |
| No alerts table                 | Log + return in response       | Client can action on response                 |

## API Design

### Endpoints

| Endpoint                                         | Method | Auth       | Purpose         |
| ------------------------------------------------ | ------ | ---------- | --------------- |
| `/api/v1/health`                                 | GET    | None       | Health check    |
| `/api/v1/budgets`                                | POST   | S2S        | Create budget   |
| `/api/v1/budgets/{budgetId}`                     | PUT    | S2S        | Update budget   |
| `/api/v1/budgets/{budgetId}`                     | DELETE | S2S        | Delete budget   |
| `/api/v1/subscriptions/{subscriptionId}/budgets` | GET    | JWT or S2S | Get all budgets |
| `/api/v1/subscriptions/{subscriptionId}/spend`   | POST   | S2S        | Spend credits   |
| `/api/v1/subscriptions/{subscriptionId}/release` | POST   | S2S        | Release credits |

### Request/Response Types

**Create Budget:**

```json
POST /api/v1/budgets
{
  "subscriptionId": "abc123def456ghi789012",
  "type": "interval",
  "label": "Monthly AI Credits",
  "maxCredits": 10000,
  "conversionFactor": 1.0,
  "expirationOrResetDate": "2024-03-01T00:00:00Z",
  "resetInterval": "monthly"
}
```

**Get Budgets Response:**

```json
GET /api/v1/subscriptions/{subscriptionId}/budgets
{
  "subscriptionId": "abc123def456ghi789012",
  "totalMaxCredits": 12000,
  "totalCurrentValue": 8500,
  "budgets": [
    {
      "budgetId": "uuid",
      "label": "Monthly AI Credits",
      "type": "interval",
      "maxCredits": 10000,
      "currentValue": 7500,
      "conversionFactor": 1.0,
      "expirationOrResetDate": "2024-03-01T00:00:00Z",
      "resetInterval": "monthly"
    },
    {
      "budgetId": "uuid",
      "label": "Bonus Credits",
      "type": "burndown",
      "maxCredits": 2000,
      "currentValue": 1000,
      "conversionFactor": 0.9,
      "expirationOrResetDate": "2024-06-01T00:00:00Z"
    }
  ]
}
```

**Spend Credits:**

```json
POST /api/v1/subscriptions/{subscriptionId}/spend
{
  "credits": 500,
  "operationType": "chat_completion",
  "operationId": "req-12345"
}
```

**Spend Response:**

```json
{
  "success": true,
  "creditsRequested": 500,
  "creditsSpent": 450,
  "allocations": [{ "budgetId": "uuid-1", "credits": 450, "newBalance": 7050 }],
  "totalBalance": 8050,
  "overBudget": false,
  "alerts": []
}
```

**Release Credits:**

```json
POST /api/v1/subscriptions/{subscriptionId}/release
{
  "credits": 500,
  "operationType": "chat_completion",
  "operationId": "req-12345"
}
```

## Spend Engine Logic

### Multi-Budget Spend Ordering

When a subscription has multiple budgets, spend from soonest-expiring first:

1. Get all active budgets ordered by `expiration_or_reset_date ASC`
2. Lazy reset any interval budgets past their reset date
3. Allocate credits to first budget (apply conversion factor)
4. Check for alert thresholds
5. Return result with allocations and alerts

### Lazy Reset

For interval budgets, reset happens on access if past reset date:

```sql
UPDATE budgets
SET current_value = max_credits,
    expiration_or_reset_date = expiration_or_reset_date +
        CASE reset_interval
            WHEN 'daily' THEN INTERVAL '1 day'
            WHEN 'monthly' THEN INTERVAL '1 month'
        END,
    updated_at = NOW()
WHERE id = $1
```

### Conversion Factor

Applied at spend time on the budget side:

- Request: "spend 100 credits"
- Budget with factor 0.9: costs 90 credits from that budget
- Budget with factor 1.1: costs 110 credits from that budget

```sql
UPDATE budgets
SET current_value = current_value - ($1 * conversion_factor),
    updated_at = NOW()
WHERE id = $2
RETURNING current_value, (current_value < 0) as over_budget;
```

### Alert Thresholds

Alerts returned (not stored) when:

- `warning_80pct`: balance drops below 20% of max
- `warning_90pct`: balance drops below 10% of max
- `exceeded`: balance goes negative

## Configuration

### Environment Variables

```bash
# Service
PORT=8080
LOG_LEVEL=info
AUDIT_LOG_PATH=/var/log/budget-service/audit.log

# PostgreSQL
DATABASE_URL=postgres://user:pass@host:5432/budget_service?sslmode=require

# Auth
AUTH_JWKS_URL=https://sso.godaddy.com/.well-known/jwks.json
AUTH_S2S_KEYS=agents-service:secret1,admin-api:secret2

# Alert thresholds (percentage of max)
ALERT_WARNING_THRESHOLD=20
ALERT_CRITICAL_THRESHOLD=10
```

### Deployment

- **Runtime:** Nomad job (alongside other AAB services)
- **Database:** Managed PostgreSQL
- **Logging:** Audit log to local file, sidecar ships to Kinesis

### Graceful Shutdown

- Drain in-flight requests (30s timeout)
- Flush audit log buffer
- Close database connections

## Dependencies

```
github.com/gorilla/mux      # HTTP routing
github.com/lib/pq           # PostgreSQL driver
github.com/golang-jwt/jwt   # JWT validation
github.com/rs/cors          # CORS handling
```

## Key Decisions Summary

| Aspect       | Decision                                  |
| ------------ | ----------------------------------------- |
| Language     | Go (consistent with existing services)    |
| Database     | PostgreSQL (RETURNING, no gap locking)    |
| Schema       | Single `budgets` table                    |
| Auth         | Mixed: JWT for customer, S2S for internal |
| Spend model  | Direct UPDATE with RETURNING              |
| Multi-budget | Spend from soonest-expiring first         |
| Reset        | Lazy reset on access                      |
| Soft limits  | Allow overspend, return alerts            |
| Audit trail  | File-based structured log                 |

## Future Work (Out of Scope)

- Webhooks for budget alerts
- Dashboard/reporting UI
- Kinesis integration for audit logs
- Weekly/custom reset intervals
