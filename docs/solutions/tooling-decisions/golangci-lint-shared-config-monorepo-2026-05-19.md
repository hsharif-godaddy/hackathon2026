---
title: Shared golangci-lint config for Go monorepo services
date: 2026-05-19
category: tooling-decisions
module: golangci-lint
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - Multiple Go services in a monorepo share near-identical lint configs
  - golangci-lint v2 with directory-walk config resolution
  - Adding a new Go service that should inherit team standards
tags:
  - go
  - linting
  - monorepo
  - golangci-lint
  - config-consolidation
  - gocyclo
---

# Shared golangci-lint config for Go monorepo services

## Context

8 Go services each maintained independent `.golangci.yml` files. Two services (budget-service and local-control-plane) had nearly identical 7-linter configs with the same settings, exclusion presets, and formatter. Creating yet another per-service config for a new service was the trigger to consolidate.

Key discovery: golangci-lint v2 does NOT merge configs. It walks up directories, finds the first `.golangci.yml`, and stops. A local config completely replaces root. There is no `extends:`, `includes:`, or inheritance mechanism.

This eliminated the "thin override" approach (local config that only disables extra linters) because a local file with just `linters.disable: [revive]` would silently drop all root linters.

## Guidance

Place one `.golangci.yml` at repo root with the shared linter set. Services that match the standard delete their local configs entirely. Services with genuinely different requirements (golden 50+ linter configs) keep full local files that take precedence via directory-walk.

**Root config contents:**
- Shared linter list (the team's baseline standard)
- Shared settings (thresholds, disabled checks)
- Path exclusions from ALL consuming services (harmless for non-matching services since golangci-lint silently ignores rules that don't match files)
- Shared formatter

**Do NOT inflate root thresholds to accommodate outlier services.** Refactor high-complexity functions to meet the standard instead of codifying technical debt as the org default.

**Prettier gotcha:** pre-commit hooks running prettier on `.yml` files strip inline YAML comments. Put comments on their own line above the value, not inline after it.

## Why This Matters

- Eliminates config drift between services with identical requirements
- New services inherit sane defaults without boilerplate
- Forces intentional choice: services that differ must maintain a full config (making the divergence visible)
- The "thin override" trap is invisible and dangerous: a minimal local config that replaces rather than extends can silently drop linters without any CI signal

## When to Apply

- 2+ Go services have near-identical golangci-lint configs
- Adding a new Go service to the monorepo
- Standardizing lint thresholds across services (e.g., aligning gocyclo)

**Keep separate local configs when:**
- A service has a genuinely stricter lint profile (50+ golden linters)
- A service has experimental linters that shouldn't leak to the rest of the repo
- Services are at different maturity levels during a gradual ramp-up

## Examples

### Before: duplicated configs

```yaml
# budget-service/.golangci.yml (80 lines)
version: "2"
linters:
  enable: [errcheck, govet, staticcheck, revive, gocritic, gocyclo, gosec]
  settings:
    gocyclo:
      min-complexity: 41  # inflated to accommodate tech debt

# local-control-plane/.golangci.yml (86 lines, nearly identical)
version: "2"
linters:
  enable: [errcheck, govet, staticcheck, revive, gocritic, gocyclo, gosec]
  settings:
    gocyclo:
      min-complexity: 25
```

### After: shared root config

```yaml
# .golangci.yml (repo root, 104 lines)
version: "2"
linters:
  enable: [errcheck, govet, staticcheck, revive, gocritic, gocyclo, gosec]
  settings:
    gocyclo:
      min-complexity: 25  # team standard, not inflated for outliers
  exclusions:
    rules:
      # budget-service paths (harmless for other services)
      - path: 'cmd/dev-budget-ui/'
        linters: [gosec]
        text: 'G112'
      # local-control-plane paths (harmless for budget-service)
      - path: 'internal/docker/'
        linters: [gosec]
        text: 'G204|G702|G703|G306'
```

```bash
# budget-service/.golangci.yml — deleted
# local-control-plane/.golangci.yml — deleted
```

### Refactoring to meet shared threshold

Four budget-service functions exceeded gocyclo=25 (at 40, 32, 29, 26). Each was reduced by extracting logical phases into helpers:

| Function | Before | After | Approach |
|----------|--------|-------|----------|
| `CreateSessionReport` | 40 | 25 | Extract per-line-item processing, allocation insertion, exhaustion state, outbox events |
| `run()` cmd/server | 32 | 18 | Extract init phases (OTel, database, auth, worker) |
| `toItemInput` | 29 | 20 | Extract credit parsing, ratio resolution |
| `hydrateMissingBudgetItemUpdateFields` | 26 | 25 | Extract nil-safe string copy |

## Related

- Sister pattern for JS/TS: Prettier/ESLint root config consolidation (single shared root config over per-package configs).
- `dev-supervisor/CLAUDE.md` — golden config example (50+ linters, gocyclo=15)
- Industry precedent: OpenTelemetry (28 modules), etcd (13 modules), Kubernetes, Prometheus, Docker all use shared root config
