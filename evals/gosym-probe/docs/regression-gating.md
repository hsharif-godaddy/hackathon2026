# Regression Gating: TOST Statistical Framework

How gosym-probe detects regressions, the statistical method it uses, and how
to reason about trial count tradeoffs when running eval against feature
branches.

---

## Overview

Regression gating answers: "Did my branch make things worse?"

The comparator runs after each eval and compares the current run's scores
against a saved baseline. The output is a gate: `pass`, `warning`, or `fail`.

**When `trialScores` are present in the baseline** (any baseline graduated
after the TOST migration), the comparator uses TOST (Two One-Sided Tests)
— a proper non-inferiority test grounded in confidence intervals.

**When `trialScores` are absent** (legacy baselines), it falls back to
static threshold comparison and caps the gate at `warning` rather than
`fail`.

---

## The Three Metrics

gosym-probe computes three aggregation metrics per evaluator per scenario:

| Metric | Definition | Question it answers |
|--------|-----------|---------------------|
| **Pass rate** | `passingTrials / totalTrials` | How often does this work? |
| **Pass^k** | All k trials passed | Does this work every single time? |
| **Pass@k** | At least 1 of k trials passed | Can this work at all? |

### Pass rate: regression gating

Pass rate is an **unbiased estimator** of the true pass probability `p`,
regardless of trial count:

```
E[pass_rate] = p    (for any number of trials)
Var[pass_rate] = p(1-p) / n
```

This makes it the correct choice for **change detection**: you can compare
a 20-trial baseline against a 3-trial regression run because both estimate
the same underlying quantity. Only the variance differs.

The regression comparator uses pass rate for exactly this reason
(`src/baselines/regression-comparator.ts`).

### Pass^k: graduation and release gates

Pass^k answers "is this deterministically reliable?" It estimates `p^k`,
which is a **different quantity for each k**:

```
If true p = 0.9:
  P(pass^10) = 0.9^10 = 0.349
  P(pass^3)  = 0.9^3  = 0.729
```

Pass^k is appropriate for **quality bars** where you fix k and demand
all-pass (graduation, release gating), but inappropriate for comparing
runs at different trial counts.

### Pass@k: smoke testing

Pass@k answers "can this work at all?" Useful for fast triage and catching
catastrophic regressions cheaply (1-2 trials).

---

## TOST: Two One-Sided Tests

### What it means

TOST tests whether the current run is **non-inferior** to the baseline —
meaning it has not regressed beyond a tolerance margin. It is not a test
of equivalence or superiority.

The test asks: "Can we rule out that the current run is worse than baseline
by more than `margin`?" If the answer is yes (the CI lower bound clears
`-margin`), non-inferiority is proven and the gate passes.

### The margin

The margin is data-driven, derived from the baseline's own noise, with a
relative floor:

```
margin = max(k × SD(baseline_trialScores), frac × max(mean, 0))
```

`SD` is the population standard deviation of the per-trial scores saved
when the baseline was graduated. `k` controls how many "wobbles" of
baseline noise are tolerated. `frac` (`minMarginFraction`, default `0.05`)
is the **relative floor**: a fraction of the baseline mean that the margin
never drops below.

**Why the floor is relative.** Score-mode evaluators store raw measurements
(turns, seconds, steps) whose scales differ by orders of magnitude, so a
fixed absolute floor is meaningless across metrics. A fractional floor is
dimensionless: `frac = 0.05` means "tolerate 5% of the baseline mean" for
every metric. When baseline variance is near-zero, `k × SD` is too tight for
TOST to prove non-inferiority at small sample sizes; the floor supplies a
minimum tolerance so sub-5% jitter is not flagged as a regression. The
margin is reported as `marginFloored: true` when the floor term strictly
exceeded `k × SD`.

A non-finite baseline mean (raw scores are unclamped post-#5369) forces the
floor term to 0, so a stray `Infinity` cannot inflate the margin into an
always-pass gate.

**What k means in practice:**

| k | Tolerance | Use case |
|---|-----------|----------|
| 1.0 | 1 wobble (strict) | Zero-variance evaluators, hard pass/fail |
| 2.0 (default) | 2 wobbles | General evaluators — absorbs typical trial variance |
| 3.0 | 3 wobbles (permissive) | High-variance evaluators (latency, cost) |

A baseline with high variance produces a wide margin, which means the
current run has more room to vary without triggering a failure. A stable
baseline (low variance) produces a tight margin, demanding the current run
stay close.

**The four regimes** (with `frac > 0`):

| Baseline | Margin | Behavior |
|----------|--------|----------|
| mean>0, SD>0 | `max(k·SD, frac·mean)` | Floor inert when `k·SD ≥ frac·mean`; else the floor engages and `marginFloored` is set. |
| mean>0, SD=0 | `frac·mean` (floored) | `k·SD` is 0, so the relative floor sets the margin. TOST runs against `frac·mean`. |
| mean=0, SD>0 | `k·SD` | Floor term is 0 (`frac·0`), so the noise term governs. |
| mean=0, SD=0 | `0` | Only here does the margin reach 0 and route to strict uniform-match. |

**SD=0 with a positive mean** (e.g., a metric that is always 300s) no longer
collapses to `margin = 0`. The relative floor gives it `frac·mean` (e.g.,
15s at `frac=0.05`), so TOST tolerates sub-5% jitter instead of demanding
perfect consistency. This is the case the absolute-`0.05` floor silently
failed on raw measurements.

**Constant-zero baseline (mean=0 AND SD=0):** Only when every baseline trial
is exactly 0 does `margin = 0`. TOST cannot prove non-inferiority with a zero
margin, so the comparator bypasses it and uses a strict uniform-match check
instead: the current run passes only if every trial score equals the baseline
constant (0). Any positive deviation is a failure. With the relative floor
this is now a live production path (the absolute floor never produced a zero
margin in prod).

### Which test is used

The comparator dispatches to different TOST implementations based on
evaluator type:

| Evaluator type | Method | Source |
|---------------|--------|--------|
| Binary pass/fail (`regressionMode` default) | Wilson-score CI on difference of proportions | `tostProportions()` |
| Continuous score-mode (`regressionMode: 'score'`) | Permutation test (exact or Monte Carlo) | `tostPermutation()` |

**Permutation test path:** When `n_baseline + n_current ≤ 15`, all
`C(n, n_current)` permutations are enumerated exactly (e.g., n=5+5 gives
252 permutations). Above 15, seeded Monte Carlo with 10,000 samples is
used. The CI is derived by centering the permutation null distribution at
the observed difference.

### Gate semantics

| Condition | Gate |
|-----------|------|
| TOST proves non-inferiority for all evaluators | `pass` |
| TOST fails for any evaluator (statistical evidence) | `fail` |
| Fallback threshold exceeded (no `trialScores`) | `warning` |
| All evaluators skipped (version mismatch) | `fail` |
| All evaluators skipped (no data) | `warning` |

`fail` means statistical evidence of regression. `warning` is
informational — it means the comparison ran without statistical backing
(legacy baseline) or could not run at all.

---

## Power and Sample Size

### What "power" means here

Power is the probability that the TOST correctly proves non-inferiority
when the true performance is unchanged. Low power = high false-fail rate
(the test fails to prove non-inferiority even when nothing regressed).

Power increases with:
- Larger current run n
- Larger baseline n (better SD estimate, wider permutation pool)
- Lower baseline variance (tighter SD → smaller margin → easier to prove)
- Higher k (wider margin → easier to prove, but risks missing real regressions)

### Approximate false-fail rates (k=2, identical distributions)

For binary evaluators (Wilson-score), with a strong baseline (n=20, p=0.85):

| n_current | Approx. false-fail rate | Signal quality |
|-----------|------------------------|----------------|
| 3 | ~10% | Low (wide CI, coarse quantization) |
| 5 | ~2% | Solid for routine checks |
| 10 | ~0.1% | Near-certain |

For score-mode evaluators (permutation, k=2, identical distributions):

| n_current | n_baseline | Combined n | Method | Approx. false-fail rate |
|-----------|-----------|------------|--------|------------------------|
| 3 | 5 | 8 | exact | ~15% |
| 3 | 10 | 13 | exact | ~8% |
| 5 | 10 | 15 | exact | ~3% |
| 10 | 20 | 30 | MC | ~0.5% |

These are approximations. Actual rates depend on the evaluator's score
distribution and baseline variance.

### Minimum useful n

At n_current=3, the Wilson CI spans roughly ±0.35 for a binary evaluator.
With a typical k=2 margin of 0.2-0.3, the CI lower bound will frequently
be below `-margin` even when nothing changed. This is expected: 3 trials
cannot statistically prove non-inferiority against a tight margin.

The test does not hide this: it returns `nonInferiorityProven: false` and
the gate becomes `fail`. This is honest behavior. The correct response is
to re-run at a higher trial count.

---

## Asymmetric n: High Baseline, Low Eval Run

A common cost-saving pattern: graduate baselines at high trial counts (10-20
trials) and run regression checks on feature branches at low trial counts
(3-5 trials). This asymmetry is supported and expected.

### Practical false-fail rates by n_current

With n_baseline=20 and k=2 (binary evaluators, no true regression):

| n_current | Approx. false-fail rate | When to use |
|-----------|------------------------|-------------|
| 3 | ~10% | Quick smoke test. If passes, high confidence. If fails, re-run at 5. |
| 5 | ~2% | Solid signal for routine branch checks. |
| 10 | ~0.1% | Near-certain. Use before merging high-risk changes. |

Stable evaluators (low CV) have lower false-fail rates at any n. Noisy
evaluators (latency, token-usage) are where n=3 gets shaky.

### Recommended workflow

```
n=3 quick check
  └─ passes → done (high confidence the branch is clean)
  └─ fails  → re-run at n=5 before investigating
               └─ passes at n=5 → n=3 was noise, proceed
               └─ fails at n=5  → likely real, investigate
```

Why high baseline n helps beyond the asymmetry itself:
- Better SD estimate for the margin (more representative noise profile)
- Larger permutation pool for score-mode evaluators (exact test remains
  feasible up to combined n=15)

### What the CI tells you

When a run fails, check the markdown report for the confidence interval.
A CI like `[-0.41, +0.08]` with margin `0.20` means:

- The CI lower bound (-0.41) is below `-margin` (-0.20)
- Non-inferiority is not proven
- But the CI upper bound (+0.08) shows the current mean is likely not worse
  than baseline — the failure is driven by uncertainty, not a clear drop

This is normal at n=3. Re-run at n=5 or n=10 to resolve.

---

## Fallback Path (Legacy Baselines)

Baselines graduated before the TOST migration lack `trialScores`. The
comparator detects this and falls back automatically.

**Fallback behavior:**
- Computes `baselineScore - currentScore` as before
- Compares against the static threshold from `fallbackThresholds`
- If threshold exceeded: gate is `warning`, not `fail`
- No `statistical` metadata in the result

The `warning` cap is intentional. Legacy baselines cannot provide
statistical backing for a `fail` verdict. The signal is still useful
(something exceeded a threshold) but is not statistically grounded.

**Per-evaluator fallback thresholds** (from `local.dev.ts`):

| Evaluator | Threshold |
|-----------|-----------|
| `jtbd-completion` | 0.10 |
| `bug-hit-rate` | 0.10 |
| `tool-call-verification` | 0.10 |
| `prompt-efficiency` | 0.20 |
| `token-usage` | 1.5 |
| `latency` | 1.5 |
| (all others) | 0.25 (default) |

To get `fail`-capable gating, re-graduate the baseline. See the migration
guide below.

---

## Configuration

The `regression` block in each environment config (`config/environments/`):

```typescript
regression: {
  alpha: 0.05,               // significance level for TOST (default: 0.05)
  k: 2.0,                    // SD multiplier for margin (default: 2.0)
  minMarginFraction: 0.05,   // relative floor: fraction of baseline mean (default: 0.05)
  evaluatorKOverrides: {     // optional: per-evaluator k overrides
    'latency': 3.0,
    'llm-cost': 3.0,
  },
  seed: 42,                  // optional: PRNG seed for MC/bootstrap determinism
  fallbackThresholds: {
    thresholds: {
      'jtbd-completion': 0.1,
      // ...
    },
    defaultThreshold: 0.25,  // applies to evaluators not in the map
  },
}
```

### `alpha`

The significance level for TOST. At `alpha=0.05`, the test uses a 95%
confidence interval. Lowering alpha (e.g., 0.01) makes the test more
conservative — the CI must clear the margin with more certainty, increasing
the false-fail rate at small n. Raising alpha (e.g., 0.10) makes it more
permissive.

Default: `0.05`.

### `k`

The SD multiplier that sets the margin. Higher k = wider margin = more
tolerant of variation.

Rules of thumb:
- `k=1`: tight, only appropriate for very stable evaluators
- `k=2`: general default, balances sensitivity and false-fail rate
- `k=3`: use for high-variance evaluators where the SD itself is large

Default: `2.0`.

### `minMarginFraction`

The relative floor as a fraction of the baseline mean. The margin never drops
below `minMarginFraction × max(mean, 0)`, regardless of how small `k × SD` is.

This is global (not per-evaluator) on purpose: the floor is dimensionless, so
5% is universal across metrics with different units. Per-metric tolerance is
handled by `evaluatorKOverrides` (the `k` term), not the floor.

Set to `0` to disable the floor entirely (margin reverts to pure `k × SD`).

Default: `0.05`.

### `evaluatorKOverrides`

Per-evaluator k override. Useful when some evaluators (e.g., latency, cost)
have inherently high variance and would produce too many false positives at
the global k.

```typescript
evaluatorKOverrides: {
  'latency': 3.0,      // latency is noisy; allow 3× SD drift
  'llm-cost': 3.0,     // cost varies with model routing
  'jtbd-completion': 1.5,  // binary and stable; tighten slightly
}
```

If an evaluator is not in `evaluatorKOverrides`, `config.k` is used.

### `seed`

An integer seed for the Mulberry32 PRNG used in Monte Carlo permutation
sampling and BCa bootstrap. Set this for deterministic results in CI.

When `seed` is omitted, it defaults to `0` in the statistical functions,
which is effectively deterministic (same seed = same results). Setting an
explicit seed in config makes this contract explicit and visible.

```typescript
regression: {
  alpha: 0.05,
  k: 2.0,
  seed: 12345,
  fallbackThresholds: { /* ... */ },
}
```

### `fallbackThresholds`

Used only when a baseline lacks `trialScores` (legacy path). Structure:

```typescript
fallbackThresholds: {
  thresholds: Record<string, number>,  // per-evaluator static thresholds
  defaultThreshold: number,            // fallback when evaluator not in map
}
```

Score-mode evaluators use relative thresholds (percentage change). Pass-rate
evaluators use absolute deltas.

---

## Migration Guide: Re-Graduating Baselines to Include `trialScores`

Baselines saved before the TOST migration lack `trialScores` and will only
ever produce `warning` gates. To enable full TOST gating, re-graduate.

### Step 1: Run graduation

Use high trial counts (20 via `--stability high`) for baselines. This is
a one-time cost that produces a stable reference point. The baseline
stores aggregated scores, not raw transcripts, so storage is minimal.

```bash
# Single scenario
pnpm run eval --graduate <scenario-name> --stability high

# All scenarios in a suite
pnpm run eval --graduate-suite <suite-name> --stability high --fan-out
```

This runs 20 trials (stability=high), saves `trialScores` in the new
baseline format, and replaces the existing baseline.

### Step 2: Verify trialScores were saved

After graduation, check the baseline JSON:

```bash
cat evals/gosym-probe/baselines/<scenario-name>.json | grep trialScores
```

Each evaluator entry should now have a `trialScores` array:

```json
{
  "jtbd-completion": {
    "passingTrials": 9,
    "totalTrials": 10,
    "trialScores": [1, 1, 1, 0, 1, 1, 1, 1, 1, 1]
  }
}
```

### Step 3: Run a regression check to confirm

```bash
pnpm run eval --scenario <scenario-name> --trials 5
```

The markdown report should now show `statistical` metadata (margin, CI,
method) instead of the legacy threshold comparison.

### Re-graduating from a prior run

If you already have a high-trial run in `results/runs/`, you can save it
as a baseline without re-running:

```bash
pnpm run save-baseline <run-id>
```

The save-baseline CLI loads per-trial `eval-results.json` files from the
run directory and extracts `trialScores` automatically. This is useful for
promoting an existing run to baseline without spending additional LLM calls.

### Stability levels

| Level | Trials | Use case |
|-------|--------|----------|
| `low` | 5 | Fast development iteration |
| `medium` | 10 | Default graduation |
| `high` | 20 | Production baselines |

Higher baseline n improves margin accuracy (better SD estimate) and
increases power for low-n regression checks.

---

## Evaluator Version Mismatches

If an evaluator's `evalVersion` changes between runs, the comparator skips
that evaluator and emits `skipReason: 'evaluator-version-mismatch'`. The gate
becomes `fail`.

This is not a TOST failure — it means the evaluation rubric changed and the
old baseline is no longer comparable. The hard fail ensures stale baselines
are not silently ignored. Re-graduate to restore full gating.

Adding `evalVersion` to an evaluator that previously lacked one is a breaking
change (the new baseline field will never match an absent field in old
baselines). Re-graduate immediately after adding or bumping `evalVersion`.
