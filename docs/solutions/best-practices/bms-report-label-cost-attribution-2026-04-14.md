---
title: "Cost attribution report labels are flat per-call values aggregated into multi-label BMS reports"
date: 2026-06-11
last_updated: 2026-06-11
category: best-practices
module: packages/ai-lib/cost-attribution
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Adding a new ReportLabel value for cost attribution"
  - "Building BMS analytics dashboards for GoDaddy-absorbed cost breakdown"
  - "Changing how per-call attributions map to BMS report items"
tags:
  - cost-attribution
  - bms-report
  - report-labels
  - per-call-attribution
  - multi-label
  - budget-service
---

# Cost attribution report labels are flat per-call values aggregated into multi-label BMS reports

## Context

Report labels answer "why did GoDaddy absorb this cost?" at the BMS analytics layer, so they can be sliced without querying agent execution logs.

Each attributed call carries exactly one `ReportLabel`. The session as a whole carries an array of labels and a per-label cost map, so a single session can report multiple reasons (for example a publish session that also hit tool failures). There is no composite `intent:category` string and no judge-driven `CostAttributionCategory`; that subsystem was removed. Labels are flat, assigned per call by deterministic rules.

## Solution

`ReportLabel` is a flat enum, one value per attribution reason (`packages/ai-lib/src/budget/cost-attribution/types.ts`):

- `airo-builder:general` (customer pays, success)
- `airo-builder:care-agent`, `airo-builder:test-accounts` (full GoDaddy override sessions)
- `airo-builder:publish-task`, `airo-builder:domain-task` (full override intents)
- `airo-builder:tool-failure`, `airo-builder:edit-read-loop`, `airo-builder:grep-spiral`, `airo-builder:causal-chain` (failure attribution)
- `airo-builder:no-output` (no value delivered)
- `airo-builder:infrastructure-overhead` (agent overhead, always GoDaddy)
- `airo-builder:repeated-reads`, `airo-builder:repeated-edits`, `airo-builder:terminal-failures`, `airo-builder:tool-retry` (severity-based patterns)

How labels get assigned and aggregated, all in `cost-attribution/index.ts`:

- `determineAttribution()` assigns one label per call. Cost-override calls get `PublishTask`/`DomainTask`; pattern calls get the matching pattern label via `patternTypeToLabel()`; causal-chain calls get `CausalChain`; infrastructure calls get `InfrastructureOverhead`; remaining GoDaddy calls default to `ToolFailure`; customer-paid calls get `General`.
- The per-call detectors live in `pattern-detection.ts`, `causal-chain-detection.ts`, `cost-override-detection.ts`, `failure-extraction.ts`, `infrastructure-detection.ts`, and `retry-detection.ts`. They produce `PatternResult[]`, `CausalChain[]`, and call-id sets keyed by `callRequestId`.
- The attribution loop sums GoDaddy cost into `costsByLabel: Map<ReportLabel, number>`.
- `generateReportItems()` emits one BMS report item per label: customer cost under `General`, then one `productCost` item per entry in `costsByLabel`.

```typescript
// One label per call (index.ts)
const label = patternTypeToLabel(pattern.type) // e.g. ReportLabel.GrepSpiral

// Aggregate GoDaddy cost by label
costsByLabel.set(label, (costsByLabel.get(label) ?? 0) + item.cost)

// Emit one report item per label
for (const [label, cost] of result.costsByLabel) {
  if (cost > 0) items.push({ budgetCost: '0', productCost: cost.toString(), label })
}
```

## Why This Matters

Multi-label reporting is shipped, not future work. A session that has both errors and a grep spiral reports each reason with its own cost, so BMS dashboards can answer "how much does friction cost us versus errors?" directly. Flat labels keep this query-friendly: each label is a single BMS string with no segment parsing.

Because every attributed call resolves to exactly one label, the label space and the attribution-reason space must stay aligned. A new failure mode needs both a `ReportLabel` and a branch in `determineAttribution()`/`patternTypeToLabel()`, or its cost silently falls into `ToolFailure`.

## When to Apply

- Adding a new `ReportLabel`: add the enum value, then wire it into the per-call assignment path so it actually appears in `costsByLabel`.
- Building BMS dashboards: group by the flat label string; expect multiple items per session (one customer `General` item plus one item per GoDaddy label).
- Do not reintroduce composite `intent:category` labels or judge-derived categories; per-call attribution replaced session-level discount categories.

## Related

- `docs/solutions/architecture-patterns/cost-attribution-sdk-native-over-custom-tracker-2026-04-24.md` (canonical architecture: SDK steps[] post-hoc, per-call via x-correlation-id, deterministic-first)
- `packages/ai-lib/src/budget/cost-attribution/types.ts` (`ReportLabel` enum, `AttributionResult.costsByLabel`/`labels`)
- `packages/ai-lib/src/budget/cost-attribution/index.ts` (`determineAttribution`, `patternTypeToLabel`, `generateReportItems`)
- `packages/ai-lib/src/budget/cost-attribution/COST-ATTRIBUTION-GUIDELINES-AND-LABELS.md`
