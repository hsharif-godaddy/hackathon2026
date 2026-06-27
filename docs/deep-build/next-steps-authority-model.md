# Next Steps: Observer → Authority Model

This document outlines the architectural evolution planned for the workflow state system,
based on review feedback identifying that the current passive-observation approach is
prototype scaffolding rather than the endstate.

## Current State (This PR)

The workflow system observes tool calls *after* they execute via `afterToolExecution` and
infers state transitions from the results. This is correct enough for the happy path but
has structural limitations:

- The workflow can refuse to *track* a step, but cannot *prevent* a bad dispatch
- `computeNextActions` exists but is advisory (display hint), not enforced in the control path
- Gate satisfaction is content-blind (any user message resolves the gate)
- Git commit path uses greedy `git add .` with pre-commit reconciliation as a safety net

## Phase 1: Centralized Workflow Authority

**Goal:** Flip from post-hoc observation to pre-dispatch validation.

### Workflow Service API

Replace the afterToolExecution observer with a centralized service that both `runAgent`
and the `workflow` tool are subordinate to:

```
canAssignStep(appId, stepId) → { allowed: boolean, reason?: string, eligible?: string[] }
assignStep(appId, stepId, mode) → { runId, baselineCommit }
completeRun(appId, runId, result) → void
failRun(appId, runId, error) → void
resolveGate(appId, stepId, resolution) → void
```

Key behaviors:
- `canAssignStep` validates: step exists, status is assignable, deps resolved, owned files safe
- On rejection, returns *why* and *what's eligible* — prevents LLM thrashing on bare refusals
- `assignStep` takes a pre-dispatch lease: records `baselineCommit`, transitions to `in_progress`
- `runAgent` calls `assignStep` *before* launching the sub-agent, not after

### Run/Attempt Model

Replace `assignedBuilder: jobId` with a first-class attempt abstraction:

```typescript
interface StepAttempt {
  runId: string
  mode: 'background' | 'interactive'
  agent: string
  status: 'running' | 'success' | 'failed' | 'aborted'
  baselineCommit: string
  ownedFiles: string[]
  startedAt: string
  finishedAt?: string
}

interface WorkflowStep {
  // ... existing fields ...
  attempts: StepAttempt[]
  // assignedBuilder removed — derived from latest running attempt
}
```

This unifies background jobs, interactive sessions, retries, and continuations under one
model. A failed step with a new attempt is self-evidently a retry — no special re-assign logic.

## Phase 2: Step-Aware Git

**Goal:** Failed/unverified work never reaches mainline.

### Option A: Isolated Worktrees (Preferred)

Each step runs in an isolated worktree/branch. Merge to main only after verification passes.
The codebase already has worktree isolation primitives. This eliminates the owned-files
whitelisting problem (builders routinely touch files outside declared `ownedFiles` — lockfiles,
shared config, generated output).

### Option B: Baseline + Revert (Pragmatic)

- Record `baselineCommit` at step assignment
- Track owned files during execution
- On failure: `git checkout <baselineCommit> -- <ownedFiles>` immediately (not at turn-end)
- Final commit stages only `done`/`skipped` step files + `workflow.json`
- Replace greedy `git add .` with explicit file staging

### Decision Needed

Worktrees are cleaner but add ~200-500ms setup per step plus disk overhead. For a 12-step
plan that's ~3-6s total. The trade-off is correctness (worktrees can't under-commit) vs
latency. Likely worth it given deep-build apps are long-running.

## Phase 3: Gate Identity + Intent

**Goal:** Gate satisfaction tied to content, not turn cadence.

### Minimum Viable

- Tie gate resolution to a specific `askQuestion` call ID (already partially done — only one
  gate blocks at a time, and we resolve only the first blocked gate per turn)
- Add a structured approve/reject affordance in the chat UI (button or explicit phrase)

### Full Version

- Cheap LLM classifier on the user's response: approve / reject / clarify / unrelated
- On reject: gate stays blocked, response fed back to the orchestrator as context
- On clarify: gate stays blocked, follow-up question issued
- On unrelated: gate stays blocked, response routed to normal agent handling

## Phase 4: Context Optimization (Deferred)

Current all-steps injection is fine for ~12-step plans. When plans grow larger:
- Trim to: north-star + progress summary + `next_eligible` + active/failed/blocked steps
- Full DAG remains available via `workflow({ operation: "get_state" })`
- Don't cut to "last 3 completed" — model needs global view for coherent decisions

## Open Question: workflow.json Storage

Currently `workflow.json` lives in the customer's git repo. This is defensible if rollback
must restore workflow state and code atomically together. But `agent_mode` went to
server-side KV instead. Worth deciding explicitly:

- **In git:** rollback restores both code and workflow state atomically. Merge conflicts
  possible if multiple sessions touch the same app.
- **In KV:** faster reads (no workspace round-trip), no merge conflicts, but rollback
  only affects code — workflow state may be stale.

Current choice (git) is reasonable for now given the atomic-rollback benefit.

## Sequencing

| Phase | Scope | Depends On |
|-------|-------|-----------|
| 1 | Authority model + attempt abstraction | — |
| 2 | Step-aware git | Phase 1 (needs baselineCommit from attempts) |
| 3 | Gate intent | Independent (can parallel with 1-2) |
| 4 | Context optimization | After plans grow beyond ~20 steps |
