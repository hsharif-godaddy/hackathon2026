---
title: "Local BMS seeding via dev-runner preflight + LCP subscription provisioning"
date: 2026-06-11
last_updated: 2026-06-11
category: architecture-patterns
module: dev-runner, local-control-plane
problem_type: architecture_pattern
component: development_workflow
severity: medium
applies_when:
  - "local dev needs a budget seeded for BMS cost attribution"
  - "seed/setup work must happen before managed processes boot"
  - "an infra dependency must hand data to a long-running service without dev-only branching in that service"
tags:
  - dev-runner
  - preflight
  - budget-service
  - bms
  - seeding
  - local-control-plane
  - dev-production-parity
related_components:
  - local-control-plane
  - budget-service
  - dev-runner preflight
---

# Local BMS seeding via dev-runner preflight + LCP subscription provisioning

## Context

Local dev needs a budget so BMS cost attribution works end to end. The current design seeds against the REMOTE dev BMS (`https://budget-service.api.int.dev-godaddy.com`) during dev-runner preflight, then hands the budget ID to the local-control-plane (LCP) subscription via a shared file. Budget-service is NOT a dev-runner-managed local process and there is no local BMS to boot.

This replaced an earlier abandoned design (see below) that tried to run BMS locally and seed it after boot with a wrapper script.

## Solution

### Seed against the remote dev BMS in a preflight check + fixer pair

Seeding is an infra concern that can be fully resolved before any managed process starts, so it lives in the dev-runner preflight Check/Fixer framework, not in a post-boot script.

- Check: `dev-runner/internal/preflight/checks/bms_remote_seed.go` (`BMSRemoteSeedCheck`). Reads `.dev-bms/budget-id`, fetches the budget from remote BMS to confirm it still exists, and warns if credits are exhausted. Missing file, empty file, 404, or exhausted credits all return `FixAvailable: true`.
- Fixer: `dev-runner/internal/preflight/fixers/bms_remote_seed.go` (`BMSRemoteSeedFixer`). Acquires an S2S token, tops up an existing budget when present, otherwise creates a new one (`POST /api/v1/budgets`), then writes the returned `budgetId` to `.dev-bms/budget-id`. A 404 on top-up falls through to create. It records outcome in `.dev-bms/seed-status`.
- Registration: `dev-runner/internal/tui/model.go` `buildPreflightRunner()`, under `CategoryServices`, alongside `PortCheck` and `MySQLCheck`.
- Constants: `dev-runner/internal/preflight/bms.go` defines `BMSDevBudgetIDFile = ".dev-bms/budget-id"`, `BMSSeedStatusFile = ".dev-bms/seed-status"`, `BMSRemoteBaseURL`.

The `.dev-bms/budget-id` file is the contract between dev-runner (writer) and LCP (reader). No HTTP handoff, so no startup-ordering race.

### LCP reads the budget ID file when provisioning a subscription

LCP binds the budget ID into the subscription so the BFF agent-token route gets `bmsBudgetId` in the JWT with the same data shape as production mgmt-airo, no dev-only branching in the route.

- `local-control-plane/internal/store/db.go`: `readDevBMSBudgetID()` reads `.dev-bms/budget-id` (via `PROJECT_ROOT`), validates it as a UUID.
- `EnsureSubscription()` writes that ID into the `subscriptions` row on first create, and reconciles it on subsequent calls when the file changes (covers budget recreate or a first-run seed failure that later succeeds).

See `docs/solutions/tooling-decisions/lcp-subscription-provisioning-mirrors-production.md` for why this provisioning lives in LCP rather than as a dev-only route bypass.

### Durable heuristics (preserved from prior design)

These held up and still apply:

1. Verify API contracts against the running service before coding against them. BMS does not expose a budget list endpoint (need the stored ID for idempotency), creates items inline with the budget, and returns `budgetId` not `id`. The check/fixer structs match those real shapes.
2. Place config overrides AFTER flag resolution. A local bypass assigned before `resolveBooleanFlag()` is dead code because the resolver overwrites it. Override after resolution, gated on the local env.
3. Preflight handles infra-only concerns. Anything checkable and fixable before processes boot (Docker container, env file, port availability, and now remote budget seeding) belongs in preflight. Per-process runtime state does not.

## Why This Matters

- File-based handoff over HTTP handoff: writing `.dev-bms/budget-id` during preflight, before LCP starts, removes the startup-ordering race that an HTTP PATCH to a not-yet-running LCP suffered (it failed silently and the BMS flow fell back to grants mode).
- Reconciliation on read: `EnsureSubscription()` re-reading the file means a recreated budget or a recovered first-run seed failure self-heals on the next subscription touch, with no manual DB edit.
- Parity over branching: provisioning the subscription in LCP keeps the agent-token route environment-agnostic, avoiding `if (development)` complexity in a critical, heavily-used endpoint.

## When to Apply

- Seeding or provisioning data that a local service needs but that can be prepared before boot: prefer a preflight check/fixer over a post-boot script.
- Handing data from a setup step to a long-running service: prefer a file the service reads at the relevant moment over an HTTP push during startup.
- Bypassing feature flags or config in local dev: override after resolution, never before.
- Integrating against an internal service API for the first time: confirm shapes with curl first.

## Abandoned prior design

The original approach assumed a LOCAL budget-service managed by dev-runner, seeded after boot. It proposed a `budget-service/scripts/dev-start.sh` wrapper that forked a `seed_after_healthy` background job then `exec make dev`, plus an HTTP PATCH to the LCP subscription, plus preflight model files (`BMSPostgresCheck`/`BMSEnvCheck`/`bms_seed_status.go`).

None of it shipped. There is no `dev-start.sh` in the tree, no "Budget Service" entry in `dev-runner.yml`, and those model files do not exist. The post-boot wrapper carried real hazards (the foreground PID had to be the service, not a seed-waiting shell, or SIGTERM would orphan it) that the preflight + file-handoff design sidesteps entirely. PR #3689 superseded it with the remote-seed plus subscription-path approach (no agent-token bypass).

## Related

- `dev-runner/internal/preflight/checks/bms_remote_seed.go`: `BMSRemoteSeedCheck`
- `dev-runner/internal/preflight/fixers/bms_remote_seed.go`: `BMSRemoteSeedFixer`
- `dev-runner/internal/preflight/bms.go`: file path + remote base URL constants
- `dev-runner/internal/tui/model.go`: `buildPreflightRunner()` registration (CategoryServices)
- `local-control-plane/internal/store/db.go`: `readDevBMSBudgetID()`, `EnsureSubscription()`
- `docs/solutions/tooling-decisions/lcp-subscription-provisioning-mirrors-production.md`: LCP subscription provisioning over dev-only route bypass
- PR #3689: local BMS via subscription path, no agent-token bypass
