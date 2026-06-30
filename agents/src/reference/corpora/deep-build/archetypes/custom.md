# Custom Archetype

Use when the project doesn't fit `site`, `app`, or `game`. The agent builds the DAG from scratch based on the project's natural structure.

## Guidance

- Interview to understand the full scope before planning anything
- Identify the natural build units: are they pages? features? systems? something else?
- Look at which existing archetype is closest and adapt its DAG pattern
- Default to lower parallelism when uncertain about file ownership
- Verify with `tsc` + `files_exist` as baseline
- Include more gates (user check-ins) when the structure is novel
- Keep the DAG shallow — fewer sequential dependencies means faster builds

## Decision heuristics

| If the project has... | Consider... |
|----------------------|-------------|
| Distinct pages with independent content | `site` pattern |
| CRUD flows and data models | `app` pattern |
| Game loop or real-time updates | `game` pattern |
| Multiple modes or domains (e.g. public site + admin app) | Hybrid: start with the dominant pattern |
| Entirely novel structure | True custom — interview heavily, plan conservatively |

## When to pick custom

- Hybrid apps (marketing site + member portal)
- Browser-based tools that aren't CRUD (editors, simulators, visualizers)
- Multi-step wizards or onboarding flows
- Anything where "what are the build units?" isn't immediately clear

## DAG construction approach

1. Run a thorough interview to surface all requirements and constraints
2. List the major deliverables and identify which can be built independently
3. Identify shared dependencies (auth, shared components, data models) — put them in foundation
4. Group independent deliverables into parallel steps with disjoint `ownedFiles`
5. Add gates at natural approval points (design direction, scope confirmation)
6. Err toward more sequential steps and add parallelism only where file ownership is clearly disjoint

## Notes

No archetype guidance is injected automatically for custom builds. The agent operates from workflow step state alone, which is sufficient for execution once the DAG is established.
