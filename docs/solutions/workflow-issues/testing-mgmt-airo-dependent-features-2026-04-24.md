---
title: Testing frontend features dependent on mgmt-airo backend state
date: 2026-04-24
category: workflow-issues
module: testing
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - frontend feature depends on mgmt-airo subscription attributes
  - local control plane does not register with mgmt-airo
  - PR branch code must be tested against real backend state before merge
tags:
  - testing
  - local-test
  - mgmt-airo
  - subscriptions
  - hosts-file
  - hybrid-testing
---

# Testing frontend features dependent on mgmt-airo backend state

## Context

Frontend features sometimes depend on specific backend state from mgmt-airo that the local control plane cannot provide. The local control plane (SQLite + Docker) creates apps locally but does not register with mgmt-airo, so subscriptions created locally lack attributes, grants, and other service-provisioned data.

The deployed test environment has the correct backend state but runs the main branch, not PR branches. This creates a gap: you need PR code running against real backend state.

Discovered while testing PR #3113 (conversion event for free trial signup), which required a subscription with a `free-plan` attribute containing `orderId` and null `conversionEventDate`.

## Guidance

**The /etc/hosts toggle pattern** splits backend state setup (real test env) from frontend code testing (local:test with PR branch).

### Step 1: Create backend state on the real test env

1. Comment out the hosts entry: `# 127.0.0.1 airo-builder.test-godaddy.com`
2. Navigate to `https://airo-builder.test-godaddy.com` in the browser
3. Log in with a test-godaddy.com account (create one if needed)
4. Perform the action that triggers backend provisioning (e.g., create an app to trigger mgmt-airo subscription creation with attributes)
5. Verify the backend state exists (check `/api/subscriptions` response for expected data)

### Step 2: Switch to local frontend on PR branch

1. Uncomment the hosts entry: `127.0.0.1 airo-builder.test-godaddy.com`
2. Start (or restart) `pnpm run local:test` on the PR branch
3. Ensure `MGMT_AIRO_BASE_URL` in `app/.env.local` is commented out (defaults to `https://mgmt.nstk.net`, the remote test control plane)

### Step 3: Test the feature

1. Navigate to `https://airo-builder.test-godaddy.com` in the same browser
2. Auth cookies persist across the toggle (same domain)
3. Frontend serves PR branch code; API calls reach real mgmt-airo with provisioned data

## Why This Matters

- Local control plane cannot replicate mgmt-airo provisioning logic (attributes, metadata, relationships)
- The domain stays the same across the toggle, so SSO cookies survive
- Subscription data is customer-scoped in mgmt-airo and persists regardless of which frontend serves requests
- No deployment required to test PR branch code against real backend state

## When to Apply

Use this pattern when:
- Feature depends on data from mgmt-airo (subscriptions, attributes, grants)
- The data is created by service-side provisioning (not local database records)
- You need to test PR branch code before merging

Do not use when:
- Feature can be tested with local stubs (`pnpm run dev`)
- Backend changes are in the same PR (deploy both to test env together)
- Testing pure UI changes with no backend state dependency

## Examples

**PR #3113: conversion event for free trial signup**

The `useConversionEvent` hook required a subscription with:
- `attributes` containing `key: "free-plan"`
- `value.orderId` populated
- `value.conversionEventDate` set to null (not yet acknowledged)

**What didn't work:**
- Creating an app on local:test with a new account: local control plane doesn't register with mgmt-airo, `/api/subscriptions` returned empty (403 from mgmt-airo for unregistered customer)
- Testing on deployed test env directly: runs main branch, PR frontend code not present

**What worked:**
1. Commented out hosts entry, navigated to real test env
2. Created new test account, created an app (triggered mgmt-airo subscription with `free-plan` attribute)
3. Uncommented hosts entry, restarted `pnpm run local:test` on PR branch
4. Loaded develop page. Verified:
   - `/api/subscriptions` returned subscription with `attributes: [{key: "free-plan", orderId: "2210598176"}]`
   - `useConversionEvent` hook executed correctly
   - `_signalsDataLayer.push()` accepted conversion event
   - `/api/subscriptions/acknowledge` POST set `conversionEventDate`
   - Subsequent page loads correctly skipped (already acknowledged)

## Related

- [Local test with local agents setup](../workflow-issues/local-test-with-local-agents-2026-03-31.md)
- [Local dev and test startup guide](../developer-experience/local-dev-and-test-startup-guide-2026-04-21.md)
- [Gasket/Next.js local testing constraints](../developer-experience/gasket-nextjs-local-testing-constraints-2026-03-31.md)
- [Signals data layer conversion event pattern](../design-patterns/signalsdatalayer-conversion-event-pattern-2026-04-23.md)
