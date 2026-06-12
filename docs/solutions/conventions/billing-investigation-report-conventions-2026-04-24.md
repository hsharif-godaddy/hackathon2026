---
title: Billing investigation report conventions for kb-investigate-billing
date: 2026-04-24
category: conventions
module: kb-investigate-billing
problem_type: convention
component: tooling
severity: medium
applies_when:
  - Modifying the kb-investigate-billing skill report template
  - Adding new data fields to investigation reports
  - Debugging why report sections are missing data
tags:
  - billing-investigation
  - skill-convention
  - report-template
  - langfuse
  - classification
---

# Billing investigation report conventions for kb-investigate-billing

## Context

The `kb-investigate-billing` skill produces structured billing investigation reports through a 4-phase pipeline: auth, data collection, parallel analysis (4 sub-agents), and report assembly. Over multiple investigations, several gaps emerged between what the analysis agents produced and what appeared in the final report. These conventions capture the fixes applied during 2026-04-24 to prevent recurrence.

## Guidance

### Report metadata must include all customer-facing fields

The report header block must include: Rating, Date, App name, App ID, Shopper (CRM-linked), Customer, Plan, Subscription, Published site URL, Total spend/tokens/requests. Omitting any field forces the reader to look up basic context elsewhere.

### Classification tables need Method and Trace columns

Every row in the fix/general classification tables must include:
- **Method**: the classification method used (embedding-nn, keyword, haiku-tiebreaker, llm)
- **Trace**: a linked Langfuse trace URL using `[shortId](fullUrl)` format

The Classification Analyst agent outputs both fields. If the report template tables lack these columns, the orchestrator silently drops them.

### Key Takeaways needs a Spending line

The Key Takeaways section has three bullet points: Classification, Other issues, and Spending. The Spending line summarizes total spend, grant breakdown, credits, tokens, requests, Langfuse trace cost, and error-correlated cost. The Key Takeaways Validator agent produces the `spending` field in its JSON output.

### Browser data takes precedence over API data for credits

When `details.json` (browser-collected via Phase 2b) has credit counts, spend totals, or grant balances, use those over `grants.json` (API-collected). The browser reflects the live UI state; the API may return stale data. The metadata Plan line and Key Takeaways Spending line must use the same source.

### Sessions endpoint fallback

The `/langfuse/sessions/{appId}` endpoint frequently times out. Phase 2 data collection includes a 30s timeout and automatic fallback: when sessions fails, the skill fetches individual trace details from `/langfuse/traces/{traceId}` and writes `traces-detail.json`. The Classification Analyst reads this fallback file for user message text when `sessions.json` is empty or has `collectionError`.

### Classification breakdown summary table

A summary table appears between Links and Findings: `taskType | Count | Override applied | Method`. The Classification Analyst produces a `classificationBreakdown` array in its JSON output that feeds this table.

### No initial app creation prompt in reports

The first message a user sends when creating their app (the initial prompt) is not relevant to billing investigations. Skip it when populating classification tables from session/trace data.

## Why This Matters

Reports are the primary deliverable of the skill. Missing fields, broken trace links, or stale credit counts undermine trust in the investigation. Each convention here was discovered through a real investigation where the omission caused confusion or required manual correction.

## When to Apply

- Adding new fields to the report template in SKILL.md
- Modifying the Classification Analyst or Key Takeaways Validator prompts in `references/agent-prompts.md`
- Debugging why a report section is empty or has stale data

## Examples

Before (classification table missing Method and Trace):
```
| Timestamp | User message | Classification | Confidence | Budget |
```

After:
```
| Timestamp | User message | Classification | Confidence | Method | Budget | Trace |
```

Before (Key Takeaways missing Spending):
```
- **Classification:** ...
- **Other issues:** ...
```

After:
```
- **Classification:** ...
- **Other issues:** ...
- **Spending:** $190.16 total across 14 credit packs + monthly plan (3,721/3,800 credits, 143.79M tokens, 2,153 requests). Langfuse traces: $6.98 (100 traces), $3.09 tied to error events.
```

## Related

- Skill files: `~/.claude/skills/kb-investigate-billing/SKILL.md`, `references/agent-prompts.md`, `references/runbook.md`
- Example reports: `~/Documents/projects/notes/Projects/Airo App Builder/feedback-reports/`
