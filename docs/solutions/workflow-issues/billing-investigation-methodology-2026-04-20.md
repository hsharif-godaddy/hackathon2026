---
title: Billing credit investigation methodology
date: "2026-04-20"
last_updated: "2026-04-24"
category: workflow-issues
module: agents
problem_type: workflow_issue
component: tooling
severity: medium
applies_when:
  - "Customer complains about being charged for fix or publish tasks"
  - "Need to verify assessment agent classification accuracy"
  - "Override pipeline health check (pending/applied/completed)"
  - "Cross-referencing ES logs, Langfuse traces, and Debug Console data"
related_components:
  - assistant
  - authentication
tags:
  - billing
  - investigation
  - debug-console
  - assessment-agent
  - langfuse
  - budget-override
  - credit-charging
---

# Billing credit investigation methodology

## Context

Customers submit feedback about credit waste and errors. The core question: did the assessment agent correctly classify user messages as free (fix/publish) vs charged (general)? Answering requires data from 5+ systems (ES logs, Langfuse, Debug Console UI, Console API, Budget Override Dashboard) with no obvious single source of truth. Without a repeatable methodology, investigators hit the same dead ends and miss the dropped-override gap entirely.

This methodology was developed and validated across 6 investigations (see feedback-reports in notes). The `/kb-investigate-billing` skill automates most of it; this doc covers the reasoning, gotchas, and gap closure techniques the skill cannot encode. (auto memory [claude]: use curl+jq against console API, not playwright, for investigations)

## Guidance

### Auth setup

```bash
# Extract auth token. Use sed, NOT grep — .env.local has shell functions
# below the token line that leak into curl headers via grep.
AUTH_JOMAX=$(sed -n '2p' .env.local | cut -d= -f2-)
BASE="https://console.airo-builder.godaddy.com/api"
```

### 8-step investigation flow

1. **Auth preflight + metadata** (`app-context`). Note: `metadata.subscriptionId` returns budget override IDs (e.g. `airo-builder:summarization-task`), not the real sub. Real sub ID only in browser Details tab.

2. **Classification breakdown** — `assessment_agent.classify.complete` events grouped by taskType. Shows fix/publish/general counts and overrideApplied counts.

3. **Free task completions** — `grants.assessment.free_task_completed` grouped by taskType. Compare with override_applied count to find dropped overrides.

4. **Override pipeline health** — all `grants.*` events grouped by event name. Healthy: pending ~ applied ~ completed. Gap = dropped overrides.

5. **Classification details per message** — each classify.complete has taskType, confidence, overrideApplied, method (`embedding-nn` vs `haiku-tiebreaker`), reasoning.

6. **User message recovery** — `haiku.calling` events have `previousMessagePreview` (~50 chars). Embedding-nn (100% confidence) only has `matchedExample`. Full text requires Langfuse.

7. **Langfuse traces** — cost per trace, session grouping. User messages are in observations, not top-level trace input (those are null).

8. **Browser-only data** — Details tab (per-grant balance, real sub ID, shopper ID), Summary tab (switchboard errors), Budget Override Dashboard (fleet pool health).

### Gap closure checklist

These gaps surfaced across multiple investigations and are easy to miss:

| Gap | How to close |
|---|---|
| Embedding-nn user messages (highest risk) | Cross-reference matchedExample against fix-intent examples. For unknowns, use Langfuse sessions endpoint with narrow time windows |
| Dropped overrides | Cross-reference override_applied timestamps with free_task_completed timestamps. Missing completions = potential billing impact |
| Conversation count | Debug Console uses 1-hour window. Langfuse unique sessionIds (paginate) are ground truth |
| Subscription ID | Metadata shows override ID. Always verify via browser Details tab |
| Tool call payloads | Not in ES logs. Cannot independently verify tool-level bugs |
| Budget pool health | Budget Override Dashboard (Elastic) for fleet-wide view |

### What doesn't work

- **Langfuse sessions endpoint on high-volume apps** — responses too large for jq (122+ traces). Narrow time windows help for single-trace sessions only.
- **Debug Console Conversation tab** — times out on high-volume apps.
- **Console API** — intermittent 503/504. Retry after 15s.
- **grep for auth token** — captures shell functions below the token. Use `sed -n '2p'`.
- **Browser automation for data collection** — 4x slower than curl+jq, fragile tab management, filter limitations. Reserve browser for the 3 data points that have no API equivalent (session history).
- **Backgrounded subshells (`&`) with shell functions in zsh** — functions lose their definitions in backgrounded contexts. Use sequential curl calls with a simple `$H` header variable instead.
- **`startTime`/`endTime` filters on ES logs queries** — silently return empty results even when data exists. Omit date filters and use `size=500` instead.
- **Skipping analysis agents (Phase 3)** — every time the orchestrator wrote reports directly from raw JSON, the conclusions were wrong (wrong verdict, missed misclassifications, unquantified credit impact).
- **Conflating agent-side and client-side errors** — agent-side errors (airo-agents ES logs) consumed credits. Client-side errors (app-context errorSummary from Katana ES) may not have reached the agent. Always label which source an error comes from.
- **Claiming credit impact without trace correlation** — error counts alone don't prove credit waste. Correlate error timestamps with Langfuse trace timestamps (same minute) to identify traces that were affected.
- **Assuming null flags mean disabled** — `enableAssessmentAgent: null` in the flags query means the log event wasn't found, not that the feature is disabled. Always check total log count and re-fetch with broader queries.
- **Reading only `.metadata` from app-context** — customer ID and shopper ID are in `recentActivity[].raw.customerId`, not in `.metadata`. The jq filter must extract these from the raw log entries.

### Skill automation learnings (2026-04-24)

The `/kb-investigate-billing` skill was improved through 6 investigations. Key automation patterns:

**CE agent routing for analysis:** dispatch 4 specialized agents in parallel:
- Classification Analyst: `ce-correctness-reviewer` (evaluates classification logic)
- Spend Analyst: `ce-data-integrity-guardian` (validates cross-system data consistency)
- Error Analyst: `ce-reliability-reviewer` (evaluates error patterns and failure modes)
- Pipeline Health Analyst: `ce-correctness-reviewer` (verifies state machine transitions)

**Key Takeaways validation:** after Phase 3, a 5th `ce-correctness-reviewer` agent validates that each complaint claim is supported by data before the report is written. This catches unsupported claims and prevents overstated verdicts.

**Data validation step:** after Phase 2 collection, check total log count. If any file is empty but logs exist, re-fetch with broader query terms (`assessment` instead of `assessment_agent`, `free_task` instead of `free_task_completed`).

**Report structure:** Key Takeaways (verdict badge, claims table, root cause, credit impact) at top. Fixes (source-verified, Evidence/Source/Impact/Direction) and Patterns (systemic, estimated prevalence) at bottom. No H1 title (Confluence page title serves). Naming: `{date}_{appId}.md` where date is feedback submission date.

## Why This Matters

Without this methodology, an investigator would spend hours discovering which systems hold which data, hit the same dead ends, and likely miss the dropped-override gap. The gap closure checklist turns a multi-day investigation into a repeatable half-day process.

It also prevents false conclusions: in the qucs9qx9ao investigation (4 negative feedbacks, 1300/1300 credits exhausted), the classification system was actually working correctly (31% of messages correctly overridden as free). The customer's frustration was an agent quality issue (false "Fixed" claims, broken deploys), not a billing failure.

## When to Apply

- Customer feedback about credit waste, incorrect charges, or "zero credits used" claims
- Auditing assessment agent classifications for a specific app
- Checking override pipeline (pending -> applied -> completed) for gaps
- Reconciling conversation counts between Debug Console, Langfuse, and customer reports
- Any billing investigation requiring end-to-end trace: user message -> classification -> grant override -> cost attribution

## Examples

**Verify a "credits wasted" complaint:**
1. Pull classification breakdown. Check fix+publish ratio vs general.
2. Pull override pipeline. Look for applied-without-completed gaps.
3. For ambiguous classifications, pull haiku reasoning and verify dominant intent.
4. Calculate billing impact of any dropped overrides.

**Verify a specific message was correctly classified:**
1. Find the `classify.complete` event by timestamp.
2. If `haiku-tiebreaker`: read reasoning field directly.
3. If `embedding-nn`: check matchedExample. Fix-intent examples ("fix this", "error message appears") indicate possible misclassification. General-intent examples ("complete the page", "create a blog") confirm correct classification.
4. For ground truth, find the Langfuse trace in the same time window and read the observation input.

**Identify dropped overrides:**
1. List all `override_applied` timestamps.
2. List all `free_task_completed` timestamps.
3. Match each applied to its nearest completed (within 1-5 min, same taskType).
4. Unmatched applied events = dropped. Calculate cost impact from corresponding Langfuse traces.

## Related

- `/kb-investigate-billing` skill (`~/.claude/skills/kb-investigate-billing/SKILL.md`) — automated version of this methodology
- Feedback reports in notes directory — outputs of this methodology (6 completed investigations)
- `agents/src/agents/assessment-agent/AssessmentAgent.ts` — classification logic, session context gate at lines 248-259
- `agents/src/agents/assessment-agent/embedding-classifier.ts` — embedding-based classifier, fast path at lines 207-226
- `agents/src/agents/assessment-agent/keywords.ts` — TASK_BUDGET_MAP for override mapping
- `packages/ai-grants/src/grant-session-manager.ts` — BudgetOverride enum
- `packages/ai-grants/src/build-metadata.ts` — override subscription ID routing (lines 155-172)
- `app/src/lib/paywall/core.ts` — switchboard fail-closed behavior
- `app/src/app/api/auth/agent-token/route.ts` — Switchboard flag resolution (lines 262-263)
