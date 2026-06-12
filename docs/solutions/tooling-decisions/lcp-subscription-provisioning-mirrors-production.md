---
title: "Make LCP subscription provisioning mirror production mgmt-airo"
date: 2026-05-27
category: tooling-decisions
module: airo-bff, local-dev-tooling
problem_type: tooling_decision
component: development_workflow
severity: medium
applies_when:
  - "Adding dev-specific branching to a service route or handler"
  - "Local control plane subscription missing data that production provides"
  - "File-reading bypass considered for local dev in a hot path"
tags:
  - local-dev
  - architecture-pattern
  - subscription-provisioning
  - dev-production-parity
related_components:
  - "agent-token route (BFF)"
  - "local control plane (LCP)"
  - "dev-runner preflight"
  - "mgmt-airo budget ID provisioning"
---

# Make LCP subscription provisioning mirror production mgmt-airo

## Context

The agent-token route (a critical, heavily-used BFF endpoint) needed `bmsBudgetId` in the JWT for cost attribution. In production, mgmt-airo provisions subscriptions with `bmsBudgetId` pre-bound. Locally, LCP's subscription was created without it because:

1. **Timing race:** `patchLCPSubscription` (HTTP PATCH to LCP) fired during dev-runner preflight before LCP was running, silently failing
2. **Auth rejection:** Under `AUTH_TYPE=jwt`, LCP's gdsso middleware rejected unauthenticated PATCHes to high-risk routes (session history)
3. **Switchboard defaults:** Feature flags defaulted to `false` locally without IAM credentials

Rather than fix these upstream issues, a `readDevBudgetId()` file-reading bypass was added to the route: if `NODE_ENV === 'development'`, read budget ID from `.dev-bms/budget-id` and skip the BMS migration check. A reviewer correctly identified this as unnecessary complexity in a critical route.

## Guidance

**Make local infrastructure serve the same data shape as production.** Instead of adding `if (development)` branching in a route, push the data provisioning into the infrastructure layer (LCP startup, dev-runner preflight) so the route never needs to know which environment it runs in.

For the BMS case: LCP's `EnsureSubscription()` reads `.dev-bms/budget-id` at subscription creation time and reconciles on subsequent calls:

```go
// local-control-plane/internal/store/db.go
func (d *DB) EnsureSubscription(id, customerID string) (*Subscription, error) {
    d.mu.Lock()
    defer d.mu.Unlock()

    sub, err := d.getSubscriptionUnlocked(id)
    if err != nil {
        return nil, err
    }
    if sub != nil {
        if sub.CustomerID != customerID {
            return nil, ErrSubscriptionNotOwned
        }
        // Reconcile bmsBudgetId from file (handles budget recreate or first-run seed failure)
        if fileID := readDevBMSBudgetID(); fileID != "" && fileID != sub.BMSBudgetID {
            now := time.Now().UTC().Format(time.RFC3339)
            _, _ = d.db.Exec(`UPDATE subscriptions SET bms_budget_id = ?, updated_at = ? WHERE id = ?`, fileID, now, id)
            sub.BMSBudgetID = fileID
        }
        return sub, nil
    }

    bmsBudgetID := readDevBMSBudgetID()
    now := time.Now().UTC().Format(time.RFC3339)
    _, err = d.db.Exec(
        `INSERT INTO subscriptions (id, customer_id, bms_budget_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        id, customerID, bmsBudgetID, now, now,
    )
    // ...
}
```

The helper reads the seed file safely:

```go
func readDevBMSBudgetID() string {
    projectRoot := os.Getenv("PROJECT_ROOT")
    if projectRoot == "" {
        projectRoot = ".."
    }
    data, err := os.ReadFile(filepath.Join(projectRoot, ".dev-bms", "budget-id"))
    if err != nil {
        return ""
    }
    id := strings.TrimSpace(string(data))
    if !uuidPattern.MatchString(id) {
        return ""
    }
    return id
}
```

The agent-token route is now 100% production code:

```typescript
// app/src/app/api/auth/agent-token/route.ts
let bmsBudgetId: string | undefined;
const bmsMigrationFlags = {
  budgetServiceEnabled: budgetServiceExperimentEnabled,
  bmsExistingEnabled,
};
if (shouldCheckBmsMigration(bmsMigrationFlags) && subscriptionId) {
  const subscription = await mgmtClient.getSubscription(subscriptionId, { includeAttributes: true });
  const migrationResult = checkBmsMigration(subscription, bmsMigrationFlags);
  if (migrationResult.useBms) {
    bmsBudgetId = migrationResult.bmsBudgetId;
  }
}
```

## Why This Matters

1. **Prevents code path divergence.** The production path is the only path. Bug fixes apply uniformly; you discover mismatches between local and production infrastructure early (wrong data shape) rather than late (production-only bug).

2. **Eliminates the timing/auth class of bugs permanently.** Internal Go function calls (file reads at subscription creation) have no timing dependency on service startup order and no auth middleware. The old HTTP PATCH approach was fragile by construction.

3. **Clarifies ownership.** The infrastructure layer (LCP) owns data provisioning; routes own business logic. Reviewers don't need to reason about which code path runs where.

4. **Self-healing.** The reconciliation on every `EnsureSubscription` call means budget recreation (404 from BMS, dev-runner seeds a new one) and first-run seed failures (AWS SSO expired, file didn't exist yet) recover automatically on the next request without manual intervention (session history).

## When to Apply

Any time you're tempted to add environment-conditional logic in a service route or handler:

- `if (NODE_ENV === 'development')` checks in hot paths
- `if (process.env.LOCAL_DEV)` branching in auth, payment, or data mutation routes
- Reading config files directly in handlers that should get data from a backing service

**The question:** "Can I make the local infrastructure serve the same data shape as production, so the route code doesn't need to know?"

**Common examples:**
- **Database seeding:** Instead of `if (isLocal) readFromFile()` in the handler, seed the data into the database at startup
- **Feature flag defaults:** Instead of hardcoding flag overrides in the route, ensure the flag system provides correct defaults locally
- **Subscription provisioning:** Instead of patching subscriptions from the route, ensure the subscription service creates them correctly

## Examples

**Before (dev-specific bypass in critical route):**
```typescript
// BAD: route knows about its environment
let bmsBudgetId: string | undefined;
const devBudgetId = await readDevBudgetId(); // reads .dev-bms/budget-id
if (devBudgetId) {
  bmsBudgetId = devBudgetId;
  logger.info('agent-token.local-dev-bms-bypass', { bmsBudgetId });
}
if (!bmsBudgetId && shouldCheckBmsMigration(flags) && subscriptionId) {
  // ... production path
}
```

**After (route is environment-agnostic):**
```typescript
// GOOD: route only knows the production contract
let bmsBudgetId: string | undefined;
if (shouldCheckBmsMigration(flags) && subscriptionId) {
  const subscription = await mgmtClient.getSubscription(subscriptionId, { includeAttributes: true });
  const result = checkBmsMigration(subscription, flags);
  if (result.useBms) bmsBudgetId = result.bmsBudgetId;
}
```

The environment-specific behavior lives in LCP (reads seed file at subscription creation), not in the route.

## Related

- Supersedes earlier guidance that recommended a local-dev filesystem service-discovery bypass (reading the seed file directly); this doc replaces that approach.
- `docs/solutions/architecture-patterns/dev-runner-post-boot-service-seeding-2026-05-13.md` (dev-runner lifecycle and seed patterns)
- `docs/solutions/architecture-patterns/preflight-check-fixer-var-sync.md` (env var single-source-of-truth principle)
- `docs/solutions/best-practices/cp-contract-alignment-bms-signup-runtime-gating-2026-04-13.md` (bmsBudgetId as runtime signal)
- PR #3689: `feat(dev-runner): local BMS via subscription path, no agent-token bypass`
