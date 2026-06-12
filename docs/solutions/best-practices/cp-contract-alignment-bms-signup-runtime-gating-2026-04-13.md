---
title: "Separate signup opt-in from runtime gating when integrating with CP for BMS"
date: 2026-04-13
category: best-practices
module: control-plane-integration
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - "Experience team needs to integrate with a new or changed Control Plane API contract"
  - "Multiple services (signup, JWT, agent, grants) must coordinate around a shared external identifier"
  - "An existing plan uses placeholder values that must be replaced with real CP-provided fields"
  - "Migrating runtime BMS gating from feature flags to data-driven signals"
tags:
  - cross-team-contract
  - control-plane
  - bms
  - budget-service
  - signup-payload
  - jwt-claims
  - grant-integration
  - api-contract
  - feature-flag-migration
  - switchboard
---

# Separate signup opt-in from runtime gating when integrating with CP for BMS

## Context

The Agent/Experience team built BMS integration (Units 0-8 of the Stream 1 plan) using `subscriptionId` as a proxy for the BMS budget ID, gated by Switchboard flag `app-builder-budget-service`. The plan noted at line 221: "Plan notes `bmsBudgetId` will be a separate field on subscription once control plane adds it. For now 1:1 mapping via `subscriptionId`."

On 2026-04-13, Jeremy Lindblom (Control Plane team) confirmed the CP contract in Slack (airo-ai-builder-squad-paywall), introducing three new fields across three API surfaces. This created a concrete integration point requiring alignment of types, signup payloads, JWT claims, and runtime gating logic across the `app/` BFF, `agents/` service, and shared types.

A prior bug (PR #2532 review, 2026-04-06) had already demonstrated the risk of the `subscriptionId` stand-in: `budgetServiceEnabled` propagated from JWT but `subscriptionId` came from the app DB record, which can be stale or literal `'not-provided'` (from `AppRepository.ts:133`). (session history)

## Guidance

**Separate the enrollment signal (feature flag at signup) from the runtime behavior signal (data field on subscription).** Feature flags control who gets enrolled; data drives runtime paths.

The confirmed CP contract introduces three fields:

1. **Signup request**: `bmsActive: boolean` -- sent when Switchboard flag `app-builder-budget-service` is on. Tells CP to provision a BMS budget for the new subscription.

2. **Subscription response**: `bmsBudgetId: string (UUID)` -- the canonical runtime signal. Present = BMS path; null/absent = legacy GoCode/Grants path. Replaces the pattern where `subscriptionId` doubled as the budget ID.

3. **Grants response**: `bmsBudgetItemId: string (UUID)` -- coexists with `llmBudgetId` until full GoCode migration. Join logic needs to support both.

**Two-phase migration:**

- **Rollout**: Switchboard controls whether `bmsActive: true` is sent at signup. Runtime checks `bmsBudgetId` presence (not the flag). Both `llmBudgetId` and `bmsBudgetItemId` coexist on grants.
- **Steady state**: Switchboard flag removed. `bmsBudgetId` is the only BMS signal. `bmsBudgetItemId` replaces `llmBudgetId` after full GoCode migration.

**When a dependency team publishes new fields, map each field to every touchpoint before coding.** The CP contract touched: mgmt-airo types, signup adapter, JWT claims config, JWT service, agent JWT validator, budget pre-check, and credit status join.

## Why This Matters

Using a feature flag as both opt-in and runtime gate creates coupling: you cannot incrementally migrate users. If a flag controls runtime behavior, flipping it affects all users simultaneously. Separating concerns lets you:

- Enroll new signups into BMS gradually while existing users stay on GoCode
- Avoid checking a remote flag service on every agent request (JWT claim carries the answer)
- Retire the flag without a coordinated big-bang cutover
- Prevent the `budgetId: subscriptionId` conflation in `agents/src/server/budget-pre-check.ts:66`, which assumes a 1:1 mapping that won't hold with real CP-provided UUIDs

## When to Apply

- A dependency team publishes a new API contract that introduces fields your code consumes
- Migrating from feature-flag-gated behavior to data-driven runtime behavior
- A shared identifier (like `subscriptionId`) is used as a stand-in for a dedicated field
- Fields from different API surfaces (signup request, subscription response, grants response) need to be threaded through multiple layers (BFF types, JWT claims, agent service)
- Two field names coexist during migration (e.g., `llmBudgetId` and `bmsBudgetItemId`)

## Runtime Safety Guard

Before the CP contract lands `bmsBudgetId`, a Switchboard flag (`app-builder-budget-service`) can resolve `true` even when `adapter.getSite()` rejects or returns a site without `subscription_id`. Without a guard, the agent token is signed with `{ budgetServiceEnabled: true, subscriptionId: undefined }`, causing `getBudget(undefined)` to fail downstream.

**Pattern:** validate the required dependency before committing to the flag-enabled path. If missing, warn and fall back to the grants path.

```typescript
// agents/src/server/routes/agent-token/route.ts
if (budgetServiceEnabled && !subscriptionId) {
  logger.warn('agent-token.budget-service.missing-subscription-id', {
    siteId: body.siteId, customerId: user.customerId
  });
  budgetServiceEnabled = false;
}
```

**Tests:**

```typescript
it('should pass budgetServiceEnabled and subscriptionId when flag is on and site has subscription', async () => {
  mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
    Promise.resolve(flag === 'app-builder-budget-service')
  );
  mockControlPlaneAdapter.getSite.mockResolvedValue({ subscription_id: 'sub-123' });
  // asserts { budgetServiceEnabled: true, subscriptionId: 'sub-123' }
});

it('should fall back to budgetServiceEnabled=false when subscriptionId is missing', async () => {
  mockCheckSwitchboardFlag.mockImplementation((flag: string) =>
    Promise.resolve(flag === 'app-builder-budget-service')
  );
  mockControlPlaneAdapter.getSite.mockResolvedValue({});
  // asserts { budgetServiceEnabled: false, subscriptionId: undefined }
});
```

**Post-CP-contract evolution:** The guard pattern remains valid but the condition shifts from `budgetServiceEnabled && !subscriptionId` to checking whether `bmsBudgetId` is present but malformed (e.g., not a valid UUID). The fail-safe principle is the same: if the data required to enter the budget path is absent/invalid, warn and fall back to grants.

**General prevention rule:** When a feature flag enables a code path that depends on external data, validate the dependency before committing to the path: `if (flagEnabled && !requiredDependency) { warn(); flagEnabled = false; }`. Test both the happy path (flag + dependency present) and the fallback (flag without dependency).

(Originally documented in PR #2455 on `feat/budget-service-client`.)

## Examples

**Signup opt-in via Switchboard flag:**

```typescript
// v2-control-plane-adapter.ts -- createSite()
// BEFORE: fixed signup payload
const response = await client.signup({
  datacenter,
  isTrial: true,
  productId,
  initialPrompt: params.prompt,
  appConfigs: [{ ... }]
});

// AFTER: conditionally include bmsActive
const response = await client.signup({
  datacenter,
  isTrial: true,
  productId,
  ...(budgetServiceEnabled && { bmsActive: true }),
  initialPrompt: params.prompt,
  appConfigs: [{ ... }]
});
```

**Runtime gating on subscription data, not feature flag:**

```typescript
// agents/src/server/budget-pre-check.ts
// BEFORE (stand-in)
return {
  budgetId: subscriptionId,  // subscriptionId != BMS budget ID
  sessionId: session.sessionId,
};

// AFTER (real BMS budget ID from JWT claim, sourced from subscription)
return {
  budgetId: bmsBudgetId,  // UUID from CP subscription
  sessionId: session.sessionId,
};
```

**Dual grant field coexistence:**

```typescript
// app/src/app/api/credits/status/route.ts -- enrichBudgetResponse()
// BEFORE: only llmBudgetId
for (const grant of grants) {
  if (grant.llmBudgetId) grantsByBudgetItemId.set(grant.llmBudgetId, grant);
}

// AFTER: prefer bmsBudgetItemId, fall back to llmBudgetId
for (const grant of grants) {
  const key = grant.bmsBudgetItemId || grant.llmBudgetId;
  if (key) grantsByBudgetItemId.set(key, grant);
}
```

**Type additions:**

```typescript
// app/src/lib/mgmt-airo/types.ts
export interface AiroSignupPayload {
  // ...existing
  bmsActive?: boolean;  // NEW: opt-in for BMS budget provisioning
}

export interface AiroSubscription {
  // ...existing
  bmsBudgetId?: string;  // NEW: present = BMS-enrolled
}

export interface AiroCreditGrant {
  // ...existing
  llmBudgetId: string;        // stays until GoCode migration
  bmsBudgetItemId?: string;   // NEW: coexists with llmBudgetId
}
```

## Related

- [Dual-path feature flag pattern](dual-path-feature-flag-react-query-websocket-2026-04-09.md) -- frontend dual-path gating using the Switchboard flag
- [Feature flag WebSocket relay pattern](../developer-experience/feature-flag-websocket-relay-pattern-2026-03-31.md) -- superseded WS-based budget_context approach (replaced by JWT claims)
- [BFF parallel fetch enrichment](bff-parallel-fetch-enrichment-2026-04-07.md) -- grant-to-budget join using `llmBudgetId` (affected by `bmsBudgetItemId` addition)
- Budget service enabled without subscription ID (PR #2455) -- prior bug from `subscriptionId` stand-in pattern, now merged into [Runtime Safety Guard](#runtime-safety-guard) above
- [BFF budget client stale field names](../integration-issues/bff-budget-client-stale-field-names-2026-04-07.md) -- field name drift between shared types and BFF client

## Test Account Setup (2026-04-17)

BMS experience side isn't fully wired up yet. To create a BMS-enabled test account:

1. Create a new GoDaddy test account
2. Add the shopperId to switchboard allowlist: `https://switchboard.int.test-gdcorp.tools/airo-app-builder/sync/app-builder-budget-service` (cache takes up to 5 minutes)
3. Go to `https://airo-builder.test-godaddy.com`, create a new app via quick-create
4. Quick-create calls BFF signup with `bmsActive: true`, which provisions a `bmsBudgetId` on the subscription

**Access:** requires `DEV-Airo-Builders` AD group membership for switchboard and test env access.

## Status Update (2026-06-11)

Landed. The CP contract fields are live: `bmsActive` (signup) and `bmsBudgetId` (runtime) are on the mgmt-airo subscription type (`app/src/lib/mgmt-airo/types.ts`). `agents/src/server/budget-pre-check.ts` now reads `bmsBudgetId` directly with a guard when it is missing -- the `subscriptionId` stand-in is gone. The runtime gate keys on `bmsBudgetId` presence, not the Switchboard flag, as designed above.

Prior status (2026-04-15): integration was in progress and deploy was blocked by the Next.js 16/UPP rollback.
