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
  --baseline <run-id>       Compare against a specific baseline run instead of the most recent
  --fan-out                 Fan out all scenarios concurrently, full trial count each
  --concurrency <n>         Override max concurrent trials
  --graduate <name>         Run stability check before promoting to regression
  --graduate-suite <name>   Graduate all scenarios in a suite
  --stability <level>       Override stability level (low | medium | high)
  --resume <run-id>         Resume a previous incomplete run (re-runs missing trials only)
```

**Adding a scenario:** implement `Scenario` in `src/scenarios/` and register it
in the `ALL_SCENARIOS` array in `src/index.ts`.

**Adding an evaluator:** implement the `Evaluator` interface
(`src/evaluators/evaluator.ts`) and register it in the relevant scenario's
`evaluators` array.

---

## Performance (Local Evals)

To get the best throughput from local eval runs:

### Docker Resource Allocation

AAB's preview and publish containers run in Docker. Give them as much
headroom as possible:

1. **CPU:** Allow Docker to use all available cores (Docker Desktop →
   Settings → Resources → CPUs: max).
2. **RAM:** Allocate as much memory as you can spare from other
   applications. On a 48 GB machine, 32-40 GB for Docker is a good
   target.

### Concurrency

Set `MAX_CONCURRENCY=5` in `evals/gosym-probe/.env` as a starting point:

```dotenv
MAX_CONCURRENCY=5
```

Optimal concurrency depends on scenario complexity. Resource-heavy
scenarios (multi-agent handoffs, large DOM captures) may need a lower
value. Monitor system load and adjust accordingly.

### AAB Launch Configuration

Start AAB with socket diagnostics and mock auth:

```bash
SOCKET_DIAGNOSTICS=true AUTH_TYPE=mock pnpm run dev
```

Or set both in `agents/.env` so they persist across restarts:

```dotenv
SOCKET_DIAGNOSTICS=true
AUTH_TYPE=mock
```

- `AUTH_TYPE=mock` bypasses JWT validation (AWS Secrets Manager is
  unavailable locally).
- `SOCKET_DIAGNOSTICS=true` emits real-time socket timing events,
  required by `LatencyEvaluator` and useful for diagnosing stalled
  trials.

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
       ├─ ScoreModeEnricher  →  passAtK from per-trial baseline delta
       └─ EvalStore  →  results/runs/{runId}/ (transcripts, evals, artifacts)
```

**Evaluators**

See `src/evaluators/` for the full set of evaluators and their implementations.

**Suite-level parallelism**

Pass `--fan-out` to fan out all scenarios concurrently instead of
running them one after another:

```bash
pnpm run eval --suite smoke --fan-out
```

Each scenario runs its full trial count sequentially within the scenario.
Concurrency is capped by `config.eval.maxConcurrency`.

**Flag interactions**

| Flag combo                       | `--trials N`        | `--concurrency M`          |
| -------------------------------- | ------------------- | -------------------------- |
| Standard eval                    | controls trials     | controls trial parallelism |
| Standard + `--fan-out`           | controls trials              | controls worker pool (capped by MAX_CONCURRENCY) |
| `--graduate`                     | ignored (set by 'stability') | controls trial parallelism                       |
| `--graduate-suite`               | ignored (set by 'stability') | controls trial parallelism                       |
| `--graduate-suite` + `--fan-out` | ignored (set by 'stability') | controls worker pool (capped by MAX_CONCURRENCY) |

Graduation trial counts are driven solely by stability level
(`low`=5, `medium`=10, `high`=20). `--trials` has no effect in
graduation paths. `--fan-out` forces trial-level concurrency to 1
(trials run sequentially within each scenario; scenarios fan out).

**Regression gating**

Regression gating is driven by baseline presence: scenarios with a
saved baseline are compared and gated; scenarios without one are
informational (logged, never block). New scenarios start without a
baseline so you can iterate without breaking eval runs. Once behavior
is stable, **graduate** the scenario (see
[Graduating a Scenario](#graduating-a-scenario)) to save a baseline
and enforce it as a gate against future changes.

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
              conversation.json        # human-readable conversation (role, content, timing)
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

| Tool                        | Artifact                                    |
| --------------------------- | ------------------------------------------- |
| `readFile`                  | Source file content (line numbers stripped) |
| `handoff`                   | Handoff prompt text                         |
| `fontTheme` / `colorScheme` | Config JSON (when output > 200 chars)       |

---

## Baselines and Regression Gating

Baseline comparison is **on by default**. Pass `--skip-baseline` to opt out:

```bash
pnpm run eval --skip-baseline
```

Baselines are stored per scenario under
`baselines/{scenario-name}/{timestamp}_{runId}.json` and are **local-only**
(gitignored). Each developer generates their own baselines against their
local AAB instance using `pnpm run save-baseline`. This avoids committing
environment-specific scores that would cause false regressions across
different machines or configurations.

Each scenario with a saved baseline is compared against it. The most recent
file in each directory is loaded automatically.

**Pinning to a specific baseline.** Pass `--baseline <run-id>` to compare
against a specific prior run instead of the most recent:

```bash
pnpm run eval --baseline abc-1234-uuid
```

The run ID must match a file in `baselines/{scenario-name}/` for every
scenario being evaluated. If any scenario is missing that baseline, the
eval exits immediately with an error before running any trials:

```
Error: baseline run "abc-1234-uuid" not found for scenario "build-landing-page".
```

`--baseline` and `--skip-baseline` are mutually exclusive.

**What a baseline stores:** aggregated `passAtK`, `passToTheK`,
`passingTrials`, `totalTrials`, and `aggregateScore` (for score-mode
evaluators) per evaluator, not raw trial transcripts.

**No baseline = informational.** Scenarios without a saved baseline are
reported but never block. Pass `--skip-baseline` to skip comparison entirely.

**How regression is detected:** two modes based on `regressionMode`:

- **Pass-rate evaluators** (default): compares pass rate
  (`passingTrials / totalTrials`) against baseline. A drop exceeding the
  threshold flags a regression.
- **Score-mode evaluators** (`regressionMode: 'score'`): compares the
  aggregate score (trimmed mean) via relative percentage change against the
  baseline. Respects `lowerIsBetter` directionality. After regression
  comparison, `enrichScoreModePassRates` derives `passAtK`/`passToTheK` by
  checking each trial's score against the baseline aggregate score within
  the threshold.

### Choosing the right metric for gating

See [docs/regression-gating.md](docs/regression-gating.md) for the full
statistical rationale. Summary: the regression comparator uses **pass rate**
because it estimates the same underlying quantity regardless of trial count,
making cross-trial-count comparison valid.

Thresholds are configured per evaluator in `config/environments/*.ts`:

```typescript
regression: {
  thresholds: {
    'prompt-efficiency': 0.20,
    'token-usage': 1.5,
  },
  defaultThreshold: 0.25,         // fallback for unlisted evaluators
}
```

---

## Resuming an Incomplete Run

Pass `--resume <run-id>` to continue a run that was interrupted before all
trials finished. Only missing trial indices are re-run; completed trials are
loaded from the existing run directory and combined with new results.

```bash
pnpm run eval --resume abc-1234-uuid
pnpm run eval --resume abc-1234-uuid --suite smoke
pnpm run eval --resume abc-1234-uuid --trials 5
```

### Run reference formats

`--resume` accepts either:
- **UUID** — the `runId` from `run-metadata.json` (e.g. `abc-1234-uuid`)
- **Directory name** — the directory under `results/runs/` (e.g.
  `2026-05-20T10-30-00_abc-1234`)

Both forms resolve to the same run directory.

### Constraints

**Scenario filter must match the original run.** You must pass the same
`--suite` and/or `--scenario` filter that produced the original run.
The harness stores which scenario names were recorded, not which filter
flags were used; if the resolved scenario set differs, the eval exits with
an error:

```
Error: cannot resume "abc-1234-uuid". Current scenario set does not match
the resumed run. Missing from current run: build-landing-page.
```

**Incompatible with `--graduate` and `--graduate-suite`.** Passing
`--graduate` or `--graduate-suite` together with `--resume` silently
supersedes the resume -- the graduation code path runs instead and
`--resume` is ignored. Use one or the other, not both.

### Trials and concurrency on resume

`--trials N` extends or caps the trial count relative to the original run.
The harness resolves trial count as:
`--trials` override → original run's trials override → scenario default.
Trials that already completed are reused; only the missing indices run.

`--fan-out`, `--concurrency`, and `--max-turns` are fully honored for the
resumed trials.

---

## Graduating a Scenario

A scenario starts without a baseline (informational only). Once behaviour
is stable, it graduates by saving a validated baseline that gates future PRs.

**Why a graduation check?** Saving a baseline from a single run that happened
to score well is unreliable — the score might not reproduce. The graduation
command runs an elevated trial count to establish a representative baseline.

### How it works

1. Runs trials based on the scenario's stability level (or the
   `--stability` override):
   | Level | Trials |
   |----------|--------|
   | `low` | 5 (default) |
   | `medium` | 10 |
   | `high` | 20 |
2. Aggregates all trial results.
3. Saves the baseline unconditionally, unless all trials produced only
   `unknown` verdicts (indicating infrastructure failure rather than
   meaningful eval data).

The baseline is saved regardless of pass rates. There is no pass-rate
gate. The purpose of graduation is to capture a stable representative
measurement, not to enforce a quality bar.

The command **never modifies scenario files** — the config change is always a
manual code commit.

### Running graduation

```bash
# Uses the scenario's stability level (defaults to low / 5 trials)
pnpm run eval --graduate build-landing-page

# Override with a higher stability level (20 trials)
pnpm run eval --graduate build-landing-page --stability high

# Limit concurrent trials within the scenario
pnpm run eval --graduate build-landing-page --concurrency 2

# Graduate all scenarios in a suite
pnpm run eval --graduate-suite smoke
```

**Success output (exit 0):**

```
✓ Scenario "build-landing-page" graduated [low / 5 trials]
  Baseline saved.
```

**Failure output (exit 1):**

```
✓ Scenario "build-landing-page" graduated [low / 5 trials]
  Baseline NOT saved (all trials produced unknown verdicts).
```

Exit 1 indicates infrastructure failure (no valid trial data) rather
than eval quality issues. The scenario will be gated on future runs
once a baseline is successfully saved.

### Suite graduation parallelism

`--graduate-suite` partitions scenarios by stability level for optimal
throughput:

- **Low stability** (5 trials each): scenarios fan out concurrently,
  capped by `--concurrency` or `config.eval.maxConcurrency`.
- **Medium / high stability** (10 or 20 trials): scenarios run one at
  a time; trials within each scenario run concurrently.

This avoids combinatorial explosion (scenario × trial parallelism) while
still making use of available concurrency at the appropriate level.

### Graduation config

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
    llm-json-evaluator.ts # LLMJsonEvaluator base class
    shared.ts             # clamp01, extractBodyHtml, htmlToText, truncate
    bug-hit-rate.ts
    prompt-efficiency.ts
    tool-call-verification.ts
    jtbd-completion.ts
    build-quality-evaluators/
      index.ts            # createBuildQualityEvaluators factory
      deterministic-dom-evaluator.ts
      quality-llm-evaluators.ts
      specs/              # 7 StructuralEvalSpec implementations

  scenarios/
    types.ts              # Scenario / ScenarioGoal / ToolCallAssertion types
    build-landing-page.ts # First concrete scenario

  personas/
    types.ts
    beginner.ts           # Low-context user, max 10 turns

  baselines/
    baseline-store.ts     # Save/load baselines/{scenario}.json
    regression-comparator.ts
    graduation-runner.ts  # Stability check before baseline save
    score-mode-enricher.ts # Derives passAtK from per-trial baseline delta
    threshold.ts          # Shared threshold logic (exceedsThreshold, resolveThreshold)
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

baselines/                # Local-only baseline snapshots (gitignored)
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
