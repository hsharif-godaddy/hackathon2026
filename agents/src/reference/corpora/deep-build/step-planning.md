# Step Planning

Reference for constructing the step DAG passed to `workflow({ operation: "init" })`.

## Step types

| Type | When to use |
|------|-------------|
| `auto` | Work dispatched to sub-agents — the default for most build steps |
| `gate` | Requires user input before proceeding (design approval, content review, playtesting) |
| `judgment` | Orchestrator makes a decision (triage, feedback interpretation) |

Most steps are `auto`. Use `gate` only when you genuinely need the user to review something before continuing. Use `judgment` sparingly — typically for triage steps that don't dispatch a sub-agent.

## Gate steps

Gate steps must include a `gate` object with a `prompt` string:

```json
{
  "id": "design-approval",
  "type": "gate",
  "title": "User approves design direction",
  "dependsOn": ["showcase"],
  "ownedFiles": [],
  "verify": [],
  "gate": { "prompt": "Does this design direction feel right? Any colors, fonts, or overall vibe you'd like adjusted?" }
}
```

When a gate step is next eligible, you **MUST** use the `askQuestion` tool — not plain prose.

## ownedFiles rules

Every `auto` step declares `ownedFiles` — the files it will create or modify.

**Critical rule: files must be disjoint across concurrently-eligible steps.** The workflow tool validates this. If two steps that could run in parallel both claim the same file, the tool will reject the plan.

Handling shared files:
- Files used by multiple pages/features → put them in the `foundation` step
- Layout files, route files, globals → always foundation
- A shared store or context file → foundation or a dedicated integration step
- If two features need the same utility, extract it into foundation

```json
// Foundation owns the shared files
{ "id": "foundation", "ownedFiles": ["src/layouts/MainLayout.tsx", "src/router.tsx", "src/styles/globals.css"] }

// Pages own only their own files — no overlap with foundation or each other
{ "id": "page-home", "ownedFiles": ["src/pages/Home.tsx", "src/data/home.ts", "src/components/home/HeroSection.tsx"] }
{ "id": "page-about", "ownedFiles": ["src/pages/About.tsx", "src/data/about.ts", "src/components/about/TeamSection.tsx"] }
```

## Verify catalog

Each step declares `verify` — an array of checks that confirm the work is done.

| Kind | Spec format | When to use |
|------|-------------|-------------|
| `files_exist` | `"path/to/file"` | File creation steps — confirms the output exists |
| `tsc` | `""` (empty) | After any TypeScript — catches type errors early |
| `route_renders` | `"/path"` | New routes — confirms the page loads without crashing |
| `test` | `"pattern"` | Data logic, utilities — run matching test files |
| `manual` | `"description"` | Judgment calls — design gates, gameplay feel, visual review |

Multiple verifies are allowed and common:

```json
"verify": [
  { "kind": "files_exist", "spec": "src/pages/Dashboard.tsx" },
  { "kind": "tsc", "spec": "" }
]
```

**Verify frequency guidance:**
- `files_exist` on every step that creates files
- `tsc` after foundation and after every feature/page step (catches issues early)
- `route_renders` for any step that adds a new route
- `test` when the plan includes test files or when step involves data/business logic
- `manual` for gates and any step where visual/interactive review is needed

## dependsOn rules

`dependsOn` is an array of step IDs that must complete before this step can start.

```json
// Sequential: each step waits for the prior
{ "id": "interview", "dependsOn": [] }
{ "id": "brief-review", "dependsOn": ["interview"] }
{ "id": "planning", "dependsOn": ["brief-review"] }

// Parallel: both depend on foundation, but not on each other
{ "id": "page-home", "dependsOn": ["foundation"] }
{ "id": "page-about", "dependsOn": ["foundation"] }

// Fan-in: showcase waits for BOTH business-details AND design
{ "id": "showcase", "dependsOn": ["business-details", "design"] }
```

Keep the DAG as shallow as possible — long sequential chains slow down the build. Ask: "does this really need to wait for that?" If not, parallelize.

## Pre-supplied inputs (skip_step)

If the user attached files that satisfy a step (a design mockup, an existing brief, content), call `skip_step` rather than running that step:

```
workflow({ operation: "skip_step", stepId: "interview", reason: "User attached docs/brief.md with full project requirements" })
```

This explicitly accounts for the step rather than silently dropping it. The step is marked skipped and its successors become eligible normally.

## DAG structure patterns

**Site (pages-based):**
```
interview → brief-review → [business-details ‖ design] → showcase → design-approval
→ planning → foundation → [page-1 ‖ page-2 ‖ page-3] → polish → final-verify
```

**App (features-based):**
```
interview → brief-review → [feature-spec ‖ design] → showcase → design-approval
→ planning → foundation → [feature-1 ‖ feature-2] → integration → polish → final-verify
```

**Game (systems-based):**
```
interview → game-design-doc → design-approval → planning
→ foundation → [core-mechanics ‖ ui-system] → content → integration → playtesting → polish
```

In all cases: design/approval gates come before planning, foundation comes before parallelizable build work.
