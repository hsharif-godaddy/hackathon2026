---
title: response.json() called before response.ok check in useBudgetService
date: 2026-04-08
category: logic-errors
module: app/src/lib/budget-service/client.ts
problem_type: logic_error
component: frontend_stimulus
severity: medium
symptoms:
  - 4xx/5xx with HTML body throws SyntaxError instead of HttpError
  - React Query retry guard bypassed for client errors
  - 4xx errors retry up to 3 times instead of failing immediately
root_cause: logic_error
resolution_type: code_fix
tags:
  - fetch-api
  - response-parsing
  - retry-logic
  - http-error-handling
  - react-query
  - budget-service
---

# response.json() called before response.ok check in useBudgetService

> **Re-anchored (2026-06-11).** The `app/src/hooks/useBudgetService.ts` hook this doc was written against was removed (PR #3036) when the frontend unified to `CreditGrant[]`; the frontend credit-fetch domain now lives in `app/src/hooks/useCreditGrants.ts`. The live BFF `app/src/lib/budget-service/client.ts` already checks `response.ok` before `.json()` correctly. The generic lesson below (check `response.ok` before `response.json()`) is durable and the reason this doc is kept.

## Problem

`useBudgetService` hook's query function called `response.json()` before checking `response.ok`. When a 4xx/5xx response has a non-JSON body (HTML gateway error page), `.json()` throws `SyntaxError` instead of `HttpError`, bypassing the retry guard and causing unnecessary retries on client errors.

## Symptoms

- 4xx responses with HTML bodies (gateway errors, proxy timeouts) throw `SyntaxError: Unexpected token '<'`
- React Query retry guard (`error instanceof HttpError && error.status >= 400 && error.status < 500`) never fires for `SyntaxError`
- 4xx errors retry up to 3 times instead of failing immediately
- Unnecessary network calls on client errors that will never succeed

## What Didn't Work

Caught by CI code review (GitHub Actions Claude reviewer on PR #2645), not by tests. Existing tests mocked `fetch` to always return valid JSON responses, so the non-JSON error path was never exercised.

The correct pattern already exists in the codebase at `app/src/lib/mgmt-airo/client.ts`, which checks `response.ok` before calling `response.json()`. The pattern was also documented in [defensive HTTP client design](../best-practices/defensive-http-client-design-2026-03-31.md) (Section #7: "Separated Response Parsing from Validation"). However, the `useBudgetService` hook was written without following this established pattern. (session history)

## Solution

Check `response.ok` before parsing JSON. For error responses, attempt JSON parse in a try/catch to extract error messages gracefully.

```typescript
// Before (buggy):
const json = await response.json();

if (!response.ok) {
  const errorMessage = json.error || `Failed to fetch credit status: ${response.status}`;
  throw new HttpError(errorMessage, response.status);
}

// After (fixed):
if (!response.ok) {
  let errorMessage = `Failed to fetch credit status: ${response.status}`;
  try {
    const errorJson = await response.json();
    if (errorJson.error) errorMessage = errorJson.error;
  } catch {
    // Non-JSON error body (e.g., HTML gateway page)
  }
  throw new HttpError(errorMessage, response.status);
}

const json = await response.json();
```

Commit: `4b153b65c`

## Why This Works

`fetch()` resolves for ALL HTTP responses, including 4xx/5xx. `response.json()` parses the body regardless of status code. When a proxy or gateway returns an HTML error page, `.json()` throws `SyntaxError`. By checking `response.ok` first, we throw `HttpError` with the correct status code before attempting to parse, ensuring the retry guard receives the expected error type.

The try/catch around the error-path `.json()` call handles the case where error responses have JSON bodies (with error messages) while still gracefully handling non-JSON bodies.

## Prevention

1. **Always check `response.ok` before `response.json()`**. The `fetch` API does not reject on HTTP errors. This is a known footgun; see [defensive HTTP client design](../best-practices/defensive-http-client-design-2026-03-31.md).

2. **Test error paths with non-JSON bodies.** Mock `fetch` to return `{ ok: false, status: 502, json: () => Promise.reject(new SyntaxError()) }` and verify the error type is `HttpError`, not `SyntaxError`.

3. **Verify retry guard error types.** When a React Query `retry` function depends on `error instanceof CustomError`, trace every throw path to confirm it produces the expected type for all failure modes, including network errors and non-JSON responses.

4. **Follow existing patterns.** `mgmt-airo/client.ts` already implements the correct pattern. Grep the codebase for existing HTTP clients before writing new fetch logic. (session history)

## Related Issues

- [Defensive HTTP client design](../best-practices/defensive-http-client-design-2026-03-31.md) -- establishes the correct pattern (Section #7: "Separated Response Parsing from Validation")
- [Budget path dependent query loading gate](../ui-bugs/react-query-dependent-query-loading-gate-2026-04-08.md) -- sibling bug in same PR, same hook
- [BFF budget client IAM/S2S auth](../best-practices/bff-budget-client-iam-s2s-auth-2026-04-07.md) -- related budget service client patterns
- PR #2645 on `feat/budget-frontend-state`
