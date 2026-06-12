---
title: Assessment BelowThreshold fast-path misclassifies fix follow-ups as general
date: 2026-04-21
category: logic-errors
module: assessment-agent
problem_type: logic_error
component: assistant
severity: high
symptoms:
  - contextual follow-up messages during fix sequences charged as general
  - embedding-nn confidence 100 with similarity 0.25-0.41 for vague messages
  - ~10-12 misclassifications per extended fix session
root_cause: logic_error
resolution_type: code_fix
tags:
  - assessment-agent
  - classification
  - billing
  - below-threshold
  - session-context
  - haiku-tiebreaker
---

# Assessment BelowThreshold fast-path misclassifies fix follow-ups as general

## Problem

The assessment agent's BelowThreshold fast-path (in the embedding classifier impl, `agents/src/agents/assessment-agent/embedding-classifier.ts`, reached via `assessment-classifier.ts` `classify()` -> `impl.classify()`) returned `general` (charged) at 100% confidence for contextual follow-up messages during active fix sequences. Vague messages like screenshots, error pastes, "here", and "ok" scored below the 0.50 embedding similarity threshold and were immediately classified as general without consulting Haiku, even though Haiku could correctly identify them as fix continuations using `previousUserMessage` context.

## Symptoms

- App 42o8hi8n25 (Crimson Foundation): 14-hour fix loop, ~10-12 of 68 classifications incorrectly charged as general
- All misclassified messages had `method: embedding-nn`, `confidence: 100`, `similarity: 0.25-0.41`
- Misclassified messages sandwiched between confirmed fix entries in the assessment timeline
- Customer purchased 10 credit packs ($2,500 in credits) to keep working through an agent-created error cascade
- Customer rated experience 3/7 (Somewhat Negative)

## What Didn't Work

- **Concatenating previous + current message before embedding** (session history): Considered but rejected because it changes the embedding input contract and invalidates 568 existing eval cases. Would require re-baselining the entire eval suite.
- **Error-context-aware classification** (session history): A broader approach tracking tool error state (`previousInteractionHadErrors`, `toolErrorCount`) was planned but abandoned after deepening analysis showed 30-40% of messages would get +2-3s latency for a feature that only changes classification in ~5-10% of cases. The session context approach is simpler and addresses the same root problem.
- **TTL-based cache expiration**: Unnecessary complexity. Self-healing cache (updating on every classification including general) eliminates staleness without time-based logic.
- **Generic `extraMetadata: Record<string, unknown>`**: Initial implementation used a loosely typed metadata bag. Reviewer correctly pointed out a typed `sessionContextGated: boolean` parameter is clearer since only one value is ever passed.

## Solution

Added a session context gate in the BelowThreshold branch (PR #2981):

**1. New context field** (`types.ts`):
```typescript
interface AssessmentContext {
  // ... existing fields
  previousAssessmentTaskType?: AssessmentTaskType
}
```

**2. Session context gate** (embedding classifier BelowThreshold branch): Compute `hasActiveNonGeneralSession` from the previous assessment task type. When it holds and the embedding result is `General`, the message routes to Haiku (`tiebreakerReason: 'session_context_gate'`, logged via `assessment_agent.decision.haiku_needed`), passing `hasActiveNonGeneralSession` through to `callHaikuTiebreaker`:
```typescript
const hasActiveNonGeneralSession = context?.previousAssessmentTaskType != null
  && context.previousAssessmentTaskType !== AssessmentTaskType.General

const sessionContextNeedsHaiku = hasActiveNonGeneralSession
  && result.taskType === AssessmentTaskType.General

// ... if Haiku is needed:
return this.callHaikuTiebreaker(prompt, result, context, startTime, hasActiveNonGeneralSession)
```

**3. Self-healing cache** (`ai-lib-websocket-server.ts`): New `lastAssessmentTaskTypeCache` Map with same lifecycle as `lastUserMessageCache`. Updates on every classification (including general), so the gate only fires at intent-transition boundaries:
```typescript
const lastAssessmentTaskTypeCache = new Map<string, AssessmentTaskType>()

// After classify() returns:
if (assessmentOutcome.result?.taskType) {
  lastAssessmentTaskTypeCache.set(socketId, assessmentOutcome.result.taskType)
}
```

**4. Observability**: `sessionContextGated: boolean` parameter on `callHaikuTiebreaker` propagates through all `buildOutcome` calls (timeout, completed, error, skipped) for Langfuse analysis.

## Why This Works

The BelowThreshold path was the only branch in the embedding classifier impl that ignored multi-turn context. Both the high-confidence embedding path and the medium-confidence Haiku path handled session context correctly. The fix closes this gap by routing BelowThreshold cases through Haiku when session context indicates a non-general task is active.

Note: the classifier was later restructured into pluggable impls -- `assessment-classifier.ts` orchestrates via `classify()` -> `impl.classify()`, with the embedding logic in `embedding-classifier.ts`, an LR variant in `lr-classifier.ts`, and selection in `classifier-factory.ts`. The session-context gate, self-healing cache, and Haiku tiebreaker described above remain live.

The self-healing cache is the key design insight: by updating on every classification (not just non-general ones), the gate automatically deactivates when intent truly shifts. Once Haiku confirms a message is general, the cache updates, and subsequent below-threshold messages fast-path normally. Extra Haiku calls are bounded to ~1 per intent-transition boundary.

Gates on all non-general types (fix, publish, domain) because publish ("go ahead") and domain ("yes that one") follow-ups have the same ambiguity pattern.

## Prevention

- **Corpus eval cases for session context**: 10 eval cases added covering vague follow-ups during active fix/publish/domain sessions (`fix-scg-001` through `fix-scg-006`, `pub-scg-001/002`, `dom-scg-001/002`), including negative cases where Haiku correctly returns general despite active session
- **Monitor `sessionContextGated` frequency**: Track gate activation via `assessment_agent.decision.session_context_gate` log events and `sessionContextGated: true` metadata on Haiku outcomes. High frequency suggests embedding classifier needs tuning.
- **Cache lifecycle consistency**: `lastAssessmentTaskTypeCache` follows `lastUserMessageCache` lifecycle (set after classify, deleted on disconnect only). Any new per-socket state should follow the same pattern.
- **Non-determinism awareness**: Two identical messages get different classification paths depending on session history. Langfuse calibration analysis should filter by `sessionContextGated` to isolate the effect.

## Related Issues

- Complementary approach (deferred): an error-context gate that classifies fix follow-ups from error signals rather than session history.
- Downstream impact: `docs/solutions/architecture-patterns/cost-attribution-sdk-native-over-custom-tracker-2026-04-24.md` (assessment task type feeds per-call cost attribution)
- PR: #2981
- Jira: AIROBUILD-1354
