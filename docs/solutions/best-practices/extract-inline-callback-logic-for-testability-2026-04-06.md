---
title: Extract inline callback logic for testability via dependency injection
date: 2026-04-06
category: best-practices
module: agents-websocket
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - Business logic with branching is inline in a framework callback (WebSocket handler, Express route, queue consumer)
  - The surrounding file is large enough that finding and modifying the logic is slow
  - Error paths (timeouts, service unavailable, budget exceeded) are hard to trigger through the framework
  - The function uses 2-3 injectable dependencies (service clients, loggers)
tags:
  - dependency-injection
  - unit-testing
  - testability
  - callback-extraction
  - error-contract-testing
  - websocket
  - budget-service
---

# Extract inline callback logic for testability via dependency injection

## Context

Large event-handler files (WebSocket servers, Express route handlers, queue consumers) accumulate inline callback logic that can't be unit tested without standing up the full server. A 35-line budget pre-execution check was embedded in `onMessageStart` inside `ai-lib-websocket-server.ts` (2648 lines). Testing budget check, session creation, or error mapping required a full WS connection. This is a recurring pattern: business logic gets added inside framework callbacks and becomes untestable.

The error mapping catch block in `experimental-websocket-server.ts` (lines 2225-2255) had the same problem -- classifying various budget error types into WebSocket error responses couldn't be tested without the full server. Extracting the catch block wasn't feasible because it lives in a 3000-line base class in a different package (`ai-transport`).

## Guidance

**Extract inline callback logic into pure async functions with an explicit deps interface.**

Replace module-level imports with injectable dependencies so tests can inject fakes without `vi.mock`:

```typescript
// budget-pre-check.ts -- extracted, ~40 lines

export interface BudgetPreCheckDeps {
  getClient: () => BudgetServiceClient | null
  logger: { info: (event: string, data: Record<string, unknown>) => void }
}

export async function performBudgetPreCheck(
  metadata: { budgetServiceEnabled?: boolean; subscriptionId?: string; appId?: string },
  deps: BudgetPreCheckDeps,
): Promise<BudgetPreCheckResult | null> {
  if (!metadata.budgetServiceEnabled) return null
  const client = deps.getClient()
  if (!client) throw new BudgetServiceUnavailableError('no client')
  // ... pure logic, no framework coupling
}
```

```typescript
// ai-lib-websocket-server.ts -- call site, 10 lines

const result = await performBudgetPreCheck(
  { budgetServiceEnabled: ff, subscriptionId, appId },
  { getClient: () => getBudgetServiceClient(), logger },
)
if (result) {
  context!.budgetService = { budgetId: result.budgetId, sessionId: result.sessionId }
}
```

**When the catch block can't be extracted** (deep in a base class, different package), test the error contract instead:

```typescript
// Verify error instances have the right shape for the catch block branches
it('BudgetServiceError 404 falls through to catch-all (name only)', () => {
  const err = new BudgetServiceError('not found', 404, '{}')
  // Not matched by 5xx/429 branch
  expect(err.statusCode).not.toBeGreaterThanOrEqual(500)
  expect(err.statusCode).not.toBe(429)
  // Not BudgetServiceAuthError
  expect(err.name).not.toBe('BudgetServiceAuthError')
  // Caught by catch-all: name === 'BudgetServiceError'
  expect(err.name).toBe('BudgetServiceError')
})

it('subclass names do not collide with base BudgetServiceError', () => {
  const unavailable = new BudgetServiceUnavailableError('down')
  const timeout = new BudgetServiceTimeoutError('slow')
  expect(unavailable.name).not.toBe('BudgetServiceError')
  expect(timeout.name).not.toBe('BudgetServiceError')
})
```

This verifies the producer-consumer contract: errors thrown by the extracted function have the properties the handler's catch branches inspect.

## Why This Matters

- **`vi.mock` is brittle.** It couples tests to module paths and import structure. Refactoring imports breaks tests without touching actual logic.
- **DI makes the dependency surface explicit.** The `Deps` interface documents exactly what the function needs. Tests construct fakes in 2 lines.
- **Inline logic in large files is a compounding problem.** Each addition makes the file harder to navigate and test. Extracting early prevents the 3000-line base class situation where extraction becomes a multi-day refactor.
- **Error contract tests are a pragmatic fallback.** When you can't test the actual catch block without a full server, testing the error shapes catches the most likely failure mode: someone changes an error class and breaks the name/statusCode contract.

**Limitation:** Error contract tests verify shapes, not the actual catch block. If someone reorders conditions in the catch block, these tests won't catch it. Accept this tradeoff when extraction from the base class is too expensive.

## When to Apply

- Business logic has branching (if/else, try/catch, early returns) inside a callback
- The function uses 2-3 injectable dependencies (DB clients, service clients, loggers)
- You need to test error paths that are hard to trigger through the framework
- The surrounding file is large enough that finding the logic is slow

**Skip when:** the inline logic is a single expression or straight-line delegation with no branching. Extraction adds indirection without testability gain.

## Examples

**Before -- inline, untestable without full WS server:**

```typescript
// ai-lib-websocket-server.ts (2648 lines)
onMessageStart: async (socketId, message, agentName, context) => {
  // ... 50 lines of setup ...
  if (typedContext?.metadata?.budgetServiceEnabled === true) {
    const subscriptionId = typedContext?.metadata?.subscriptionId as string | undefined
    if (!subscriptionId) {
      throw new BudgetServiceUnavailableError('missing subscriptionId')
    }
    const budgetClient = getBudgetServiceClient()
    if (!budgetClient) {
      throw new BudgetServiceUnavailableError('no client')
    }
    const budget = await budgetClient.getBudget(subscriptionId)
    const remaining = computeRemaining(budget.creditsTotal, budget.creditsUsed)
    if (!(remaining > 0)) {
      throw BudgetExceededError.fromBudgetCheck(subscriptionId)
    }
    const session = await budgetClient.createSession(subscriptionId)
    context!.budgetService = { budgetId: subscriptionId, sessionId: session.sessionId }
  }
  // ... 200 more lines ...
}
```

**After -- extracted, 19+ tests, no WS server needed:**

```typescript
// budget-pre-check.ts (standalone, ~40 lines)
export async function performBudgetPreCheck(metadata, deps): Promise<Result | null> { ... }

// ai-lib-websocket-server.ts (call site, 10 lines)
const result = await performBudgetPreCheck(
  { budgetServiceEnabled, subscriptionId, appId },
  { getClient: getBudgetServiceClient, logger },
)
if (result) {
  context!.budgetService = { budgetId: result.budgetId, sessionId: result.sessionId }
}

// websocket-budget-integration.test.ts -- no vi.mock, just inject fakes
const client = { getBudget: vi.fn().mockResolvedValue({...}), createSession: vi.fn().mockResolvedValue({...}) }
const deps = { getClient: () => client, logger: { info: vi.fn() } }
const result = await performBudgetPreCheck({ budgetServiceEnabled: true, subscriptionId: 'sub-1' }, deps)
expect(result).toEqual({ budgetId: 'sub-1', sessionId: 'sess-abc' })
```

## Related

- [Context threading across agent handoffs](context-threading-across-agent-handoffs-2026-04-02.md) -- documents the state threading patterns (dual-write + restore, local var capture) in the same files. Companion to this doc: that one covers *what* patterns to use, this one covers *how to test* them.
- [Budget service client simplification patterns](budget-service-client-simplification-patterns-2026-04-03.md) -- DI patterns in the client itself (`getToken` injection)
- [Defensive HTTP client design](defensive-http-client-design-2026-03-31.md) -- typed error hierarchy that the contract tests exercise
- [AI code bloat simplification pass](ai-code-bloat-simplification-pass-2026-04-02.md) -- motivation for extraction (reduce bloat)
- [NaN bypass budget service fail-closed](../logic-errors/nan-bypass-budget-service-fail-closed-2026-04-06.md) -- discovered during extraction; the NaN fail-closed guard is tested by the extracted function's test suite
- PR [#2532](https://github.com/gdcorp-partners/airo-app-builder/pull/2532) -- implementation
- [onMessageStart context metadata timing](../logic-errors/websocket-onmessagestart-context-metadata-timing-2026-04-13.md) -- the extracted `performBudgetPreCheck` was affected by this timing bug (read metadata before contextProvider populated it)
