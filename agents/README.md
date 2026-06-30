# @airo/agents

Express API service providing AI agent orchestration, app lifecycle management, WebSocket streaming, and SQLite persistence. Runs on port 4000.

## Quick Start

```bash
# From repo root
corepack enable
pnpm install
pnpm run dev          # TUI with all services (agents, app, control plane)
```

Or run agents alone:

```bash
pnpm run dev:agents
```

## Testing

Uses Vitest (not Jest).

```bash
pnpm --filter @airo/agents test:unit              # All unit tests
pnpm --filter @airo/agents test:unit "pattern"     # Filter by file path
pnpm --filter @airo/agents test:unit -t "test name" # Filter by test name
pnpm --filter @airo/agents test:integration        # Integration tests (need running services)
```

## Environment

Run `pnpm run dev` from the repo root — preflight checks will generate `agents/.env` automatically. See `agents/.env.example` for available variables.

## Controlled Feature Rollouts

The agents service has a lightweight, deterministic rollout system for gating features to a controlled percentage of apps. Rollout percentages can be adjusted at runtime via **Switchboard** — no redeploy needed.

### How it works

Resolution order for each `isFeatureEnabled` call:

1. **Switchboard** — flag `rollout.<featureName>` (number type). If set, this wins over the code config. Value `0` = disabled for everyone. Value `1–100` = enabled at that percent.
2. **`ROLLOUTS` registry** (`src/config/feature-rollouts.ts`) — code-level default, used when no Switchboard flag is configured.

Bucketing is deterministic: a SHA-256 hash of `"<featureName>:<appId>"` is reduced to a bucket 0–99. If the bucket is below the effective `rolloutPercent`, the feature is on. The feature name in the key means the same app lands in an **independent bucket for every feature** — being in the 10% cohort for feature A does not put it in the 10% cohort for feature B.

```
hash("new-checkout:abc1234xyz") → bucket 73 → 73 < 20? → disabled
hash("new-sidebar:abc1234xyz")  → bucket  4 →  4 < 20? → enabled
```

### Adding a feature rollout

**1. Register it** in [`src/config/feature-rollouts.ts`](src/config/feature-rollouts.ts):

```typescript
export const ROLLOUTS = {
  'my-new-feature': {
    description: 'Short description of what this rollout controls',
    rolloutPercent: 0,   // start at 0, increase gradually
    enabled: false,      // flip to true when ready to begin rollout
  },
};
```

**2. Gate your code** using `isFeatureEnabled`:

```typescript
import { isFeatureEnabled } from '../../lib/feature-rollouts.js';

// context.metadata.appId is available in tools, agents, and services
if (isFeatureEnabled('my-new-feature', context.metadata.appId)) {
  // new code path
} else {
  // existing code path
}
```

**3. Roll out** by increasing `rolloutPercent` in `feature-rollouts.ts`, or by setting the Switchboard flag (see below). A 10% rollout exposes the feature to ~10% of apps, always the same apps for the same feature name.

**4. Clean up** once fully rolled out: remove the `isFeatureEnabled` guard, delete the old code path, and remove the entry from `feature-rollouts.ts`.

### Adjusting rollouts via Switchboard (no redeploy)

Create a flag named `rollout.<featureName>` as a **number** type in the `airo-app-builder` Switchboard app:

| Value | Effect |
|-------|--------|
| `-1` (default) | No override — uses `ROLLOUTS` code config |
| `0` | Kill-switch — disabled for all apps immediately |
| `1–100` | Overrides rollout percent to that value |

Flag changes propagate within ~2 minutes (Switchboard cache refresh).

**Switchboard environments:**

| Env | URL |
|-----|-----|
| dev | https://switchboard.int.dev-gdcorp.tools/airo-app-builder |
| test | https://switchboard.int.test-gdcorp.tools/airo-app-builder |
| prod | https://switchboard.int.gdcorp.tools/airo-app-builder |

**Example:** To immediately disable `my-new-feature` in production without a deploy, set `rollout.my-new-feature = 0` in the prod Switchboard environment. To re-enable at 25%, set it to `25`. To hand control back to the code config, delete the flag or set it to `-1`.

### Observability

`isFeatureEnabled` automatically records the result as an OTel span attribute on the currently active span:

```
rollout.my-new-feature = "enabled"   // or "disabled"
```

At the start of each agent turn, all registered rollouts are pre-populated on the turn span via `recordRolloutsOnSpan` — so every span in Grafana carries the full rollout picture for that app, even for features the turn never explicitly checked (once rollouts are registered; the registry ships empty). Use these attributes to filter and group results in LogQL / your OTLP backend.

### Key files

| File | Role |
|------|------|
| [`src/config/feature-rollouts.ts`](src/config/feature-rollouts.ts) | Rollout registry — the only file you edit to add/remove rollouts |
| [`src/lib/feature-rollouts.ts`](src/lib/feature-rollouts.ts) | `isFeatureEnabled()` and `recordRolloutsOnSpan()` |
| [`src/services/switchboard.ts`](src/services/switchboard.ts) | Switchboard client (`getSwitchboardValue`) |


## Reference

See [agents/CLAUDE.md](CLAUDE.md) for detailed documentation covering agent selection, prompt composition, tool system, database schema, observability, and security.
