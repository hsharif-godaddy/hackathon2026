# budget-service

Credit budget management service for AAB.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - System design, components, data flow
- [Database Schema](docs/SCHEMA.md) - Tables, columns, indexes, constraints
- [Logging](docs/LOGGING.md) - HTTP access logs, audit logs, log formats

## Development

### Prerequisites

- Go 1.25+
- PostgreSQL 15+

### Setup

1. Copy environment file:

   ```bash
   cp .env.example .env
   ```

   Optional: copy to `.env.local` for machine-specific overrides (loaded by `make dev` instead of `.env` when present).

   **`make dev`** loads `.env.local` if it exists, otherwise `.env`, then starts [Air](https://github.com/air-verse/air) (via `go run`; no global install). Files must use shell-assignable lines (`KEY=value`); comments (`# …`) are fine.

   For **`go run ./cmd/server`** without Make, export variables yourself, e.g. `set -a && . ./.env && set +a && go run ./cmd/server`, or use a tool like [direnv](https://direnv.net/).

2. Create database:

   ```bash
   createdb budget_service
   psql budget_service < migrations/001_create_budgets.sql
   ```

3. Run the service (ensure PostgreSQL is reachable per `DATABASE_URL` in `.env`):

   ```bash
   go run ./cmd/server
   ```

   Hot reload (after `.env` or `.env.local` is in place):

   ```bash
   make dev
   ```

   From the monorepo root: `make -f budget-service/Makefile dev` (working directory for Air and env files is always `budget-service/`).

### API Endpoints

| Endpoint                                         | Method | Auth         | Purpose         |
| ------------------------------------------------ | ------ | ------------ | --------------- |
| `/api/v1/health`                                 | GET    | None         | Health check    |
| `/api/v1/budgets`                                | POST   | Admin        | Create budget   |
| `/api/v1/budgets/{budgetId}`                     | PUT    | Admin        | Update budget   |
| `/api/v1/budgets/{budgetId}`                     | DELETE | Admin        | Delete budget   |
| `/api/v1/subscriptions/{subscriptionId}/budgets` | GET    | Subscription | Get budgets     |
| `/api/v1/subscriptions/{subscriptionId}/spend`   | POST   | Subscription | Spend credits   |
| `/api/v1/subscriptions/{subscriptionId}/release` | POST   | Subscription | Release credits |

## Authentication

The service supports two authentication modes configured via `AUTH_MODE`:

### Environment Variables

| Variable                    | Description                                        | Default |
| --------------------------- | -------------------------------------------------- | ------- |
| `AUTH_MODE`                 | `test` (HMAC) or `jwt` (JWKS)                      | `jwt`   |
| `AUTH_JWKS_URL`             | JWKS endpoint URL (required in jwt mode)           | -       |
| `AUTH_TEST_SIGNING_KEY`     | HMAC signing key (required in test mode)           | -       |
| `AUTH_ADMIN_ALLOWLIST`      | Comma-separated admin CNAMEs/IAM identities        | -       |
| `AUTH_ADMIN_ALLOWLIST_FILE` | Path to JSON file with additional admin identities | -       |

### Test Mode

For integration testing without external dependencies:

```bash
AUTH_MODE=test AUTH_TEST_SIGNING_KEY=your-secret-key go test ./...
```

### Admin Allowlist File Format

```json
{
  "allowed": ["admin1.example.com", "iam:service-account"]
}
```

### Auth Types

- **Subscription**: JWT with `subscriptionId` claim. Token's subscriptionId must match URL parameter.
- **Admin**: JWT with `cname` or `iam` claim. Identity must be in allowlist (env var or file).

### Testing

```bash
go test ./...
```

### Building

```bash
go build ./cmd/server
```

### Docker

```bash
docker build -t budget-service .
docker run -p 8080:8080 --env-file .env budget-service
```
