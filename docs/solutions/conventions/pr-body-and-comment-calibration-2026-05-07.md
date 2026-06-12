---
title: PR body and code comment calibration for focused fixes
date: 2026-05-07
category: conventions
module: tooling
problem_type: convention
component: development_workflow
severity: low
applies_when:
  - Writing a PR description for a single-commit or single-concern fix
  - Writing a JSDoc or header comment that introduces a test file or helper
  - Writing a commit message that will be read by reviewers unfamiliar with internal metric names
tags: [pr-description, code-comments, communication, review, calibration, ce-commit-push-pr]
related_components: [ce-commit-push-pr, kb-pr-review-comments, kb-pr-defend]
---

# PR body and code comment calibration for focused fixes

## Context

Multiple rounds on PR #3506 surfaced a consistent pattern in the PR body and an accompanying test-file JSDoc: content that made sense to the author (who had just finished the fix) read as jargon-heavy and speculative to a reviewer (who hadn't). Each round removed one more unnecessary section. The final shape was shorter, clearer, and more useful to the reviewer than any earlier draft.

The pattern generalizes to future PRs and code comments: sections that describe the work, the process, or the speculative edges default on; sections that serve the reader must be defended. Drafting agents — including this one via `ce-commit-push-pr` — tend to over-include.

## Guidance

**Lead with observable harm, not metric names.** Reviewers don't recognize internal log event names, miss-rate percentages, or metric-system jargon as meaningful without context. A Summary section that opens with "54% miss rate on `budget.report.attribution_emit_missing_conversation_id`" forces the reader to reverse-engineer what that means. A Summary that opens with "Cost-attribution traces for every InitialAgent first-message conversation were silently dropped on the server" tells them what broke, *then* earns the right to cite the metric as supporting evidence.

**Drop `## Scope` sections on focused single-commit fixes.** Scope sections are useful when a PR has ambiguous boundaries and a reviewer needs to know what was intentionally excluded. They're dead weight on a one-line fix in a helper function — listing what's *not* there is preemptive defense, not information.

**Drop `## Teams to notify` lists in the PR body.** Named-team notification belongs in a rollout checklist or a Slack message, not in a PR description that will be read long after the rollout. Keep the *reason* a downstream team might care (e.g., "systems keyed on Langfuse cost-attribution traces should decide whether to retrain or accept the distribution shift") and let the rollout process handle the actual notification.

**Drop the debugging narrative.** A section titled "Why the original diagnosis was wrong" or "How I traced the bug" is agent-process documentation. The reader cares about the current fix. If the diagnosis path has durable institutional value (e.g., a misdiagnosis pattern worth flagging), put it in `docs/solutions/`, not the PR body.

**Code comments follow the same rules.** A JSDoc that opens with "Regression coverage for the 54% `budget.report.attribution_emit_missing_conversation_id` miss rate in test env caused by the cache-write guard reading the wrong field" carries the same reviewer-unfamiliarity problem as the PR body's original lede. Reframe around what the code *does* — the precedence rule — and let the reader arrive at the *why* afterward.

**Compress until each section earns its place.** The minimum viable PR body for a focused fix is: Summary → What changed → Impact → Test plan. Everything else is elective and should be justified by the specific PR.

## Why This Matters

- **Reviewer time is the scarce resource.** The PR body is read once at review and once more at archaeological lookup months later. Padding adds skim cost without adding signal.
- **Drafts carry agent-process bias.** When `ce-commit-push-pr` composes a description, the evidence it has is the diff + the conversation in which the diff was written. That context is rich with failed hypotheses, scoping decisions, and notification lists — all of which the agent will faithfully include unless told not to. Calibration happens at review time, not draft time.
- **Metric names are organizational jargon.** Even in the originating team, a metric that's 6 months old may no longer be a known artifact. Harm + mechanism + metric-as-evidence survives; metric-first framing rots.
- **Scope sections and notify-lists age poorly.** "Not included: X, Y, Z" statements become confusing as follow-up PRs land those items. A PR body that doesn't invent those exclusions doesn't have that drift problem.

## When to Apply

- Always on **focused single-commit fixes** or **docs/test-only PRs**. Default to minimum structure.
- On **multi-unit feature PRs**, scope and test plan earn their place but should still lead with observable impact.
- **Not** on long-lived RFC-shaped PRs where the process narrative is the point.
- The calibration applies equally to `ce-commit-push-pr` drafts, `ce-brainstorm` / `ce-plan` summaries, and code comments that introduce non-obvious logic.

## Examples

### PR body Summary lede — before and after

**Before (metric-first, no user-visible harm):**

> Fix the 54% `budget.report.attribution_emit_missing_conversation_id` miss rate in test env by reading server-populated `context.metadata.conversationId`...

**After (harm-first, metric as supporting detail):**

> Cost-attribution traces for every InitialAgent first-message conversation were silently dropped on the server: the OpenTelemetry span that carries per-conversation cost into Langfuse had no `conversationId` attached, so the span was emitted without a parent and then discarded. In the last 48h of test-env traffic that was **7 out of 13 sessions (54%)** — the exact rate reflected in the `budget.report.attribution_emit_missing_conversation_id` warn log.

### JSDoc header — before and after

**Before (metric-first, explains the symptom):**

```ts
/**
 * Regression coverage for the 54% `budget.report.attribution_emit_missing_conversation_id`
 * miss rate in test env caused by the cache-write guard reading the wrong field.
 *
 * Server-populated conversationId lives on `context.metadata.conversationId` (written by
 * `attachConversationId` in the transport before `onMessageStart`). The client-sent
 * `context.conversation.conversationId` is only populated after the first message in a
 * conversation, so InitialAgent first-message sessions had no cache entry and every
 * downstream `onBudgetReport` lookup missed.
 */
```

**After (rule-first, explains the precedence):**

```ts
/**
 * Pins the precedence rule used by the cost-attribution cache write:
 * `context.metadata.conversationId` (server-populated by `attachConversationId`
 * in the transport before `onMessageStart`) is authoritative; fall back to the
 * client-sent `context.conversation.conversationId` only when metadata is missing.
 *
 * First-message sessions have no client-sent conversationId (the server generates
 * it), so a guard that reads only the conversation field silently skips the cache
 * write and drops the downstream OTel cost-attribution span.
 */
```

### Section checklist for a focused fix PR

| Section | Default | Include when |
|---|---|---|
| Summary | ✅ always | — |
| What changed | ✅ always | — |
| Impact | ✅ when blast radius is non-obvious | Skip if the Summary already covers it |
| Test plan | ✅ always | — |
| Scope | ❌ default off | Only when the PR boundary is genuinely ambiguous |
| Teams to notify | ❌ default off | Move to rollout checklist or Slack |
| Debugging narrative | ❌ default off | Extract to `docs/solutions/` if the lesson is durable |
| Demo / screenshot | ✅ when observable behavior changed | Skip for telemetry-only or backend-plumbing fixes |

### Iterate via short prompts, not regeneration

When an initial draft is too heavy, incremental prompts outperform regeneration: "do we need the Scope section?" / "drop the Teams list" / "remove the diagnosis-story section" produced four clean revisions in under ten minutes on PR #3506, each review fitting on one screen. Full-rewrite prompts re-introduce the same sections a draft-time agent defaults into.
