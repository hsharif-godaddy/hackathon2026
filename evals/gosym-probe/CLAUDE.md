@CLAUDE.local.md

# gosym-probe

Eval harness for the Airo App Builder (AAB) agent. Drives a synthetic
user (GoCode / foundation LLM) through scripted scenarios against a
locally running AAB instance, scores results, and compares against
saved baselines.

---

## Quick Start

**Prerequisites**

- Node.js 20+, pnpm
- AAB running locally (SSE chat transport over HTTP on the agents server `:4000`, Next.js UI `:8443`)
- AWS SSO authenticated: `aws sso login --profile airobuild-dev-private-sso`

**Setup**

```bash
cp .env.example .env   # fill in OPENAI_BASE_URL and PROBE_OPENAI_API_KEY
pnpm install           # run from repo root
```

**Run**

Use the **Probe tab** in the dev runner (`pnpm run dev` from the repo root) for
interactive eval execution, menu-driven scenario browsing, and baseline
management.

For headless / CI usage:

```bash
pnpm run eval          # headless eval with flags
```

---

## Scripts

| Script          | Command                                   | Description                        |
| --------------- | ----------------------------------------- | ---------------------------------- |
| `eval`          | `tsx --env-file=.env src/index.ts`        | Headless eval runner               |
| `save-baseline` | `tsx --env-file=.env src/save-baseline.ts`| Snapshot a run as the new baseline |
| `test`          | `vitest run`                              | Run tests once                     |
| `test:watch`    | `vitest`                                  | Watch mode                         |

### `pnpm run eval` flags

```
--scenario <name>        Run one scenario by name
--suite <name>           Filter to scenarios in a named suite
--env <env>              Override GD_ENV
--trials <n>             Override per-scenario trial count
--concurrency <n>        Cap concurrency (trials in standard mode, worker pool size in --fan-out mode; clamped to config.eval.maxConcurrency)
--capture-concurrency <n> Cap concurrent Playwright captures, independent of trial concurrency (default 2; clamped to capture.maxConcurrency, default 8). Lets you raise --concurrency without overlapping captures thrashing the backend.
--max-routes <n>         Cap routes captured per trial (default 20). Lower it to trade capture depth for speed.
--max-turns <n>          Override max turns per simulation
--skip-baseline          Skip baseline comparison
--baseline <run-id>      Compare against a specific baseline run instead of the most recent
--fan-out                Dispatch trials round-robin across a worker pool (capped by maxConcurrency); workers stay busy until the queue drains
--graduate <name>        Stability check one scenario before promoting
--graduate-suite <name>  Stability check all scenarios in a suite
--stability <level>      Override stability level (low|medium|high)
--resume <run-id>        Resume a previous incomplete run
```

### Flag interactions

| Flag combo                     | `--trials N`        | `--concurrency M`                                      |
| ------------------------------ | ------------------- | ------------------------------------------------------ |
| Standard eval                  | controls trials     | controls trial parallelism                             |
| Standard + `--fan-out`         | controls trials                | controls worker pool (capped by MAX_CONCURRENCY)                             |
| `--graduate`                   | ignored (set by 'stability')   | controls trial parallelism                             |
| `--graduate-suite`             | ignored (set by 'stability')   | controls trial parallelism                             |
| `--graduate-suite` + `--fan-out` | ignored (set by 'stability') | controls worker pool (capped by MAX_CONCURRENCY)                             |

Graduation trial counts are driven solely by stability level
(`low`=5, `medium`=10, `high`=20). `--trials` has no effect in
graduation paths. `--fan-out` dispatches trials round-robin across all
workers (A1,B1,C1,A2,B2,C2,...), keeping workers busy until the queue
drains. `--concurrency M` sets the worker pool size, capped by MAX_CONCURRENCY.

`--baseline` and `--skip-baseline` are mutually exclusive. `--baseline`
pins comparison to a specific prior run; omitting both flags loads the
most recent baseline for each scenario.

### Capture concurrency (decoupled from trial concurrency)

Each trial has two phases: a network-bound LLM conversation, then an
expensive Playwright capture (a fresh browser + up to `--max-routes` ×
viewports navigations against the single local AAB backend). `--concurrency`
governs how many trials/conversations run at once; **`--capture-concurrency`
separately caps how many captures run at once** (default 2). They are
independent — `--capture-concurrency` is *not* clamped to the trial
`maxConcurrency`. It **is** bounded by its own ceiling, `capture.maxConcurrency`
(default 8, env var `MAX_CAPTURE_CONCURRENCY`), a sanity guard so a typo like
`--capture-concurrency 100` can't launch a browser stampede against the single
local backend; a request above the ceiling is clamped down with a warning.

This is why raising trial concurrency alone used to cause capture timeouts:
N overlapping captures thrash CPU/RAM and the backend, blowing the per-route
goto/app-ready waits. Keep captures bounded while raising conversations:

```bash
MAX_CONCURRENCY=8 pnpm run eval --suite golden-light --capture-concurrency 2
```

If captures are still slow at 2-wide, trim depth with `--max-routes` (or the
`MAX_ROUTES` env var). A single shared semaphore inside `SiteCapture` enforces
the cap across standard, fan-out, and graduation paths.

### Resume behavior

`--resume <run-id>` re-runs only missing trial indices into the same run
directory; completed trials are reused. Accepted run-ref formats: UUID
(`runId` from `run-metadata.json`) or directory name under `results/runs/`.

**Scenario-filter requirement.** Pass the same `--suite`/`--scenario` filter
as the original run. The harness validates that the resolved scenario names
match what was recorded; a mismatch exits with an error before running any
trials.

**Graduation resume.** `--graduate-suite <name> --fan-out --resume <run-id>`
resumes an incomplete graduation fan-out run. The harness validates that the
stored run has `kind: graduation` and matches the requested scenario names,
then runs only the remaining trials for incomplete scenarios (fan-out mode
only). Completed scenarios are finalized (baselines saved) as they finish.
Pass the same `--suite` filter as the original run.

Sequential graduation (`--graduate-suite` without `--fan-out`) does not
support `--resume` — the sequential path re-runs each scenario entirely and
cannot resume partial scenario work. Use `--fan-out` for graduation runs that
may need recovery. `--graduate` (single-scenario) also does not support
`--resume`.

### `pnpm run save-baseline` usage

```bash
pnpm run save-baseline <run-id>               # snapshot all scenarios
pnpm run save-baseline <run-id> --suite <name> # snapshot one suite
```

---

## Architecture

```
src/index.ts      Headless CLI entrypoint
src/save-baseline.ts  Baseline snapshot script

src/runner/       SuiteRunner, Simulation, TrialAggregator,
                  GoalTracker, types
src/clients/      AABClient (SSE), GocodeClient (OpenAI-compat),
                  DOMCapture (Playwright)
src/evaluators/   Evaluator interface + concrete evaluators
src/scenarios/    Scenario types + registry + concrete scenarios
                  (prompt-vs-skill/ suite)
src/baselines/    BaselineStore, RegressionComparator, GraduationRunner,
                  GraduationSuiteRunner, ScoreModeEnricher, threshold utils
src/reporters/    Markdown run reporter
src/store/        EvalStore (run results persistence)
src/personas/     Persona types (e.g. beginner)
src/util/         Shared utilities (scenario-filters, concurrency, etc.)

config/
  environments/   Per-env config: local.dev.ts, local.test.ts,
                  local.prod.ts
  index.ts        loadConfig() — reads GD_ENV, returns Config

baselines/        Shared golden baseline snapshots (committed, regression gates)
runs/             Run output — gitignored
```

**Execution flow**

```
index.ts
  └─ SuiteRunner
       ├─ Simulation × k trials
       │    ├─ SyntheticUserAgent  →  GoCode (LLM)
       │    ├─ AABClient           →  AAB SSE :4000
       │    └─ DOMCapture          →  AAB Next.js UI :8443
       ├─ TrialAggregator  →  pass@k / pass^k per evaluator
       ├─ RegressionComparator  →  current vs baseline
       ├─ ScoreModeEnricher  →  passAtK from per-trial baseline delta
       └─ MdReporter  →  runs/{runId}/
```

In graduation paths (`--graduate` / `--graduate-suite`), `onTrialEvaluated`
persists each trial's transcript and eval results to disk as it completes.
This ensures trial data survives a partial failure and is available to
`--resume` without re-running completed work.

---

## Coding Conventions

- **TypeScript strict mode** — `strict: true` in `tsconfig.json`. No
  implicit any, no unsafe assertions.
- **ESM imports** — use `.js` extensions on all local imports even
  though source files are `.ts`. The bundler resolves `.ts` at build
  time; the `.js` extension is required at runtime.
  ```typescript
  import { buildScenarioIndex } from "./util/scenario-filters.js"; // correct
  import { buildScenarioIndex } from "./util/scenario-filters";    // wrong
  ```
- **Test colocation** — unit tests live in `__tests__/` next to their
  source module (e.g. `src/evaluators/__tests__/jtbd-completion.test.ts`).
- **TDD** — write tests before implementing. Run `pnpm test` before
  every commit.
- **No default exports** — named exports only.

---

## Environment Variables

Configured in `.env` (copy from `.env.example`).

| Variable             | Required | Default                     | Description                                       |
| -------------------- | -------- | --------------------------- | ------------------------------------------------- |
| `GD_ENV`                | No       | `local.dev`                 | Config environment to load                                                      |
| `OPENAI_BASE_URL`       | Yes      | —                           | GoCode endpoint URL                                                             |
| `PROBE_OPENAI_API_KEY`  | No*      | —                           | GoCode API key; not needed when `GOCODE_USE_S2S_AUTH=true`                      |
| `GOCODE_USE_S2S_AUTH`   | No       | `false`                     | Set to `true` to use IAM S2S JWT auth instead of a static key                  |
| `OPENAI_MODEL`          | No       | —                           | Model for the synthetic user (GoCode)                                           |
| `MAX_CONCURRENCY`       | No       | per-env                     | Max concurrent trials; `--concurrency` overrides                                |
| `CAPTURE_CONCURRENCY`   | No       | `2`                         | Max concurrent Playwright captures, independent of trial concurrency; `--capture-concurrency` overrides; clamped to `MAX_CAPTURE_CONCURRENCY` |
| `MAX_CAPTURE_CONCURRENCY` | No     | `8`                         | Hard ceiling for capture concurrency; requests above it are clamped down with a warning |
| `MAX_ROUTES`            | No       | `20`                        | Max routes captured per trial; `--max-routes` overrides                         |
| `MAX_TURNS`             | No       | `10`                        | Max turns per simulation; `--max-turns` overrides                               |
| `AWS_PROFILE`           | No       | `airobuild-dev-private-sso` | AWS SSO profile; required for S2S and AAB                                       |
| `PROBE_DEBUG_EVENTS`    | No       | —                           | Set to `1` to log AAB SSE events                                                |

### AAB-side variables (set in `agents/.env` at repo root, not probe `.env`)

| Variable             | Required | Default | Description                                                                                                                                                                                                         |
| -------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOCKET_DIAGNOSTICS` | No       | —       | Set to `true` in AAB to gate the SSE diagnostic events `token_usage_summary`, `stream_timing_summary`, `stream_chunk_slow_gap`, and `stream_chunk_timeout` (emitted by the SSE path), consumed by `LatencyEvaluator` and the token-usage collector. When unset, no diagnostic events are emitted. |

---

## Config Environments

Three environments defined in `config/environments/`:

| `GD_ENV`     | File            | Use                   |
| ------------ | --------------- | --------------------- |
| `local.dev`  | `local.dev.ts`  | Default development   |
| `local.test` | `local.test.ts` | Local test stack      |
| `local.prod` | `local.prod.ts` | Local prod-like stack |

`loadConfig()` in `config/index.ts` reads `GD_ENV` and returns the
matching `Config`. Switching environment:

```bash
GD_ENV=local.test pnpm run eval
# or edit .env: GD_ENV=local.test
```

Each config file exports `createConfig(): Config` and sets regression
thresholds per evaluator:

```typescript
regression: {
  thresholds: {
    'prompt-efficiency': 0.20,
    'token-usage': 1.5,
  },
  defaultThreshold: 0.25,
}
```

The `defaultThreshold` acts as a loose gate for score-mode evaluators
to absorb infrastructure variance. Per-evaluator thresholds override it.
Threshold logic lives in `src/baselines/threshold.ts`.

---

## How to Add a Scenario

1. Create `src/scenarios/<your-scenario-name>.ts`:

```typescript
import type { Scenario } from "./types.js";
import type { GocodeClient } from "../clients/gocode-client.js";
import type { AABCtrlPlaneClient } from "../clients/aab-ctrl-plane-client.js";
import { beginnerPersona } from "../personas/beginner.js";
import { JTBDCompletionEvaluator } from "../evaluators/jtbd-completion.js";

export function buildMyScenario(
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return {
    name: "my-scenario",
    suite: "my-suite", // optional; groups related scenarios
    persona: beginnerPersona,
    goals: [
      {
        description: "Agent completed the user task",
        assertion: "positive",
      },
    ],
    evaluators: [new JTBDCompletionEvaluator(gocode)],
    trials: 3,
  };
}
```

2. Register in `src/scenarios/registry.ts`:

```typescript
import { buildMyScenario } from "./my-scenario.js";

export function createAllScenarios(
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario[] {
  return [
    buildLandingPageScenario(gocode, ctrlPlane),
    buildMyScenario(gocode, ctrlPlane), // add here
  ];
}
```

3. Write tests in `src/scenarios/__tests__/` verifying the scenario
   shape (goals, evaluator names, trial count).

4. Run `pnpm run eval --scenario my-scenario --trials 1 --skip-baseline`
   to verify end-to-end.

---

## How to Add an Evaluator

Implement the `Evaluator` interface from `src/evaluators/evaluator.ts`:

```typescript
import type { EvalResult, Evaluator } from "./evaluator.js";
import type { DOMSnapshot, Transcript } from "../runner/transcript.js";
import type { Scenario } from "../scenarios/types.js";

export class MyEvaluator implements Evaluator {
  readonly name = "my-evaluator";

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    // scoring logic here
    return {
      evaluator: this.name,
      score: 1.0, // 0.0–1.0
      verdict: "pass", // 'pass' | 'partial' | 'fail' | 'unknown' | 'observed'
      reason: "All checks passed",
    };
  }
}
```

**Key rules:**

- `score` must be in `[0.0, 1.0]` for non-observed verdicts (`pass`,
  `fail`, `partial`, `unknown`). For `observed`-verdict evaluators
  (`regressionMode: 'score'`), emit the raw measurement (e.g. token
  count, USD cost); `normalizeEvalResult` leaves it unclamped.
- Return `verdict: 'unknown'` when inputs are insufficient to judge.
- Return `verdict: 'observed'` for score-mode evaluators that record a
  measurement (no pass/fail semantics).

Wire the evaluator into a scenario's `evaluators` array:

```typescript
evaluators: [
  new JTBDCompletionEvaluator(gocode),
  new MyEvaluator(),
],
```

Write tests in `src/evaluators/__tests__/` with fixture transcripts
covering pass, partial, fail, and unknown cases.
