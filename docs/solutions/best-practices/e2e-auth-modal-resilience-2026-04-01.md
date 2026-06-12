---
title: Handle SSO session expiration in long-running E2E tests
date: 2026-04-01
last_updated: 2026-04-01
category: best-practices
module: e2e tests
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - writing Playwright E2E tests that run longer than SSO session TTL
  - tests involve AI generation steps that take 30-60+ seconds
  - tests perform level 3 auth operations (delete, deploy, unpublish) after long waits
  - upgrading gd-auth or changing SSO expiration behavior
symptoms:
  - "E2E regression tests fail at 100% rate after gd-auth upgrade"
  - "'Sign In Required' modal overlays page, blocking all test interactions"
  - "Tests timeout on selector assertions unrelated to the feature being tested"
root_cause: test_isolation
resolution_type: test_fix
tags:
  - e2e
  - playwright
  - sso
  - session-expiration
  - auth-modal
  - flaky-tests
  - gd-auth
---

# Handle SSO session expiration in long-running E2E tests

## Context

Playwright regression tests against `airo-builder.test-godaddy.com` run as single long flows (create app, chat with AI, verify preview, publish, delete). Each test can take 3-7 minutes. GoDaddy SSO sessions expire during this window, causing the blocking SSO login modal to show a "Sign In Required" prompt when any BFF call returns 401. Without handling this modal, the test fails with confusing selector errors unrelated to the feature being tested.

**Trigger incident:** PR #2471 upgraded gd-auth from 1.4.1 to 1.5.0. The upgrade correctly enforced `useNewExpiration` rules that 1.4.1 silently bypassed due to an option name mismatch. This shifted E2E pass rate from ~50% (already flaky) to 0%. The root cause was the same session expiration issue, but stricter enforcement made it consistent.

**Investigation timeline:**
1. Downloaded test artifacts from GH Actions run 23864995999 -- all screenshots showed "Sign In Required" modal
2. Compared E2E run history: `45ffac9` (before #2471) had 3/6 passes; after, 0/4 passes
3. Initially suspected PR #2342 (grants cleanup) since it was in the same commit range. Exonerated: grants were already ON in production, removing OFF branches is a no-op
4. Identified PR #2471 (gd-auth 1.5.0) as the tipping point via commit bisection

## Guidance

Add reactive auth checkpoints before critical operations that follow long-running steps. The pattern uses role-based modal detection with a short timeout and wraps re-auth in explicit error handling:

```typescript
export async function dismissAuthModalIfPresent(
  page: Page
): Promise<boolean> {
  const signInModal = page.getByRole('heading', {
    name: 'Sign In Required',
  });
  const isVisible = await signInModal
    .isVisible({ timeout: SHORT_TIMEOUT })
    .catch(() => false);

  if (!isVisible) return false;

  console.log(
    '  Warning: "Sign In Required" modal detected'
    + ' -- re-authenticating...'
  );

  const modalSignIn = page.getByRole('button', {
    name: 'Sign In',
    exact: true,
  });
  await modalSignIn.click();
  await handleSsoLogin(page);
  await signInModal.waitFor({
    state: 'hidden',
    timeout: SSO_TIMEOUT,
  });

  console.log('  Re-authenticated successfully');
  return true;
}

export async function ensureAuthenticated(
  page: Page
): Promise<void> {
  const didReauth = await dismissAuthModalIfPresent(page);
  if (didReauth) {
    await verifyAuthenticated(page);
  }
}
```

Place `ensureAuthenticated(page)` calls at natural session-expiry boundaries:
- After AI generation completes (30-60s wait)
- Before delete operations (level 3 auth)
- Before publish verification
- Before page navigations to protected routes after long waits

## Why This Matters

Without this, E2E tests fail intermittently with errors like "button not found" or "element not visible" when the real cause is an auth modal blocking the page. The failures are hard to diagnose because the error message doesn't mention authentication. This pattern converts a flaky, confusing failure into either a clean re-auth or a descriptive error.

The gd-auth 1.5.0 incident showed how a library upgrade can shift flaky tests to consistent failures without any test code changing. The resilience pattern protects against future auth behavior changes.

## When to Apply

- Any Playwright test against deployed environments (test, prod) with real SSO
- Tests with steps that take >30 seconds (AI generation, deployment waits)
- Tests that perform level 3 operations after long waits
- After upgrading gd-auth or changing SSO/auth configuration

Not needed for:
- Unit tests or component tests (no real SSO)
- Short tests that complete within SSO TTL
- Tests against local dev (mock auth, no session expiry)

## Examples

```typescript
// In a smoke test after AI generation
await waitForChatInput(page);
console.log('  AI processing complete');

// Session may have expired during AI generation
await ensureAuthenticated(page);

// Now safe to test preview controls or publish
```

Key design decisions:
- **Reactive, not proactive**: only handles the modal if it already appeared. Proactive session checks would add network round-trips to every checkpoint on the happy path.
- **Role-based selectors**: uses `getByRole('heading', { name: 'Sign In Required' })` which is stable across i18n in the English test environment.
- **<2s overhead on happy path**: `SHORT_TIMEOUT` (2s) check for modal presence when session is valid.
- **Page-level selectors are safe**: the SSO login modal uses UXCore `Modal` with `strategy="fixed"` and no `onClose`, blocking all other page elements.

## Prevention

- New E2E tests with long-running steps should include `ensureAuthenticated()` checkpoints
- When upgrading gd-auth or changing auth config, run E2E suite to verify pass rate doesn't regress
- Monitor E2E pass rate after auth-related PRs (check for shift from flaky to consistent failure)

## Related

- `tests/helpers/auth.ts` -- implementation of helpers
- `tests/regression/develop-chat.spec.ts`, `develop-publish.spec.ts`, `apps-page.spec.ts` -- usage
- PR #2482 -- initial implementation
- PR #2471 -- gd-auth 1.5.0 upgrade that exposed the issue
- PR #2342 -- grants cleanup (initially suspected, exonerated)
- `app/src/components/auth/SsoLogin.tsx` -- the blocking SSO login modal (`strategy='fixed'`); previously `AuthBoundary.tsx`, removed in PR #3085 (Gasket Auth as single source of truth)
- `app/src/lib/gasket-config.ts` -- `appFetch()` 401 detection that triggers the modal
