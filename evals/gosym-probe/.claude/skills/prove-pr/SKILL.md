---
name: prove-pr
description: Analyze a PR's behavioral changes against existing eval
    coverage, identify gaps, and recommend /new-scenario and
    /new-evaluator invocations to fill them.
argument-hint: "<pr-url|pr-number|branch> [--repo <path>] [--run]"
---

Analyze a PR's behavioral changes against existing eval coverage,
identify gaps, and recommend `/new-scenario` and `/new-evaluator`
invocations to fill them.

## Usage

```
/prove-pr <pr-url|pr-number|branch> [--repo <path>] [--run]
```

- `<pr-url|pr-number|branch>`: GitHub PR URL, PR number, or branch
  name (required)
- `--repo <path>`: path to the target repo when the PR is not in the
  current repository (optional; inferred from sibling dirs if omitted)
- `--run`: execute eval commands for scenarios that cover the PR after
  the report (optional)

## Instructions

The user wants to analyze PR coverage: $ARGUMENTS

### 1. Parse arguments

Extract:
- **target**: first positional arg — PR URL (`https://github.com/…`),
  PR number (e.g. `42`), or branch name (required)
- **--repo**: explicit path to the target repository (optional)
- **--run**: flag (optional)

If no target is provided, print the Usage block above and stop.

### 2. Fetch the diff

**Resolve the repository path:**

If `--repo` is provided, use that path. Otherwise check whether the
target repo differs from the current one:
- For PR URLs/numbers: the repo is embedded in the URL or can be read
  from `gh pr view <target> --json headRepository`
- If the target repo is not the current repo, look for it as a
  sibling directory: `ls ../` and find a directory matching the repo
  name. If not found, ask the user for the path.

**Fetch the diff:**

```bash
# PR URL or number
gh pr diff <target> --repo <owner/repo>

# Branch
git -C <repo-path> diff main...<branch>
```

If the diff fetch fails, report the error and stop.

### 3. Categorize behavioral changes

Read the diff and classify each changed file or logical unit into one
or more categories:

| Category           | What it means                          | Eval relevant? |
|--------------------|----------------------------------------|----------------|
| `new-capability`   | New feature, tool, or agent behavior   | HIGH — needs   |
|                    | the agent can now perform              | new scenario   |
| `changed-behavior` | Existing behavior modified (prompts,   | HIGH — may     |
|                    | tool logic, response format)           | need update    |
| `bug-fix`          | Corrects a specific failure mode       | MEDIUM — check |
|                    |                                        | regression     |
| `performance`      | Latency, token count, step efficiency  | MEDIUM —       |
|                    |                                        | TurnDuration / |
|                    |                                        | AgentSteps     |
| `ui-change`        | Visual output or DOM structure changes | MEDIUM —       |
|                    |                                        | OutputQuality  |
| `infrastructure`   | Config, build, deps, infra only        | LOW — no eval  |
|                    |                                        | needed         |

Print a table of: file/area changed → category → eval relevance.
Filter out `infrastructure`-only changes from further analysis.

### 4. Map to existing coverage

Read the current scenario and evaluator inventory:

```bash
# Scenario inventory
cat src/scenarios/registry.ts
# Then read each scenario file referenced there for goals
```

For each behaviorally relevant change from step 3, assess coverage:

| Status        | Meaning                                          |
|---------------|--------------------------------------------------|
| **Covered**   | An existing scenario goal directly tests this    |
|               | behavior and appropriate evaluators are wired    |
| **Partial**   | A scenario touches this area but the goal or     |
|               | evaluator does not specifically test the change  |
| **Gap**       | No scenario goal addresses this behavior at all  |

Print a coverage table:

```
| Behavioral Change     | Scenario(s)         | Status  | Notes       |
|-----------------------|---------------------|---------|-------------|
| <change description>  | <scenario name(s)>  | Covered |             |
| <change description>  | <scenario name>     | Partial | Goal too    |
|                       |                     |         | broad       |
| <change description>  | —                   | Gap     | No coverage |
```

### 5. Gap analysis

For each Gap or Partial entry, produce a prioritized recommendation:

**Priority:**
- **HIGH**: `new-capability` or `changed-behavior` with no coverage
- **MEDIUM**: `bug-fix`, `performance`, `ui-change` with no coverage,
  or `Partial` coverage on a HIGH-relevance change
- **LOW**: `Partial` coverage on MEDIUM-relevance changes

For each recommendation, output a pre-filled invocation the user can
run directly:

```
Priority | Change              | Gap               | Command
---------|---------------------|-------------------|--------
HIGH     | <change>            | No scenario       | /new-scenario <description derived from the change> [--suite <relevant-suite>]
MEDIUM   | <change>            | No latency eval   | /new-evaluator <description> --deterministic
```

Rules for pre-filling commands:
- Derive the description from the actual diff content — be specific,
  not generic
- If a related suite exists (e.g. `prompt-vs-skill`), suggest it
- Recommend `/new-evaluator` only when no existing evaluator covers
  the measurement (check the redundancy table in
  `.claude/skills/new-evaluator/SKILL.md`)
- One command per gap — do not stack multiple recommendations on one
  row

### 6. Coverage report

Print the full report:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COVERAGE REPORT: <pr-url or branch>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Behavioral changes: <N>  (new-capability: X, changed-behavior: Y, …)
Coverage:           <N> covered | <N> partial | <N> gaps

<coverage table from step 4>

Recommendations (<N> actions):
<gap analysis table from step 5>

Scenarios to run now:
  pnpm run eval --scenario <name> --trials 1 --skip-baseline
  pnpm run eval --suite <suite> --trials 1 --skip-baseline
  (only list scenarios that are Covered or Partial — already runnable)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If there are no gaps, print:
```
✓ Full coverage — no new scenarios or evaluators needed.
```

### 7. Run existing scenarios (if --run)

If `--run` was passed, execute the eval commands for all scenarios
listed under "Scenarios to run now":

```bash
pnpm run eval --scenario <name> --trials 1 --skip-baseline
```

Run one at a time and display output. After each, report pass/fail.

If no runnable scenarios exist, note it and skip.
