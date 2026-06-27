# Deep Build — Workflow State Implementation Plan

**Branch:** `jeichorn/deep-build-workflow-exploration`
**Prereq:** design in `docs/deep-build/workflow-state-design.md`

---

## Phase 1: Agent mode persistence (unblocks everything else)

### 1.1 Write `app.agent_mode` on deep-build entry

**File:** `agents/src/agents/deep-build-agent.ts` (or a new `agents/src/tools/ai-lib-tools/set-agent-mode.ts`)

- On first deep-build activation (e.g. the orchestrator's first turn, or a dedicated `setAgentMode` tool call), write:
  ```typescript
  memoryStore.set(scope, 'app.agent_mode', { mode: 'deep-build' })
  ```
- Use the same `getKvMemoryStore()` + `workspaceScopeFromAppId` pattern as `set-wizard-step.ts`.

### 1.2 Agent router reads `app.agent_mode`

**File:** `agents/src/server/agent-router.ts`

- After step 2 (session cache check) and before step 3 (persisted conversation agent):
  ```typescript
  // 2.5 App-level agent mode override
  const agentMode = await deps.getAppAgentMode?.(appId)
  if (agentMode) {
    if (session) rehydrateSession(session, agentMode, 'agent_router.app_mode_rehydrate_error')
    return agentMode
  }
  ```
- Add `getAppAgentMode?: (appId: string) => Promise<string | undefined>` to `AgentRouterDeps`.
- Wire it in `agents/src/server/app.ts`:
  ```typescript
  getAppAgentMode: async (appId) => {
    const result = await memoryStore.get(workspaceScopeFromAppId(appId), 'app.agent_mode')
    return result?.value?.mode
  }
  ```

### 1.3 Verify: reopen an app → deep-build resolves

Manual test: enter deep-build → close → reopen → confirm agent is `deep-build` (check logs for `agent_router.persisted_agent` or the new `agent_router.app_mode` log line).

---

## Phase 2: Workflow state JSON store + tool

### 2.1 Type definitions

**New file:** `agents/src/workflow/types.ts`

Define the types from the design doc: `StepType`, `StepStatus`, `VerifyCheck`, `GateSatisfaction`, `WorkflowStep`, `WorkflowState`. Export them.

### 2.2 Workflow store (read/write/compute)

**New file:** `agents/src/workflow/workflow-store.ts`

Responsibilities:
- `read(appId): WorkflowState | null` — read `docs/workflow.json` from the app workspace.
- `write(appId, state): void` — atomic write (temp + rename) via workspace file API.
- `nextActions(state): WorkflowStep[]` — compute eligible steps (deps satisfied, not done/skipped/blocked).
- `validateDisjoint(steps): Error[]` — check `ownedFiles` disjointness for concurrent steps.

Use `createForWorkspace(appId, 'preview').files` for reads/writes (same as `set-wizard-step`'s brand-tokens path).

### 2.3 Workflow tool (AI-lib)

**New file:** `agents/src/tools/ai-lib-tools/workflow.ts`

Zod schema for tool input:
```typescript
z.object({
  operation: z.enum(['init', 'get_state', 'next_actions', 'assign', 'complete_step',
                     'satisfy_gate', 'skip_step', 'fail_step', 'add_steps', 'update_step']),
  // per-operation fields ...
})
```

Key enforcement (in the tool, not the prompt):
- `complete_step`: reject if `type === 'gate'` and `gate.satisfaction` absent; run `verify[]`; on pass → git commit (Phase 3) → set status `done`.
- `next_actions`: pure computation from the DAG, returned to model.
- `init`: validate `ownedFiles` disjointness; write initial state.
- `skip_step`: require a reason string.

### 2.4 Register tool with deep-build agent

**File:** `agents/src/agents/deep-build-agent.ts`

Add `workflow: allAILibTools.workflow` to the tools map.

**File:** `agents/src/tools/ai-lib-tools/index.ts`

Register the new `workflowAITool`.

### 2.5 Unit tests

**New file:** `agents/src/workflow/__tests__/workflow-store.test.ts`

- `nextActions` computation (DAG traversal, respects deps, skips done/skipped)
- `validateDisjoint` (catches overlapping `ownedFiles`)
- Gate enforcement (complete_step rejects unsatisfied gates)

---

## Phase 3: File-scoped commits in `complete_step`

### 3.1 Add `GitUtils.addFilesAndCommit` (file-scoped)

**File:** `agents/src/utils/git.ts`

New method that:
1. `git add <specific files>` (not `.`)
2. `git commit -m <step title>`
3. Returns the commit hash

This is distinct from the existing `addFiles` + `commit` because it's a single atomic operation that only stages the listed files.

### 3.2 Wire into `complete_step`

**File:** `agents/src/workflow/workflow-store.ts` (or the tool itself)

On successful verification:
```typescript
const hash = await gitUtils.addFilesAndCommit(appPath, [...step.ownedFiles, 'docs/workflow.json'], commitMessage)
step.commitHash = hash
step.status = 'done'
// write updated workflow.json (already staged in the commit above)
```

Order matters: update `workflow.json` first (set status = done, commitHash), then stage + commit both the owned files and the updated `workflow.json` together.

### 3.3 Turn-end reconciliation

**File:** `agents/src/workflow/workflow-store.ts`

Export a `reconcileBeforeTurnEnd(appId)` function that the orchestrator must call before its turn ends:
- For each step in `failed` status: `git checkout -- <step.ownedFiles>` (revert to last committed state)
- This ensures the greedy `git add .` failsafe finds no unverified work.

The orchestrator prompt instructs it to call this (or it's wired into the tool's post-turn hook).

---

## Phase 4: `--no-ff` merge mode for deep-build turns

### 4.1 Add `GitUtils.mergeNoFf`

**File:** `agents/src/utils/git.ts`

```typescript
async mergeNoFf(repoPath: string, branch: string, message: string): Promise<string> {
  // git merge --no-ff <branch> -m <message>
  // returns the merge commit hash
}
```

### 4.2 Merge mode selection in git-hook-service

**File:** `agents/src/services/git-hook-service.ts`

In `handleConnectionEnd`, after the final commit on the feature branch:
```typescript
const mode = await memoryStore.get(scope, 'app.agent_mode')
if (mode?.value?.mode === 'deep-build') {
  // --no-ff merge: preserves per-step commits on main
  await gitUtils.mergeNoFf(app.path, currentBranch, squashMessage)
} else {
  // existing squash merge (unchanged)
  await gitUtils.squashMerge(app.path, currentBranch, squashMessage)
}
```

### 4.3 Verify: per-step commits survive on main

Manual test: run a deep-build with 2+ steps → inspect `git log --oneline` on main → confirm N step commits + 1 merge commit (not 1 squashed commit).

---

## Phase 5: Verification checks (`verify[]`)

### 5.1 Verification runner

**New file:** `agents/src/workflow/verify-runner.ts`

Implements each `VerifyCheck.kind`:
- `files_exist`: glob against workspace → pass if all match at least one file.
- `tsc`: run `npx tsc --noEmit` via workspace tasks → pass if exit 0.
- `route_renders`: (future) hit the preview server at the route path → pass if 200.
- `test`: (future) run a specific test command → pass if exit 0.
- `manual`: always passes (orchestrator judgment).

### 5.2 Wire into `complete_step`

Before committing, run all `step.verify[]` checks. If any fail → set `status = 'failed'`, record failure reason in `step.notes`, return error to orchestrator.

---

## Phase 6: Orchestrator prompt update

### 6.1 Replace the decision-loop table

**File:** `agents/src/prompts/deep-build/core.md`

Replace the prose state machine with instructions to use the `workflow` tool:
- On every turn: call `get_state` (reads `northStar` + current state).
- Call `next_actions` to get eligible work.
- For gates: call `askQuestion`, then `satisfy_gate` with the user's answer.
- For auto/judgment steps: dispatch builders, `awaitAgents`, then `complete_step`.
- Before ending turn: ensure all active steps are resolved (done/skipped/failed).

The prompt shrinks dramatically — the enforcement lives in the tool, not prose.

### 6.2 Triage instruction

Add a triage section: on any user message, the orchestrator must first judge whether this is a trivial edit (skip to direct builder dispatch) or a non-trivial ask (init a workflow). Provide a classification rubric:
- Trivial: "fix the typo", "change the color to blue", single-file edits with obvious scope.
- Non-trivial: new pages, new features, multi-file changes, anything requiring design decisions.

---

## Implementation order & dependencies

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
                │                       
                └──→ Phase 5 (parallel with 3/4)
                                        
All ──→ Phase 6 (last — prompt rewrite after tooling works)
```

Phase 1 is independently shippable and immediately useful (fixes the agent-reopen bug).
Phases 2–5 are the workflow system core.
Phase 6 is the prompt rewrite that ties it together.

---

## Risk & rollback

- **Phase 1** is additive (new KV key, new router check with `?.` optional chaining). Zero risk to existing agents — the check returns undefined for all non-deep-build apps and falls through.
- **Phases 2–5** are entirely new files/tools, only registered on the `deep-build` agent. No other agent sees or uses them.
- **Phase 4** (merge mode) is the only change to shared infrastructure (`git-hook-service`). Gated by the `app.agent_mode` check — only fires for deep-build apps. Existing squash behavior unchanged.
- **Phase 6** only modifies `prompts/deep-build/core.md` — the deep-build agent's own prompt.

If anything breaks, removing the `workflow` tool from `deep-build-agent.ts` tools map + reverting Phase 4's conditional → full rollback to current behavior.
