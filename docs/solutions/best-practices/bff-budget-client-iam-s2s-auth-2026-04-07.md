---
title: BFF Budget Service client patterns with IAM S2S auth
date: 2026-04-07
category: best-practices
module: app (BFF layer)
problem_type: best_practice
component: authentication
severity: medium
applies_when:
  - Creating BFF HTTP clients for internal service-to-service communication
  - Sharing domain error classes across packages (app/ cannot depend on ai-lib)
  - Implementing IAM S2S JWT authentication in Next.js API routes
  - Validating resource ownership before proxying to user-agnostic services
tags:
  - bff
  - http-client
  - iam-s2s-auth
  - jwt
  - budget-service
  - error-sharing
  - zod
  - singleton-pattern
  - token-caching
  - ownership-validation
  - query-param-validation
---

# BFF Budget Service client patterns with IAM S2S auth

## Context

Unit 7 of budget service integration originally added a BFF endpoint (`GET /api/credits/status`) that proxied credit status requests to Budget Management Service (BMS). Unlike other BFF clients (AiroMgmtClient, DomainsClient) that pass the customer's SSO JWT, BMS uses S2S auth because it has no user-scoping. This forced several architectural decisions around error sharing, auth patterns, ownership validation, and validation edge cases.

**Route consolidation (PR #3036):** `GET /api/credits/status` and its `enrichBudgetResponse` helper were both deleted. The endpoint is now `GET /api/credits/grants`, which maps the BMS budget into grant shape via `adaptBudgetToGrants` from `app/src/lib/credit-adapter`. The auth, ownership, and validation guidance below still applies; only the route name and the budget-to-grants adapter changed.

## Guidance

### 1. Move pure error classes to @airo/shared for cross-package reuse

Budget error classes are pure value objects with no ai-lib dependencies. `@airo/shared` already supports runtime exports (grants module has `GrantManager` class). The `./budget` export path is pre-configured for both types and JS in `packages/shared/package.json`.

```typescript
// packages/shared/src/budget/errors.ts -- the canonical source
export class BudgetServiceError extends Error {
  readonly statusCode: number
  readonly responseBody: string
  constructor(message: string, statusCode: number, responseBody: string) {
    super(message)
    this.name = 'BudgetServiceError'
    this.statusCode = statusCode
    this.responseBody = responseBody
  }
}
// + BudgetServiceAuthError, BudgetServiceTimeoutError, BudgetServiceUnavailableError

// packages/ai-lib/src/budget/errors.ts -- re-export for backward compat
export { BudgetServiceError, ... } from '@airo/shared/budget'
```

ai-transport checks errors by `error.name` string (not `instanceof`), so relocation is safe. No downstream import changes needed.

### 2. Use `Bearer` prefix for BMS auth, not `sso-jwt`

The BFF has two S2S token patterns: `insights-auth.ts` returns `sso-jwt ${token}`, while the ai-lib budget client uses `Bearer ${token}`. BMS go-auth middleware (`packages/go-auth/middleware.go:98-101`) accepts both. Use `Bearer` to match the ai-lib convention.

```typescript
// app/src/lib/budget-service/client.ts
headers: {
  Authorization: `Bearer ${token}`,  // NOT sso-jwt
  'Content-Type': 'application/json',
}
```

### 3. IAM token utility with mutex for concurrent refresh dedup

```typescript
// app/src/lib/iam-token.ts
let cachedToken: { jwt: string; expiresAt: number } | null = null
let refreshPromise: Promise<string> | null = null

export async function getIamToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.jwt
  if (refreshPromise) return refreshPromise  // concurrent callers wait on same promise

  refreshPromise = (async () => {
    try {
      const client = new IamTokenClient(getSsoHostSync())
      const jwt = await client.getToken()
      cachedToken = { jwt, expiresAt: Date.now() + 30 * 60 * 1000 }
      return jwt
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}
```

Returns raw JWT. Callers add `Bearer` or `sso-jwt` prefix as needed. `clearIamTokenCache()` exported for testing. Node.js single-threaded event loop means the `refreshPromise` assignment is synchronous before any `await` yields -- no race condition.

### 4. Use `getSubscription(id, options?)` singular for ownership validation

`AiroMgmtClient.getSubscription(subscriptionId, options?)` validates ownership in one call (`options` carries `noCache` / `includeAttributes`; the grants route passes `{ includeAttributes: true }`). mgmt-airo scopes by user JWT, returns 404 if not owned. More efficient than `getSubscriptions()` + filter (token-budget route pattern).

```typescript
try {
  await mgmtClient.getSubscription(subscriptionId)
} catch (err) {
  if (err instanceof AiroHttpError && err.status === 404) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
  }
  throw err
}
```

This ownership check is necessary because BMS uses S2S auth (no user scoping). The grants route skips this because mgmt-airo scopes by JWT implicitly.

### 5. Zod `as z.ZodType<T>` cast is runtime-only, not compile-time

The cast suppresses TypeScript field checking. If `@airo/shared` types rename a field, the schema silently compiles but fails at runtime. `.passthrough()` is needed for forward-compat with BMS adding fields.

```typescript
// Cast does NOT verify field names match. Runtime validation only.
const BudgetResponseSchema = z.object({
  budgetId: z.string(),
  creditsTotal: z.string(),
  // ...
}).passthrough() as z.ZodType<BudgetResponse>
```

### 6. Empty string query params bypass truthiness checks

`searchParams.get('subscriptionId')` returns `''` for `?subscriptionId=`, which is truthy.

```typescript
// WRONG: misses empty string
if (!subscriptionId) { ... }

// RIGHT: catches empty and whitespace
if (!subscriptionId?.trim()) { ... }
```

## Why This Matters

- **Error sharing:** BFF routes need to catch budget errors for HTTP status mapping. Duplication between ai-lib and app causes field drift (see bff-budget-client-stale-field-names-2026-04-07.md).
- **Auth clarity:** S2S JWT vs customer JWT confusion causes silent 401s that surface as 502 to users.
- **Token storms:** Without mutex, concurrent requests on cold start trigger many simultaneous IAM token refreshes.
- **Ownership validation:** BMS has no user-scoping. Without the ownership check, any authenticated user could read any subscription's credit data (IDOR).
- **Zod drift:** Misleading comments about compile-time safety lead to skipped schema updates when types change.

## When to Apply

- Creating BFF HTTP clients for internal Go services with S2S auth
- Sharing domain errors across app/ and ai-lib/ (or any packages that can't depend on each other)
- Any cached token utility where concurrent requests are common
- Validating resource ownership before proxying to user-agnostic services
- All query param validation in Next.js route handlers

## Examples

See implementation (origin PR #2609; route since consolidated by PR #3036):
- `app/src/lib/budget-service/client.ts` -- BFF client with injectable fetch/getToken
- `app/src/lib/iam-token.ts` -- token utility with mutex
- `app/src/app/api/credits/grants/route.ts` -- route with ownership check (replaced the deleted `credits/status` route)
- `app/src/lib/credit-adapter` -- `adaptBudgetToGrants` budget-to-grants mapper (replaced `enrichBudgetResponse`)
- `packages/shared/src/budget/errors.ts` -- shared error classes

## Related

- [Budget Service client simplification patterns](../best-practices/budget-service-client-simplification-patterns-2026-04-03.md) -- agent-side client patterns (complementary)
- [Defensive HTTP client design](../best-practices/defensive-http-client-design-2026-03-31.md) -- 16 HTTP client patterns for BMS (agent-side foundation)
- [BFF budget client stale field names](../integration-issues/bff-budget-client-stale-field-names-2026-04-07.md) -- field drift from duplicated validators (solved by this approach)
- [BFF parallel-fetch enrichment](../best-practices/bff-parallel-fetch-enrichment-2026-04-07.md) -- extends this client with grant join, type labels, numeric conversion
