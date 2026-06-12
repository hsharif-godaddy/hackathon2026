---
title: "Preflight check/fixer env var sync coupling"
date: 2026-05-26
category: architecture-patterns
module: dev-runner
problem_type: architecture_pattern
component: development_workflow
severity: medium
applies_when:
  - "adding a new env var to a preflight fixer's baseVars list"
  - "existing .env files are not regenerated on new dev-runner versions"
  - "check and fixer for the same service define required vars independently"
tags:
  - dev-runner
  - preflight
  - env-vars
  - single-source-of-truth
  - structural-coupling
  - local-dev
related_components:
  - agents
  - budget-service
---

# Preflight check/fixer env var sync coupling

## Context

The dev-runner preflight framework uses a Check/Fixer pattern: checks run first to validate .env files, and if a check fails, its paired fixer runs to repair the state. The check's required list gates whether the fixer runs at all.

The coupling problem: the check validates a subset of vars (defined in `checks/env.go`), while the fixer writes a superset (defined in `fixers/env.go`). A var present in the fixer but absent from the check creates a silent gap; existing .env files pass the check and never trigger the fixer for the missing var.

Discovered on PR #3689 when `BUDGET_SERVICE_URL` was added to the fixer's `baseVars` (line 300) but not to the check's `required` list (line 106). Existing .env files passed the check and never got the new var.

Audit found 5 pairs with active drift and 2 with duplicated-but-matching lists across all env check/fixer pairs.

(session history) Prior sessions show the original BMS integration design routed through the LCP subscription as a middleman. When that was simplified to a direct file-based approach, the `BUDGET_SERVICE_URL` env var was added to the fixer but the check/fixer coupling bug was latent; it only manifested when a reviewer tested with a pre-existing .env file.

## Current state

The specific drift that triggered this (BUDGET_SERVICE_URL missing from the check) has been patched: `BUDGET_SERVICE_URL` is now in the `required` list in `checks/env.go`, matching the fixer. But the structural fix below was never built. The fixer in `fixers/env.go` still defines a local `baseVars := []struct{...}` slice, and the check defines `required` independently. The two-list coupling remains; only this one instance was closed by hand.

## Guidance (proposed, unbuilt)

The durable fix is to extract managed var definitions into a shared package-level file consumed by both check and fixer, so a single list makes drift impossible. This has not been implemented; the snippets below are a sketch, not a description of code that exists.

Design principles:
- Check requires ALL vars the fixer manages (strictest: if the fixer writes it, the check requires it)
- Fixer's upsert is idempotent (writes only missing vars, never overwrites), so triggering it on a missing non-critical var is harmless
- Conditional vars (auth-mode-dependent) returned from functions, not static slices
- Belt-and-suspenders test asserting the invariant

The structural fix derives both the check and the fixer from a single source-of-truth var list, so neither can drift from the other.

## Why This Matters

Without structural enforcement, every new env var addition is a potential oversight. The check/fixer contract is implicit; nothing catches the drift until a user reports a missing var. The blast radius is subtle: the app starts fine but a feature silently fails at runtime due to empty config.

## When to Apply

- When adding new env vars to any fixer in dev-runner
- When creating new check/fixer pairs
- Any system with "two lists that must stay in sync" (env vars, feature flags, config schemas)
- During code review: if you see a var added to a fixer, verify the paired check

## Examples

Before (bug-prone):
```go
// checks/env.go
required := []string{"NODE_ENV", "AUTH_TYPE"}

// fixers/env.go (different file, different list)
baseVars := []struct{ key, value string }{
    {"NODE_ENV", "development"},
    {"AUTH_TYPE", "jwt"},
    {"BUDGET_SERVICE_URL", "https://..."}, // NOT in check!
}
```

After (proposed structural fix, not yet implemented):
```go
// internal/preflight/vars.go (single source of truth)
type EnvVar struct {
    Key    string
    Value  string
    Quoted bool
}

var AgentsEnvBaseVars = []EnvVar{
    {"NODE_ENV", "development", false},
    {"AUTH_TYPE", "jwt", false},
    {"BUDGET_SERVICE_URL", "https://...", false},
}

func Keys(vars []EnvVar) []string { /* extract .Key */ }

// checks/env.go
required := preflight.Keys(preflight.AgentsEnvBaseVars)

// fixers/env.go
for _, v := range preflight.AgentsEnvBaseVars { upsertEnvVar(path, v.Key, v.Value) }
```

Invariant test (belt-and-suspenders):
```go
func TestCheckRequiresAllFixerVars(t *testing.T) {
    fixerKeys := preflight.Keys(preflight.AgentsEnvBaseVars)
    checkKeys := getCheckRequired()
    for _, k := range fixerKeys {
        assert.Contains(t, checkKeys, k, "fixer var %q missing from check", k)
    }
}
```

## Related

- [Refactor plan: single source of truth for preflight env vars](../../plans/2026-05-26-002-refactor-preflight-single-source-vars-plan.md)
- [Dev-runner preflight design spec](../../superpowers/specs/2026-04-07-dev-runner-preflight-design.md)
- [Post-boot service seeding pattern](dev-runner-post-boot-service-seeding-2026-05-13.md)
- [LCP subscription provisioning mirrors production](../tooling-decisions/lcp-subscription-provisioning-mirrors-production.md)
