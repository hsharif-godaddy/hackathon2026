---
title: Cost attribution uses SDK steps[] post-hoc, not custom streaming tracker
date: 2026-04-24
category: architecture-patterns
module: budget-service
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - Building cost attribution or billing-path analysis for agent execution
  - Choosing between real-time streaming callbacks and post-hoc SDK data
  - Designing per-call vs session-level billing granularity
tags:
  - cost-attribution
  - budget-service
  - judge-agent
  - sdk-steps
  - execution-tracking
  - per-call-attribution
  - bms
---

# Cost attribution uses SDK steps[] post-hoc, not custom streaming tracker

## Context

Two competing approaches to cost attribution were developed in parallel (PR #2733 and PR #2935). Both aimed to split agent execution costs between customer and GoDaddy budgets based on execution quality.

PR #2733 built a custom `ExecutionContextTracker` with streaming callbacks (`onToolStart`/`onToolEnd`/`onLlmStart`/`onError`) that accumulated tool call records during execution. PR #2935 used the Vercel AI SDK's built-in `steps[]` array, analyzing it post-hoc after execution completes.

The team chose #2935's architecture. Key factors from code review:

- mlefebvre1 flagged in #2733 review: "is the custom tracker needed given Vercel AI SDK provides tool/usage data at completion?" (auto memory [claude]: intent definition and GoCode correlationId context informed the per-call attribution design)
- byuong's #2935 review recommended shipping rule-based attribution only, gating LLM components behind dry-run until calibrated
- The converged approach (#3144) uses #2935's SDK-native architecture with deterministic-first attribution

## Guidance

### Use SDK `steps[]` post-hoc, not custom tracking

The Vercel AI SDK provides `StepResult[]` containing tool calls, results, errors, and `x-correlation-id` headers. Read this in `onFinish`/`onBudgetReport` rather than building custom accumulators.

**Why not custom tracking:** The `ExecutionContextTracker` approach (PR #2733) required:
- 210 lines of stateful per-socket accumulation code
- Workarounds for transport clearing `pendingToolCalls` between LLM rounds
- `filePath` often undefined because tool input wasn't available at `onToolEnd` time
- Pre-populated `judgeReportedSessions` guard because `onBudgetReport` fires before `beforeMessageComplete`
- Memory bounds management (1000-item cap with oldest-first eviction)

The SDK-native approach eliminates all of this. Steps are passed directly via callback parameter, not stored in intermediate Maps.

### Attribute per-call via x-correlation-id, not session-level discount

Each GoCode response includes `x-correlation-id` which maps to BMS `sessionItems[].callRequestId`. This enables attributing individual LLM calls to customer or GoDaddy.

PR #2733 applied a single graduated discount to the entire session (`discount = min(100%, error_base + friction_bonus + frustration_bonus)`). This meant 1 error in a 100-call session got the same 25% as 1 error in 5 calls. Per-call attribution eliminates the normalization problem structurally.

### Use causal chain detection for agent-caused failures

Trace edit -> error -> fix sequences to distinguish "agent broke something then repaired it" (GoDaddy pays for the whole chain) from "user asked to fix a bug" (customer pays). The causal chain detector checks if errors mention recently edited files within a 5-step proximity window.

### Run detection in parallel, not blocking

When `budgetServiceEnabled` is true, fire assessment + retry detection as non-blocking promises during `onMessageStart`. Await them with a 5s timeout in `onMessageComplete` after execution finishes. Detection latency (100-500ms typical) is hidden behind execution time (seconds to minutes).

PR #2733 blocked assessment up to 3.5s before execution could start, and acknowledged making it non-blocking as a future work item.

### Ship deterministic rules first, gate LLM behind dry-run

byuong's review of #2935 was decisive: no LLM on the billing path without calibration data, a feedback loop, and a comparison path proving LLM judgment beats rules-only. The converged approach in #3144 ships rule-based attribution (pattern detection, causal chains, failure extraction) and gates LLM components (judge agent, fix verification, retry intent detection) behind the `costAttributionDryRun` switchboard flag.

## Why This Matters

Cost attribution directly affects billing. A custom tracker that misses tool calls or double-counts them produces wrong bills. The SDK already collects execution data accurately; duplicating that collection introduces drift risk for zero benefit.

Per-call attribution is more precise and avoids the normalization debate entirely. Session-level discounts require threshold calibration that varies with session length, which was an unresolved gap in #2733.

LLM-based attribution on a billing path without calibration infrastructure risks unpredictable cost allocation. Deterministic rules are auditable and consistent.

## When to Apply

- Any new cost attribution or billing analysis feature for agent execution
- When tempted to add streaming callbacks to track execution state that the SDK already provides
- When choosing between per-item and aggregate billing granularity
- When considering LLM-based decisions on financial paths

## Examples

**Attribution priority cascade (from #3144):**

| Priority | Condition | Attribution |
|----------|-----------|-------------|
| 1 | Full override intent (publish/domain) | 100% GoDaddy |
| 2 | High-confidence retry (>= 80%) | 100% GoDaddy |
| 3 | Fix intent verified via edit ratio | 100% GoDaddy |
| 4 | Fix reclassified (low edit ratio) | 100% Customer |
| 5 | Per-call: failed calls + pattern calls + causal chain calls | Mixed (per `callRequestId`) |
| 6 | No value delivered | 100% GoDaddy |
| 7 | Default | 100% Customer |

**Dual-mode execution:**

| Mode | Assessment | Detection | Attribution |
|------|-----------|-----------|-------------|
| Flag OFF (grants) | Blocking before execution | N/A | N/A |
| Flag ON (budget service) | Parallel with execution | Parallel with execution | Post-hoc via steps[] |

## Related

- PR #2733: Original custom tracker approach (closing)
- PR #2935: SDK-native rewrite (being decomposed)
- PR #3144: Rule-based attribution (converged implementation)
- PRs #3091, #3092, #3139: Extracted infra pieces from #2935
