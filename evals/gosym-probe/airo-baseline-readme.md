# Airo Baseline Evals

This document covers the common commands for running the `airo-baseline` synthetic-user suite in `gosym-probe`.

## Prerequisites

Start Airo Builder locally with mock auth from the repo root:

```bash
AUTH_TYPE=mock pnpm run dev
```

The dev TUI should show healthy services for `App`, `Agents`, and `Control Plane`.

## Open The Interactive CLI

From the repo root:

```bash
GD_AIRO_BASELINE_ENABLE=1 \
GD_AIRO_BASELINE_USE_BASELINE_EVALUATORS=1 \
PROBE_DEBUG_EVENTS=1 \
pnpm --filter gosym-probe start
```

This opens the `gosym-probe` menu UI with options such as `Run Scenarios`.

## Run The Airo Baseline Suite

Run all `airo-baseline` scenarios with baseline evaluators and debug websocket events:

```bash
GD_AIRO_BASELINE_ENABLE=1 \
GD_AIRO_BASELINE_USE_BASELINE_EVALUATORS=1 \
PROBE_DEBUG_EVENTS=1 \
pnpm --filter gosym-probe eval --suite airo-baseline --skip-baseline --max-turns 15
```

## Run In Parallel

Use `--parallel-suites` to fan out scenarios concurrently:

```bash
GD_AIRO_BASELINE_ENABLE=1 \
GD_AIRO_BASELINE_USE_BASELINE_EVALUATORS=1 \
PROBE_DEBUG_EVENTS=1 \
pnpm --filter gosym-probe eval --suite airo-baseline --parallel-suites --skip-baseline --max-turns 15
```

Note: `--parallel-suites` forces one trial per scenario.

## Run Multiple Trials

To run multiple trials per scenario, omit `--parallel-suites`:

```bash
GD_AIRO_BASELINE_ENABLE=1 \
GD_AIRO_BASELINE_USE_BASELINE_EVALUATORS=1 \
PROBE_DEBUG_EVENTS=1 \
pnpm --filter gosym-probe eval --suite airo-baseline --skip-baseline --max-turns 15 --trials 2
```

## Resume A Previous Run

Resume a run by passing either the run ID or run directory name:

```bash
GD_AIRO_BASELINE_ENABLE=1 \
GD_AIRO_BASELINE_USE_BASELINE_EVALUATORS=1 \
PROBE_DEBUG_EVENTS=1 \
pnpm --filter gosym-probe eval --suite airo-baseline --skip-baseline --max-turns 15 --trials 2 --resume <run-id-or-run-dir>
```

Example:

```bash
GD_AIRO_BASELINE_ENABLE=1 \
GD_AIRO_BASELINE_USE_BASELINE_EVALUATORS=1 \
PROBE_DEBUG_EVENTS=1 \
pnpm --filter gosym-probe eval --suite airo-baseline --skip-baseline --max-turns 15 --trials 2 --resume 140e8aa2-c568-46ca-a217-5f54d33180da
```

Resume skips completed trial indices and writes missing trials into the same run directory.

## Flags

- `GD_AIRO_BASELINE_ENABLE=1`: loads the `airo-baseline` scenarios from `evals/airo-baseline-set`.
- `GD_AIRO_BASELINE_USE_BASELINE_EVALUATORS=1`: attaches the baseline evaluator set.
- `PROBE_DEBUG_EVENTS=1`: prints AAB websocket debug events.
- `--suite airo-baseline`: runs only the Airo baseline suite.
- `--skip-baseline`: skips saved-regression-baseline checks while iterating.
- `--max-turns <n>`: caps conversation turns.
- `--trials <n>`: runs multiple trials per scenario when not using `--parallel-suites`.
- `--resume <run-id-or-run-dir>`: resumes an existing run.

## Override Synthetic Users Path

By default, `airo-baseline` loads:

```text
evals/airo-baseline-set/synthetic-users/
```

Override with:

```bash
GD_AIRO_BASELINE_SYNTHETIC_USERS_PATH=/path/to/synthetic-users-folder
GD_AIRO_BASELINE_SCENARIOS_PATH=/path/to/scenarios-folder
```
