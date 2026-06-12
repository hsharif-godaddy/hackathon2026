---
title: Triaging CI bot review comments at scale
date: 2026-04-24
category: workflow-issues
module: ci-review
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - CI bot posts 3+ review items on a PR
  - Comments span multiple concerns (auth, testing, error handling)
  - PR has multiple commits where earlier fixes may be invisible to the bot
  - Time-sensitive PR needs quick valid/invalid separation
tags:
  - ci-review
  - code-review
  - false-positives
  - claude-ci
  - pr-workflow
  - triage
---

# Triaging CI bot review comments at scale

## Context

Claude CI bot posts review comments on PRs but often generates false positives. In PR #3113 (generic conversion event), the bot posted 4 comments with 19 items. After systematic triage, 15 of 19 (79%) were false positives. Without verification, teams waste time on invalid feedback or auto-apply unnecessary changes that add complexity.

The `kb-resolve-claude-comments` skill implements this workflow. This doc captures the underlying pattern and false positive taxonomy for when manual triage is needed.

## Guidance

### Workflow

1. **Extract all review comments programmatically** via GitHub API or `gh` CLI. Capture file paths, line numbers, and full comment text. Include PR diff and description for context.

2. **Spawn parallel review agents per comment**, routing to the best CE specialist:
   - Auth/permissions: `ce-security-reviewer`
   - Test coverage: `ce-testing-reviewer`
   - Error handling/async: `ce-reliability-reviewer`
   - Mixed concerns/default: `ce-correctness-reviewer`

3. **Each agent must verify claims against actual code at HEAD**:
   - Read files at HEAD, not just diff context
   - Trace imports and callers to verify claims about missing tests or constants
   - Check `git log` to confirm issues weren't already fixed in prior commits
   - Look for guards, idempotency checks, and validation the bot may have missed

4. **Collect agree/disagree verdicts with file:line citations**. Flag conflicting verdicts across agents for manual spot-check.

5. **Apply only agreed fixes**. Batch into logical commits. Document why disagreed items were rejected.

6. **Minimize resolved/superseded comment threads** via GitHub GraphQL API.

### False positive taxonomy

| Category | Example (PR #3113) | Detection |
|---|---|---|
| **Already fixed** | "hardcoded free-plan string" when `ATTRIBUTE_KEYS.FREE_PLAN` was used | Read file at HEAD, grep for literal |
| **Factually incorrect** | "uses level 1 auth" when `route.ts:75` has `{ level: 3 }` | Read actual route config |
| **Misread code** | "overwrites conversionEventDate" when line 834 has early-return guard | Read method implementation fully |
| **Low-value advisory** | "add sessionStorage error logging" for expected private-browsing failures | Trace call sites, assess risk/benefit |

## Why This Matters

- 79% false positive rate observed in PR #3113 would waste significant reviewer time if triaged manually
- Auto-applying CI suggestions without verification introduces unnecessary complexity and churn
- False positives erode trust in CI feedback over time, making valid items easier to dismiss
- Systematic verification catches both false positives (via code inspection) and legitimate issues (via focused review)

(auto memory [claude]) This connects to established team feedback: always verify file state at HEAD before commenting, check actual handler/validation code before commenting on API contracts, and scope reviews to the PR diff.

## When to Apply

- CI bot posts comments with 3+ items
- Comments span multiple concerns requiring specialist knowledge
- PR has multiple commits where earlier fixes may be invisible to the bot
- You need quick separation of valid feedback from noise

Skip for single-item comments (manual verification is faster) or trivial style comments (auto-apply is low-risk).

## Examples

### True Positive: Error serialization
**Claim**: `logger.error('event.failure', { error: e })` passes raw Error, serializes to `{}`  
**Verdict**: AGREE. No `.message` extraction. Fix: `e instanceof Error ? e.message : String(e)`

### True Positive: Missing test coverage
**Claim**: `acknowledgeConversion` has untested 404 and idempotent paths  
**Verdict**: AGREE. Tests only cover happy path. Added 3 tests for 404 throw, idempotent return, normal update.

### False Positive: Already fixed
**Claim**: "hardcoded 'free-plan' string literal should use constant"  
**Verdict**: DISAGREE. File already uses `ATTRIBUTE_KEYS.FREE_PLAN` (fixed in commit d3f6ca476).

### False Positive: Factually incorrect
**Claim**: "route uses level 1 auth, should be level 3"  
**Verdict**: DISAGREE. `route.ts:75` has `withCustomerAuth(handler, { level: 3 })`.

## Related

- `docs/solutions/documentation-gaps/claude-md-codebase-drift-2026-03-27.md` documents the same false positive problem from the CLAUDE.md drift angle
- `docs/solutions/conventions/billing-investigation-report-conventions-2026-04-24.md` uses the same parallel CE agent verification pattern
- `kb-resolve-claude-comments` skill automates this workflow
- (session history) Prior session on this branch confirmed plan-to-code alignment and the level 3 auth upgrade, directly connecting to one false positive caught during triage
