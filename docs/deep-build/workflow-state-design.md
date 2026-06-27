# Deep Build — Workflow State & Commit Model (Design)

**Status:** Research / proposal (branch `jeichorn/deep-build-workflow-exploration`)
**Scope:** A new `workflow` state tool for the Deep Build orchestrator (`agents/src/prompts/deep-build/core.md`). Additive — does not modify the existing `todo-list` or `set-wizard-step` systems.

## Problem

The Deep Build orchestrator encodes a deterministic, workflow-oriented process (interview → design → plan → build → verify) as a prose decision-loop table in `core.md`. The LLM is acting as the interpreter of that state machine: every turn it must re-infer the current state from conversation history + artifact existence, then pick the matching table row. This produces inconsistency.

Three requirements make a flat static workflow insufficient:

1. **Initial site build has many extra steps** that don't apply to follow-up edits.
2. **The orchestrator must continually judge whether an ask is big enough** to warrant a full discuss → plan → build → verify loop.
3. **High-level site goals must stay in scope** across a long multi-agent build.

Observed failure modes, most common first:

- **Skipping user-input gates** — the model keeps making progress instead of pausing for required approval/input.
- **Skipping steps** — work is marked done or jumped over because "next action" is re-inferred each turn rather than tracked.

## Core idea: the plan IS the workflow

Separate two concerns that the prose table conflates:

- **Which steps** — *dynamic*, generated per project. A game, an admin app, and a marketing site emit different step lists. This is an LLM judgment call (triage + planning).
- **Execution discipline** (don't skip, enforce gates, commit on completion) — *deterministic*, applied to whatever steps the plan declares.

A deterministic **executor** does not hardcode the steps; it executes whatever typed step list it is handed. Flexibility (per-archetype plans, skippable steps when inputs are pre-supplied) is preserved; enforcement is moved out of the model.

This directly answers requirement (1) — archetype-specific step lists; (2) — triage becomes a first-class step that classifies the ask and emits the matching plan; (3) — a North Star block is re-injected every turn.

## Key decisions

### 1. State lives in `docs/`, committed with the code

State is a JSON document (`docs/workflow.json`) committed into the app repo alongside `brief.md` / `design.md`.

Rationale:
- The plan is a document (a typed-step DAG), not a relational table set — JSON fits, and there are no cross-app queries to justify SQLite.
- **Co-location fixes the stale-metadata bug:** today a `git revert` rolls back functionality but not the completion metadata (stored separately), leaving a step "complete" that no longer is. With state committed in the same commit as the code it certifies, revert rolls back plan + code **together**.
- Research-branch isolation: no migration, no shared schema, no touching tables the develop/build agents already read.
- Inspectable, diffable, hand-seedable per archetype.

Hazards accepted and mitigated (see Commit Model): commit-timing coupling, builder git ops sweeping the file, merge conflicts, PaaS git-contract differences.

### 2. Single-writer

**Only the orchestrator's `workflow` tool mutates `workflow.json`.** Sub-agents (builders, media, verification) modify the working tree and report results via `awaitAgents`; they never touch the plan file. This makes JSON safe without locking and keeps data immutable across the orchestrator↔sub-agent boundary.

### 3. Derived completion, not asserted

A step is `done` because its `verify[]` checks pass against the **current tree** (files exist, `tsc` passes, route renders), not because a boolean was once set. The asserted bit is a cache; the source of truth is re-checkable. This means a revert that removes code makes the step not-done on the next check — there is no standalone truth to drift.

### 4. File-scoped, orchestrator-owned commits

Parallel builders share one working tree; the orchestrator already partitions their file assignments to avoid collisions. We make that partition **data** (`ownedFiles` per step) so it can drive commits:

```
complete_step:  verify(step) → git add <step.ownedFiles> + workflow.json → commit
```

- The orchestrator commits (validation must precede the commit). Builders never commit.
- A step's files are committed **only after its builder returns** (`awaitAgents`) and `verify` passes — files settled, not mid-write.
- `ownedFiles` must be **disjoint across steps that can run concurrently**. Shared/registration files (route table, nav, barrels, `package.json`, lockfile, `globals.css`) belong to exactly one step — the foundation step (committed before parallel pages start) or a dedicated serialized "wire up" step. Never owned by two concurrent steps.

### 5. Typed steps and hard gates

Gates cannot be enforced by prose ("pause and ask the user") because progress competes with pausing and wins. A gate is a step the executor **refuses to complete** until a user input/approval is recorded — the same mechanism as the existing stop-after tools (`handoff`, `requestSecrets`).

### 6. Next action is computed, not inferred

`next_actions` returns steps whose `dependsOn` are satisfied and which are not done/skipped/blocked. The orchestrator is *handed* eligible steps; it never picks from a flat table. This kills step-skipping.

### 7. Explicit skips

When a pre-supplied input (e.g. an attachment) satisfies a step, it is marked `skipped` with a reason — distinct from `done` and from silent omission. Silent vs. deliberate skipping look identical in a prose loop; in the state model they are different statuses.

## Commit model & interaction with the existing git hook

### Existing behavior (traced)

`agents/src/services/git-hook-service.ts`, wired via `agents/src/server/message-lifecycle.ts` into the SSE `MessageExecutionService`:

- `handleMessageStart` — at the start of **every top-level message**, creates a timestamped feature branch off `main`. Keyed per `appId` (in-memory `Map`).
- During the turn, all tool/sub-agent changes accumulate on that branch (no per-tool commits — deliberately, to avoid `.git/index.lock` races).
- `handleConnectionEnd` — at message end, commits any leftovers with `git add .`, then **squash-merges** the branch into `main` (one commit, message = user prompt).

**Confirmed:** the hook fires per top-level message (the orchestrator turn), keyed by `appId`. Sub-agents dispatched via `run-agent.ts` do **not** independently trigger it.

### Two problems for the workflow model

1. **Squash flattens per-step commits.** Even with clean per-step commits on the feature branch, the squash collapses them into one commit on `main` — destroying per-step atomic-revert granularity.
2. **`git add .` at turn end is greedy.** It sweeps everything uncommitted, including work deliberately left uncommitted because it **failed** verification.

### Decision: `--no-ff` merge for workflow turns + turn-end reconciliation

- **Keep the feature branch** (preserves isolation, recovery, race avoidance — unchanged infrastructure).
- The orchestrator makes **file-scoped per-step commits on the feature branch** during the turn (`complete_step`).
- At turn end, the hook performs a **`--no-ff` merge instead of a squash** for workflow turns, preserving every per-step commit on `main` plus a turn-boundary merge commit.
- **Merge mode is additive and gated:** `handleConnectionEnd` gains a merge-mode parameter that **defaults to `squash` (unchanged for all existing agents)** and switches to `--no-ff` only when the active agent is the Deep Build orchestrator. A `merge` (`--no-ff`) method is added to `GitUtils`; the squash path is untouched.
- **Turn-end reconciliation rule:** before the orchestrator's turn ends, every step must be `done` (committed), `skipped`, or `failed` with its files reverted/stashed. This guarantees the greedy `git add .` failsafe finds nothing unverified to sweep — it then only folds genuine leftovers into the merge.

The existing per-message auto-commit thus remains as a **failsafe**, not the primary commit path. The orchestrator owns every meaningful commit boundary; the failsafe should almost never catch anything.

### Result

- One commit per **verified step** on `main`, plus a turn-boundary merge commit.
- Revert of a single step commit rolls back that feature **and** its `workflow.json` completion flag (same commit) → revert re-coherence.
- On the next turn the orchestrator reads `workflow.json` from the (possibly reverted) tree, sees the step `pending`, and re-does it. Git state and plan state cannot diverge — they are the same state.

## Schema

`docs/workflow.json`:

```typescript
type StepType = 'auto' | 'gate' | 'judgment';
//   auto     — deterministic transition the orchestrator executes (build, verify)
//   gate     — HARD STOP: cannot complete until user input/approval is recorded
//   judgment — orchestrator decides content (triage, design-feedback interpretation)

type StepStatus =
  | 'pending'      // deps unmet or not started
  | 'in_progress'  // a builder owns it this turn
  | 'blocked'      // gate awaiting user input
  | 'done'         // verified + committed
  | 'skipped'      // deliberately satisfied (e.g. attachment) — NOT silently dropped
  | 'failed';      // verification failed; files left uncommitted

interface VerifyCheck {
  kind: 'files_exist' | 'tsc' | 'route_renders' | 'test' | 'manual';
  spec: string;                 // glob, command, route path, or human description
}

interface GateSatisfaction {
  satisfiedBy: 'user_approval' | 'user_answer' | 'attachment';
  reference: string;            // message id, attachment path, approval token
  recordedAt: string;           // ISO; stamped by the tool, not the model
}

interface WorkflowStep {
  id: string;
  title: string;
  type: StepType;
  status: StepStatus;
  dependsOn: string[];          // DAG edges → "next eligible" is computed, not inferred
  ownedFiles: string[];         // file-scoped commit partition — MUST be disjoint across
                                //   steps that can run concurrently
  verify: VerifyCheck[];        // derived completion: re-checkable against the tree
  gate?: {                      // present iff type === 'gate'
    prompt: string;
    satisfaction?: GateSatisfaction;  // set when satisfied; absent = still blocked
  };
  commitHash?: string;          // set on done — links step ↔ commit for revert re-coherence
  assignedBuilder?: string;     // which sub-agent owns it this turn
  notes?: string;
}

interface WorkflowState {
  schemaVersion: 1;             // evolve the format loudly, not weirdly
  appId: string;
  archetype: 'marketing-site' | 'admin-app' | 'game' | 'custom';
  northStar: {                  // re-injected every orchestrator turn — fixes goal drift
    goals: string[];
    audience: string;
    voice: string;
  };
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}
```

## Tool surface

```typescript
type WorkflowOp =
  | 'init'          // triage/planning emits the step list for this archetype
  | 'get_state'     // returns full state + northStar (orchestrator reads at turn start)
  | 'next_actions'  // COMPUTED: steps whose deps are done & not done/skipped/blocked
  | 'assign'        // mark in_progress + assignedBuilder (before dispatch)
  | 'complete_step' // verify → file-scoped commit → mark done   (gated transition)
  | 'satisfy_gate'  // record GateSatisfaction; only then can a gate step complete
  | 'skip_step'     // explicit skip with reason (attachment satisfied it)
  | 'fail_step'     // verification failed; record why, leave files uncommitted
  | 'add_steps' | 'update_step';  // re-plan mid-run (e.g. interview revealed it's a game)
```

### Transitions the executor enforces (in code, not prose)

1. **`next_actions` is computed from the DAG** — orchestrator never picks from a flat table. Kills step-skipping.
2. **`complete_step` is a gate:** runs `verify[]` against the current tree → if pass, `git add <ownedFiles>` + updated `workflow.json` → commit → record `commitHash`. If `type === 'gate'` and `gate.satisfaction` is absent → **reject** (`blocked: awaiting user input`). Kills skipped gates and unverified completions.
3. **`ownedFiles` disjointness** validated at `init` / `add_steps` for steps not in a `dependsOn` relationship — the manual write-partition made enforceable, and what makes file-scoped commits safe with parallel builders.
4. **Commit only after the owning builder returns and `verify` passes.**
5. **Turn-end reconciliation** — every step `done` / `skipped` / `failed`-and-reverted before the turn ends, so the greedy failsafe sweeps nothing unverified.

## How requirements & failure modes are addressed

| Item | Mechanism |
|---|---|
| Extra steps for initial build | Archetype-specific step list emitted by `init` (triage) |
| Judge if ask is big enough | Triage is a first-class step that classifies the ask → archetype/plan; small edits get a minimal step list |
| Keep goals in scope | `northStar` re-injected every turn via `get_state` |
| Skipping user-input gates | `gate` steps rejected by `complete_step` until `satisfy_gate` records input |
| Skipping steps | `next_actions` computed from the DAG; nothing is jumped |
| Stale completion after revert | State committed with code (`docs/`) + derived completion + `--no-ff` per-step commits |
| Silent vs. deliberate skip | `skipped` status with reason, distinct from `done` |

## Agent mode persistence & active-agent detection

### Problem: deep-build selection is lost on app reopen

The agent router (`agents/src/server/agent-router.ts`) resolves the agent per-message with this priority:

1. `/agent <name>` manual override (per-message, not sticky)
2. Warm session cache (in-memory, lost on reconnect/reload)
3. **`conversations.agentId`** — the persisted frozen agent on the app's latest conversation (via `getPersistedAgentIdForApp` → `ConversationLifecycleStore.getLatestForApp`)
4. Fallback: no conversations → `initial`, else → `develop`

If the user enters deep-build from the homepage link, the first conversation freezes `deep-build`. But if a **new conversation** is later created for that app (new session, page reload that triggers fresh conversation creation), it goes through `resolveInitialAgentId` and freezes a default agent — losing deep-build.

### Solution: app-level `agentMode` in KV memory

Add a persistent per-app mode (`app.agent_mode`) in the same KV memory store used by `set-wizard-step` (key: `brand.wizard.phase`). This is checked by the agent router **between steps 2 and 3** — after the session cache but before the conversation-level lookup. When set, it overrides the default agent for new conversations.

```
Agent resolution priority (revised):
  1. /agent <name> manual override
  2. Warm session cache
  2.5 NEW: app.agent_mode KV → use that agent for this app (all conversations)
  3. conversations.agentId (frozen per-conversation)
  4. Default: initial / develop
```

**Storage:** KV memory (`getKvMemoryStore().get(scope, 'app.agent_mode')`), scoped by `WorkspaceScope` (appId + customerId). Same mechanism as wizard-step — no migration, no new table. Precedent: `set-wizard-step.ts` line 33 (`MEMORY_KEY = 'brand.wizard.phase'`).

**Setting it:** the deep-build orchestrator (or the initial entry point that activates deep-build) writes `app.agent_mode = 'deep-build'` via a tool call or initialization hook on first entry. Once set, all future conversations for that app resolve to `deep-build` without the user re-selecting.

**Active-agent detection for git hook merge mode:** the same `app.agent_mode` KV value serves as the signal for `handleConnectionEnd` to select `--no-ff` vs. squash:

```typescript
// In message-lifecycle or git-hook-service:
const mode = await memoryStore.get(scope, 'app.agent_mode')
const mergeMode = mode?.value === 'deep-build' ? 'no-ff' : 'squash'
```

This solves the "active-agent detection" open question — no need to thread `agentName` through the lifecycle params. The mode is a durable per-app property, not a per-turn transient.

## Open questions / future

- **Triage timing:** plan emitted fully at `init`, or incrementally (re-plan after the interview reveals the true archetype)? `add_steps` / `update_step` support mid-run re-planning either way.
- **Verification cost:** `verify[]` re-checks can be expensive; cache the asserted bit + `commitHash` and only re-derive when the tree HEAD changes.

## Non-goals

- Modifying `todo-list` or `set-wizard-step` (kept simple; this is a sibling system).
- Changing squash behavior for any existing agent (merge mode defaults to squash).
