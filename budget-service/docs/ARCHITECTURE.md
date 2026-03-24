# Architecture

The budget-service is a standalone Go microservice that manages credit budgets for AI agent operations.

## System Context

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AAB Frontend  │────▶│   AAB Backend   │────▶│ budget-service  │
│   (Next.js)     │     │   (Node.js)     │     │     (Go)        │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                        ┌─────────────────┐              │
                        │   AI Agents     │──────────────┤
                        │   (Node.js)     │              │
                        └─────────────────┘              │
                                                         ▼
                                                ┌─────────────────┐
                                                │   PostgreSQL    │
                                                └─────────────────┘
```

## Internal Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                           budget-service                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐  │
│  │   HTTP      │───▶│   API       │───▶│    Spend Engine         │  │
│  │   Server    │    │   Handlers  │    │  (Business Logic)       │  │
│  │  (Gorilla)  │    │             │    └───────────┬─────────────┘  │
│  └─────────────┘    └─────────────┘                │                 │
│                                                     │                 │
│                     ┌─────────────┐                │                 │
│                     │   Audit     │◀───────────────┤                 │
│                     │   Logger    │                │                 │
│                     └──────┬──────┘                │                 │
│                            │                       │                 │
│                            ▼                       ▼                 │
│                     ┌─────────────┐    ┌─────────────────────────┐  │
│                     │  Audit Log  │    │    Budget Repository    │  │
│                     │   (File)    │    │      (PostgreSQL)       │  │
│                     └─────────────┘    └─────────────────────────┘  │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Package Structure

```
budget-service/
├── cmd/server/           # Application entry point
│   └── main.go           # Main function, server startup
├── internal/             # Private application code
│   ├── api/              # HTTP layer
│   │   ├── server.go     # Server setup, routes, middleware
│   │   └── handlers.go   # Request handlers
│   ├── budget/           # Data access layer
│   │   └── repository.go # PostgreSQL operations
│   ├── spend/            # Business logic layer
│   │   └── engine.go     # Multi-budget allocation, alerts
│   ├── logging/          # Audit logging
│   │   └── audit.go      # File-based audit logger
│   ├── config/           # Configuration
│   │   └── config.go     # Environment variable loading
│   └── integration/      # Integration tests
├── pkg/models/           # Public types (shared with clients)
│   ├── budget.go         # Domain models
│   └── api.go            # Request/response types
├── migrations/           # Database migrations
│   └── 001_create_budgets.sql
└── docs/                 # Documentation
    ├── ARCHITECTURE.md   # This file
    └── SCHEMA.md         # Database schema
```

## Key Components

### HTTP Server (`internal/api/server.go`)

- Uses Gorilla Mux for routing
- Graceful shutdown with configurable timeout
- Health check endpoint for container orchestration

### API Handlers (`internal/api/handlers.go`)

- Request validation
- JSON serialization/deserialization
- Audit log integration
- Error response formatting

### Spend Engine (`internal/spend/engine.go`)

Core business logic for credit operations:

1. **Multi-Budget Allocation**: Spends from soonest-expiring budget first
2. **Lazy Reset**: Interval budgets auto-reset when accessed past their reset date
3. **Conversion Factor**: Applies budget-specific multiplier to credit amounts
4. **Alert Generation**: Warns at 80% and 90% usage thresholds
5. **Soft Limits**: Allows overspending with `OverBudget` flag

### Budget Repository (`internal/budget/repository.go`)

PostgreSQL operations with atomic updates:

- Uses `UPDATE ... RETURNING` for atomic balance changes
- Handles concurrent access safely at database level
- Supports partial updates for budget modifications

### Audit Logger (`internal/logging/audit.go`)

- JSON-formatted audit entries
- File-based storage with sync for durability
- Thread-safe with mutex protection

## Data Flow

### Spend Operation

```
1. Client sends POST /api/v1/subscriptions/{id}/spend
   └─▶ { credits: 100, operationType: "ai-generation" }

2. Handler validates request
   └─▶ Credits must be non-negative

3. Spend Engine processes request
   ├─▶ Get all budgets for subscription (ordered by expiration)
   ├─▶ Check if any interval budgets need reset (lazy reset)
   ├─▶ Select first budget (soonest expiring)
   ├─▶ Apply conversion factor: 100 * 0.9 = 90 actual credits
   └─▶ Decrement balance atomically in database

4. Spend Engine checks alerts
   └─▶ If remaining < 20% of max: generate warning_80pct_used
   └─▶ If remaining < 10% of max: generate critical_90pct_used
   └─▶ If remaining < 0: generate exceeded

5. Audit Logger records transaction
   └─▶ { event: "credits.spent", credits: 90, newBalance: 910, ... }

6. Handler returns response
   └─▶ { success: true, creditsSpent: 90, overBudget: false, ... }
```

### Budget Priority (Soonest-Expiring-First)

```
Subscription has 3 budgets:
├─▶ Budget A: expires 2024-03-01, balance: 500
├─▶ Budget B: expires 2024-06-01, balance: 1000
└─▶ Budget C: expires 2024-12-01, balance: 2000

Spend request: 600 credits

Result:
├─▶ Budget A depleted: 500 → 0 (used 500)
├─▶ Budget B reduced: 1000 → 900 (used 100)
└─▶ Budget C unchanged: 2000

Note: Current implementation spends from single budget per request.
Multi-budget spanning is a potential future enhancement.
```

## Configuration

Environment variables (loaded via `internal/config/config.go`):

| Variable           | Default                               | Description                    |
|--------------------|---------------------------------------|--------------------------------|
| `PORT`             | `8080`                                | HTTP server port               |
| `DATABASE_URL`     | (required)                            | PostgreSQL connection string   |
| `AUDIT_LOG_PATH`   | `/var/log/budget-service/audit.log`   | Audit log file path            |
| `LOG_LEVEL`        | `info`                                | Logging level (debug/info)     |
| `WARNING_THRESHOLD`| `20`                                  | Alert at N% remaining          |
| `CRITICAL_THRESHOLD`| `10`                                 | Critical alert at N% remaining |

## Performance Considerations

### Database Connection Pool
```go
db.SetMaxOpenConns(25)    // Parallel query capacity
db.SetMaxIdleConns(5)     // Warm connection pool
db.SetConnMaxLifetime(5 * time.Minute)  // Prevent stale connections
```

### Atomic Operations

All balance changes use PostgreSQL's `UPDATE ... RETURNING` for atomicity:
```sql
UPDATE budgets
SET current_value = current_value - $1
WHERE id = $2
RETURNING current_value;
```

This ensures concurrent requests don't create race conditions.

### Indexes

Two indexes optimize the critical query pattern:
- `idx_budgets_subscription`: Fast subscription lookup
- `idx_budgets_sub_expiration`: Efficient ordering by expiration

## Security

### Authentication (Planned)
- JWT validation for customer-facing endpoints
- S2S (Service-to-Service) tokens for internal services

### Authorization
- Budgets are scoped to subscription IDs
- No cross-subscription access is possible

### Audit Trail
- All credit operations are logged with:
  - Timestamp
  - Operation type and ID
  - Credits involved
  - Balance before/after
  - Subscription and budget IDs

## Future Enhancements

1. **Authentication Middleware**: JWT and S2S token validation
2. **Rate Limiting**: Protect against abuse
3. **Multi-Budget Spanning**: Single spend across multiple budgets
4. **Idempotency**: Deduplicate retried operations via operation ID
5. **Metrics**: Prometheus integration for monitoring
