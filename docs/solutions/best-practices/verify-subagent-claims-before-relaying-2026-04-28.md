---
title: Verify subagent claims before relaying to the user
date: 2026-04-28
category: best-practices
module: agents
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - orchestrator delegates research or verification to subagents and relays findings
  - subagent returns factual assertions about code state (line presence, function signatures, log statements)
  - orchestrator has already read the relevant code or diff in the current conversation
tags:
  - subagent-verification
  - orchestrator-pattern
  - pr-review
  - delegation
  - cross-reference
---

# Verify subagent claims before relaying to the user

## Context

An orchestrator delegated PR feedback verification to a subagent (ce-previous-comments-reviewer). The subagent reported that both a non-ok response log and a `.catch` network error log were "still present" in `useConversionEvent.ts`. The orchestrator had already read the full diff earlier in the conversation, which clearly showed the `.then()` handler contained only `if (response.ok) { invalidateQueries() }` with no else branch. The non-ok log was already removed.

The orchestrator relayed the subagent's incorrect claim without cross-referencing. The user caught the error.

This extends two existing principles (auto memory [claude]): "verify server-side before posting" (`feedback_verify-server-side.md`) and "verify latest before commenting" (`feedback_verify-latest-before-commenting.md`). Both address trusting indirect information over direct evidence.

## Guidance

Never relay a subagent's factual claim without verifying it against information already in your context.

When a subagent reports a code-level finding ("this line is still present," "this function still does X"), and you have already read the relevant code or diff, cross-reference the claim before acting on it. If the claim contradicts what you already know, trust your direct evidence and either correct the finding or re-read the file to resolve the discrepancy.

Subagent output is hearsay. Your own prior reads are primary evidence. Primary evidence wins.

## Why This Matters

- **User trust erodes fast.** Relaying a wrong factual claim that the user can see you had the evidence to refute makes the orchestrator look careless.
- **Compounding errors.** An incorrect claim, once relayed, can trigger unnecessary code changes, wasted review cycles, or incorrect PR comments.
- **The orchestrator's value is judgment, not passthrough.** If it just relays subagent output verbatim, it adds no value over the user reading the subagent output directly.

## When to Apply

- Anytime a subagent returns a factual assertion about code state and you have already read the relevant code, diff, or file in the current conversation.
- Anytime you are about to relay a subagent finding to the user or act on it (making a code change, posting a PR comment).
- Especially when the claim is specific and verifiable (line numbers, presence/absence of code) rather than subjective (style opinions).

Does NOT apply when you have no prior context on the relevant code and the subagent is the only source. In that case, read the code yourself before relaying.

## Examples

### Before (failure mode)

```
Orchestrator reads diff -> sees .then() has only if (response.ok) { invalidate }, no else
Orchestrator delegates to subagent
Subagent: "Both logs still present"
Orchestrator relays: "Thread #6: both logs are still present"
User: "The non-ok log was already removed. Why didn't you catch that?"
```

### After (correct behavior)

```
Orchestrator reads diff -> sees .then() has only if (response.ok) { invalidate }, no else
Orchestrator delegates to subagent
Subagent: "Both logs still present"
Orchestrator cross-references: "I already read this. Lines 73-76 have no else. Subagent is wrong."
Orchestrator: "Thread #6: non-ok log already removed. Only .catch remains. Addressed."
```

### General pattern

```
1. Receive subagent output
2. Identify factual claims
3. For each claim: do I already have evidence?
   - Yes + match -> relay
   - Yes + conflict -> trust own evidence, correct or re-verify
   - Yes + ambiguous -> re-read file to resolve
   - No evidence -> read the file yourself, then relay
```

## Related

- [Triaging CI bot review comments](../workflow-issues/triaging-ci-bot-review-comments-2026-04-24.md) (same verify-at-HEAD principle applied to bot comments)
- [AI code bloat simplification](../best-practices/ai-code-bloat-simplification-pass-2026-04-02.md) (cross-referencing review findings against implementation plan)
- [Documentation drift from codebase](../documentation-gaps/claude-md-codebase-drift-2026-03-27.md) (verifying automated reviewer claims against actual file state)
