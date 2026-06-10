# Prompt-Tax Compression Experiment — Results (handoff/working notes)

> Durable record of the A/B so the verdict + numbers survive a context compaction.
> Source of truth for the Confluence draft. **This file is for us, not the article.**

## What was tested

A/B test of a **compressed `develop` agent system prompt** vs. the canonical prompt,
run through the gosym-probe eval harness at **high stability (20 trials)** across the
**golden-light** suite (3 scenarios → 60 trials total).

- **Branch under test:** `feat/prompt-tax-compression` (`f1cf913`)
- **Compressed run (B):** `b98e1e47-e02a-4cf7-974a-75a6a51b6eee`
  - run dir: `runs/20260604155022_b98e1e47-e02a-4cf7-974a-75a6a51b6eee/`
  - `PROBE_COMPRESSED_DEVELOP=true` → golden-light scenarios use the `compressed-develop`
    agent profile → develop-agent logs `compression.arm {useCompressedPrompt:true, source:"profile"}`
    (verified active in `agents/dev.log`).
- **Baseline (A):** `0defcca2-7e89-4b53-80bd-f43a2ab0d2f4` — the **published main baseline**,
  added to main yesterday by **PR #4485 / commit `4c954fe`** (`0cd6d3e` build, branch `main`,
  uncompressed prompt).
- Both A and B are clean **high / 20-trial** graduation runs. Same suite, same scenarios.
- Run config: `MAX_CONCURRENCY=2`, `--graduate-suite golden-light --fan-out --stability high`.
- Run completed 60/60, 0 errors / 0 RangeErrors. (One mid-run rate-limit collapse earlier
  was recovered via restart-agents + `--resume`; the final 60 are clean.)

## Prompt size delta (the input to the experiment)

| File | Canonical | Compressed | Δ |
|---|---|---|---|
| `develop/core.md` | 21,564 B | 15,191 B | **−30%** |
| `develop/communication.md` (compressed adds) | — | 4,303 B | — |

Core develop prompt shrank ~30%. **The question: did that cut token cost / latency?**

## Verdict: **STATISTICAL NULL — not a win, not a loss.**

Correctness and quality fully preserved; **no statistically significant change in token
cost or latency**. The prompt got 30% smaller and **total cost did not move** beyond noise.

### Correctness & quality — preserved
| Metric | Baseline (A) | Compressed (B) | Note |
|---|---|---|---|
| bug-hit-rate | 100% (60/60) | 100% (60/60) | pass@k & pass^k both ✓ |
| jtbd-completion | 100% (multipage 95%) | 100% | multipage +5% |
| output-quality | ~0.83 | ~0.83 | flat (±1%) |
| intent-to-output-alignment | — | — | drift −0.7% to −1.8% (within noise) |
| silent-hallucination | — | — | drift −0.8% to −2.5% (within noise) |
| implicit-feature-gap | — | — | mixed ±1.4% (within noise) |

### Cost & latency — NO significant change (Welch t-test, per-trial trialScores, n=20 each)
| Scenario | Metric | Base µ | Comp µ | Δ% | Welch t | Significant (|t|>2)? |
|---|---|---|---|---|---|---|
| simple-portfolio | token-usage | 1,193,408 | 1,151,116 | **−3.5%** | −0.12 | No |
| multipage-catalog | token-usage | 1,555,504 | 1,784,419 | +14.7% | 1.57 | No |
| cleaning-biz-ambiguity | token-usage | 1,880,496 | 2,063,168 | +9.7% | 1.00 | No |
| simple-portfolio | turn-duration | 312,331 | 349,651 | +11.9% | 0.52 | No |
| multipage-catalog | turn-duration | 438,336 | 466,979 | +6.5% | 0.99 | No |
| cleaning-biz-ambiguity | turn-duration | 468,294 | 495,226 | +5.8% | 0.76 | No |

**All cost/latency deltas are statistically insignificant.** Per-trial variance is enormous
(σ ≈ µ; per-trial tokens range **465K–6.6M**, with a single ~6.6M outlier ~5× the next-highest).

> ⚠️ Methodology note: the baseline JSON's stored `aggregateScore` is a **trimmed mean**
> (trim10 ≈ 918K vs raw mean 1.19M for simple-portfolio, due to the right-skew + outlier).
> A naive "trimmed-aggregate vs raw-mean" comparison produces a spurious "9–15% regression"
> headline that **does not survive a t-test**. Always compare like-for-like and test significance.

## The publishable insight (the actual finding)

Per-trial token usage is **~1.16M input / ~13K output**, and input is **dominated by cached
tool-result context**, NOT the system prompt. (Sample trial: `aab.inputTokens` 1,162,610 /
`outputTokens` 13,162; `cachedInputTokensRead` 961,435.)

Shrinking the system prompt by 30% optimizes a **single-digit-percent slice** of total cost,
and that saving disappears into trial-to-trial variance driven by **how many tool round-trips
each build takes**.

> **Compressing the prompt is the wrong lever for token cost. The cost is in the agent's
> tool-context loop (cached tool results across turns), not its instructions.**

Where the real cost lever is: reducing tool round-trips / context re-injection per build
(fewer turns, smaller tool payloads, better caching of repeated context), not prompt golf.

## State of the world after this session

- Deleted the gitignored auto-minted compressed baselines (`b98e1e47`) and the earlier
  `b53420c4` mints from all 3 scenario `baselines/` dirs. (Baselines are gitignored via
  `evals/gosym-probe/.gitignore:9` `baselines/**/*.json`; they only enter git when force-added.)
- `0defcca2` baselines restored from main and **staged** (`git add`) — the canonical comparison baseline.
- Compressed run's full per-trial data is **retained** in `runs/20260604155022_b98e1e47.../`.
- Restored original run `runs/20260529050825_4eca9fa9.../` (user action).

## Confluence article — TODO (next)

Audience: safari manager + `#gd-experiments`. Win-or-lose writeup.
Plan: draft to local Markdown → user approves → publish to Confluence (Atlassian MCP).
Angle: "We A/B'd a 30%-smaller develop prompt at high stability (3×20). Cost & latency
showed no significant change; correctness held. Lesson: prompt size isn't where the tokens
are — tool-context is. Next lever: the agent's tool loop."
