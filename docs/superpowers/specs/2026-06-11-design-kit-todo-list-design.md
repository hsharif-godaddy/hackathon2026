# Design Kit Wizard — Todo List Fix

- **Date:** 2026-06-11
- **Branch:** `feat/design-kit-wizard`
- **Status:** Implemented (prompt changes + invariant test); pending user review. Not
  committed (a concurrent agent is working the same branch).
- **Scope:** Prompt-only. No code, tool, or UI changes. Base prompt files and the
  production (non-design-kit) initial agent are untouched.

## Problem

When the Design Kit Wizard starts, the agent creates the **wrong** todo list. It shows
the website page roadmap (e.g. "Homepage", "Full menu", "About", "Contact") at the very
beginning of the wizard, before any brand work has happened. That roadmap is the
*develop* agent's working list — it belongs after handoff, not during the brand-building
wizard.

### Root cause

The design-kit prompt variant is assembled from `manifest.json`, which includes the
**base** fragment `initial/3.0/feature-list.md`. That fragment's rule is:

> Call `todoList` in the same turn as `setProjectName`. … List 4-6 high-level features …
> Always start with "Homepage".

`wizard-flow.md` Step 2 calls `setProjectName` (to set the project name from the Phase-1
answer). Because `feature-list.md` ties `todoList` creation to `setProjectName`, the agent
creates the website page roadmap at Step 2 — the start of the wizard.

Two other base fragments in the manifest (`project-name.md`, `identity.md`) also say
"call `todoList` in the same turn as `setProjectName`", but **only** `feature-list.md`
defines the *items* ("4-6 features, start with Homepage"). So the item definition lives in
exactly one place, which makes the fix surgical.

## Goals

1. During the wizard (Steps 1–4), the todo list shows the **brand-building journey**, not
   the website page roadmap.
2. At the Step 5 handoff ("Create my website"), the agent creates the **website roadmap**
   (Homepage + pages) so the develop agent finds it ready — `develop/core.md` line 111
   already states *"One roadmap list per app — Initial agent already created it"* and the
   develop agent never creates one itself.
3. No "pink-elephant" negations (instructions that name an unwanted behavior and tell the
   model not to do it, which can plant the idea). Fix by *removing the wrong instruction*
   and *positively redirecting* the surviving instinct.

## Non-goals

- No changes to the base `feature-list.md`, `project-name.md`, or `identity.md` (they feed
  the production initial agent).
- No code changes to `set-wizard-step.ts`, the `todoList` tool, or any UI component.
- The deterministic "pre-seeded mirror inside `set-wizard-step.ts`" approach (noted as a
  possible future shape in project memory) is explicitly out of scope — this change is
  prompt-driven, consistent with how the wizard already maintains its own `todoList`.

## The todo model (chosen: 3-phase journey → roadmap)

**During the wizard (Steps 1–4)** the list is the brand-building journey:

```
┌─ Building your brand ─────────┐
│ ☐ Build your brand kit        │   ← marked done at end of Step 2
│ ☐ Create your brand showcase  │   ← marked done after Step 4 writes the showcase
│ ☐ Build your website          │   ← marked done at Step 5 (handoff)
└───────────────────────────────┘
```

**At the Step 5 handoff** ("Create my website") all three journey items are marked done,
then a fresh website roadmap takes over for the develop agent:

```
┌─ [Project] website ───────────┐
│ ☐ Homepage                    │
│ ☐ Menu                        │
│ ☐ About                       │
│ ☐ Contact                     │
└───────────────────────────────┘
```

### Why two lists, resolved in this order

The `todoList` tool's `openListCreateGuard` (`agents/src/tools/todo-list-tool.ts`) rejects
`create_list` while **any** list for the app still has open items. Therefore the journey
list must have **no open items** before the website roadmap is created. The Step 5 order is
fixed:

1. `setWizardStep({ step: 5 })`
2. `mark_done` every still-open journey item (always "Build your website"; also
   "Create your brand showcase" if the user skipped the showcase straight from Step 3).
3. `create_list` the website roadmap (now allowed — no open items anywhere).
4. `handoff` to `develop`.

The roadmap is created last, so it is the most-recently-updated list. The "current" list
returned by `GET /agent/todo-lists/:appId/current` is the most-recently-updated one
(`agents/src/server/routes/todo-list.ts`), so the develop agent and the UI flyout both
point at the website roadmap. The completed journey list remains as harmless history.

## Implementation changes

### 1. `agents/src/prompts/initial/design-kit/manifest.json`

Remove the final entry `{ "src": "base", "file": "feature-list.md" }`. This deletes the
"Homepage + features at `setProjectName`" *item definition* at its source. The generic
"call `todoList` with `setProjectName`" instinct (from `project-name.md` / `identity.md`)
survives and is redirected positively to the journey list by `wizard-flow.md` Step 2.

The `handoff-invariants.test.ts` assertion that `workflow-override.md` sits immediately
after `identity.md` is unaffected (we remove only the last entry). The `manifest.test.ts`
existence checks still pass (base files `identity.md` + `project-name.md` remain; variant
files unchanged).

### 2. `agents/src/prompts/initial/design-kit/wizard-flow.md`

`wizard-flow.md` becomes the single owner of all `todoList` timing for this agent:

- **Step 2** — in the same turn as `setProjectName`, `create_list` named
  **"Building your brand"** with three items, in order: `Build your brand kit`,
  `Create your brand showcase`, `Build your website`. (Pairing it with `setProjectName`
  satisfies the surviving base instinct with the *correct* list.)
- **End of Step 2 → entering Step 3** — `mark_done` the `Build your brand kit` item.
- **Step 4** — after `public/brand-showcase.html` is written, `mark_done` the
  `Create your brand showcase` item.
- **Step 5** — the fixed sequence above (mark remaining journey items done → create the
  website roadmap → handoff). The website-roadmap guidance migrated from the old
  `feature-list.md` lives here: 4–6 high-level pages/features, always starting with
  "Homepage", phrased as features (pages/capabilities) not implementation steps, with a
  short JSON example.
- **Rules section** — one concise rule documenting the two-list model so the timing is
  discoverable without re-reading every step.

### 3. Tests — `agents/src/prompts/initial/design-kit/__tests__/todo-list-invariants.test.ts` (new)

Prompt-level assertions (read fragments from disk, mirroring `handoff-invariants.test.ts`):

- `manifest.json` does **not** include `feature-list.md` (guards the regression at the
  source).
- `wizard-flow.md` Step 2 section creates the journey list and contains all three journey
  titles (`Build your brand kit`, `Create your brand showcase`, `Build your website`).
- The website roadmap (`create_list` + "Homepage") appears **only** within the Step 5
  section — never before it (mirrors the handoff invariant: the roadmap is a handoff-time
  artifact).

## Pink-elephant safety

The unwanted "early website roadmap" behavior is eliminated by **removing its source
instruction** (`feature-list.md`), not by telling the model "do not create the website list
at Step 2". The surviving "call `todoList` with `setProjectName`" pull is satisfied by a
**positively specified** journey list. Every new sentence is an instruction to *do*
something ("create…", "mark done…"), consistent with the principle recorded in project
memory: rephrase-positive / omit when naming a behavior would plant it; reserve negation
for behaviors intrinsic to the model's repertoire.

## Risks & mitigations

- **Agent forgets the Step 5 order and calls `create_list` before marking journey items
  done.** The tool returns the guard error (which itself says to `mark_done` open items
  first), so the agent can self-correct. The prompt states the order explicitly to minimize
  this.
- **Item IDs across turns.** The agent uses IDs from the `create_list` result / todo
  context, or `get_list` to re-fetch — the same pattern the develop agent already uses.
- **Two lists could confuse "current".** Resolved deterministically by most-recently-updated
  ordering; the roadmap is created last.

## Files touched

- `agents/src/prompts/initial/design-kit/manifest.json` (remove one entry)
- `agents/src/prompts/initial/design-kit/wizard-flow.md` (per-step todoList instructions)
- `agents/src/prompts/initial/design-kit/__tests__/todo-list-invariants.test.ts` (new)
