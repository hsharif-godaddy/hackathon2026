---
title: AI-generated code bloat -- ten anti-patterns and a simplification workflow
date: 2026-04-02
last_updated: 2026-04-03
revision_note: "updated stale code examples after PR #2455 review refactoring (HMAC->S2S, validators->zod, circuit breaker removed)"
category: best-practices
module: packages/ai-lib/budget
problem_type: best_practice
component: tooling
severity: low
applies_when:
  - reviewing or accepting AI-generated code (LLM agents, copilot, etc.)
  - a feature branch has accumulated code across multiple AI conversations
  - a file has 3+ methods with structurally identical try/catch or validation blocks
  - a class exports types or callbacks with zero production consumers
  - tests use @internal getters to inspect private state
symptoms:
  - copy-paste duplication across similar methods
  - defensive overengineering (cross-realm guards in single-process Node)
  - YAGNI types exported but never imported
  - premature abstraction (interfaces wrapping single values, factory functions returning literals)
  - test permutation bloat (multiple tests covering the same branch)
  - event/callback systems with zero production wiring
  - test-only getters coupling tests to implementation details
  - configurable values with only one valid option
  - scattered side-effect calls causing double-counting
root_cause: missing_workflow_step
resolution_type: workflow_improvement
tags:
  - ai-code-generation
  - code-simplification
  - yagni
  - code-review
  - budget-service
  - refactoring
  - circuit-breaker
  - test-design
---

# AI-generated code bloat -- ten anti-patterns and a simplification workflow

## Context

The `budget-service-client` feature branch accumulated code across multiple AI conversations. Each conversation produced locally correct code, but without a consolidation pass the module grew ~15% larger than necessary.

**Pass 1** (commit `61b61f124`, +113/-389 lines, net -276): A `code-simplicity-reviewer` audit identified 120-140 lines of cuttable code across ~940 total lines. Targeted duplication, discriminated unions, validator preambles, cross-realm guards, YAGNI types, and test permutation bloat.

**Pass 2** (PR #2455 review): A second `code-simplicity-reviewer` run against the PR found four more YAGNI violations. Cross-referenced each finding against the implementation plan to avoid removing planned functionality -- 5 of 9 findings were rejected because they conflicted with the plan. The 4 safe fixes removed ~55 implementation LOC and replaced ~75 test LOC with behavioral equivalents.

This is not a bug -- the code worked and all tests passed. The problem is maintenance cost: every unnecessary line is a line to read, review, and debug.

## Guidance

Six anti-patterns to watch for, with fixes:

### 1. Copy-paste duplication across methods

**Before** -- 5 public methods each repeating the same try/validate/record block:

```typescript
async getBudget(budgetId: string): Promise<BudgetResponse> {
  const data = await this.request('GET', `/budget/${budgetId}`, budgetId, undefined, this.getBudgetTimeoutMs)
  try {
    assertBudgetResponseShape(data)
  } catch (err) {
    this.recordFailure()
    throw err
  }
  this.recordSuccess()
  return data
}
// ... 4 more identical blocks with different validators
```

**After** -- one generic `requestAndValidate()`, public methods become delegations:

```typescript
private async requestAndValidate<T>(
  method: 'GET' | 'POST' | 'PATCH', path: string,
  schema: z.ZodType<T>, label: string, body?: unknown, timeoutMs?: number
): Promise<T> {
  const data = await this.request(method, path, body, timeoutMs)
  return validateResponse(schema, data, label)
}

async getBudget(budgetId: string): Promise<BudgetResponse> {
  return this.requestAndValidate('GET', `/api/v1/budgets/${encodeURIComponent(budgetId)}`,
    BudgetResponseSchema, 'BudgetResponse', undefined, this.getBudgetTimeoutMs)
}
```

*Note: further simplified in PR #2455 review -- circuit breaker (`assertCircuitClosed`, `recordFailure`, `recordSuccess`) removed entirely, hand-rolled validators replaced with zod schemas.*

### 2. Discriminated union returns where throw suffices

**Before** -- `parseResponse` returns `{ ok, data/error }`, caller checks and re-throws:

```typescript
private async parseResponse<T>(response: Response, method: string, path: string):
  Promise<{ ok: true; data: T } | { ok: false; error: BudgetServiceError }> {
  // ... returns { ok: false, error: new BudgetServiceError(...) }
}
// Caller:
const result = await this.parseResponse<T>(response, method, path)
if (result.ok) return result.data
this.recordFailure()
throw result.error
```

**After** -- throws directly, caller simplified to one line:

```typescript
private async parseResponse(response: Response, method: string, path: string): Promise<unknown> {
  // ... throw new BudgetServiceError(...)
}
// Caller:
return await this.parseResponse(response, method, path)
```

### 3. Repeated validator preambles

**Before** -- 7 validators each with identical null-check + cast:

```typescript
function assertBudgetResponseShape(data: unknown): asserts data is BudgetResponse {
  if (typeof data !== 'object' || data === null) {
    throw new BudgetServiceError('invalid BudgetResponse: expected object', 200, JSON.stringify(data))
  }
  const d = data as Record<string, unknown>
  // field checks...
}
```

**After (pass 1)** -- `asRecord()` helper reduced duplication:

```typescript
function asRecord(data: unknown, label: string): Record<string, unknown> { ... }
function assertBudgetResponseShape(data: unknown): asserts data is BudgetResponse {
  const d = asRecord(data, 'BudgetResponse')
  // field checks...
}
```

**After (PR #2455 review)** -- entire hand-rolled approach replaced with zod schemas:

```typescript
const BudgetResponseSchema = z.object({
  budgetId: z.string(),
  creditsTotal: z.string(),
  items: z.array(BudgetItemSchema),
}).passthrough()
```

*~140 lines of assert functions replaced with ~30 lines of zod schemas.*

### 4. `isInstance()` in single-process Node

Duck-typed brand fields + static `isInstance()` methods exist for cross-realm `instanceof` safety (iframes, multiple module instances). Single-process server code doesn't need them.

**Before:** 4 static methods, a `isBudgetServiceError` brand field, ~15 lines in errors.ts.
**After:** Plain `instanceof` at 4 call sites. errors.ts went from 68 to 34 lines.

### 5. YAGNI types and trivial factories

- `BudgetServiceErrorResponse` -- exported type, zero imports anywhere
- `BillingModeContext` -- interface wrapping a single boolean
- `createRefreshRequiredPayload()` -- factory returning `{ refreshRequired: true }`
- `'none'` variant on `BillingMode` -- "reserved for future use"

All removed. If needed later, they can be added in the conversation that needs them.

### 6. Test permutation bloat

5 tests for `godaddyCost` validation testing field permutations (missing, null, non-number cost, missing category, non-string category) -- but only 2 distinct code paths (null/undefined check, field type check). 6 tests for a 3-line function where 3 tested the same falsy branch.

**Rule:** one test per distinct code path, not per input variation.

### 7. Exported event/callback systems with zero production consumers

**Before** -- `CircuitBreakerEvent` type + `onCircuitStateChange` callback exported, only tests wired it. ~35 implementation LOC + ~120 test LOC for event emission with zero production consumers.

**After (pass 1):** Callbacks removed. Circuit breaker worked identically without notifications.

**After (PR #2455 review):** Circuit breaker itself removed entirely -- unnecessary in single-agent-per-app deployment model. The entire callback + state machine + event system was YAGNI from the start.

### 8. Test-only @internal getters

**Before** -- getter exposes internals, tests inspect state directly:

```typescript
/** @internal Visible for testing only */
get circuitBreakerState(): { failures: number; isTripped: boolean; isHalfOpen: boolean } { ... }

// Tests:
expect(client.circuitBreakerState.failures).toBe(1)
expect(client.circuitBreakerState.isTripped).toBe(true)
```

**After (pass 1)** -- behavioral tests through public API (circuit breaker still existed).

**After (PR #2455 review)** -- circuit breaker removed entirely. The behavioral tests were themselves removed because the circuit breaker no longer exists. The anti-pattern lesson still applies: always test behavior through public API, not internal state.

### 9. Configurable values with single valid option

**Before** -- configurable issuer with one valid value:

```typescript
export interface BudgetServiceClientConfig {
  issuer?: string  // always 'airo-agents' for this client
}
this.issuer = config.issuer ?? 'airo-agents'
```

**After (pass 1)** -- hardcoded HMAC issuer:

```typescript
return jwt.sign({ sub: budgetId, iss: 'airo-agents' }, this.signingKey, { ... })
```

**After (PR #2455 review)** -- HMAC auth replaced with IAM S2S JWT (`getS2SToken`). The entire issuer/signingKey configuration was removed along with the `jsonwebtoken` dependency. The anti-pattern lesson still applies: don't make things configurable until a second valid value exists.

### 10. Scattered side-effect calls causing double-counting

**Before** -- `recordFailure()` called in 3 places across 2 methods:

```typescript
private async request(...) {
  try { response = await this.fetch(...) }
  catch (err) { this.recordFailure(); /* rethrow */ }  // site 1
  try { return await this.parseResponse(...) }
  catch (err) { this.recordFailure(); throw err }       // site 2
}

private async requestAndValidate<T>(...) {
  const data = await this.request(...)
  try { validate(data) } catch (err) { this.recordFailure(); throw err }  // site 3
}
```

A JSON parse failure hit site 2, then the rethrown error propagated to site 3, incrementing the circuit breaker failure counter twice per request. This was a real bug -- it could cause premature circuit breaker trips.

**After (pass 1)** -- single call site wrapping both request + validate:

```typescript
private async requestAndValidate<T>(...) {
  let data: unknown
  try {
    data = await this.request(...)
    validate(data)
  } catch (err) {
    this.recordFailure()  // single site
    throw err
  }
  this.recordSuccess()
  return data as T
}
```

**After (PR #2455 review)** -- circuit breaker removed entirely, so `recordFailure`/`recordSuccess` are gone:

```typescript
private async requestAndValidate<T>(...) {
  const data = await this.request(method, path, body, timeoutMs)
  return validateResponse(schema, data, label)
}
```

The anti-pattern lesson still applies: side effects in catch blocks within a call chain will double-count. But the best fix was removing the entire subsystem that needed them.

## Why This Matters

- Pass 1: 276 net lines removed (client 578->452, errors 68->34, billing-mode 28->5)
- Pass 2: ~55 implementation LOC removed, ~75 test LOC replaced with ~60 behavioral equivalents
- Combined: zero behavior change, all tests pass
- Each unnecessary line is maintenance debt: read during reviews, debugged during incidents, updated during refactors
- AI code generation optimizes for correctness in isolation -- it doesn't see the whole file's repetition across conversations
- The scattered `recordFailure()` (#10) was a real bug, not just bloat -- double-counting could cause premature circuit breaker trips

## When to Apply

- After generating significant new code across multiple AI conversations
- Before marking a feature branch as ready for review
- When a file has 3+ methods with structurally identical try/catch or validation blocks
- When error classes have `isInstance()` static methods in server-side Node code
- When types are exported but have zero imports (`grep` for the type name)
- When test files have multiple tests whose descriptions differ but whose code paths are identical
- When a class has event/callback config options but `grep` finds zero production consumers
- When tests use `@internal` getters or inspect private state -- rewrite as behavioral assertions
- When a config option has exactly one valid value in the consuming context
- When the same side effect (e.g., `recordFailure`, `emit`, `log`) appears in multiple catch blocks within a call chain
- **When cross-referencing review findings against an implementation plan** -- reject simplification suggestions that remove planned functionality (e.g., dual timeouts, standalone helper files needed by future units)

## Examples

See the before/after code in the Guidance sections above. The systematic approach:

1. Run `code-simplicity-reviewer` agent against the changed files or PR
2. Cross-reference findings against the implementation plan -- reject anything that removes planned functionality
3. Group safe findings by anti-pattern category (the ten above)
4. Apply fixes in order of impact (duplication > scattered side effects > YAGNI > test trimming)
5. Verify: tests pass, typecheck clean, lint clean
6. Save a feedback memory with the specific anti-patterns to avoid in future conversations

## Related

- [Defensive HTTP client design](defensive-http-client-design-2026-03-31.md) -- complementary doc covering what patterns to apply at system boundaries (refreshed 2026-04-03 to reflect circuit breaker removal, zod validation, S2S auth)
- [Budget Service Client Simplification Patterns](budget-service-client-simplification-patterns-2026-04-03.md) -- documents the PR #2455 review refactoring that superseded several patterns in this doc
- Commit `61b61f124` -- `refactor(budget): simplify client, errors, types` (pass 1)
- PR #2455 -- `feat: budget service client + feature flag` (pass 2 fixes applied during review). The originating integration plan was used to gate which simplification findings were safe vs plan-conflicting.
