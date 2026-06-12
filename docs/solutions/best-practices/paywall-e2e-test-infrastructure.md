---
title: E2E testing patterns for silent paywall/credit regressions
date: 2026-06-03
category: best-practices
module: paywall-credit-e2e-infrastructure
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - "Testing payment flows that can't use real transactions"
  - "Testing post-upgrade regressions that lack error signals"
  - "Building account-agnostic E2E tests for monetization surfaces"
  - "Adding data-testid sentinels that ship in the same PR as the tests"
tags:
  - e2e-testing
  - playwright
  - paywall
  - checkout
  - route-interceptor
  - progression-assertions
  - incident-prevention
---

# E2E testing patterns for silent paywall/credit regressions

## Context

The paywall and credit system loads external CDS/UPP bundles from a CDN at runtime. These bundles can fail silently: no thrown error, no failed XHR, just a hung UI. The April 2026 incident (INC6463526) demonstrated this when a Next.js upgrade swapped React internals, causing all checkout flows to hang for 2+ hours with zero error signal. The existing E2E suite only verified that the publish button was visible, not that the cart actually mounted.

The team built comprehensive E2E coverage (PR #4415) using patterns designed to catch this class of silent regression.

## Guidance

### Progression-based assertions (not presence)

A component can be "present" in the DOM while hung. Assert that rendering progressed to completion:

```typescript
// WEAK: passes on a hung modal
await expect(page.getByTestId('cds-paywall-interactive')).toBeVisible();

// STRONG: asserts loading finished, content rendered, no silent errors
await expect(page.getByTestId('cds-paywall-interactive')).toBeVisible();
await expect(page.getByTestId('skeleton-plan-card')).not.toBeVisible();
await expect(page.locator('#paywall-error-title')).not.toBeAttached();
collector.assertClean();
await assertStableReactVersion(page);
```

### Account-agnostic test design

Tests detect account state at runtime and skip gracefully. The CI account is free-tier; paid-account tests skip without failing. No pre-existing app dependencies.

```typescript
const paywallAppeared = await paywallInteractive
  .isVisible({ timeout: 10_000 })
  .catch(() => false);

if (!paywallAppeared) {
  test.skip(true, 'Account is not on free plan; paywall not triggered');
  return;
}
```

### Route interceptors for API contracts

`page.route()` mocks subscription and grants endpoints to test the UI rendering contract without real transactions. Works for client-rendered pages (`"use client"` directive).

```typescript
await page.route('**/api/subscriptions', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: { active: { plan: 'starter', builderEntitlementId: 'ent-test' } },
    }),
  });
});
```

### Deploy-first gate awareness

Tests using new `data-testid` sentinels must go in `tests/e2e/` (deploy-first via `deploy-test-e2e.yml`), not `tests/regression/` (runs against already-deployed env). The regression suite will fail on testids that haven't deployed yet.

### SSO handling: detect then handle

Always check auth state before calling `handleSsoLogin`. Calling it when already authenticated causes a 30s timeout.

```typescript
const ssoResult = await detectSsoType(page, true);
if (ssoResult === 'authenticated') {
  // already logged in, skip
} else if (isSignInUIResult(ssoResult)) {
  await handleSsoLogin(page);
}
```

### Console error collector

Shared helper that listens for specific silent-failure console categories and fails the test if any match.

```typescript
const collector = createConsoleCollector(page);
// ... perform actions ...
collector.assertClean(); // throws if paywall.cds.error etc. detected
```

## Why This Matters

1. Externalized CDN dependencies fail silently. A version mismatch produces no stack trace, just a hung UI.
2. Presence-only assertions create false confidence. The broken CDS bundle left the modal in the DOM but frozen.
3. The April 2026 incident sat in the pipeline 16h before a human noticed. Progression-based E2E assertions would have caught it on the post-merge gate.
4. LLMs make frequent code changes to the paywall system. Without E2E coverage, silent regressions ship undetected.

## When to Apply

- UI surfaces loading external bundles (CDS, analytics, third-party widgets)
- Flows with state progression (modals, multi-step wizards, async data fetches)
- Monetization surfaces where silent failure is revenue-impacting
- Any integration point where failure is a hang or silent no-op rather than a thrown exception
- Tests shipping `data-testid` additions in the same PR as the assertions that use them

## Examples

### Shared app-creation flow with SSO

```typescript
async function createAppAndNavigate(page, promptText) {
  await page.goto('/');
  const promptInput = page.getByTestId('homepage-prompt-input');
  await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
  await dismissOverlays(page);
  await promptInput.fill(promptText);
  const submitButton = page.locator('[data-eid*="homepage.prompt.submit"]');
  await expect(submitButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
  await submitButton.click();

  const ssoResult = await detectSsoType(page, true);
  if (isSignInUIResult(ssoResult)) {
    await handleSsoLogin(page);
  }

  await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
}
```

### Interceptor-based post-purchase contract test

```typescript
await page.route('**/api/credits/grants**', async (route) => {
  await route.fulfill({
    body: JSON.stringify({
      success: true,
      data: [{ type: 'plan-monthly', creditsMax: 150, creditsSpent: 30, isAvailable: true }],
    }),
  });
});

await page.goto('/manage-plan');
const planCard = page.getByTestId('manage-plan-plan-card');
await expect(planCard).toBeVisible();
const planText = await planCard.textContent();
expect(/Starter/i.test(planText!)).toBe(true);
```

## Related

- `docs/solutions/best-practices/e2e-auth-modal-resilience-2026-04-01.md`
- `docs/solutions/best-practices/nextjs16-vendored-react-canary-breaks-cds-upp.md`
- `docs/solutions/best-practices/cds-esm-react19-compat-shims-2026-04-23.md`
- `docs/solutions/workflow-issues/flag-gated-migration-verification-2026-05-18.md`
- `docs/solutions/developer-experience/smoke-test-cds-esm-against-prod-cdn-from-local-dev-2026-05-08.md`
