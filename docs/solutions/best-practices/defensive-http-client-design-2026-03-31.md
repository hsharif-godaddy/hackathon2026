---
title: Defensive HTTP Client Design Patterns for Budget Service
date: 2026-03-31
last_updated: 2026-04-03
revision_note: "PR #2455 review: HMAC->IAM auth, circuit breaker removed (single-user model), hand-rolled validation->zod, retries 1->3 with exponential backoff, assignment removed from WS payload, pending no longer subtracted from display"
category: best-practices
module: Budget Service HTTP Client
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - building HTTP clients for internal or external microservices
  - consuming APIs where schema drift is possible
  - agent/billing/financial systems where reliability matters
  - single-instance-per-user deployment models (one agent per app)
  - failure modes directly impact end-user experience
tags:
  - http-client
  - error-handling
  - type-safety
  - response-validation
  - fetch-injection
  - retry-logic
  - defensive-design
  - zod
  - iam-auth
  - budget-service
---

# Defensive HTTP Client Design Patterns for Budget Service

## Context

Building a typed HTTP client for Budget Service, an in-repo Go microservice (`budget-service/`) that manages billing and credit budgets. The client runs inside AI agents during prompt execution in a **single-instance-per-user deployment model** (one agent per app, deployed as a Nomad job). Reliability is critical because budget check failures directly block user requests. The service uses IAM S2S JWT authentication (via JWKS validation) and returns monetary amounts with high precision.

Through iterative code review audits and PR review feedback (PR #2455, reviewer: mlefebvre1-godaddy), defensive patterns were identified, applied, and refined. Key insight from review: **match client resilience to deployment topology** -- patterns designed for shared/multi-tenant services (circuit breakers, speculative state) add cost without benefit in a single-user context.

Reference implementation: `packages/ai-lib/src/budget/`

## Guidance

### 1. Readonly Response Types

All API responses use `readonly` at every nesting level, including arrays.

```typescript
export interface BudgetResponse {
  readonly budgetId: string
  readonly creditsTotal: string
  readonly creditsUsed: string
  readonly items: readonly BudgetItem[]
}
```

**Without this:** A consumer accidentally mutates a cached response object. The mutation propagates to other subscribers, causing stale state and data corruption that's hard to trace.

### 2. Discriminated Unions for State-Dependent Payloads

When a payload has two distinct shapes based on a flag, model as a union:

```typescript
type BudgetUpdatePayload = BudgetUpdateSuccess | BudgetUpdateRefreshRequired

interface BudgetUpdateSuccess {
  readonly refreshRequired: false
  readonly customerRemaining: number
  readonly budgets: readonly BudgetSummary[]
}

interface BudgetUpdateRefreshRequired {
  readonly refreshRequired: true
  // no other fields -- prevents reading stale data
}
```

Note: an earlier version included `assignment: ReconcileAssignment` in the success type. Removed during PR review -- frontend only needs resulting state (remaining balances), not per-report deduction breakdown. Shipping unused data creates phantom coupling.

**Without this:** Consumers write scattered null checks. Nothing prevents reading `customerRemaining` when `refreshRequired` is true (the data is meaningless in that state).

### 3. Runtime Shape Validation with Zod at System Boundary

Validate response shapes after JSON.parse, before returning to callers. Use zod schemas when the library is already a project dependency:

```typescript
import { z } from 'zod'

const BudgetItemSchema = z.object({
  budgetItemId: z.string(),
  creditsTotal: z.string(),
  creditsUsed: z.string(),
  creditsPending: z.string(),
  expireAt: z.string(),
}).passthrough()

const BudgetResponseSchema = z.object({
  budgetId: z.string(),
  creditsTotal: z.string(),
  creditsUsed: z.string(),
  creditsPending: z.string(),
  items: z.array(BudgetItemSchema),
}).passthrough()

function validateResponse<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const fields = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')
    throw new BudgetServiceError(`invalid ${label}: ${fields}`, 200, JSON.stringify(data))
  }
  return result.data
}
```

An earlier version used ~140 lines of hand-rolled `assertXxxShape` functions with manual `typeof` checks. Replaced with ~50 lines of zod schemas during PR review. Benefits: less code, per-field error paths, composable schemas, harder to miss a required field check.

Use `.passthrough()` (or `z.looseObject()` in zod 4) to avoid stripping unknown fields from API responses -- forward-compatible with new fields the server may add.

**Without this:** `JSON.parse` succeeds on `{"foo":"bar"}` and casts it as `BudgetResponse`. `result.creditsTotal` is `undefined`, propagating silently into calculations.

### 4. Typed Error Hierarchy

Four error classes model distinct failure modes:

```typescript
class BudgetServiceError extends Error {          // base: HTTP errors
  readonly statusCode: number
  readonly responseBody: string
}
class BudgetServiceAuthError extends ...  {}      // 401/403
class BudgetServiceTimeoutError extends ... {}    // request timeout (statusCode=0)
class BudgetServiceUnavailableError extends ... {} // network failure (statusCode=0)
```

**Without this:** All errors look the same. Retry logic guesses which are transient. Auth errors get retried (wasteful). Schema errors get retried (futile).

### 5. ~~Circuit Breaker~~ Removed: Timeouts Suffice in Single-User Model

**Removed during PR #2455 review.** In a single-instance-per-user deployment (one agent per app), circuit breakers add ~50 lines of state machine complexity for near-zero benefit.

The reviewer's analysis: "The 3s timeout already provides fast failure. The circuit breaker only saves one user from a few more timeouts after they've already waited 9s (3 x 3s). For a single-user context, this added complexity may not be worth it."

**Current approach:** `AbortSignal.timeout(3000)` on each request bounds worst-case latency. No circuit breaker state.

**When circuit breakers ARE justified:** Multi-tenant services with connection pools serving many concurrent users, where one failing dependency can exhaust shared resources and cascade failures across all users.

### 6. Injectable Fetch

Accept optional `fetch` in config, default to global:

```typescript
interface BudgetServiceClientConfig {
  fetch?: typeof globalThis.fetch
}
// Constructor:
this.fetch = config.fetch ?? globalThis.fetch
```

**Without this:** Tests mutate `globalThis.fetch`, leaking mocks between test cases. No way for consumers to add tracing, proxy support, or mTLS.

### 7. Separated Response Parsing from Validation

`parseResponse()` handles HTTP error status, empty body, and JSON parse failures. `requestAndValidate()` handles zod schema validation:

```typescript
private async parseResponse(response: Response, method: string, path: string): Promise<unknown> {
  const rawText = await response.text().catch(...)
  if (!response.ok) throw new BudgetServiceError(...)
  if (!rawText) throw new BudgetServiceError(...)
  return JSON.parse(rawText)
}

private async requestAndValidate<T>(
  ..., validate: (data: unknown) => T
): Promise<T> {
  const data = await this.request(...)
  return validate(data) // zod safeParse + BudgetServiceError wrapper
}
```

**Without this:** Mixed responsibilities make it hard to reason about which layer handles which failure mode.

### 8. Aggressive Retries with Exponential Backoff for Critical-Path Operations

For billing-critical operations (cost reconciliation), use multiple retries with exponential backoff. Match retry aggressiveness to business impact:

```typescript
async createReport(sessionId: string, request: CreateReportRequest): Promise<ReportResponse> {
  const doReport = () => this.requestAndValidate(...)
  let lastErr: unknown
  for (let attempt = 0; attempt <= this.reportMaxRetries; attempt++) {
    try {
      return await doReport()
    } catch (err) {
      // 409 = report already exists; short-circuit, caller treats as success
      if (err instanceof BudgetServiceConflictError) throw err
      lastErr = err
      const isTransient = err instanceof BudgetServiceTimeoutError || err instanceof BudgetServiceUnavailableError
      if (!isTransient || attempt === this.reportMaxRetries) throw err
      await new Promise((r) => setTimeout(r, 50 + Math.random() * (100 << (attempt + 1))))
    }
  }
  throw lastErr
}
```

Key design choices:
- **3 retries** (configurable via `reportMaxRetries`), not 1. A single retry is too fragile for billing reconciliation where failure means unreconciled costs
- **Exponential backoff** with jitter: `50 + random * (100 << (attempt + 1))`, bounded by ~200ms, ~400ms, ~800ms
- **409 short-circuits the loop**: a `BudgetServiceConflictError` (report already exists) is not retried; the caller treats it as success (idempotent re-file)
- **Only transient errors** trigger retries: timeout and network unreachable. Auth, 4xx, and schema errors fail immediately
- Non-critical reads (`getBudget`) have no retries; the 3s timeout is sufficient

**Without this:** One retry with a fixed 100ms delay fails on anything beyond a momentary blip. Unreconciled costs require manual recovery.

### 9. Constructor Validation

Validate config at construction, not at first use:

```typescript
const parsed = new URL(url)
if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) {
  throw new Error('BUDGET_SERVICE_URL must use HTTPS. Only http://localhost allowed for local dev.')
}
```

Note: an earlier version also validated `BUDGET_SERVICE_SIGNING_KEY` for HMAC auth. After switching to IAM S2S JWT (`getS2SToken`), there is no shared signing key to validate. Auth tokens are obtained from AWS IAM credentials at request time.

**Without this:** Invalid URL format produces cryptic fetch errors at runtime. Construction-time validation surfaces config issues immediately on startup.

### 10. Cross-Field Validation

Validate semantic constraints between fields before sending:

```typescript
if (params.godaddyCategory != null && params.godaddyCost == null) {
  throw new Error('reconcile: godaddyCategory requires godaddyCost')
}
```

Validate in both directions. An earlier version only checked one direction.

**Without this:** Malformed request reaches Budget Service, gets a cryptic server error. Debugging requires tracing through the agent to find the incomplete request.

### 11. Omit Fields Whose Semantics Belong to Another Service

When a field's meaning is owned by a different service (e.g., budget `type` is a control plane grant concept, not a Budget Service concept), omit it from the client's view types:

```typescript
// BudgetSummary view for consumers -- no type field
interface BudgetSummary {
  readonly budgetItemId: string
  readonly remaining: number
  readonly expiration: string
}
```

**Without this:** Consumers branch on `type` values that could change if control plane redefines grant types. The client becomes coupled to another service's domain model.

### 12. Only Show Finalized Costs to Users

When computing remaining budget for user-facing display, only subtract finalized amounts (`creditsUsed`). Do not subtract pending costs:

```typescript
// Only finalized spend reduces displayed balance
function computeRemaining(total: string, used: string): number {
  const result = parseFloat(total) - parseFloat(used)
  return Math.round(result * 1e6) / 1e6
}
```

An earlier version subtracted `creditsPending` as well. Reviewer feedback: "pending should not be subtracted away from user credits amount as only finalized creditsSpent should be surfaced." Pending costs may be reversed or adjusted during reconciliation; showing them reduces the displayed balance speculatively.

**Without this:** Users see fewer credits than they actually have. If pending costs are later reversed, the balance jumps up, creating a confusing UX.

### 13. IAM S2S JWT over HMAC Shared Secrets

When both services run in AWS infrastructure with IAM roles, use IAM S2S tokens instead of HMAC-signed JWTs:

```typescript
import { getS2SToken } from '../utils/s2s-auth.js'

// Config accepts a token getter (injectable for testing)
this.getToken = config.getToken ?? (() => getS2SToken())

// Each request gets a fresh (or cached) IAM token
const token = await this.getToken()
headers: { Authorization: `Bearer ${token}` }
```

An earlier version generated HMAC JWTs with a shared `BUDGET_SERVICE_SIGNING_KEY`:
```typescript
// BEFORE (removed): HMAC shared secret
jwt.sign({ sub: budgetId, iss: 'airo-agents' }, this.signingKey, { algorithm: 'HS256', expiresIn: 60 })
```

IAM JWT advantages: no shared secret to distribute/rotate across environments, uses existing AWS role infrastructure, BMS validates via JWKS (confirmed live 2026-04-03), token caching and concurrency-safe refresh handled by gd-auth-client.

**Without this:** Shared HMAC keys require coordinated rotation across every service pair and environment. A leaked key allows arbitrary token forging.

### 14. Truncate Error Response Bodies

Limit stored response bodies to prevent sensitive service details from propagating through logs:

```typescript
const rawText = await response.text().catch((err: Error) => `[body read failed: ${err.message}]`)
const text = rawText.length > 1024 ? rawText.slice(0, 1024) + '...[truncated]' : rawText
```

**Without this:** A 401 response may include JWT signature details. The full body is stored in `BudgetServiceAuthError.responseBody` and logged, leaking auth implementation details.

### 15. Check Transport Return Values Before Updating Dedup State

When a hook sends data via a transport (e.g., WebSocket emit), only update the deduplication key if the transport confirms delivery:

```typescript
const sent = controller.emitBudgetContext({ budgetServiceEnabled: enabled, subscriptionId })
if (!sent) {
  logger.debug('websocket.budget_context.emit_failed', { budgetServiceEnabled: enabled })
  return  // don't update lastSentRef -- retry on next render
}
lastSentRef.current = key
```

**Without this:** If the socket disconnects between the React state update and the actual emit, the dedup ref is updated as if sent. On reconnect, the message is not retried.

## Why This Matters

Each pattern addresses a specific failure mode:

| Pattern | Failure prevented |
|---------|-------------------|
| Readonly types (#1) | Mutation of cached response objects |
| Discriminated unions (#2) | Reading stale fields on error payloads |
| Zod validation (#3) | Undefined fields from malformed API responses |
| Error hierarchy (#4) | Retrying non-transient errors |
| ~~Circuit breaker~~ (#5) | Removed: unnecessary complexity in single-user model |
| Injectable fetch (#6) | Global state mutation in tests |
| Separated parsing (#7) | Mixed failure mode responsibilities |
| Aggressive retries (#8) | Unreconciled billing costs from transient failures |
| Constructor validation (#9) | Cryptic runtime errors from bad config |
| Cross-field validation (#10) | Malformed requests producing cryptic server errors |
| Foreign field omission (#11) | Client coupled to another service's domain model |
| Finalized costs only (#12) | Users see speculative balance reductions |
| IAM over HMAC (#13) | Shared secret management and rotation burden |
| Truncate bodies (#14) | Auth details leaked in error logs |
| Transport confirmation (#15) | Dedup state updated for undelivered messages |

### Core principle: match complexity to deployment topology

Single-user-per-instance means:
- **No circuit breaker** -- no shared resource pool to protect
- **Aggressive retries on billing paths** -- one user's reconciliation failure is 100% of the problem
- **No speculative state** (pending costs) in user display -- confuses the single user who sees it

## When to Apply

- Building HTTP clients for microservices (internal or external)
- Consuming APIs where the server team ships independently (schema drift risk)
- Agent execution paths where failures block user actions
- **Especially** single-instance-per-user deployments where resilience must match the deployment model

Not needed for: internal function calls, in-process APIs, or clients where you control both sides and deploy together.

## Examples

### Before/After: Discriminated Union

**Before:**
```typescript
if (update.refreshRequired) {
  // need to refresh
} else if (update.customerRemaining != null && update.budgets != null) {
  // update display
} else {
  // unclear state
}
```

**After:**
```typescript
if (payload.refreshRequired) {
  triggerRefresh()
} else {
  updateDisplay(payload.customerRemaining, payload.budgets)
}
```

### Before/After: Injectable Fetch

**Before:**
```typescript
beforeEach(() => { originalFetch = globalThis.fetch })
afterEach(() => { globalThis.fetch = originalFetch })
```

**After:**
```typescript
const client = new BudgetServiceClient({ ...config, fetch: mockFetch })
```

## Related

- `packages/ai-lib/src/budget/` -- reference implementation
- `packages/ai-lib/src/providers/unified-provider.ts` -- existing S2S fetch wrapper (similar layer)
- `packages/ai-common/src/errors.ts` -- existing `BudgetExceededError` (reused, not extended)
- `docs/solutions/best-practices/ai-code-bloat-simplification-pass-2026-04-02.md` -- simplification pass that removed early YAGNI
- `docs/solutions/best-practices/bff-parallel-fetch-enrichment-2026-04-07.md` -- BFF-layer application: parallel-fetch + graceful degradation + fail-closed numeric conversion
