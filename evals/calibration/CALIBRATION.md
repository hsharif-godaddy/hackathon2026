# Calibrating the GoArena evaluators

A short, plain-English guide to *how* this tool decides whether an evaluator can be trusted, and
*why* it's built the way it is.

## The problem

GoArena evaluators are **LLM-as-judge** graders. Each one is a YAML file with a rubric and an
output schema; in production a single model reads the evidence for a simulation and emits a score
(almost always **0–100**).

The risk with any single-model grader is that you can't tell a *good* score from a *lucky* one:

- Is the rubric clear enough that different competent judges land in the same place? (**reliability**)
- Does the score actually reflect quality, or just one model's quirk? (**accuracy / bias**)

"Calibration" here means answering those two questions for each evaluator, using the real
simulation evidence we've already captured under `dataset/`.

## The core idea

For every evaluator, on every simulation, we ask **several different models the same question** and
then look at how they agree and how they compare to the production score.

```
                 ┌─────────────┐
   evidence  ──► │  Judge: GPT │ ─► score
   (the same     ├─────────────┤
    rubric +     │ Judge: Sonnet│ ─► score      ──►  aggregate ──► finalScore
    packet for   ├─────────────┤                          │
    every judge) │ Judge: …     │ ─► score                ├─► reliability (do judges agree?)
                 └─────────────┘                          └─► accuracy   (vs production score)
                        │
                        ▼
                 advisory meta-judge  ─►  recommendedScore + rubric-adherence notes
```

## Complete Calibration Logic Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ INPUT: Evidence Packet (simulation-id)                                              │
│  • Conversation transcript                                                          │
│  • Tool calls & responses                                                           │
│  • DOM-extracted page content                                                       │
│  • Screenshots (for vision evaluators)                                              │
│  • Production GoArena score from DynamoDB                                           │
└────────────────────────────────────┬────────────────────────────────────────────────┘
                                     │
                ┌────────────────────┴────────────────────┐
                │  For each evaluator (YAML rubric)       │
                └────────────────────┬────────────────────┘
                                     │
        ┌────────────────────────────┴────────────────────────────┐
        │                                                           │
        ▼                                                           ▼
┌──────────────────────┐                              ┌──────────────────────┐
│  JUDGE PANEL         │                              │  META-JUDGE          │
│  (diverse models)    │                              │  (advisory auditor)  │
├──────────────────────┤                              ├──────────────────────┤
│ • GPT-5.2            │                              │ • Different family   │
│ • Claude Sonnet 4.6  │                              │   from panel majority│
│ • (add more models)  │                              │ • Reads all judge    │
│                      │                              │   outputs            │
│ Same rubric + prompt │                              │ • No veto power      │
│ to all judges        │                              └───────────┬──────────┘
└──────────┬───────────┘                                          │
           │                                                      │
           │ Each judge produces:                                 │
           │  • score (0-100) or label (categorical)              │
           │  • confidence (0-100)                                │
           │  • reasoning                                         │
           │                                                      │
           ▼                                                      ▼
┌──────────────────────┐                              ┌──────────────────────┐
│  VALIDITY GATE       │                              │  META OUTPUT         │
│  (objective checks)  │                              ├──────────────────────┤
├──────────────────────┤                              │ • recommendedScore   │
│ ✓ JSON parseable?    │                              │ • confidence         │
│ ✓ Score present?     │                              │ • rubric-adherence   │
│ ✓ Within scale?      │                              │   notes              │
│                      │                              └───────────┬──────────┘
│ Drop invalid judges  │                                          │
│ (record reason)      │                                          │
└──────────┬───────────┘                                          │
           │                                                      │
           │ Valid judges only ─────────────┬─────────────────────┘
           ▼                                │
┌──────────────────────────────────────────┴────────────────────────────────┐
│  AGGREGATION & METRICS COMPUTATION                                        │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  1. FINAL SCORE (robust aggregate)                                        │
│     Numeric:                                                               │
│       • 3+ judges → MEDIAN (outlier-resistant)                            │
│       • 2 judges  → MEAN                                                  │
│     Categorical:                                                           │
│       • Most common LABEL                                                 │
│                                                                            │
│  2. JUDGE AGREEMENT                                                       │
│     Numeric (scale-normalized):                                           │
│       • exact: range == 0 (all judges identical)                          │
│       • withinThreshold: range <= 0.1 (within 10% of scale)              │
│     Categorical:                                                           │
│       • exact: all judges same label (100% agreement)                     │
│       • withinThreshold: >= 50% agree on final label                     │
│                                                                            │
│  3. SCORE VARIANCE                                                        │
│     • Raw variance/stdDev/range on original scale                         │
│     • Normalized variance/stdDev/range on [0,1]                          │
│                                                                            │
│  4. META-JUDGE OVERRIDE                                                   │
│     • override = |recommendedScore - finalScore| > 5% of scale           │
│     • High override rate → rubric hard to follow consistently            │
│                                                                            │
│  5. PRODUCTION COMPARISON (ground truth)                                  │
│     • delta = finalScore - productionScore                               │
│     • meanAbsDelta (MAE) = average |delta| across dataset                │
│     • bias = mean(delta) across dataset                                  │
│     • withinScalePct = % runs where |delta| <= 20% of scale             │
│                                                                            │
│  6. CONFIDENCE DISTRIBUTION                                               │
│     • Histogram bins (0-100 in 10-point buckets)                         │
│     • Separate for judges vs meta-judge                                  │
│                                                                            │
└────────────────────────────────────┬──────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ OUTPUT: Per-Run Consensus                                                           │
│  dataset/<sim-id>/judging/<evaluatorId>/consensus.json                             │
│   • finalScore / finalLabel                                                         │
│   • metrics (agreement, variance, confidence, production delta)                     │
│   • all judge scores + validity status                                              │
│   • meta-judge recommendation                                                       │
└────────────────────────────────────┬────────────────────────────────────────────────┘
                                     │
                          (aggregate across all runs)
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ OUTPUT: Dataset-Wide Metrics                                                        │
│  dataset/judging-metrics.json                                                       │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  overall: (all evaluators combined)                                                 │
│    • runs, judgeAgreementPct, metaJudgeOverrideRatePct                             │
│    • scoreVariance (avg across dataset)                                             │
│    • vsProduction (meanAbsDelta, bias, withinScalePct)                             │
│    • confidenceDistribution (judges + meta)                                         │
│                                                                                      │
│  byEvaluatorId: {                                                                   │
│    "airo-content-quality": { same structure as overall }                            │
│    "airo-usability": { ... }                                                        │
│    ...                                                                               │
│  }                                                                                   │
│                                                                                      │
│  🔴 Red flags:                                                                      │
│    • judgeAgreementPct.withinThreshold < 50%  → ambiguous rubric                   │
│    • metaJudgeOverrideRatePct > 30%           → hard to follow consistently        │
│    • vsProduction.meanAbsDelta > 20           → miscalibrated vs production        │
│    • vsProduction.withinScalePct < 50%        → poor production alignment          │
│                                                                                      │
│  🟢 Good signs:                                                                     │
│    • judgeAgreementPct.withinThreshold > 75%  → clear, reliable rubric             │
│    • metaJudgeOverrideRatePct < 15%           → consistent interpretation          │
│    • vsProduction.meanAbsDelta < 10           → well-calibrated                    │
│    • scoreVariance.avgStdDevNormalized < 0.05 → stable across judges               │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘

DECISION FRAMEWORK:
  ✅ Trust: high agreement + low variance + good prod alignment
  ⚠️  Review: moderate disagreement or high meta-override rate → improve rubric clarity
  🔴 Retire: consistent low agreement or large prod MAE → fundamentally flawed evaluator
```

Two principles make this trustworthy:

1. **Same rubric, different models.** Every judge gets the *identical* prompt — the evaluator's own
   rubric, no personas, no "be strict" / "be lenient" instructions. The only thing that differs is
   the model. So when judges disagree, that disagreement is a real signal about the rubric, not
   something we injected.
2. **Diverse model families.** The judges come from different model families (e.g. GPT + Claude).
   Two copies of the same model at temperature 0 are basically one opinion counted twice, which
   would fake high agreement. Diversity is the whole point.

## The pieces

### 1. The judge panel
N judges, each a distinct model family, each given the same rubric and the same evidence packet
(conversation, tool calls, DOM-extracted page content, and screenshots when the evaluator needs
vision). Configured via `JUDGE_MODELS` in `.env`.

### 2. Objective validity gate
Before a judge's score counts, it must pass simple, mechanical checks — **not** a vote by another
LLM:

- its JSON parses,
- it produced a score (or a label, for categorical evaluators),
- the score is inside the evaluator's declared scale.

A judge that fails is dropped and the reason is recorded (`unparseable JSON`, `score outside
scale`, …). This is deliberately objective so we never let one model silently veto another.

### 3. The final score (robust aggregate)
From the valid judges:

- **3+ judges → median** (resists a single outlier model pulling the result),
- **2 judges → mean**,
- categorical → the **most common label**.

### 4. The meta-judge (advisory only)
A separate model — from a *different* family than the panel majority — reads all the judge outputs
and writes up rubric-adherence notes plus a `recommendedScore`. Crucially it is **advisory**: it
does not remove judges or change the final score. We just record whether its recommendation
*meaningfully* differs from the aggregate (an "override" only when it's off by more than 5% of the
scale). This avoids the old failure mode where a GPT meta-judge quietly threw out the one Claude
judge on ~97% of runs.

### 5. Ground-truth comparison
Every simulation already has the real production GoArena score in
`dynamodb/synthia-evaluations.json`. We compare our panel's `finalScore` against it:

- `delta` = finalScore − productionScore
- `absDelta`, and across the dataset a **mean absolute delta (MAE)** and **bias** (mean signed delta)
  per evaluator.

A large MAE means the production grader and a diverse panel disagree — that evaluator is worth a
closer look.

### 6. Scale awareness
Each evaluator declares its own scale (`scoreConfig: min/max`, usually 0–100). All raw scores are
kept on that scale for reporting, but any cross-evaluator math (variance, agreement thresholds,
dataset-wide averages) is done on **normalized [0,1]** scores so a 0–100 evaluator is never blended
with, say, a 1–10 one.

## What the numbers tell you

Per evaluator, in `dataset/judging-metrics.json`:

| Metric | Question it answers | Bad sign |
| --- | --- | --- |
| `judgeAgreementPct.exact / withinThreshold` | Do independent models land in the same place? | Low % → rubric is ambiguous |
| `scoreVariance.*Normalized` | How spread out are the judges? | High variance → noisy/unstable rubric |
| `vsProduction.meanAbsDeltaRaw` (MAE) | How far is the panel from the production score? | Large → production grader may be miscalibrated |
| `vsProduction.biasRaw` | Does production systematically score higher/lower? | Strongly non-zero → consistent skew |
| `metaJudgeOverrideRatePct` | How often does the auditor disagree with the aggregate? | High → rubric hard to follow |
| `validity` (`drops`) | Are judges failing to produce usable output? | Many drops → output schema unclear |

Agreement percentages are computed only over runs where they're *measurable* (≥2 valid judges);
runs with too few valid judges are reported separately as `insufficientJudges` rather than counted
as "disagreement."

The actionable output: **evaluators with high disagreement or high MAE-vs-production are the ones
to rewrite or retire.** Evaluators where diverse judges agree *and* track the production score are
the ones you can trust.

## How to run

```bash
# 1. Build the evidence dataset (Langfuse + DynamoDB + screenshots) — see README.md
npm run dataset -- --manifest ./manifest.json

# 2. Run the calibration judges over the dataset
npm run judge -- --workers 4          # all evaluators × all simulations
npm run judge -- --simulation-id <id> # a single simulation
npm run judge -- --evaluators ../goarena/evaluators/usability.yaml   # a single evaluator

# 3. Aggregate dataset-wide metrics
npm run metrics
```

Outputs land under `dataset/<simulation-id>/judging/<evaluatorId>/`:

- `judge-<model>.json` — each judge's score, validity, and reasoning
- `meta.json` — the advisory meta-judge's notes and recommendation
- `consensus.json` — the final score plus all reliability / accuracy metrics for that run

…and the dataset-wide roll-up is `dataset/judging-metrics.json`.

## Configuration (`.env`)

```
JUDGE_MODELS=gpt-5.2,claude-sonnet-4-6   # diverse panel; add a 3rd family for a stronger median
JUDGE_META_MODEL=claude-sonnet-4-6       # advisory auditor (different family than the majority)
GOCAAS_BASE_URL=...                      # OpenAI-compatible proxy
GOCAAS_API_KEY=...
```

## Statistical Limitations (v1.0)

### Small Sample Sizes & Uncertainty
With typical datasets of 10-50 simulations per evaluator, **point estimates have substantial uncertainty**. An evaluator with measured MAE=15 over 10 runs could have true MAE anywhere from 9 to 21 (95% confidence interval).

**Implications:**
- Don't make trust/retire decisions based on <20 runs
- Metrics with n<10 should be treated as preliminary only
- Confidence intervals are coming in v2.0

### Agreement Thresholds Are Heuristic
The **10% normalized range** for "within threshold" agreement (e.g., judges scoring 70 and 80 count as "agreement") is asserted, not empirically validated.

**For categorical evaluators:** The 50% threshold with 2 judges means any non-disagreement passes (equivalent to random chance on binary labels).

**Mitigation:**
- Use agreement % as a **relative comparison** between evaluators
- Don't treat 75% vs 74% as meaningfully different
- Empirical threshold calibration planned for v2.0

### Self-Reported Confidence Is Unvalidated
Judge confidence scores (0-100) are **not calibrated probabilities**. High confidence does not guarantee accuracy until validated on your specific evaluators.

**Current status:** Informational only, not validated. Use for diagnostics, not decisions.

### Median at N=3
With exactly 3 judges, median simply picks the middle value and discards the outer two. This provides outlier resistance (protects against one judge hallucinating), but has less information than mean. At N≥5, median becomes clearly superior. Variance is always reported regardless.

---

## Why not the obvious shortcuts?

- **One judge?** No way to tell a reliable score from a fluke.
- **Three copies of the same model?** Fake agreement — it's one opinion, thrice.
- **Let an LLM meta-judge pick the winners?** It systematically favors its own family; validity
  must be objective.
- **Average everything onto one number?** Mixing score scales makes the average meaningless;
  normalize first, and always keep the per-evaluator breakdown.
