---
title: CORS error masking a 401, and an allowlist missing the prod origin
date: 2026-06-11
category: integration-issues
module: Next.js BFF (app/)
problem_type: integration_issue
component: authentication
symptoms:
  - "Browser reports a CORS error (no Access-Control-Allow-Origin) instead of the real 401 when auth fails"
  - "Cross-origin caller from a prod-local origin blocked outright by the exact-match allowlist"
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [cors, authentication, nextjs-bff, customer-auth, allowlist, cross-origin, middleware]
related_components: [authentication]
---

# CORS error masking a 401, and an allowlist missing the prod origin

## Problem

A cross-origin caller (the My Products app running prod locally) hit the BFF `/api/subscriptions` and got a browser CORS error. There were two independent causes that present identically in the browser: the auth wrapper returned 401s without CORS headers (masking the real status), and the prod origin was never in the allowlist.

## Symptoms

- Browser console shows a CORS violation blocking the response; Network tab shows the request failed on CORS, not a 401.
- A caller from `https://local.cx.godaddy.com:8443` is rejected even though the test counterpart `https://local.cx.test-godaddy.com:8443` works.

## What Didn't Work

The first pass fixed only the masking bug (CORS headers on the 401), on the assumption that the allowlist already contained the caller's origin. That assumption came from a pasted thread URL showing the **test** origin, which the allowlist did have. When the reporter corrected it to the **prod** origin (`local.cx.godaddy.com:8443`), the real blocker surfaced: the allowlist had the test variant but not prod. The test/prod asymmetry was the tell, `account.*` had both variants, `local.cx.*` had only test.

## Solution

**Fix 1, wrap the wrapper-level 401s in `withCorsHeaders`** (`app/src/lib/customer-auth.ts`). The early-return 401:

```typescript
if (!authContext.isAuthenticated) {
  transaction?.end('HTTP 401');
  return withCorsHeaders(
    NextResponse.json(
      { error: 'Unauthorized', message: unauthContext.error, requiresAuth: true },
      { status: 401 }
    ),
    request.headers.get('origin')
  );
}
```

The same wrap on the mgmt-airo safety-net catch path:

```typescript
const authResponse = mgmtAiro401Response(error, 'auth.handler.mgmt-airo.hbi-expired');
if (authResponse) {
  transaction?.end('HTTP 401');
  return withCorsHeaders(authResponse, request.headers.get('origin'));
}
```

The unhandled-error rethrow→500 path is left unwrapped (no response is constructed there; it rethrows to an outer handler) and documented as residual.

**Fix 2, add the prod origin to the allowlist** (`app/src/lib/cors.ts`):

```typescript
const ALLOWED_ORIGINS = [
  'https://account.test-godaddy.com',
  'https://account.godaddy.com',
  'https://local.cx.test-godaddy.com:8443',
  'https://local.cx.godaddy.com:8443', // added
];
```

## Why This Works

**Masking:** `withCustomerAuth` returns a bare 401 before the route handler runs. Route handlers wrap their own responses with `withCorsHeaders`, but the wrapper's early short-circuit bypassed that, so the response had no `Access-Control-Allow-Origin` and the browser blocked it as a CORS violation, hiding the 401. Wrapping the 401 at the source surfaces the real auth error. `withCorsHeaders` is safe to apply at the wrapper level because it is a no-op for same-origin requests (no `Origin` header) and for non-allowlisted origins, returning the response unmodified.

**Omission:** CORS requires an exact origin match (scheme, host, and port). The allowlist had `local.cx.test-godaddy.com:8443` but not `local.cx.godaddy.com:8443`, so the prod-local caller never matched.

## Prevention

1. **Wrap every middleware-level short-circuit response in CORS.** Any response a wrapper constructs before the handler runs must apply CORS headers directly, or allowlisted cross-origin callers see a masked CORS error instead of the real status.
2. **Keep test/prod origin pairs symmetric.** When adding a cross-origin allowlist entry, add both the test and prod variants. If one namespace has a test/prod pair and another has only one, the incomplete pair is likely the bug.
3. **Unit-test the allowlist** so entries can't be silently dropped (`app/src/lib/cors.test.ts`):

```typescript
it.each([
  'https://account.test-godaddy.com',
  'https://account.godaddy.com',
  'https://local.cx.test-godaddy.com:8443',
  'https://local.cx.godaddy.com:8443',
])('reflects allowlisted origin %s with credentials', (origin) => {
  const response = withCorsHeaders(NextResponse.json({ ok: true }), origin);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
});
```

4. **When debugging a CORS error, check two things in order.** First, is the exact failing origin in the allowlist (scheme, host, port; verify test vs prod)? Second, does the failing response actually carry `Access-Control-Allow-Origin` (raw headers in the Network tab)? A CORS error has two independent causes that look identical: origin-not-allowlisted (no header added) and response-short-circuits-before-the-wrapper (header missing). Confirm the exact origin before concluding the allowlist is fine.

## Related Issues

- `logic-errors/response-json-before-ok-check-2026-04-08.md` — same root-cause class (order of execution bypassing the error path), different layer (frontend hook vs BFF middleware).
