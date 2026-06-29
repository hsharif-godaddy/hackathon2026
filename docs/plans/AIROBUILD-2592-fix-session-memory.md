# AIROBUILD-2592: Fix Session Memory for Assessment Classifier

## Context

**Problem**: The assessment classifier has one-turn memory. It stores only the single previous assessment task type in `LifecycleSessionStore`. When a user starts a fix conversation ("fix my button"), the agent asks follow-up questions, and the user responds with something ambiguous ("Chrome"), the classifier may mark it as General — charging the customer. Once any intermediate turn is classified as General, the session context gate breaks permanently: all subsequent turns lose fix context.

**Affected apps**: `9bnwrbgar7`, `8zyi9c6wk5`, `59jf813osm`

**Real-world scenario**:
1. "fix my button" → Fix (stored)
2. Agent: "What browser?" 
3. "Chrome" → Gate fires (prev=Fix), Haiku checks → maybe says General → chain **broken**
4. "it still doesn't work" → NO gate fires (prev=General now) → customer charged

**Goal**: Same-bug follow-ups remain attributed to GoDaddy regardless of phrasing, as long as the user hasn't moved on to new unrelated work.

---

## Approach: Execution-Aware Fix Session

### State Machine

```
┌─────────────┐   Fix classified (≥65%)    ┌──────────────────┐
│ No Session  │ ──────────────────────────> │ active:gathering │
└─────────────┘                             └──────────────────┘
                                                     │
                     agent used str_replace_based_edit_tool + no askQuestion/suggestedResponse
                                                     │
                                                     v
┌─────────────┐  Haiku: General ≥80% confidence  ┌──────────────────┐
│ No Session  │ <─────────────────────────────── │ active:attempted │
└─────────────┘                                  └──────────────────┘
                                                     │
                                      Haiku: Fix (user reports still broken)
                                                     │
                                                     v
                                             ┌──────────────────┐
                                             │ active:gathering │
                                             └──────────────────┘

Safety: Turn count guard auto-ends session after N=5 turns
```

### Key Behaviors

- **gathering**: Agent hasn't attempted a fix yet (asking questions via `askQuestion`/`suggestedResponse` tools, or only reading/searching). Session context gate ensures Haiku is always called (with expanded context) when LR says General. Haiku has fix-session-aware prompt that biases toward Fix for ambiguous messages.
- **attempted**: Agent used `str_replace_based_edit_tool` (code changes) WITHOUT calling `askQuestion`/`suggestedResponse` (no follow-up question). Haiku's bias shifts toward General (fix was attempted, conversation may be winding down). User's next message determines: positive resolution / new topic → session ends; complaint → back to gathering.
- **Classification pipeline unchanged**: LR always runs first. If LR says Fix → fast path (no Haiku needed, session stays active). If LR says General AND fix session active → gate fires → Haiku called with expanded context.
- **Billing interaction**: Fix session does NOT bypass billing. Only messages Haiku explicitly classifies as Fix (confidence ≥65%) get `overrideApplied = true` (GoDaddy pays). General classifications during a fix session = customer pays, but session stays active for next turn.

### Safety Nets

1. **Customer still pays for General**: Session staying "active" only means Haiku gets called — it doesn't auto-override billing
2. **Turn count guard (N=5)**: Auto-ends session if it hasn't terminated naturally. Prevents runaway sessions.
3. **Phase-aware Haiku bias**: During `attempted` phase, Haiku's bias shifts toward General (easier to end the session after a fix attempt)
4. **80% confidence threshold**: Only high-confidence General ends the session

---

## Observability

Structured logs (following `logger.info/warn("domain.operation.lifecycle", { data })` convention) at each fix session lifecycle event:

| Event | Log Key | Fields |
|-------|---------|--------|
| Fix session activated | `fix_session.activated` | appId, sessionKey, confidence, classifierMode, reason (AssessmentReason) |
| Phase transition → attempted | `fix_session.phase.attempted` | appId, sessionKey, turnCount, codeToolsUsed (tool names list) |
| Phase transition → gathering (retry) | `fix_session.phase.gathering_retry` | appId, sessionKey, turnCount, haikuConfidence, haikuReasoning |
| Fix session ended (topic change) | `fix_session.ended.topic_change` | appId, sessionKey, turnCount, haikuConfidence, haikuReasoning, phase |
| Fix session ended (turn guard) | `fix_session.ended.turn_guard` | appId, sessionKey, turnCount, phase, lastHaikuReasoning |
| Session gate fired (fix session) | `assessment_agent.decision.haiku_needed` | reason: `'fix_session_gate'`, fixSessionPhase, lrTaskType, lrConfidence |
| Haiku result in fix session | `fix_session.haiku_result` | appId, sessionKey, haikuTaskType, haikuConfidence, haikuReasoning, fixSessionPhase |

These enable:
- **Dashboards**: Fix session activation rate, average turn count, end-reason distribution
- **Alerting**: Turn guard firing rate (high rate = sessions not ending naturally, prompt tuning needed)
- **Debugging**: Full lifecycle trace for any conversation via appId + sessionKey filter
- **Billing audit**: Cross-reference `fix_session.activated` with `budget.report.fix_intent_override` to verify attribution correctness

---

## Implementation Steps

### Step 0: Discovery — Langfuse Trace Analysis

Query Langfuse for real failure conversations from affected apps (`9bnwrbgar7`, `8zyi9c6wk5`, `59jf813osm`). Find conversations where:
- Message N classified as Fix → Message N+1 or N+2 classified as General
- The classified-as-General message was clearly a fix follow-up

Build corpus test cases from these real traces (with `fixSessionActive: true`, `recentUserMessages` from actual history).

---

### Step 1: Extend `AssessmentContext` types

**File**: `agents/src/agents/assessment-agent/types.ts`

Add to `AssessmentContext` interface (after line 85):
```typescript
/** True when a fix session is active for this session (gathering or attempted). */
fixSessionActive?: boolean
/** Recent user messages (last 3, oldest-first) for expanded Haiku context. */
recentUserMessages?: string[]
/** The current fix session phase. */
fixSessionPhase?: 'gathering' | 'attempted'
```

---

### Step 2: Extend `LifecycleSessionStore`

**File**: `agents/src/server/message-lifecycle.ts`

New state + methods on the class:
```typescript
type FixSessionPhase = 'gathering' | 'attempted'

// New Maps:
private fixSessionPhase = new Map<string, FixSessionPhase>()
private recentUserMessages = new Map<string, string[]>()
private fixSessionTurnCount = new Map<string, number>()
```

Methods:
- `isFixSessionActive(key)` — `fixSessionPhase.has(key)`
- `getFixSessionPhase(key)` — returns phase or undefined
- `activateFixSession(key)` — sets phase=gathering, turnCount=0
- `transitionToAttempted(key)` — sets phase=attempted
- `transitionToGathering(key)` — sets phase=gathering (retry after "still broken")
- `deactivateFixSession(key)` — deletes from maps
- `incrementFixSessionTurns(key)` — increments turn counter, returns new count
- `getRecentUserMessages(key)` — returns array or []
- `pushUserMessage(key, msg)` — appends, keeps max 3
- Update `clearSession()` to clear all new maps

Named constants:
```typescript
export const FIX_SESSION_END_CONFIDENCE = 80
export const FIX_SESSION_MAX_TURNS = 5
const RECENT_MESSAGES_WINDOW = 3
```

---

### Step 3: Fix session lifecycle in store population

**File**: `agents/src/server/message-lifecycle.ts`

In `runStartAssessment()` (~line 140):
1. Read fix session state from store and pass to classify:
   ```typescript
   fixSessionActive: sessionStore.isFixSessionActive(sessionKey),
   recentUserMessages: sessionStore.getRecentUserMessages(sessionKey),
   fixSessionPhase: sessionStore.getFixSessionPhase(sessionKey),
   ```
2. After classification (after line 166), manage lifecycle:
   - Always `pushUserMessage()` and `incrementFixSessionTurns()`
   - **Start**: NOT in session AND Fix with confidence ≥ 65 → `activateFixSession()`
   - **End (topic change)**: IN session, phase=attempted AND General ≥ 80% → `deactivateFixSession()`
   - **End (turn guard)**: turn count ≥ `FIX_SESSION_MAX_TURNS` (5) → `deactivateFixSession()`
   - **Retry**: IN session, phase=attempted AND Fix → `transitionToGathering()` (still broken)
   - If General with confidence < 80% → session stays active (ambiguous, keep context)

Apply same logic to `startParallelAssessment()` (in `.then()` callback).

---

### Step 4: Post-execution phase transition

**File**: `agents/src/server/sse/MessageExecutionService.ts` (~line 2553, after turn completes)

After the agent turn completes, update fix session phase based on **execution step tool usage** (not text heuristics):

```typescript
const sessionKey = sseSessionKey(conversationId)
if (this.deps.sessionStore.isFixSessionActive(sessionKey)
    && this.deps.sessionStore.getFixSessionPhase(sessionKey) === 'gathering') {
  const askedQuestion = agentAskedQuestion(allExecutionSteps)
  const madeCodeChanges = agentMadeCodeChanges(allExecutionSteps)

  if (madeCodeChanges && !askedQuestion) {
    this.deps.sessionStore.transitionToAttempted(sessionKey)
  }
  // If agent asked a question (even alongside code changes) → stay in gathering
  // If agent only read/searched (no code tools, no question tools) → stay in gathering
}
```

Helpers (in `message-lifecycle.ts` or `fix-session-utils.ts`, exported for testing):
```typescript
/** Tools that explicitly ask the user a question (stop-after tools that pause execution). */
const QUESTION_TOOLS = new Set(['askQuestion', 'suggestedResponse'])

/** Tools that modify customer code — the definitive signal of a fix attempt. */
const CODE_MODIFICATION_TOOLS = new Set(['str_replace_based_edit_tool'])

export function agentAskedQuestion(steps: ExecutionStep[]): boolean {
  return steps.some(step =>
    step.content.some(item =>
      item.type === 'tool-call' && item.toolName && QUESTION_TOOLS.has(item.toolName)
    )
  )
}

export function agentMadeCodeChanges(steps: ExecutionStep[]): boolean {
  return steps.some(step =>
    step.content.some(item =>
      item.type === 'tool-call' && item.toolName && CODE_MODIFICATION_TOOLS.has(item.toolName)
    )
  )
}
```

**Why this is reliable** (vs. the "?" text heuristic):
- `askQuestion` is a stop-after tool — when called, execution pauses for user input. 100% means "agent asked a question."
- `str_replace_based_edit_tool` is the ONLY code modification tool. 100% means "agent changed code."
- No false positives from ternary operators, URLs, or code blocks
- No multilingual concerns — tool names are constants

---

### Step 5: Update session context gate

**File**: `agents/src/agents/assessment-agent/assessment-classifier.ts` (lines 73-77)

Replace:
```typescript
const hasActiveNonGeneralSession = context?.previousAssessmentTaskType != null
  && context.previousAssessmentTaskType !== AssessmentTaskType.General
const sessionContextNeedsHaiku = hasActiveNonGeneralSession
  && result.taskType === AssessmentTaskType.General
```

With:
```typescript
const hasActiveNonGeneralSession = context?.previousAssessmentTaskType != null
  && context.previousAssessmentTaskType !== AssessmentTaskType.General
const fixSessionNeedsHaiku = context?.fixSessionActive === true
  && result.taskType === AssessmentTaskType.General
const sessionContextNeedsHaiku = (hasActiveNonGeneralSession || fixSessionNeedsHaiku)
  && result.taskType === AssessmentTaskType.General
```

`fixSessionNeedsHaiku` fires even when `previousAssessmentTaskType` is General — solving the broken-chain problem.

---

### Step 6: Expand Haiku context for fix sessions

**File**: `agents/src/agents/assessment-agent/assessment-classifier.ts`

Update `callHaiku()` method (~line 297):
- Add parameter: `fixSessionContext?: { active: boolean; recentMessages?: string[]; phase?: 'gathering' | 'attempted' }`
- When `fixSessionContext.active` and `recentMessages` present, build expanded prompt:
  ```xml
  <fix_session_active>true</fix_session_active>
  <fix_session_phase>{gathering|attempted}</fix_session_phase>
  <recent_messages>
  <message index="0">{msg1, max 150 chars}</message>
  <message index="1">{msg2, max 150 chars}</message>
  </recent_messages>
  <user_prompt>{current, max 500 chars}</user_prompt>
  ```
- When not in fix session, keep existing `<previous_message>` + `<user_prompt>` format unchanged

Update call site in `callHaikuTiebreaker()` (~line 195).

---

### Step 7: Update Haiku system prompt

**File**: `agents/src/agents/assessment-agent/classifier-factory.ts`

Change `getHaikuSystemPrompt(mode)` → `getHaikuSystemPrompt(mode, fixSessionActive?)`. When `fixSessionActive = true`, append `FIX_SESSION_ADDENDUM`:

```
FIX SESSION CONTEXT:
A fix session is currently active. A prior message was classified as a fix request.

WHEN <fix_session_active>true</fix_session_active> IS PRESENT:
- Review <recent_messages> for full conversation context

GATHERING PHASE (<fix_session_phase>gathering</fix_session_phase>):
- Agent is still investigating or asking questions
- STRONGLY bias toward "fix" — the user is likely answering agent questions
- Short responses ("Chrome", "yes", "the red one", "on mobile") → fix
- Clarifications and confirmations → fix
- Only classify as "general" for CLEARLY new, unrelated topics (confidence ≥80)

ATTEMPTED PHASE (<fix_session_phase>attempted</fix_session_phase>):
- Agent already made code changes (attempted the fix)
- Positive resolution signals ("thanks", "that worked", "looks good", "perfecto") → general (≥80 confidence)
- Complaints/bug reports ("still broken", "that didn't work", "same error") → fix
- Clear new topics ("add a gallery", "now publish my app") → general (≥80 confidence)
- Ambiguous messages → lean toward general (fix was attempted, conversation winding down)
```

---

### Step 8: Corpus eval test cases

**File**: `evals/corpus-eval/corpora/assessment-agent/fix.yaml` (add new section)

**File**: `evals/corpus-eval/src/corpus/types.ts` (extend TestCase with new fields)

**File**: `evals/corpus-eval/src/evaluators/assessment-evaluator.ts` (pass new context fields)

New test cases tagged `fix-session`:
- **Gathering — ambiguous follow-ups** (expect: fix):
  - `fixSessionActive: true`, `fixSessionPhase: gathering`, `previousAssessmentTaskType: general` (broken chain)
  - Prompts: "Chrome", "yes", "the submit one", "on mobile", "Safari on iPhone"
- **Gathering — clear new topic** (expect: general):
  - `fixSessionActive: true`, `fixSessionPhase: gathering`
  - Prompts: "add a contact form", "now publish my app", "create a new page for recipes"
- **Attempted — positive resolution** (expect: general):
  - `fixSessionActive: true`, `fixSessionPhase: attempted`
  - Prompts: "thanks", "that worked", "looks good", "perfecto", "merci"
- **Attempted — still broken** (expect: fix):
  - `fixSessionActive: true`, `fixSessionPhase: attempted`
  - Prompts: "still broken", "nope same error", "that didn't help"
- **Multilingual** (both phases, multiple languages)
- **Real traces** from Langfuse (Step 0)

---

### Step 9: Unit tests

**File**: `agents/src/agents/assessment-agent/__tests__/Classifier.test.ts`

New `describe('fix session memory')`:
- Gate fires when `fixSessionActive=true` even if `previousAssessmentTaskType=General`
- Expanded context passed to Haiku prompt (verify XML structure)
- Phase-aware Haiku bias (gathering biases Fix, attempted biases General)
- No gate when `fixSessionActive=false`

**File**: `agents/src/server/__tests__/message-lifecycle.test.ts`

- `LifecycleSessionStore` fix session methods (all transitions, turn count, sliding window, clearSession)
- `runStartAssessment` lifecycle: start, end (topic change), end (turn guard), retry (attempted→gathering)
- `startParallelAssessment` same lifecycle in `.then()` path
- `agentAskedQuestion` and `agentMadeCodeChanges` helpers
- `isFixSessionActive` integration with MessageExecutionService post-turn hook

---

## Testing Strategy

| Phase | Method | Purpose |
|-------|--------|---------|
| **Pre-implementation** | Langfuse query on affected apps | Discover real failure patterns, build realistic corpus cases |
| **Pre-implementation** | Run existing corpus eval (baseline) | `pnpm --filter corpus-eval eval:assessment` — capture current accuracy |
| **Post-implementation** | Run corpus eval (new cases) | `eval run --tags "fix-session"` — verify new cases pass |
| **Post-implementation** | Run full corpus eval (regression) | Verify no accuracy regression on existing 568 cases |
| **Post-deploy** | Langfuse monitoring | Watch `assessment_agent.decision.haiku_needed` with `reason=session_context_gate` for fix sessions activating |

**Accuracy targets:**
- Existing categories: maintain current accuracy (>85% overall)
- Fix-session gathering: >90% (these are high-signal scenarios with strong context)
- Fix-session attempted (end detection): >85%

---

## Files to Modify

| File | Change |
|------|--------|
| `agents/src/agents/assessment-agent/types.ts` | Add context fields |
| `agents/src/server/message-lifecycle.ts` | Extend store, lifecycle management, helpers |
| `agents/src/agents/assessment-agent/assessment-classifier.ts` | Update gate + expand Haiku context |
| `agents/src/agents/assessment-agent/classifier-factory.ts` | Update prompt with fix session addendum |
| `agents/src/server/sse/MessageExecutionService.ts` | Post-turn phase transition (~10 lines) |
| `evals/corpus-eval/src/corpus/types.ts` | Extend TestCase schema |
| `evals/corpus-eval/src/evaluators/assessment-evaluator.ts` | Pass new context fields |
| `evals/corpus-eval/corpora/assessment-agent/fix.yaml` | Add fix-session test cases |
| `agents/src/agents/assessment-agent/__tests__/Classifier.test.ts` | Fix session unit tests |
| `agents/src/server/__tests__/message-lifecycle.test.ts` | Store + lifecycle unit tests |

## Existing Code to Reuse

- `LifecycleSessionStore` Map pattern (`message-lifecycle.ts:41-63`)
- Session context gate logic (`assessment-classifier.ts:73-77`)
- Haiku XML prompt format (`assessment-classifier.ts:306-313`)
- `buildOutcome()` method (`assessment-classifier.ts:351-373`)
- `StepContentItem.toolName` for tool detection (`ai-lib/src/budget/cost-attribution/types.ts:222-236`)
- `allExecutionSteps` + `lastTurnResult.accumulatedContent` at finalization (`MessageExecutionService.ts:2553-2593`)
- Test helpers: `lrFix()`, `lrGeneral()`, `makeOutcome()` (`Classifier.test.ts:81-105`)
- `MIN_CONFIDENCE_FOR_OVERRIDE` constant (`assessment-classifier.ts:29`)
- Corpus eval infrastructure (`evals/corpus-eval/`)
- Assessment evaluator with `previousMessage`/`previousAssessmentTaskType` support

## Verification

1. **Unit tests**: `pnpm --filter @airo/agents test:unit "assessment"` + `"lifecycle"`
2. **Corpus evals**: `pnpm --filter corpus-eval eval:assessment` (full) + `--tags "fix-session"` (new)
3. **Typecheck**: `pnpm typecheck`
4. **Lint**: `pnpm lint`
5. **Manual scenario** (local dev):
   - "fix my button" → Fix, session=gathering
   - "Chrome" → Haiku called, returns Fix → GoDaddy pays
   - Agent makes edits, responds without asking question → session=attempted
   - "that worked thanks" → Haiku: General ≥80% → session ends
   - OR "still broken" → Haiku: Fix → session=gathering (retry)
