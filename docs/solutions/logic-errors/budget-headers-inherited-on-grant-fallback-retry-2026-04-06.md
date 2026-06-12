---
title: Budget headers inherited on grant-fallback retry
date: 2026-04-06
category: logic-errors
module: ai-lib
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - Grant-fallback retry requests inherited x-gocode-budget-* headers from original request
  - Budget-exceeded retries incorrectly attributed to exhausted BMS session
root_cause: logic_error
resolution_type: code_fix
tags:
  - budget
  - gocode
  - http-headers
  - grant-fallback
  - request-retry
  - unified-provider
---

# Budget headers inherited on grant-fallback retry

## Problem

Budget HTTP headers (`x-gocode-budget-service-name`, `x-gocode-budget-id`) injected by `createS2SFetchWrapper` persisted into grant-fallback retry requests, causing grant-funded retries to be incorrectly attributed to exhausted BMS budget sessions.

## Symptoms

- Grant-fallback retries after budget exhaustion still carried BMS budget headers
- GoCode attributed grant-funded requests to the wrong budget session
- No visible errors; cost attribution silently incorrect in BMS telemetry

## What Didn't Work

Not applicable; issue was found during structured PR review (cross-confirmed by correctness + adversarial reviewers) before reaching production.

## Solution

In `handleBudgetExceededWithGrantFallback` (`packages/ai-lib/src/providers/unified-provider.ts`), delete budget headers before the grant-fallback retry.

**Before:**
```typescript
const retryInit: RequestInit = { ...modifiedInit, body: retryBody }
return await fetch(url, retryInit)
```

**After:**
```typescript
const retryHeaders = new Headers(modifiedInit.headers as HeadersInit)
retryHeaders.delete('x-gocode-budget-service-name')
retryHeaders.delete('x-gocode-budget-id')
const retryInit: RequestInit = { ...modifiedInit, body: retryBody, headers: retryHeaders }
return await fetch(url, retryInit)
```

## Why This Works

`createS2SFetchWrapper` sets budget headers on the shared `headers` object before the first fetch (so they persist across 401 auth retries). The grant-fallback retry path was written before budget headers existed and spread `modifiedInit` (which includes the mutated headers) into the retry without cleanup. The retry correctly replaced `litellm_metadata.user` in the body but missed the HTTP headers. Deleting the budget headers before retry ensures grant-funded requests have clean attribution.

## Prevention

- **Audit all retry/fallback paths when adding request metadata.** Any new header, query param, or body field added to a shared request object must be checked against every retry path in the same function. The retry path may predate the new metadata.
- **Clone headers before mutation.** Consider creating a new `Headers` instance per retry rather than inheriting from the shared `modifiedInit`. This prevents header leakage by default.
- **Code review checklist item:** "Does this change add request metadata? Are there retry paths that should exclude it?"
- **Pattern:** Similar to how `litellm_metadata.user` is replaced on grant fallback (body field), per-request attribution headers must also follow the funding source transition.

## Related Issues

- PR #2572: Budget GoCode passthrough + report creation (where the bug was introduced and fixed)
- `docs/solutions/best-practices/defensive-http-client-design-2026-03-31.md`: HTTP client patterns (injectable fetch, retry logic)
- `docs/solutions/best-practices/budget-service-client-simplification-patterns-2026-04-03.md`: Retry strategy for budget service
