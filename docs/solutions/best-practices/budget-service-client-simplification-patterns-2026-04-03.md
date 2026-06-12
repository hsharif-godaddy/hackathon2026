---
title: Budget Service Client Simplification Patterns
date: 2026-04-03
last_updated: 2026-04-09
category: best-practices
module: packages/ai-lib/budget
problem_type: best_practice
component: service_object
severity: medium
applies_when:
  - building HTTP service clients consumed by agents
  - wrapping internal Go microservices with TypeScript clients
  - handling auth for service-to-service calls in one-agent-per-app architecture
  - deciding between defensive complexity and simpler alternatives
tags:
  - budget-service-client
  - s2s-auth
  - zod-validation
  - http-client
  - retry-strategy
  - type-organization
  - circuit-breaker-removal
  - simplification
related_components:
  - authentication
  - testing_framework
---

# Budget Service Client Simplification Patterns

## Context

During PR #2455 review of `BudgetServiceClient` (`packages/ai-lib/src/budget/budget-service-client.ts`), the tech lead identified five areas where the client used more complexity than the architecture warranted. The refactoring removed 318 net lines across 10 files while improving reliability of the critical reconciliation path.

These patterns apply to any internal service client in this monorepo's one-agent-per-app deployment model. (auto memory [claude]: BMS is the in-repo Go service at `budget-service/`; API path differences between Go service and TS client may indicate the Go API is evolving.)

## Guidance

### 1. Use IAM S2S auth, not shared secrets

Internal service calls use `getS2SToken()` from `gd-auth-client`. Do not introduce HMAC/shared-secret auth with `jsonwebtoken`.

Accept an optional `getToken` function in config for testability:

```typescript
interface ServiceClientConfig {
  baseUrl: string
  getToken?: () => Promise<string>
}

class ServiceClient {
  private getToken: () => Promise<string>

  constructor(config: ServiceClientConfig) {
    this.getToken = config.getToken ?? (() => getS2SToken())
  }

  private async request(path: string) {
    const token = await this.getToken()
    // Authorization: `Bearer ${token}`
  }
}
```

This codebase already uses `getS2SToken` for Logo API, Image API, Video API, Knowledge Service, and 3+ other integrations. The `getToken` injection enables test doubles without module mocking.

### 2. Validate responses with zod, not hand-rolled asserts

Zod is already a dependency (`^4.3.6`). Use schemas with `.passthrough()` (tolerates extra fields from evolving APIs) and a single helper that maps `ZodError` to the client's error type:

```typescript
import { z } from 'zod'

const BudgetResponseSchema = z.object({
  budgetId: z.string(),
  creditsTotal: z.string(),
  items: z.array(z.object({
    budgetItemId: z.string(),
    creditsTotal: z.string(),
    creditsUsed: z.string(),
  }).passthrough()),
}).passthrough() as z.ZodType<BudgetResponse>

function validateResponse<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  throw new BudgetServiceError(
    `Budget Service returned invalid ${label}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    200, JSON.stringify(data)
  )
}
```

~30 lines of schemas replaced ~140 lines of manual `typeof` checks. Same `BudgetServiceError` type preserved for backward compat.

### 3. Skip circuit breakers for single-tenant-per-process services

In this deployment (one agent process per app, one user per agent), circuit breaker state is not shared across users. Each user independently discovers outages. The 3s timeout already provides fast failure.

The circuit breaker only saved one user a few extra timeouts after ~9s of failures (3 failures x 3s timeout). Not worth ~50 lines of state management.

Instead, invest in retries for critical paths:

```typescript
async createReport(sessionId: string, request: CreateReportRequest): Promise<ReportResponse> {
  const doReport = () => this.requestAndValidate('POST', path, ReportResponseSchema, 'ReportResponse', request, this.reportTimeoutMs)
  let lastErr: unknown
  for (let attempt = 0; attempt <= this.reportMaxRetries; attempt++) {
    try {
      return await doReport()
    } catch (err) {
      // 409 = report already exists; don't retry, let caller handle as success
      if (err instanceof BudgetServiceConflictError) throw err
      lastErr = err
      const isTransient = err instanceof BudgetServiceTimeoutError || err instanceof BudgetServiceUnavailableError
      if (!isTransient || attempt === this.reportMaxRetries) throw err
      await new Promise(r => setTimeout(r, 50 + Math.random() * (100 << (attempt + 1))))
    }
  }
  throw lastErr
}
```

Backoff is `50 + Math.random() * (100 << (attempt + 1))`, giving jittered delays bounded by ~200ms, ~400ms, ~800ms. Jitter prevents thundering herd. Reconciliation failure = unreconciled cost, so 3 retries is warranted. A 409 `BudgetServiceConflictError` (report already exists) short-circuits the retry loop; the caller treats it as success.

### 4. Surface only finalized data to consumers

When a backend tracks both pending and finalized state, only surface finalized values:

```typescript
// Before: pending subtracted from remaining
function computeRemaining(total: string, used: string, pending: string): number {
  return parseFloat(total) - parseFloat(used) - parseFloat(pending)
}

// After: only finalized creditsUsed affects displayed remaining
function computeRemaining(total: string, used: string): number {
  const result = parseFloat(total) - parseFloat(used)
  return Math.round(result * 1e6) / 1e6
}
```

Pending amounts are internal BMS state not yet confirmed. Showing them creates confusing UX where credits appear consumed before costs are finalized.

**Note (2026-04-09):** The frontend now receives `budget_update` WebSocket events containing finalized `customerRemaining`. These trigger an optimistic React Query cache patch of aggregate `creditsUsedNumeric`, but deliberately do not patch per-item breakdown (which would require replicating BMS's soonest-expiring-first allocation logic client-side). See [budget-frontend-state-zero-credits-and-optimistic-scope](budget-frontend-state-zero-credits-and-optimistic-scope-2026-04-09.md).

### 5. Scope types to their consumers

Types belong in the package that consumes them, not in `@airo/shared` by default.

```
packages/shared/src/budget/types.ts        -- BudgetItem, SessionResponse, WS events (frontend needs these)
packages/ai-lib/src/budget/report-types.ts -- CreateReportRequest, ReportResponse, deductions (agent-only)
```

Ask: "Does the frontend ever import this type?" If no, it belongs in the backend package. Report creation/reconciliation is an agent-side concern; the frontend only sees budget summaries and WebSocket event payloads.

## Why This Matters

- **Auth**: Shared secrets don't rotate, can't be audited, create operational coupling. IAM S2S is zero-config in deployed environments.
- **Validation**: Hand-rolled validation is the #1 source of subtle bugs (missing field checks, wrong types, no passthrough). Zod eliminates the class.
- **Resilience**: Unnecessary circuit breakers add state, config, and testing burden with no user-visible benefit in single-tenant architectures. Retries on the critical reconciliation path prevent data inconsistency.
- **Data model**: Surfacing intermediate/pending state causes support tickets when users see incorrect balances.
- **Type scoping**: Leaking backend types into shared packages creates false coupling. Frontend changes shouldn't require understanding reconciliation internals.

## When to Apply

- Building any HTTP client for an internal service in this monorepo
- The service runs in single-tenant deployment (one agent per app)
- The service is behind IAM
- Response shapes may evolve (API under active development)
- The client bridges backend data to a frontend consumer

May not apply to:
- External third-party API clients (auth differs)
- Shared multi-tenant services (circuit breakers may help there)
- Stable, versioned APIs where `.passthrough()` is unnecessary

## Examples

See the reference implementation at `packages/ai-lib/src/budget/budget-service-client.ts` and its test suite at `packages/ai-lib/src/budget/__tests__/budget-service-client.test.ts`.

Key changes from PR #2455:
- `jsonwebtoken` + `@types/jsonwebtoken` removed from `packages/ai-lib/package.json`
- `BUDGET_SERVICE_SIGNING_KEY` env var removed from `agents/.env.example`
- 6 report types moved from `@airo/shared/budget` to `@airo/ai-lib/budget/report-types.ts`
- Circuit breaker tests (~120 lines) replaced with retry tests (~40 lines)

## Related

- [Defensive HTTP Client Design Patterns](defensive-http-client-design-2026-03-31.md) -- original 16 patterns; patterns 3, 5, 9, 12-14 are now outdated by this simplification
- [AI Code Bloat Simplification Pass](ai-code-bloat-simplification-pass-2026-04-02.md) -- prior simplification pass on the same feature branch
- PR #2455: `feat: budget service client + feature flag`
