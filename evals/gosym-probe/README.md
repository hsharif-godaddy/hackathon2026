# gosym-probe

Local, offline eval harness for the Airo App Builder (AAB) agent.

Runs entirely on the developer's machine: drives a synthetic user (powered by
GoCode / Claude Sonnet 4.6) through scripted scenarios against a locally
running AAB instance, records full conversation transcripts, captures DOM
snapshots via Playwright, and scores results with LLM-as-a-Judge evaluators.

See [QUICK_START.md](QUICK_START.md) to get up and running.

---

## Overview

GoSym-Probe runs a synthetic user against your locally running agent
harness instance, scores how well the agent handles scripted tasks,
and flags regressions.

1. **Baseline setup.** Start your agent on `main`, run
   `pnpm run eval` to get scores for your scenarios.
2. **Save baseline.** Run `pnpm run save-baseline <run-id>` to lock
   in those scores as the comparison point.
3. **Test your changes.** Switch your agent to your feature branch,
   run the same eval. The harness automatically compares against the
   saved baseline and surfaces any regressions.
4. **Ship with confidence.** If scores hold (or improve), your
   feature branch didn't break agent behavior.
5. **Graduate.** Once stable, run
   `pnpm run eval --graduate <scenario>` to promote a scenario from
   `capability` to `regression` and lock in the new baseline.

Think of it as integration tests for agent behavior, not code.

---

## CLI Reference

```
pnpm run eval [options]

Options:
  --scenario <name>         Run a single scenario by name
  --suite <name>            Run all scenarios in a named suite
  --env <env>               Override GD_ENV (local.dev | local.test | local.prod)
  --trials <n>              Override per-scenario trial count
  --skip-baseline           Skip baseline regression gating
  --parallel-suites         Run all scenarios concurrently, 1 trial each
  --concurrency <n>         Override max concurrent trials
  --graduate <name>         Run stability check before promoting to regression
  --graduate-suite <name>   Graduate all scenarios in a suite
  --stability <level>       Override stability level (low | medium | high)
```

**Adding a scenario:** implement `Scenario` in `src/scenarios/` and register it
in the `ALL_SCENARIOS` array in `src/index.ts`.

**Adding an evaluator:** implement the `Evaluator` interface
(`src/evaluators/evaluator.ts`) and register it in the relevant scenario's
`evaluators` array.

---

## Debugging

### PROBE_DEBUG_EVENTS

Set `PROBE_DEBUG_EVENTS=1` to print every inbound AAB socket event to stderr
during an eval run:

```
[aab] chunk
[aab] tool_start read_file
[aab] tool_call read_file
[aab] tool_result read_file
[aab] step_complete
[aab] complete
```

Format: `[aab] {type}` for most events; `[aab] {type} {toolName}` for
`tool_*` events.

Useful for verifying which events arrive at the socket during handoff chains
and diagnosing empty transcript turns.

```bash
PROBE_DEBUG_EVENTS=1 pnpm run eval --scenario build-landing-page --trials 1
```

---

## Architecture

```
CLI (src/index.ts)
  └─ SuiteRunner
       ├─ Simulation × k trials per scenario
       │    ├─ SyntheticUserAgent  ──────→  GoCode (LLM)
       │    ├─ AABClient           ──────→  AAB Socket.IO :4000
       │    └─ DOMCapture          ──────→  AAB Next.js UI :8443
       │
       ├─ TrialAggregator   →  pass@k / pass^k per evaluator
       ├─ RegressionComparator  →  current vs. baseline
       └─ EvalStore  →  results/runs/{runId}/ (transcripts, evals, artifacts)
```

**Evaluators**

| Evaluator | Kind | What it checks |
|---|---|---|
| `bug-hit-rate` | computed | Unrecovered error events in transcript |
| `prompt-efficiency` | computed | Turn count vs. `maxTurns` |
| `tool-call-verification` | computed | Expected tools called / not called |
| `jtbd-completion` | LLM-judged | Scenario goals met (positive/negative assertions) |
| `output-quality` | LLM-judged | DOM snapshot quality vs. rubric / reference |

**Trial strategy**

- `executionMode: 'sequential'` (default) — one trial at a time.
- `executionMode: 'parallel'` — `Promise.all(k)` fan-out; for stateless agents.

**Suite-level parallelism**

Pass `--parallel-suites` to fan out all scenarios concurrently instead of
running them one after another:

```bash
pnpm run eval --suite smoke --parallel-suites
```

Each scenario is forced to `trial=1` in this mode — per-scenario
`executionMode` is ignored. Concurrency is capped by
`config.eval.maxConcurrency`. Use this for fast sweeps; use
`executionMode: 'parallel'` on individual scenarios when you need multi-trial
parallelism within a single scenario. Use when running scenarios at high trial values.

**Scenario categories**

Every scenario has a `category` that controls how baseline comparison
behaves:

| Category | Baseline required? | Score drop beyond threshold | Use case |
|---|---|---|---|
| `capability` | No | Logged, never blocks | New or experimental scenarios |
| `regression` | Yes (exit 1 if missing) | **Blocks the run** (exit 1) | Stable, graduated scenarios |

New scenarios start as `capability` so you can iterate without
breaking eval runs. Once behavior is stable, **graduate** the
scenario to `regression` (see
[Graduating a Scenario](#graduating-a-scenario-capability--regression))
to enforce it as a gate against future changes.

---

## Result Storage

`EvalStore` persists every run under `results/` (gitignored). Older runs
are pruned automatically when the count exceeds `maxRuns` in config.

```
results/
  .run-index.json
  runs/
    {runId}/
      run-metadata.json               # timestamp, git SHA, config
      scenarios/
        {scenarioName}/
          scenario-config.json
          aggregated.json              # pass@k, timing, regression status
          trials/
            {trialIndex}/
              transcript.json          # turns + snapshot count (no binaries)
              eval-results.json        # per-evaluator verdicts and scores
              tool_calls.json          # ordered tool call sequence + frequency
              snapshots/
                {i}.png / {i}.html / {i}.meta.json
              artifacts/               # only present when tool outputs qualify
                {i}-{filename}         # extracted source files, configs, prompts
                artifacts.json         # manifest of all extracted artifacts
```

**tool_calls.json** summarizes every tool call in the trial: an ordered
sequence with timing and error flags, plus aggregate counts by tool name.

**artifacts/** extracts useful outputs from specific tool calls:

| Tool | Artifact |
|---|---|
| `readFile` | Source file content (line numbers stripped) |
| `handoff` | Handoff prompt text |
| `fontTheme` / `colorScheme` | Config JSON (when output > 200 chars) |

---

## Baselines and Regression Gating

Baseline comparison is **on by default**. Pass `--skip-baseline` to opt out:

```bash
pnpm run eval --skip-baseline
```

Each `regression`-category scenario is compared against a saved baseline.
Baselines are versioned per scenario under
`baselines/{scenario-name}/{timestamp}_{runId}.json` and committed to the
repo so the whole team shares the same reference point. The most recent
file in each directory is loaded automatically.

**What a baseline stores:** aggregated `passAtK`, `passToTheK`,
`passingTrials`, and `totalTrials` per evaluator, not raw trial transcripts.

**Missing baselines block by default.** If a `regression`-category scenario
has no saved baseline, the run exits 1. Pass `--skip-baseline` to bypass
comparison entirely.

**How regression is detected:** for each evaluator, the harness computes
`drop = baselineScore - currentScore`. If `drop > threshold` the evaluator is
flagged `exceeded: true` and the run exits 1. Thresholds are configured per
evaluator in `config/environments/*.ts`:

```typescript
regression: {
  thresholds: {
    'output-quality':    0.15,   // allow up to 15% drop
    'prompt-efficiency': 0.20,
  },
  defaultThreshold: 0.1,         // fallback for unlisted evaluators
}
```

---

## Graduating a Scenario: capability → regression

A scenario starts as `category: 'capability'` while the agent is still
improving. Once behaviour is stable, it graduates to `category: 'regression'`
to gate future PRs.

**Why a graduation check?** Saving a baseline from a single run that happened
to score well is unreliable — the score might not reproduce. The graduation
command runs an elevated trial count and requires that every evaluator passes
at a high rate before recommending promotion.

### How it works

1. Runs trials based on the scenario's stability level (or the
   `--stability` override):
   | Level    | Trials |
   |----------|--------|
   | `low`    | 1      |
   | `medium` | 5 (default) |
   | `high`   | 10     |
2. Aggregates all trial results → pass rate per evaluator.
3. **Always saves a baseline**, whether or not promotion is recommended.
4. If `min(pass rate across all evaluators) ≥ graduationPassRateThreshold`
   (default `0.9`):
   - Prints the required `category` config change and exits 0.
5. Otherwise: prints per-evaluator pass rates with threshold markers
   and exits 1. The baseline is saved as an informational checkpoint.

`unknown` verdicts count toward `totalTrials` as failures. A DOM snapshot
timeout or a judge that cannot score a turn will reduce the pass rate.

The command **never modifies scenario files** — the config change is always a
manual code commit.

### Running graduation

```bash
# Uses the scenario's stability level (defaults to medium / 5 trials)
pnpm run eval --graduate build-landing-page

# Override with a higher stability level (10 trials)
pnpm run eval --graduate build-landing-page --stability high

# Limit concurrent trials within the scenario
pnpm run eval --graduate build-landing-page --concurrency 2

# Graduate all scenarios in a suite
pnpm run eval --graduate-suite smoke
```

**Promoted output (exit 0):**

```
✓ Scenario "build-landing-page" promoted [medium / 5 trials]
  Baseline saved.
  Min pass rate: 100% (threshold: 90%)

  To graduate, update the scenario config:
    category: 'regression'  // was: 'capability'
```

**Not promoted output (exit 1):**

```
✗ Scenario "build-landing-page" not promoted [medium / 5 trials]
  Baseline saved (informational checkpoint).
  Per-evaluator pass rates (threshold: 90%):
    bug-hit-rate: 100% ✓
    jtbd-completion: 60% ✗
```

Apply the suggested change in `src/scenarios/<name>.ts` and open a PR.

### Suite graduation parallelism

`--graduate-suite` partitions scenarios by stability level for optimal
throughput:

- **Low stability** (1 trial each): scenarios fan out concurrently,
  capped by `--concurrency` or `config.eval.maxConcurrency`.
- **Medium / high stability** (5 or 10 trials): scenarios run one at
  a time; trials within each scenario run concurrently.

This avoids combinatorial explosion (scenario × trial parallelism) while
still making use of available concurrency at the appropriate level.

### Graduation config

```typescript
regression: {
  graduationPassRateThreshold: 0.9, // min required pass rate per evaluator
}
```

Trial counts are determined by the stability level (see table above).
Use `--stability` to override at the CLI, or set `stabilityLevel` on the
scenario definition for a permanent default.

### Saving a baseline manually

`--graduate` is the recommended way to create baselines because it
validates score stability before committing. Use `save-baseline` only
when you need to force-set a baseline without the stability check, for
example after a known infrastructure change that shifted scores but did
not affect agent quality.

```bash
# Save baselines for all scenarios in a run
pnpm run save-baseline <run-id>

# Save baselines for only the scenarios in a given suite
pnpm run save-baseline <run-id> --suite <name>
```

This promotes the aggregated results of an existing run to a baseline
without re-running the simulation. It writes one baseline file per
scenario that was included in the run (or per suite-filtered subset).

---

## Project Structure

```
config/
  environments/           # Per-env config (local.dev / local.test / local.prod)
  index.ts                # Config loader (GD_ENV-based)

src/
  clients/
    aab-client.ts         # Socket.IO wrapper for AAB :4000
    agents-api-client.ts  # HTTP client for AAB app registration
    gocode-client.ts      # OpenAI-compat client → GoCode
    dom-capture.ts        # Playwright screenshot + HTML capture
    agent-client.ts       # AgentClient interface + AgentEvent union

  runner/
    simulation.ts         # Single conversation loop
    suite-runner.ts       # Batch runner: scenarios × k trials
    trial-aggregator.ts   # pass@k / pass^k aggregation
    synthetic-user.ts     # SyntheticUserAgent interface
    gocode-synthetic-user.ts
    transcript.ts         # Transcript / Turn / ToolCall types

  evaluators/
    evaluator.ts          # Evaluator interface + EvalResult type
    bug-hit-rate.ts
    prompt-efficiency.ts
    tool-call-verification.ts
    jtbd-completion.ts
    output-quality.ts

  scenarios/
    types.ts              # Scenario / ScenarioGoal / ToolCallAssertion types
    build-landing-page.ts # First concrete scenario

  personas/
    types.ts
    beginner.ts           # Low-context user, max 30 turns

  baselines/
    baseline-store.ts     # Save/load baselines/{scenario}.json
    regression-comparator.ts
    graduation-runner.ts  # Stability check before category promotion
    types.ts

  store/
    eval-store.ts           # Run persistence: save/load/prune trial data
    artifact-extractor.ts   # Extract source files, configs, prompts from tool outputs
    tool-call-summarizer.ts # Per-trial tool call sequence and frequency summary
    types.ts                # StoredToolCallSummary, ArtifactEntry, RunMetadata, etc.

  reporters/
    json-reporter.ts      # results/{runId}.json
    md-reporter.ts        # results/{runId}.md

  index.ts                # CLI entrypoint

baselines/                # Version-controlled baseline snapshots
results/                  # Run output (gitignored)
NOTES.md                  # Integration discoveries and known issues
```

---

## Running Tests

Unit tests cover all modules with fixture-based inputs — no live AAB or
GoCode connection required. Each module has a `__tests__/` folder co-located
with its source.

```bash
pnpm run test          # from evals/gosym-probe/
pnpm run test:watch    # watch mode

# or from repo root:
pnpm --filter gosym-probe test
```
