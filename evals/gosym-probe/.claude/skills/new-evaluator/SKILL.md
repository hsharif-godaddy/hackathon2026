---
name: new-evaluator
description: Design and scaffold a new evaluator with eval design
    reasoning. Checks redundancy against existing evaluators before
    generating evaluator code and tests.
argument-hint: "<description> [--deterministic] [--llm] [--wire <scenario-name>]"
---

Design and scaffold a new evaluator with eval design reasoning.

Acts as an eval design partner: checks redundancy, reasons through
scoring and thresholds, then generates evaluator code and tests.

## Usage

```
/new-evaluator <description> [--deterministic] [--llm]
               [--wire <scenario-name>]
```

- `<description>`: what to measure (required)
- `--deterministic`: force computed-from-data mode
- `--llm`: force LLM-judgment mode
- `--wire <scenario-name>`: also add the evaluator to this scenario

## Instructions

The user wants to create a new evaluator: $ARGUMENTS

### 1. Parse arguments

Extract description (everything before `--` flags), plus
`--deterministic`, `--llm`, and `--wire <name>`. Stop with the Usage
block if no description. Stop with an error if both `--deterministic`
and `--llm` are set.

### 2. Redundancy check

Read all files in `src/evaluators/`. Present this inventory and
assess overlap with the requested description:

| Evaluator                     | Type    | Coverage                         |
|-------------------------------|---------|----------------------------------|
| BugHitRateEvaluator           | det.    | Error count in transcript.errors |
| PromptEfficiencyEvaluator     | det.    | User turns vs scenario.maxTurns  |
| ToolCallVerificationEvaluator | det.    | scenario.expectedTools assertions|
| TurnDurationEvaluator         | det.    | Latency vs maxDurationMs         |
| AgentStepsEvaluator           | det.    | Step count vs maxSteps           |
| JTBDCompletionEvaluator       | LLM     | Task success via transcript+goals|
| OutputQualityEvaluator        | LLM     | Visual quality via DOM snapshot  |

- **Already covered**: stop. Name the evaluator and suggest
  configuring it instead. Do not proceed.
- **Partial overlap**: note what is distinct and continue.
- **No overlap**: continue.

### 3. Evaluator design analysis

Reason through each substep and print your conclusions.

#### 3a. Deterministic vs LLM-based

**Deterministic**: score computable from structured data
(counts, ratios, tool names, timestamps). No GoCode call. Runs once
total across trials.

**LLM-based**: scoring requires judgment or semantic interpretation
(quality, correctness, behavior). Uses GoCode. Runs once per trial.

Use the flag if provided. Otherwise choose and explain.

#### 3b. Inputs

Available fields — pick only what is needed:
- `transcript.errors[]`, `transcript.turns[]` (role, content,
  toolCalls, durationMs, totalSteps)
- `scenario.goals[]`, `scenario.maxTurns`,
  `scenario.expectedTools`
- `snapshot?.html` (visual evaluators only)

Flag any field that does not exist in the current types — that needs a
separate change.

#### 3c. Scoring formula

Prefer continuous scoring over binary (gradient enables regression
detection). Common patterns:

| Pattern       | Formula                           | Example              |
|---------------|-----------------------------------|----------------------|
| Ratio metric  | `Math.max(0, 1 - used/max)`       | PromptEfficiency     |
| Count metric  | `1 / (1 + count)`                 | BugHitRate           |
| Fraction      | `satisfied / total`               | ToolCallVerification |
| LLM continuous| prompt returns `SCORE: [0.0-1.0]` | OutputQuality        |
| LLM categoric | pass→1.0, partial→0.5, fail→0.0   | JTBDCompletion       |

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
Type:      deterministic | LLM-based
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

- **Deterministic pattern**: follow `src/evaluators/bug-hit-rate.ts`
  (no constructor) or `src/evaluators/turn-duration.ts` (constructor
  options object) depending on whether the threshold is configurable.
- **LLM-based pattern**: follow `src/evaluators/jtbd-completion.ts`
  (categorical) or `src/evaluators/output-quality.ts` (continuous
  SCORE/VERDICT/REASON format).

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
6. `evaluator.deterministic` is `true` or `false`

LLM-based additionally:
7. Each verdict token (pass/partial/fail/unknown) maps correctly
8. Unrecognized response → `unknown`
9. Key input fields appear in the prompt passed to `complete`

### 7. Wire into scenario (if --wire provided)

Find the scenario file with:
```bash
grep -rl "name: '<scenario-name>'" src/scenarios/ --include='*.ts'
```

Add an import (alphabetical order) and append the evaluator instance
to the `evaluators` array. For deterministic evaluators with required
constructor args, add a `// TODO: set <arg>` comment.

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
Type:  deterministic | LLM-based

Files created:
  - src/evaluators/<evaluator-name>.ts
  - src/evaluators/__tests__/<evaluator-name>.test.ts
Files modified:
  - src/scenarios/<scenario>.ts  (if --wire)
Tests: all passing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
