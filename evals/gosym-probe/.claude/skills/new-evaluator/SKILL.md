---
name: new-evaluator
description: Design and scaffold a new evaluator with eval design
  reasoning. Checks redundancy against existing evaluators before
  generating evaluator code and tests.
argument-hint: "<description> [--wire <scenario-name>]"
---

Design and scaffold a new evaluator with eval design reasoning.

Acts as an eval design partner: checks redundancy, reasons through
scoring and thresholds, then generates evaluator code and tests.

## Usage

```
/new-evaluator <description> [--wire <scenario-name>]
```

- `<description>`: what to measure (required)
- `--wire <scenario-name>`: also add the evaluator to this scenario

## Instructions

The user wants to create a new evaluator: $ARGUMENTS

### 1. Parse arguments

Extract description (everything before `--` flags), plus
`--wire <name>`. Stop with the Usage block if no description.

### 2. Redundancy check

Read all files in `src/evaluators/`. Present this inventory and
assess overlap with the requested description:

Read all evaluator files in `src/evaluators/` to build the current inventory dynamically.

- **Already covered**: stop. Name the evaluator and suggest
  configuring it instead. Do not proceed.
- **Partial overlap**: note what is distinct and continue.
- **No overlap**: continue.

### 3. Evaluator design analysis

Reason through each substep and print your conclusions.

#### 3a. Scoring approach

Determine whether scoring can be computed directly from transcript data
(counts, ratios, tool names, timestamps) or requires an LLM call for
judgment or semantic interpretation (quality, correctness, behavior).
Choose and explain.

#### 3b. Inputs

Available fields — pick only what is needed:

- `transcript.errors[]`, `transcript.turns[]` (role, content,
  toolCalls, durationMs, totalSteps)
- `scenario.goals[]`, `scenario.expectedTools`
- `snapshot?.html` (visual evaluators only)

Flag any field that does not exist in the current types — that needs a
separate change.

#### 3c. Scoring formula

Prefer continuous scoring over binary (gradient enables regression
detection). Common patterns:

| Pattern        | Formula                           | Example              |
| -------------- | --------------------------------- | -------------------- |
| Ratio metric   | `Math.max(0, 1 - used/max)`       | PromptEfficiency     |
| Count metric   | `1 / (1 + count)`                 | BugHitRate           |
| Fraction       | `satisfied / total`               | ToolCallVerification |
| LLM continuous | prompt returns `SCORE: [0.0-1.0]` | OutputQuality        |
| LLM categoric  | pass→1.0, partial→0.5, fail→0.0   | JTBDCompletion       |

State the formula and justify it.

#### 3d. Verdict thresholds

Standard 3-tier (default): pass ≥ 0.7, partial ≥ 0.4, fail < 0.4.
Binary (hard assertions): score = 1.0 → pass, else fail.
LLM-mapped: verdict from LLM response, score derived from it.

State the choice and justify.

#### 3e. Edge cases

For each: state the condition and the return value.
Required: no data → `unknown`; zero denominator guard; missing
snapshot → `unknown` (if visual). LLM-based also: parse failure →
`unknown`; GoCode exception → `unknown` + error message.

### 4. User confirmation gate

Print this summary and ask "Proceed with code generation, or adjust
the design?" Do not generate code until confirmed.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVALUATOR DESIGN SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name:      <evaluator-name>
Class:     <ClassName>Evaluator
File:      src/evaluators/<evaluator-name>.ts
Inputs:    <fields consumed>
Scoring:   <formula>
Verdicts:  pass ≥ X | partial ≥ Y | fail < Y
Edges:     <case → handling>
Redundancy: <none | partial overlap with X — distinct because Y>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 5. Generate evaluator file

Create `src/evaluators/<evaluator-name>.ts`.

- **Computed pattern**: follow `src/evaluators/bug-hit-rate.ts`
  (no constructor) or `src/evaluators/turn-duration.ts` (constructor
  options object) depending on whether the threshold is configurable.
- **LLM-based pattern**: follow `src/evaluators/jtbd-completion.ts`
  (categorical) or `src/evaluators/llm-json-evaluator.ts` (continuous
  scoring via Zod-validated JSON response).

Key rules: `.js` extensions on local imports, 80-char wrap, prefix
unused params with `_`, clamp scores with `Math.max(0, Math.min(1, …))`.

### 6. Generate test file

Create `src/evaluators/__tests__/<evaluator-name>.test.ts`.

Copy the `makeTranscript` / `makeScenario` / `mockPersona` fixture
helpers from `src/evaluators/__tests__/jtbd-completion.test.ts`.

Required test cases:

1. Pass case (score ≥ 0.7)
2. Partial case (0.4 ≤ score < 0.7) — skip for binary scoring
3. Fail case (score < 0.4)
4. No data → `verdict: 'unknown'`
5. `evaluator.name` equals the kebab-case name

LLM-based additionally:

6. Each verdict token (`pass`/`partial`/`fail`/`unknown`) maps correctly
7. Unrecognized response → `unknown`
8. Key input fields appear in the prompt passed to `complete`

### 7. Wire into scenario (if --wire provided)

Find the scenario file with:

```bash
grep -rl "name: '<scenario-name>'" src/scenarios/ --include='*.ts'
```

Add an import (alphabetical order) and append the evaluator instance
to the `evaluators` array. For evaluators with required constructor
args, add a `// TODO: set <arg>` comment.

### 8. Verify

```bash
npx vitest run
```

Fix any failures before continuing. Then print:

```
To use the new evaluator in a scenario:
  import { <ClassName>Evaluator }
    from '../evaluators/<evaluator-name>.js';
  evaluators: [..., new <ClassName>Evaluator(<args>)]
```

### 9. Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVALUATOR CREATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name:  <evaluator-name>

Files created:
  - src/evaluators/<evaluator-name>.ts
  - src/evaluators/__tests__/<evaluator-name>.test.ts
Files modified:
  - src/scenarios/<scenario>.ts  (if --wire)
Tests: all passing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
