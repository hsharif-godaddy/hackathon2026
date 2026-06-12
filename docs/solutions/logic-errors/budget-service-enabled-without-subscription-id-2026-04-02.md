---
title: BMS gating fails safe to GoDaddy-billed when bmsBudgetId is absent
date: 2026-06-11
last_updated: 2026-06-11
category: logic-errors
module: agent-token route
problem_type: logic_error
component: authentication
severity: medium
symptoms:
  - paid budget tracking could enable without the identifier it requires
  - agent enters BMS code path with no budget id to bill against
  - cost lands on the wrong payer when enablement and identity disagree
root_cause: missing_validation
resolution_type: code_fix
tags:
  - budget-service
  - bms
  - agent-token
  - jwt
  - fail-safe
  - feature-flag-dependency
---

# BMS gating fails safe to GoDaddy-billed when bmsBudgetId is absent

## Context / Problem

The agent-token route (`app/src/app/api/auth/agent-token/route.ts`) decides whether an agent runs under BMS (Budget Management Service, paid per-customer budget tracking) or falls back to GoDaddy-billed grants. The hazard is constant across every implementation: never sign a JWT that enables paid budget tracking without the identifier that path needs to bill correctly. Enable BMS without a valid budget id and the agent enters the BMS code path with nothing to charge against, so cost lands on the wrong payer.

## Root Cause

Enablement and the required billing identity are two separate signals. If a code path commits to "BMS on" before confirming the identity exists, a lookup failure, a missing attribute, or an in-progress migration leaves the JWT claiming BMS while the identifier is undefined.

### Prior implementation (Switchboard flag + subscriptionId guard)

The original route keyed enablement on the `app-builder-budget-service` Switchboard flag and a `subscriptionId` resolved from the site. A trailing guard caught the mismatch:

```typescript
if (budgetServiceEnabled && !subscriptionId) {
  logger.warn('agent-token.budget-service.missing-subscription-id', { ... });
  budgetServiceEnabled = false;
}
```

That guard no longer exists. The `missing-subscription-id` log string is gone. The route was rewritten so enablement is driven by BMS budget identity plus cohort plus a migration check, not by a flag + subscriptionId pairing.

## Solution

### Current gating (bmsBudgetId presence + cohort + migration check)

Enablement is keyed on `bmsBudgetId` presence, gated by Hivemind cohort and a three-lever migration check. Flow in `route.ts`:

1. Switchboard `app-builder-budget-service` and `app-builder-bms-existing` resolve to booleans (fail-closed to `false` on rejection via `resolveBooleanFlag`).
2. The new-user flag is intersected with the Hivemind cohort: `budgetServiceEnabled = isBudgetServiceExperimentTreatment(switchboardEnabled, cohort)`. The JWT reflects experiment treatment, not raw Switchboard.
3. `shouldCheckBmsMigration(flags)` returns true if either `budgetServiceEnabled` (new users) or `bmsExistingEnabled` (migrated users) is set. The migration check only runs when that is true AND a `subscriptionId` exists.
4. The subscription is fetched (`mgmtClient.getSubscription(subscriptionId, { includeAttributes: true })`) and passed to `checkBmsMigration(subscription, flags)` in `app/src/lib/bms-migration/index.ts`.
5. `checkBmsMigration` returns `useBms` only when `bmsBudgetId` is present AND the migration state matches the enabling flag:
   - No `bmsBudgetId` → `useBms: false`, reason `no-bms-budget-id`.
   - New user (no migration attribute) → requires `budgetServiceEnabled`.
   - Existing user, `migrationDate` set → requires `bmsExistingEnabled`.
   - Existing user, `migrationDate` null (in progress) → `useBms: false`, reason `migration-in-progress`.
6. Only when `useBms` is true does the route set `bmsBudgetId = result.bmsBudgetId` and `budgetServiceEnabled = true`. Both ride in the JWT together.

### Fail-safe path

On the disabled branch and the catch branch, `bmsBudgetId` stays `undefined` and `budgetServiceEnabled` is set to `false` (route.ts ~lines 499-517):

```typescript
} else {
  budgetServiceEnabled = false;          // bms-disabled
} catch (err) {
  // bmsBudgetId stays undefined → cost assigned to GoDaddy
  budgetServiceEnabled = false;          // bms-budget-id-fetch-failed
}
```

A subscription fetch failure, a missing budget id, or a mismatched migration state all collapse to the same safe state: no `bmsBudgetId`, BMS off, cost billed to GoDaddy via grants. The two signals can never disagree in the JWT.

## Prevention

- Keep paid-billing enablement and the billing identifier coupled: derive `budgetServiceEnabled` from the same check that produces `bmsBudgetId`, so the JWT can never claim BMS without an id.
- Default to the unpaid path on any failure. A subscription lookup that throws, a null attribute, or an in-progress migration must all fall back to GoDaddy-billed, not enable BMS on faith.
- Gate the expensive identity lookup behind a cheap flag check (`shouldCheckBmsMigration`) so the fail-safe is also the cheap default.
- Each disabled branch logs a distinct `reason` (`no-bms-budget-id`, `migration-in-progress`, `existing-user-flag-disabled`, `new-user-flag-disabled`, `bms-budget-id-fetch-failed`) for observability without a dedicated mismatch warning.

## Related

- `app/src/lib/bms-migration/index.ts` — `checkBmsMigration`, `shouldCheckBmsMigration`, `getMigrationDate`
- [CP contract alignment](../best-practices/cp-contract-alignment-bms-signup-runtime-gating-2026-04-13.md) — the predicted shift from flag-based to data-based runtime gating, now shipped
- [Feature flag guard replacement](../best-practices/feature-flag-guard-replacement-2026-03-30.md) — "was the flag a proxy for a capability check?"
- PR #3036 — rewrote the route to BMS budget-id + migration-check gating, removing the flag + subscriptionId guard
