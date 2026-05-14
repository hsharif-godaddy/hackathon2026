# Regression Gating: Metrics, Trial Counts, and Thresholds

How gosym-probe detects regressions, which metrics it uses, and how to
reason about trial count tradeoffs when running eval against feature branches.

---

## The Three Metrics

gosym-probe computes three aggregation metrics per evaluator per scenario:

| Metric | Definition | Question it answers |
|--------|-----------|---------------------|
| **Pass rate** | `passingTrials / totalTrials` | How often does this work? |
| **Pass^k** | All k trials passed | Does this work every single time? |
| **Pass@k** | At least 1 of k trials passed | Can this work at all? |

Each metric serves a different purpose. Using the wrong one for a given
gate produces misleading signals.

### Pass rate: regression gating

Pass rate is an **unbiased estimator** of the true pass probability `p`,
regardless of trial count:

```
E[pass_rate] = p    (for any number of trials)
Var[pass_rate] = p(1-p) / n
```

This makes it the correct choice for **change detection** (did my branch
make things worse?). You can compare a 10-trial baseline against a 3-trial
regression run because both estimate the same underlying quantity. Only the
variance differs.

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

This makes pass^k appropriate for **quality bars** where you fix k and
demand all-pass (graduation, release gating), but inappropriate for
comparing runs at different trial counts. A 10-trial baseline with
pass^k = true represents a much stronger signal than a 3-trial run with
pass^k = true.

### Pass@k: smoke testing

Pass@k answers "can this work at all?" If even one trial passes, the
system is functional. Useful for:

- Fast triage (is the scenario totally broken or just flaky?)
- Catching catastrophic regressions cheaply (1-2 trials)
- Gating scenarios where partial success is acceptable

---

## Where Each Metric Is Used

| Metric | Good for | Why |
|--------|----------|-----|
| **Pass rate** | Regression gating | Unbiased estimator of true probability, comparable across trial counts, supports thresholds |
| **Pass^k** | Graduation / release gates | Answers "is this deterministically reliable?" which matters for promotion decisions where you fix k and demand all-pass |
| **Pass@k** | Smoke testing / triage | Answers "can this work at all?" useful for catching total breakages cheaply |

---

## Trial Count Mismatch: Baseline vs Regression Runs

A common cost-saving pattern: establish baselines at high trial counts
(10 trials via `--graduate --stability high`) and run regression checks
on feature branches at low trial counts (3 trials via `--trials 3`).

### Why this works mechanically

The regression comparator normalizes to ratios before comparing:

```typescript
// regression-comparator.ts
const currentScore = agg.passingTrials / agg.totalTrials;
const baselineScore = baselineEntry.passingTrials / baselineEntry.totalTrials;
const exceeded = baselineScore - currentScore > threshold;
```

Trial counts never enter the threshold formula. A 10-trial baseline at
0.9 is compared the same way against a 3-trial run at 0.667. No warnings,
no adjustments, no statistical corrections.

### The variance problem

With 3 trials, your possible pass-rate values are quantized:

```
0/3 = 0.000
1/3 = 0.333
2/3 = 0.667
3/3 = 1.000
```

With 10 trials, you get 11 possible values (0.0, 0.1, 0.2, ... 1.0).

A single flaky trial at 3 trials swings the score by 33 percentage
points. At 10 trials, each trial only moves the score by 10 points.

### Concrete example

**Scenario:** jtbd-completion evaluator, threshold = 0.10

**Baseline (10 trials):** 9/10 pass = 0.90

| 3-trial result | Pass rate | Delta from baseline | Regression? |
|----------------|-----------|---------------------|-------------|
| 3/3 pass | 1.000 | +0.10 | No (improved) |
| 2/3 pass | 0.667 | -0.233 | **Yes** (exceeds 0.10) |
| 1/3 pass | 0.333 | -0.567 | **Yes** |
| 0/3 pass | 0.000 | -0.900 | **Yes** |

At 3 trials, there is no middle ground between "all pass" and "regression
flagged." One unlucky LLM response is the difference between a clean run
and an investigation.

### False positive and false negative rates

**Higher false-positive rate (spurious regressions):** A scenario with
true p = 0.85 will produce 2/3 passes about 33% of the time (binomial
probability), triggering a false regression flag against a 0.9 baseline.

**Higher false-negative rate (missed regressions):** A real regression
dropping p from 0.9 to 0.7 can still produce 3/3 passes about 34% of
the time (0.7^3 = 0.343 for all-fail is wrong; P(3/3) = 0.343), masking
the problem entirely.

### Score-mode evaluators are more resilient

Score-mode evaluators (token-usage, latency, prompt-efficiency) compare
medians and use relative percentage thresholds. Medians are noisier at
3 trials but not catastrophically so, because the underlying measurements
are continuous rather than binary.

---

## Practical Recommendations

### Establishing baselines

Use high trial counts (10 via `--stability high`) for baselines. This is
a one-time cost that produces a stable reference point. The baseline
stores aggregated scores, not raw transcripts, so storage is minimal.

```bash
pnpm run eval --graduate <scenario> --stability high
```

### Running regression checks on feature branches

Use 3 trials for cost-conscious branch validation:

```bash
pnpm run eval --trials 3
```

Expect noisier results. Treat flagged regressions as "investigate" signals
rather than definitive failures.

### Threshold tuning for low trial counts

With 3 trials and pass-rate evaluators, the default threshold of 0.10 is
too tight (a single failure blows past it). Options:

1. **Loosen pass-rate thresholds to 0.35+** in a branch-check config
   environment. This absorbs the quantization noise while still catching
   2/3 or worse failures against a strong baseline.

2. **Use pass@k as the branch gate** instead of pass-rate. If at least
   one trial passes, the scenario is not catastrophically broken. Reserve
   strict pass-rate gating for graduation and CI.

3. **Confirm before acting.** When a 3-trial run flags a regression,
   re-run at higher trial count before concluding it's real:
   ```bash
   pnpm run eval --scenario <name> --trials 10
   ```

### Cost vs confidence tradeoffs

| Trials | Relative cost | Pass-rate granularity | Confidence in regression signal |
|--------|---------------|----------------------|-------------------------------|
| 3 | 1x | 4 values (0, .33, .67, 1) | Low (high variance) |
| 5 | 1.7x | 6 values (0, .2, .4, .6, .8, 1) | Moderate |
| 10 | 3.3x | 11 values (0.0 to 1.0) | High |

The sweet spot depends on scenario cost. For cheap scenarios (few turns,
no DOM capture), 5 trials is a good balance. For expensive scenarios
(multi-turn, Playwright captures), 3 trials with loose thresholds and
confirmation re-runs is pragmatic.
