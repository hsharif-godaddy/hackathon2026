# App Archetype

Use for dashboards, CRUD apps, admin panels, SaaS tools, and interactive utilities. Build unit is the **feature** — features may share state and database models, requiring careful parallelism management.

<!-- inject-start -->
Build unit: features (medium parallelism, may share state). Design gate before building.
Phases: interview → design → plan → foundation (auth, DB, layout) → features → integration → polish.
Parallelism: medium — check ownedFiles overlap carefully. Fewer concurrent builders.
Verify: tsc throughout, test for data logic, files_exist for scaffolding.
Skills load after planning, before build.
<!-- inject-end -->

## Typical DAG

```
interview → brief-review (gate) → [feature-spec, design] (parallel)
→ showcase → design-approval (gate) → planning → plan-review
→ skill-install → foundation (auth, database, layout)
→ [feature-1, feature-2] (medium parallelism) → integration → polish → final-verify
```

## Example step plan

```json
{
  "archetype": "app",
  "northStar": { "goals": ["..."], "audience": "...", "voice": "..." },
  "steps": [
    { "id": "interview", "type": "auto", "title": "Collect app requirements via interview", "dependsOn": [], "ownedFiles": ["docs/brief.md"], "verify": [{"kind": "files_exist", "spec": "docs/brief.md"}] },
    { "id": "brief-review", "type": "gate", "title": "User reviews project brief", "dependsOn": ["interview"], "ownedFiles": [], "verify": [], "gate": {"prompt": "Here's what I understand you're building. Does this capture the requirements? Anything to add or change?"} },
    { "id": "feature-spec", "type": "auto", "title": "Document features and data models", "dependsOn": ["brief-review"], "ownedFiles": ["docs/feature-spec.md"], "verify": [{"kind": "files_exist", "spec": "docs/feature-spec.md"}] },
    { "id": "design", "type": "auto", "title": "Create design system and UI patterns", "dependsOn": ["brief-review"], "ownedFiles": ["docs/design.md", "src/styles/globals.css"], "verify": [{"kind": "files_exist", "spec": "docs/design.md"}] },
    { "id": "showcase", "type": "auto", "title": "Build design preview showcase", "dependsOn": ["feature-spec", "design"], "ownedFiles": ["src/components/design-preview/Showcase.tsx"], "verify": [{"kind": "files_exist", "spec": "src/components/design-preview/Showcase.tsx"}] },
    { "id": "design-approval", "type": "gate", "title": "User approves design direction", "dependsOn": ["showcase"], "ownedFiles": [], "verify": [], "gate": {"prompt": "Does this design direction fit what you're building? Any UI patterns or visual style to adjust?"} },
    { "id": "planning", "type": "auto", "title": "Create implementation plan", "dependsOn": ["design-approval"], "ownedFiles": ["docs/plans/app.md"], "verify": [{"kind": "files_exist", "spec": "docs/plans/app.md"}] },
    { "id": "plan-review", "type": "auto", "title": "Review and refine plan", "dependsOn": ["planning"], "ownedFiles": [], "verify": [] },
    { "id": "skill-install", "type": "auto", "title": "Install required skills (database, auth)", "dependsOn": ["plan-review"], "ownedFiles": [], "verify": [] },
    { "id": "foundation", "type": "auto", "title": "Build foundation (auth, DB schema, layout shell)", "dependsOn": ["skill-install"], "ownedFiles": ["src/lib/db.ts", "src/lib/auth.ts", "src/layouts/AppLayout.tsx", "src/layouts/parts/Sidebar.tsx"], "verify": [{"kind": "tsc", "spec": ""}, {"kind": "files_exist", "spec": "src/lib/db.ts"}] },
    { "id": "feature-dashboard", "type": "auto", "title": "Build dashboard feature", "dependsOn": ["foundation"], "ownedFiles": ["src/pages/Dashboard.tsx", "src/components/dashboard/", "src/hooks/useDashboardData.ts"], "verify": [{"kind": "files_exist", "spec": "src/pages/Dashboard.tsx"}, {"kind": "tsc", "spec": ""}] },
    { "id": "feature-settings", "type": "auto", "title": "Build settings feature", "dependsOn": ["foundation"], "ownedFiles": ["src/pages/Settings.tsx", "src/components/settings/", "src/hooks/useSettings.ts"], "verify": [{"kind": "files_exist", "spec": "src/pages/Settings.tsx"}, {"kind": "tsc", "spec": ""}] },
    { "id": "integration", "type": "auto", "title": "Wire features together (nav, routing, data flow)", "dependsOn": ["feature-dashboard", "feature-settings"], "ownedFiles": ["src/router.tsx", "src/store/", "src/layouts/parts/Navigation.tsx"], "verify": [{"kind": "tsc", "spec": ""}] },
    { "id": "polish", "type": "auto", "title": "Error handling, loading states, a11y", "dependsOn": ["integration"], "ownedFiles": ["src/components/ErrorBoundary.tsx", "src/components/LoadingSpinner.tsx"], "verify": [{"kind": "tsc", "spec": ""}] },
    { "id": "final-verify", "type": "auto", "title": "Final verification", "dependsOn": ["polish"], "ownedFiles": [], "verify": [{"kind": "tsc", "spec": ""}] }
  ]
}
```

## DAG structure notes

- `feature-spec` and `design` run in parallel after `brief-review` — both are needed before showcase
- Foundation is heavier than site: includes auth flows, database schema, shared state setup
- Features depend on foundation but may need to share models — check ownedFiles carefully
- Integration step wires features together — owns routing and shared navigation, not feature files
- Polish focuses on error handling and loading states, not just aesthetics

## Build phases

| Phase | Steps | Notes |
|-------|-------|-------|
| 0 | interview, brief-review | Interactive + gate |
| 1 | feature-spec, design (parallel) | Background agents |
| 2 | showcase, design-approval | Showcase builds; gate pauses |
| 3 | planning, plan-review, skill-install | Sequential |
| 4 | foundation | Single builder — auth, DB, layout |
| 5 | features (2-3 parallel) | Medium concurrency |
| 6 | integration | Single builder — wires features |
| 7 | polish, final-verify | Single builder |

## Parallelism rules

- Features are the parallel unit — but only if their `ownedFiles` are disjoint
- Features that share a data model or store file must be sequential or must split file ownership
- Foundation must complete before any feature work begins
- Integration is always sequential — it touches shared files
- Err toward fewer concurrent builders (2-3 max) to avoid merge conflicts

## Common skills

- `database` — Drizzle ORM schema and migrations
- `authentication` — auth flows and session management
- `payment` — Stripe integration
- `commerce` — product and cart data models
- `email` — transactional email

Skills involving database or auth MUST be installed interactively — they may ask configuration questions.

## Verify emphasis

- `tsc` — after every builder, especially foundation and integration
- `test` — for data access functions and business logic
- `files_exist` — for scaffolding steps (feature directories, schema files)
- `manual` — for design approval and any UX flows requiring visual review
