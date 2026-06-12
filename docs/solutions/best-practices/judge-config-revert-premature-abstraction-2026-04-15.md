---
title: Judge config revert, premature abstraction over hardcoded thresholds
date: 2026-04-15
category: best-practices
module: budget-judge-pipeline
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Considering extracting hardcoded values into config files before production data justifies it
  - Adding Switchboard/JWT transport for structured config data
  - Building config infrastructure before the values have ever been changed
tags:
  - premature-abstraction
  - judge-config
  - switchboard
  - jwt-bloat
  - revert
  - config-management
---

# Judge config revert: premature abstraction over hardcoded thresholds

## Context

The judge agent's discount thresholds (error tiers, friction bands, frustration bonuses) were calibrated from 51K Langfuse traces and hardcoded in `JudgeAgent.ts`. Two plans were implemented in PR #2733:

- **Plan 001** (configurable discount table): extracted thresholds into `judge-config.json` + Zod schema, added config-driven fast-path routing and flat intent overrides
- **Plan 002** (Switchboard sourcing): fetched config from Switchboard, transported via JWT claim, per-session config in `AgentContext`

Both were reverted in commit `9ca56c022` before merging. The config had never been changed in production. The thresholds change quarterly at most.

## Guidance

### Start hardcoded, extract when evidence demands it

Config infrastructure (Zod schemas, JSON files, Switchboard transport, JWT claims) has real carrying cost: cache key bloat, dual-source-of-truth drift, init-time file loading, and test surface expansion. These costs are justified only when the values actually change in production.

**Evidence threshold for extraction:**
- Values changed >= 2 times in production -> extract to config file
- Values need per-session or per-customer variation -> add feature flag transport
- Values need no-deploy changes weekly -> add Switchboard/remote config

### Don't put structured config in JWTs

Plan 002 embedded ~500 bytes of JSON config in the JWT claim. Issues discovered during review:

- JWT cache key must include the config string, cratering hit rate
- `resolveStringFlag` filters `'default'` to `undefined`, breaking JSON values
- Singleton `getJudgeAgent()` defeats per-session config (the load-bearing fix requires `createJudgeAgent(config)` on every message)
- JWT practical limit is ~4KB across browsers/proxies. Each new claim narrows the margin.

If agents need remote config, agents should fetch it directly (one HTTP call at session start) rather than routing through BFF -> JWT -> agents.

### Config-driven routing adds hidden complexity

Plan 001 replaced `assessment.isFastPath` (a boolean from the assessment agent) with config-driven routing: `config.fastPathIntents.includes(taskType) && confidence >= config.fastPathConfidenceThreshold`. This added:

- Flat override path (`isFlatOverride`) with its own report label format
- `policy_subsidy` CostAttributionCategory for overrides
- 3-way routing (fast-path, flat-override, graduated) instead of 2-way (fast-path, graduated)
- Config validation for sorted descending tiers, min/max bounds, etc.

The graduated discount thresholds were unchanged from the hardcoded values. The flat override path had zero production consumers.

## Why This Matters

- **773 lines deleted** when reverted (net). That's 773 lines of carrying cost that provided zero production value.
- The config infrastructure was tested, reviewed, deepened with 10 review agents, and generated 15+ copilot review comments. Engineering effort spent on infrastructure that was never used.
- Hardcoded values work until they don't. When they need to change, the extraction is straightforward and can be re-derived from the Before/After examples below.

## When to Apply

- Before extracting hardcoded values into config: has the value ever been changed in production?
- Before adding Switchboard/JWT transport for config: can agents fetch directly instead?
- Before adding config-driven routing: does the routing actually vary, or is it always the same path?

## Examples

**Before (plan 001, reverted):**
```
judge-config.json + judge-config.ts + Zod schema + loadJudgeConfig() + getJudgeAgent(config) + createJudgeAgent(config) + config-driven fast-path + flat override path + policy_subsidy category
```

**After (restored):**
```
Hardcoded thresholds in computeErrorBase(), computeFrictionBonus(), computeFrustrationBonus(). assessment.isFastPath for routing. getJudgeAgent() singleton.
```

Same behavior. 773 fewer lines.

## Related

- The configurable judge discount table and Switchboard judge-config transport were each built then reverted in full: two build efforts (config table, Switchboard transport) followed by two reverts. The Before/After examples above capture both directions.
- `docs/solutions/architecture-patterns/cost-attribution-sdk-native-over-custom-tracker-2026-04-24.md` -- the per-call attribution model that replaced the judge pipeline
- PR #2733: budget execution tracker, friction scorer, judge pipeline (later reverted)
