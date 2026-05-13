---
name: new-scenario
description: Design and scaffold a new eval scenario with eval design
  reasoning. Acts as an eval design partner before generating scenario
  code, tests, and registry entry.
argument-hint: "<description> [--suite <name>] [--persona beginner|standard] [--visual] [--sequential]"
---

Design and scaffold a new eval scenario with eval design reasoning.

Acts as an eval design partner: reasons about what to measure and why
before generating scenario code, tests, and registry entry.

## Usage

```
/new-scenario <description> [--suite <name>] [--persona beginner|standard]
              [--visual] [--sequential]
```

- `<description>`: natural language description of what the scenario
  tests (required)
- `--suite <name>`: add to an existing or new suite (standalone if
  omitted)
- `--persona beginner|standard`: override persona selection (auto if
  omitted)
- `--visual`: hint that the scenario involves visual/UI output
  (triggers build-quality evaluators via `createBuildQualityEvaluators`)
- `--sequential`: force sequential execution mode (parallel is default
  for standalone scenarios)

## Instructions

The user wants to create a new scenario: $ARGUMENTS

### 1. Parse arguments

Extract from `$ARGUMENTS`:

- **description**: everything before any `--` flag (required)
- **--suite**: suite name (optional)
- **--persona**: `beginner` or `standard` (optional, auto-selected if
  omitted)
- **--visual**: flag (optional)
- **--sequential**: flag (optional)

If no description is provided, print the Usage block above and stop.

### 2. Eval design analysis

Before generating any code, reason through the eval design. Read the
existing scenarios and evaluators to understand current coverage.

**Read these files:**

- `src/scenarios/registry.ts` for the current scenario inventory
- `src/scenarios/types.ts` for the `Scenario` and `ScenarioGoal` types
- `src/evaluators/evaluator.ts` for the `Evaluator` interface
- All scenario files referenced in the registry to understand existing
  patterns

Then work through each substep below and print your reasoning.

#### 2a. Observable goal design

Design 1-4 goals for the scenario. Each goal needs:

- A `description`: a concrete, observable behavior (not vague intent).
  Good: "The agent creates a page with a visible contact form".
  Bad: "The agent does a good job".
- An `assertion`: `positive` (behavior must happen) or `negative`
  (behavior must not happen).

**Goal design rules:**

- Goals must be independently verifiable from the transcript or DOM
- Each goal should test one distinct behavior
- Use `negative` assertions sparingly, only for known failure modes
- Write descriptions that an LLM judge can evaluate from a transcript
  without domain expertise

Print the proposed goals in a table:

```
| # | Description                              | Assertion |
|---|------------------------------------------|-----------|
| 1 | The agent creates...                     | positive  |
```

#### 2b. Evaluator selection

Select evaluators using this decision tree. Every scenario gets the
first two. Add others based on the conditions shown.

| Evaluator                     | When to include                     |
| ----------------------------- | ----------------------------------- |
| BugHitRateEvaluator           | **Always.** Detects error messages  |
|                               | and crashes in the transcript.      |
| PromptEfficiencyEvaluator     | **Always.** Measures prompt token   |
|                               | economy.                            |
| ToolCallVerificationEvaluator | When the scenario has               |
|                               | `expectedTools` assertions (agent   |
|                               | must/must not call specific tools). |
| JTBDCompletionEvaluator       | When goals involve subjective task  |
|                               | success that requires LLM judgment. |
|                               | This is an LLM-based evaluator.     |
|                               | Include for most scenarios.         |
| createBuildQualityEvaluators  | When `--visual` flag is set OR      |
|                               | the scenario involves UI output.    |
|                               | Factory function returning multiple |
|                               | evaluators.                         |
| TurnDurationEvaluator         | When response latency matters (e.g. |
|                               | performance-sensitive flows).       |
| AgentStepsEvaluator           | When measuring agent efficiency     |
|                               | (number of tool calls or steps to   |
|                               | reach the goal).                    |

Print the selected evaluators and why each was included or excluded.

#### 2c. Persona selection

Choose a persona based on the scenario's interaction style:

| Persona    | Use when                                       |
| ---------- | ---------------------------------------------- |
| `beginner` | User needs hand-holding, asks clarifying       |
|            | questions, follows instructions literally.     |
|            | Best for: guided flows, first-time user paths. |
| `standard` | User is decisive, knows what they want, makes  |
|            | own design choices. Best for: business users,  |
|            | content-focused tasks, multi-step workflows.   |

If `--persona` was provided, use that. Otherwise, select based on the
scenario description and print your reasoning.

Both personas have no turn-ceiling setting. The simulation loop uses
`config.eval.maxTurns` (default 30) as the global ceiling. Per-scenario
turn limits are not supported; adjust the global config if needed.

#### 2d. Execution mode

- **`parallel`** (default for standalone): trials run concurrently.
  Use when each trial is independent and stateless.
- **`sequential`**: trials run one at a time. Use when trials share
  state, use the same provisioned app, or the scenario involves
  multi-step conversation where order matters.

If `--sequential` was provided, use sequential. Otherwise, select
based on the scenario and print your reasoning.

#### 2e. Construct validity check

Ask yourself: "If this scenario passes all evaluators, does that
actually prove the behavior works?"

Check for:

- **False positives**: could the scenario pass without the behavior
  actually working? (e.g. goals too vague, evaluators not measuring
  the right thing)
- **False negatives**: could the scenario fail even when the behavior
  works? (e.g. goals too specific, timing-dependent checks)
- **Missing coverage**: is there a critical aspect of the behavior
  that no goal or evaluator checks?

Print your validity assessment. If there are concerns, propose
adjustments to goals or evaluator selection.

#### 2f. Suite grouping

If `--suite` was provided, check if the suite already exists:

```bash
grep -rl "suite: '<suite-name>'" src/scenarios/ --include='*.ts'
```

- **Existing suite**: note the directory and naming convention (e.g.
  `prompt-vs-skill/` uses `pvs-` prefix for scenario names).
- **New suite**: propose a directory name and scenario name prefix.
- **No suite**: scenario is standalone at `src/scenarios/` root.

### 3. User confirmation gate

Present a design summary and wait for user approval before generating
any code:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO DESIGN SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Name:       <scenario-name>
Suite:      <suite-name or "standalone">
Persona:    <beginner|standard>
Exec mode:  <parallel|sequential>
Category:   capability
Trials:     3

Goals:
  1. [positive] <description>
  2. [positive] <description>

Evaluators:
  - BugHitRateEvaluator (always)
  - PromptEfficiencyEvaluator (always)
  - JTBDCompletionEvaluator (reason)
  ...

Validity: <brief assessment>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Ask: "Proceed with code generation, or adjust the design?"

If the user wants adjustments, revise steps 2a-2f and present a new
summary. Do not generate code until the user confirms.

### 4. Generate scenario file

Derive the scenario name from the description:

- Convert to kebab-case
- Keep it short (2-5 words)
- If in a suite, apply the suite's naming prefix

**Standalone scenario** (no `--suite`):

Create `src/scenarios/<scenario-name>.ts` following this pattern:

```typescript
import { <persona>Persona } from '../personas/<persona>.js';
import { BugHitRateEvaluator }
  from '../evaluators/bug-hit-rate.js';
import { PromptEfficiencyEvaluator }
  from '../evaluators/prompt-efficiency.js';
// ... other selected evaluators
import type { GocodeClient }
  from '../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../clients/aab-ctrl-plane-client.js';
import type { Scenario } from './types.js';

export function build<PascalName>Scenario(
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return {
    name: '<scenario-name>',
    persona: <persona>Persona,
    goals: [
      {
        description: '<goal-1-description>',
        assertion: '<positive|negative>',
      },
      // ... more goals
    ],
    evaluators: [
      new BugHitRateEvaluator(),
      new PromptEfficiencyEvaluator(),
      // ... other selected evaluators
      // LLM-based evaluators take gocode as constructor arg
    ],
    trials: 3,

    setup: async () => {
      const { appId, previewUrl } =
        await ctrlPlane.provisionApp();
      return { appId, previewUrl };
    },

    teardown: async (ctx) => {
      const appId = ctx.appId as string | undefined;
      if (appId) {
        await ctrlPlane.deleteApp(appId);
      }
    },
  };
}
```

**Suite scenario** (with `--suite`):

Create `src/scenarios/<suite-dir>/<scenario-name>.ts` following the
same pattern but with:

- `suite: '<suite-name>'` field
- Relative imports (one more `../` level)
- Suite naming prefix on the scenario name

If the suite directory does not exist yet:

1. Create `src/scenarios/<suite-dir>/`
2. Create `src/scenarios/<suite-dir>/index.ts` that re-exports the
   scenario factory

If the suite directory already exists, add the export to the existing
`index.ts`.

**Key rules:**

- Use `.js` extensions on all local imports (ESM convention)
- Hard-wrap at 80 characters
- LLM-based evaluators (`JTBDCompletionEvaluator`,
  `createBuildQualityEvaluators`) need `gocode` in their constructor
- Computed evaluators take no constructor args
- Regression gating is driven by baseline presence (use `/graduate`
  to save a baseline and enable regression checks)
- Always include `setup` and `teardown` for app provisioning

### 5. Update registry

Read `src/scenarios/registry.ts` and add:

1. An import for the new scenario factory function
   - Standalone: import directly from the scenario file
   - Suite: import from the suite's `index.ts`
2. A call to the factory in the returned array

Maintain alphabetical order within the import section. Place the new
scenario call in a logical position (after existing scenarios in the
same suite, or at the end for standalone).

### 6. Generate test file

Create a test file that verifies the scenario's shape.

**Standalone**: `src/scenarios/__tests__/<scenario-name>.test.ts`
**Suite**: `src/scenarios/<suite-dir>/__tests__/<scenario-name>.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { build<PascalName>Scenario } from '../<scenario-file>.js';
import type { GocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';

describe('<scenario-name> scenario', () => {
  const mockGocode = {} as GocodeClient;
  const mockCtrlPlane = {} as AABCtrlPlaneClient;

  const scenario = build<PascalName>Scenario(
    mockGocode,
    mockCtrlPlane,
  );

  it('has correct name', () => {
    expect(scenario.name).toBe('<scenario-name>');
  });

  it('has <N> goals', () => {
    expect(scenario.goals).toHaveLength(<N>);
    expect(
      scenario.goals.every((g) => g.description.length > 0),
    ).toBe(true);
  });

  it('includes required evaluators', () => {
    const names = scenario.evaluators.map((e) => e.name);
    expect(names).toContain('bug-hit-rate');
    expect(names).toContain('prompt-efficiency');
    // ... other expected evaluators
  });

  it('has trials set', () => {
    expect(scenario.trials).toBeGreaterThan(0);
  });
});
```

Adjust import paths based on the file location (standalone vs suite).

### 7. Verify

Run tests to confirm everything compiles and passes:

```bash
npx vitest run
```

If tests fail, fix the issue before continuing.

Then print a smoke test command the user can run manually:

```
To run the scenario end-to-end:
  pnpm run eval --scenario <name> --trials 1 --skip-baseline
```

### 8. Output

Summarize what was created:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO CREATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Name:     <scenario-name>
Suite:    <suite-name or "standalone">
Category: capability

Files created:
  - src/scenarios/<path-to-scenario>.ts
  - src/scenarios/<path-to-test>.test.ts

Files modified:
  - src/scenarios/registry.ts
  - src/scenarios/<suite>/index.ts (if suite)

Tests: all passing

Next steps:
  - Run: pnpm run eval --scenario <name> --trials 1 --skip-baseline
  - When stable: /graduate <name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
