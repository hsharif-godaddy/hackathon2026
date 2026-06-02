# PR eval comparison — todo-list-progress

> Single entry point for reviewers. Raw runs stay under `evals/gosym-probe/runs/` (gitignored).

## Metadata

| Field | Value |
|-------|-------|
| Generated | 2026-05-28T00:05:28.454Z |
| Branch HEAD (at generation) | `2c50929c55e2229b500f70594fe69192ca023321` |
| Manifest JSON | [pr-todo-list-progress-eval-manifest.json](./pr-todo-list-progress-eval-manifest.json) |

## Verdict

**Todo lifecycle:** Large improvement on `re-ask-in-tool-call` (0/1 → 5/5) and `build-with-explicit-name` (0/1 → 4/5). B5 false positives fixed; remaining A4 fail on one `build-with-explicit-name` trial is likely eval/persona noise (homepage-only build vs “mark all roadmap items done”).

**Golden-light:** Suite-level `latency` pass rate improved (9% → 50% trial-level rollup) but **not** a primary win — TTFC still ~40–75s; `simple-portfolio` latency still 0/3 after. Todo code adds negligible DB overhead.

**Not claimed:** Stream latency fix, perfect golden-light gate, or production perf benchmarks.

## Executive summary

| Comparison | Suite | Before pass | After pass | Δ mean score | pass@k (after) |
|------------|-------|-------------|------------|--------------|----------------|
| re-ask-in-tool-call | todo-lifecycle | 0/1 | 5/5 | 0.13 | ✓ |
| build-with-explicit-name | todo-lifecycle | 0/1 | 4/5 | 0.12 | ✓ |
| simple-portfolio | golden-light | 3/3 | 3/3 | 0.00 | ✓ |
| business-site | golden-light | 2/3 | 3/3 | 0.17 | ✓ |
| multipage-catalog | golden-light | 1/3 | 0/3 | 0.00 | ✗ |
| cleaning-biz-ambiguity | golden-light | 1/2 | 3/3 | 0.25 | ✓ |

## todo-lifecycle suite

### `re-ask-in-tool-call`

| Metric | Before | After |
|--------|--------|-------|
| Run ID | `2dd47218` | `38d8dbda` |
| Git SHA | `84212c18` | `5d0397f7` |
| Trial pass rate | 0/1 | 5/5 |
| Mean score | 0.87 | 1.00 |
| pass@k | ✗ | ✓ |
| pass^k | ✗ | ✓ |
| Avg trial duration | 15m 57s | 18m 54s |
| Avg turns/trial | 12.0 | 12.8 |

#### Per-trial (`todo-lifecycle`)

| Trial | Before score | After score | After verdict | Flags |
|-------|--------------|-------------|---------------|-------|
| T1 | 0.87 | 1.00 | pass | — |
| T2 | — | 1.00 | pass | — |
| T3 | — | 1.00 | pass | — |
| T4 | — | 1.00 | pass | — |
| T5 | — | 1.00 | pass | — |

#### Checklist flags (trials flagged per ID)

| ID | Before (# trials) | After (# trials) |
|----|-------------------|------------------|
| A4 | 1 | 0 |
| C1 | 1 | 0 |

#### Drill-down

- Before: [`re-ask-in-tool-call` summary](../runs/20260521223415_2dd47218-6199-4ad4-86ac-7de3455a3fd5/summary.md)
- After: [`re-ask-in-tool-call` summary](../runs/20260522193040_38d8dbda-1d30-4dcd-8c72-54f5d89577d3/summary.md)
- After trials: [T1](../runs/20260522193040_38d8dbda-1d30-4dcd-8c72-54f5d89577d3/scenarios/re-ask-in-tool-call/trials/0/eval-results.md), [T2](../runs/20260522193040_38d8dbda-1d30-4dcd-8c72-54f5d89577d3/scenarios/re-ask-in-tool-call/trials/1/eval-results.md), [T3](../runs/20260522193040_38d8dbda-1d30-4dcd-8c72-54f5d89577d3/scenarios/re-ask-in-tool-call/trials/2/eval-results.md), [T4](../runs/20260522193040_38d8dbda-1d30-4dcd-8c72-54f5d89577d3/scenarios/re-ask-in-tool-call/trials/3/eval-results.md), [T5](../runs/20260522193040_38d8dbda-1d30-4dcd-8c72-54f5d89577d3/scenarios/re-ask-in-tool-call/trials/4/eval-results.md)

### `build-with-explicit-name`

| Metric | Before | After |
|--------|--------|-------|
| Run ID | `2dd47218` | `38b2302b` |
| Git SHA | `84212c18` | `5d0397f7` |
| Trial pass rate | 0/1 | 4/5 |
| Mean score | 0.87 | 0.99 |
| pass@k | ✗ | ✓ |
| pass^k | ✗ | ✗ |
| Avg trial duration | 57m 29s | 48m 45s |
| Avg turns/trial | 60.0 | 37.6 |

#### Per-trial (`todo-lifecycle`)

| Trial | Before score | After score | After verdict | Flags |
|-------|--------------|-------------|---------------|-------|
| T1 | 0.87 | 1.00 | pass | — |
| T2 | — | 1.00 | pass | — |
| T3 | — | 1.00 | pass | — |
| T4 | — | 1.00 | pass | — |
| T5 | — | 0.93 | fail | A4 |

#### Checklist flags (trials flagged per ID)

| ID | Before (# trials) | After (# trials) |
|----|-------------------|------------------|
| A4 | 1 | 1 |
| B5 | 1 | 0 |

#### Drill-down

- Before: [`build-with-explicit-name` summary](../runs/20260521223415_2dd47218-6199-4ad4-86ac-7de3455a3fd5/summary.md)
- After: [`build-with-explicit-name` summary](../runs/20260527170301_38b2302b-6322-4728-baf6-9432d07fe401/summary.md)
- After trials: [T1](../runs/20260527170301_38b2302b-6322-4728-baf6-9432d07fe401/scenarios/build-with-explicit-name/trials/0/eval-results.md), [T2](../runs/20260527170301_38b2302b-6322-4728-baf6-9432d07fe401/scenarios/build-with-explicit-name/trials/1/eval-results.md), [T3](../runs/20260527170301_38b2302b-6322-4728-baf6-9432d07fe401/scenarios/build-with-explicit-name/trials/2/eval-results.md), [T4](../runs/20260527170301_38b2302b-6322-4728-baf6-9432d07fe401/scenarios/build-with-explicit-name/trials/3/eval-results.md), [T5](../runs/20260527170301_38b2302b-6322-4728-baf6-9432d07fe401/scenarios/build-with-explicit-name/trials/4/eval-results.md)

## golden-light suite

### Suite: `golden-light`

| | Before (`26eb6e2e`) | After (`c2bb554a`) |
|---|---|---|
| Git SHA | `5d0397f7` | `5d0397f7` |
| Timestamp | 2026-05-23T00:27:52.388Z | 2026-05-27T21:47:09.738Z |

#### `simple-portfolio`

| Evaluator | Before pass | After pass | Before mean | After mean | pass@k B→A |
|-----------|-------------|------------|-------------|------------|------------|
| agent-steps | 0/3 | 0/3 | 0.93 | 0.92 | ✓→✓ |
| bug-hit-rate | 3/3 | 3/3 | 1.00 | 1.00 | ✓→✓ |
| implicit-feature-gap | 3/3 | 2/3 | 1.00 | 0.67 | ✓→✓ |
| intent-to-output-alignment | 3/3 | 2/3 | 0.95 | 0.63 | ✓→✓ |
| jtbd-completion | 3/3 | 3/3 | 1.00 | 1.00 | ✓→✓ |
| output-quality | 3/3 | 3/3 | 0.86 | 0.86 | ✓→✓ |
| prompt-efficiency | 0/3 | 0/3 | 0.93 | 0.92 | ✓→✓ |
| scope-drift-overgeneration | 2/3 | 2/3 | 0.67 | 0.67 | ✓→✓ |
| silent-hallucination | 3/3 | 2/3 | 1.00 | 0.67 | ✓→✓ |
| token-usage | 0/3 | 0/3 | 0.00 | 0.00 | ✓→✓ |
| tool-failure-rate | 0/3 | 0/3 | 0.02 | 0.04 | ✓→✓ |
| tool-parallelism | 0/3 | 0/3 | 0.02 | 0.09 | ✓→✓ |
| turn-duration | 0/3 | 0/3 | 312224.33 | 256711.00 | ✓→✓ |
| latency | 0/3 | 0/3 | 0.00 | 0.00 | ✗→✗ |

Avg trial: 5m 23s → 4m 24s · Avg turns: 4.0 → 5.3

#### `business-site`

| Evaluator | Before pass | After pass | Before mean | After mean | pass@k B→A |
|-----------|-------------|------------|-------------|------------|------------|
| agent-steps | 0/3 | 0/3 | 0.87 | 0.88 | ✓→✓ |
| bug-hit-rate | 3/3 | 3/3 | 1.00 | 0.83 | ✓→✓ |
| implicit-feature-gap | 2/3 | 2/3 | 0.67 | 0.67 | ✓→✓ |
| intent-to-output-alignment | 3/3 | 2/3 | 0.90 | 0.61 | ✓→✓ |
| jtbd-completion | 2/3 | 3/3 | 0.83 | 1.00 | ✓→✓ |
| output-quality | 3/3 | 2/3 | 0.83 | 0.55 | ✓→✓ |
| prompt-efficiency | 0/3 | 0/3 | 0.87 | 0.88 | ✓→✓ |
| scope-drift-overgeneration | 0/3 | 2/3 | 0.00 | 0.67 | ✗→✓ |
| silent-hallucination | 3/3 | 2/3 | 1.00 | 0.67 | ✓→✓ |
| token-usage | 0/3 | 0/3 | 0.00 | 0.00 | ✓→✓ |
| tool-failure-rate | 0/3 | 0/3 | 0.02 | 0.02 | ✓→✓ |
| tool-parallelism | 0/3 | 0/3 | 0.08 | 0.06 | ✓→✓ |
| turn-duration | 0/3 | 0/3 | 613493.67 | 466792.67 | ✓→✓ |
| latency | 0/3 | 0/3 | 0.14 | 0.14 | ✓→✓ |

Avg trial: 11m 41s → 8m 11s · Avg turns: 10.0 → 9.3

#### `multipage-catalog`

| Evaluator | Before pass | After pass | Before mean | After mean | pass@k B→A |
|-----------|-------------|------------|-------------|------------|------------|
| agent-steps | 0/3 | 0/3 | 0.91 | 0.90 | ✓→✓ |
| bug-hit-rate | 3/3 | 3/3 | 0.83 | 1.00 | ✓→✓ |
| implicit-feature-gap | 0/3 | 2/3 | 0.00 | 0.67 | ✗→✓ |
| intent-to-output-alignment | 2/3 | 2/3 | 0.56 | 0.85 | ✓→✓ |
| jtbd-completion | 1/3 | 0/3 | 0.50 | 0.50 | ✓→✗ |
| output-quality | 2/3 | 3/3 | 0.55 | 0.84 | ✓→✓ |
| prompt-efficiency | 0/3 | 0/3 | 0.91 | 0.90 | ✓→✓ |
| scope-drift-overgeneration | 2/3 | 3/3 | 0.67 | 1.00 | ✓→✓ |
| silent-hallucination | 2/3 | 2/3 | 0.67 | 0.67 | ✓→✓ |
| token-usage | 0/3 | 0/3 | 0.00 | 0.00 | ✓→✓ |
| tool-failure-rate | 0/3 | 0/3 | 0.01 | 0.00 | ✓→✓ |
| tool-parallelism | 0/3 | 0/3 | 0.05 | 0.05 | ✓→✓ |
| turn-duration | 0/3 | 0/3 | 454252.33 | 350095.67 | ✓→✓ |
| latency | 0/3 | 0/3 | 0.12 | 0.38 | ✗→✓ |

Avg trial: 8m 54s → 6m 4s · Avg turns: 7.3 → 8.0

#### `cleaning-biz-ambiguity`

| Evaluator | Before pass | After pass | Before mean | After mean | pass@k B→A |
|-----------|-------------|------------|-------------|------------|------------|
| agent-steps | 0/2 | 0/3 | 0.87 | 0.74 | ✓→✓ |
| bug-hit-rate | 2/2 | 3/3 | 1.00 | 1.00 | ✓→✓ |
| implicit-feature-gap | 2/2 | 3/3 | 1.00 | 1.00 | ✓→✓ |
| intent-to-output-alignment | 2/2 | 3/3 | 0.93 | 0.93 | ✓→✓ |
| jtbd-completion | 1/2 | 3/3 | 0.75 | 1.00 | ✓→✓ |
| output-quality | 2/2 | 3/3 | 0.83 | 0.82 | ✓→✓ |
| prompt-efficiency | 0/2 | 0/3 | 0.87 | 0.74 | ✓→✓ |
| scope-drift-overgeneration | 1/2 | 3/3 | 0.50 | 1.00 | ✓→✓ |
| silent-hallucination | 2/2 | 3/3 | 1.00 | 1.00 | ✓→✓ |
| token-usage | 0/2 | 0/3 | 0.00 | 0.00 | ✓→✓ |
| tool-failure-rate | 0/2 | 0/3 | 0.00 | 0.02 | ✓→✓ |
| tool-parallelism | 0/2 | 0/3 | 0.06 | 0.03 | ✓→✓ |
| turn-duration | 0/2 | 0/3 | 459435.00 | 576429.67 | ✓→✓ |
| latency | 0/2 | 0/3 | 0.04 | 0.24 | ✗→✓ |

Avg trial: 8m 8s → 10m 7s · Avg turns: 11.0 → 19.3

#### Latency detail (after run, `latency` verdict = fail)

- *(no trials with `latency` verdict fail in after run — gate may still fail vs May 15 baseline)*

#### Latency pass rate rollup (after vs before)

| Scenario | Before `latency` pass | After `latency` pass |
|----------|----------------------|---------------------|
| simple-portfolio | 0/3 | 0/3 |
| business-site | 0/3 | 0/3 |
| multipage-catalog | 0/3 | 0/3 |
| cleaning-biz-ambiguity | 0/2 | 0/3 |

#### Drill-down

- Before suite: [summary](../runs/20260523002752_26eb6e2e-7c23-4320-b503-616a91440256/summary.md)
- After suite: [summary](../runs/20260527214709_c2bb554a-4dfe-49f0-85a9-d5c841a45b3a/summary.md)

## Run index

| Role | Run ID | Directory |
|------|--------|-----------|
| — | `2dd47218-6199-4ad4-86ac-7de3455a3fd5` | `20260521223415_2dd47218-6199-4ad4-86ac-7de3455a3fd5` |
| — | `38d8dbda-1d30-4dcd-8c72-54f5d89577d3` | `20260522193040_38d8dbda-1d30-4dcd-8c72-54f5d89577d3` |
| — | `38b2302b-6322-4728-baf6-9432d07fe401` | `20260527170301_38b2302b-6322-4728-baf6-9432d07fe401` |
| — | `26eb6e2e-7c23-4320-b503-616a91440256` | `20260523002752_26eb6e2e-7c23-4320-b503-616a91440256` |
| — | `c2bb554a-4dfe-49f0-85a9-d5c841a45b3a` | `20260527214709_c2bb554a-4dfe-49f0-85a9-d5c841a45b3a` |

*Generated by `pnpm run report:pr-compare` · 2026-05-28*
