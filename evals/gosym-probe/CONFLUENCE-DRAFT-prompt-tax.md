# Validating the Prompting-Tax Cheat Sheet on a Real Agent: Does Prompt Compression Actually Save Money?

> A real-world replication of **Pattern #1 ("Compressed over verbose")** from the
> [Prompting Tax — Engineer Cheat Sheet](https://godaddy-corp.atlassian.net/wiki/spaces/ENBLMNT/pages/4400349396/),
> run against a production AI agent instead of isolated coding tasks.

**TL;DR** — The cheat sheet says compressing your prompt cuts cost ~18% at neutral-or-better
quality. We tested that on the AAB **`develop` agent** — a real, tool-heavy production agent —
by compressing its core system prompt **30%** and running a high-stability A/B (3 scenarios ×
20 trials = 60 builds per arm). **Two-part result:**

- ✅ **Quality claim CONFIRMED** — 30% smaller prompt, zero quality or correctness regression.
- ⚪ **Cost-savings claim did NOT replicate on this workload** — no statistically significant
  cost change. The 18% wasn't there.

**Why:** the cheat sheet's savings come from the *output* side, and its benchmark was short
coding tasks where output is a meaningful slice of cost. Our agent's cost is **~99% cached
*input* tool-context** — output is 13K tokens out of 1.16M. Compressing the prompt optimizes a
slice too small to move the total. **The tax is real, but it lands on a part of the bill that
barely exists for tool-heavy agents.**

This is a *refinement*, not a refutation. The cheat sheet itself says its patterns are
"benchmark-backed recommended defaults, not universal laws." We found a concrete workload class
where the savings magnitude doesn't transfer — and where the safety claim absolutely does.

---

## What the cheat sheet claims (Pattern #1)

> *"Same meaning, fewer words. Claude understands telegram style fine. Output tokens cost 5x
> input across all Claude models. Verbose prompts inflate the output side… Claude tends to
> mirror the verbosity it sees in instructions."*
> **Evidence:** +1.20 composite quality at −18.2% cost on Sonnet; −20% output tokens
> (15,120 runs, `targeted-constraints`).

The mechanism is explicitly **output-token driven**: verbose instructions → verbose output →
higher cost. Our test asks: **does that hold on a production agent whose cost profile looks
nothing like a short coding task?**

## What we tested

| | |
|---|---|
| **Subject** | AAB `develop` agent (drives real end-to-end app builds) |
| **Harness** | gosym-probe — captures 14 evaluators per build |
| **Suite** | golden-light: `simple-portfolio`, `multipage-catalog`, `cleaning-biz-ambiguity` |
| **Stability** | High — 20 trials/scenario, **60 builds per arm** |
| **Arm A (verbose)** | Canonical published develop prompt |
| **Arm B (compressed)** | Same instructions, telegram-compressed |

The compression was **semantics-preserving** — exactly the cheat sheet's "same meaning, fewer
words." We changed prompt *length*, not *content*.

| File | Verbose | Compressed | Δ |
|---|---|---|---|
| `develop/core.md` | 21,564 B | 15,191 B | **−30%** |

A 30% cut — larger than most real `CLAUDE.md` trims.

---

## Results

### ✅ Quality claim — CONFIRMED

| Metric | Verbose (A) | Compressed (B) |
|---|---|---|
| bug-hit-rate | 100% (60/60) | 100% (60/60) |
| jtbd-completion | 100% (multipage 95%) | 100% |
| output-quality | ~0.83 | ~0.83 (flat) |
| intent-alignment / hallucination / feature-gap | — | all drift within ±2.5% (noise) |

The cheat sheet's strongest, most actionable claim — *compression is safe, the verbose words
aren't load-bearing for quality* — **held completely.** Cutting 30% of the prompt cost us
nothing in correctness or quality.

### ⚪ Cost-savings claim — did NOT replicate here

Welch t-test on per-trial scores, n=20 per scenario per arm. Significance threshold |t| > 2.0.

| Scenario | Metric | Verbose µ | Compressed µ | Δ% | Welch t | Significant? |
|---|---|---|---|---|---|---|
| simple-portfolio | token-usage | 1,193,408 | 1,151,116 | −3.5% | −0.12 | **No** |
| multipage-catalog | token-usage | 1,555,504 | 1,784,419 | +14.7% | 1.57 | **No** |
| cleaning-biz-ambiguity | token-usage | 1,880,496 | 2,063,168 | +9.7% | 1.00 | **No** |
| simple-portfolio | turn-duration | 312,331 | 349,651 | +11.9% | 0.52 | **No** |
| multipage-catalog | turn-duration | 438,336 | 466,979 | +6.5% | 0.99 | **No** |
| cleaning-biz-ambiguity | turn-duration | 468,294 | 495,226 | +5.8% | 0.76 | **No** |

**No significant cost or latency change in either direction.** The expected ~18% savings did
not appear. Per-trial variance is enormous — σ ≈ µ, per-trial tokens range **465K–6.6M** (one
outlier ~5× the next-highest). Any prompt-sized effect is swamped.

> **Methodology note (shareable lesson):** the harness's stored `aggregateScore` is a *trimmed*
> mean (trim-10%), not raw. Comparing a stored trimmed-aggregate against a fresh raw mean
> manufactures a phantom "9–15% regression" that evaporates under a t-test. We nearly published
> that false headline. **Compare like-for-like and test for significance** before calling a win
> or loss — exactly the rigor the cheat sheet's own "Verifying you got the win" section asks for.

---

## Why the savings didn't transfer

Per-build token usage is roughly **1.16M input / 13K output**, and input is **dominated by
cached tool-result context**, not the system prompt:

```
Sample build:
  inputTokens          1,162,610
  outputTokens            13,162   ← the cheat sheet's lever acts HERE
  cachedInputTokensRead   961,435   ← but the cost lives HERE
```

The cheat sheet's mechanism is *output*-side, and its benchmark (single-shot coding tasks)
has a cost mix where output matters. A tool-using agent inverts that: it makes **many tool
round-trips per build**, replaying accumulated tool results as cached input every turn. Output
is ~1% of tokens. So a 30% prompt cut optimizes a single-digit-percent slice of the bill, and
that saving disappears into run-to-run variance driven by **how many tool round-trips each
build happens to take.**

> **The Prompting Tax is real — but for tool-heavy agents it lands on a part of the bill that
> barely exists. The cost lever isn't the prompt; it's the tool-context loop.**

This is fully consistent with the cheat sheet's own framing ("not universal laws") and its
honest scoping (the headline r=−0.95 was Python-specific and didn't replicate cross-language).
We're adding one more boundary condition: **savings magnitude is workload-dependent — short
generative tasks vs. long tool-using agent loops are different cost regimes.**

---

## What this means for the cheat sheet

| Cheat sheet claim | Verdict on a real agent | Action |
|---|---|---|
| Compression is **safe** (neutral/+ quality) | ✅ Confirmed | Keep recommending — strongly |
| Compression saves **~18% cost** | ⚪ Workload-dependent; didn't replicate on tool-heavy agent | Add a scope note: applies to output-heavy workloads |
| "Verify you got the win: output tokens drop" | ✅ Exactly right — and exactly how we caught the null | Promote this — it's the guardrail that prevents false wins |

**Recommendation:** add a one-line scope caveat to Pattern #1 — *"Savings scale with the output
fraction of your cost. For tool-heavy agents where cached input dominates, compression is still
safe but the cost win is small; target the tool loop instead."*

---

## Where the real lever is (for agents)

Cost per build scales with **tool round-trips and context re-injection**, not prompt length:

- Fewer agent turns per build
- Smaller tool-call payloads
- Better caching / reuse of repeated context across turns

That's the next experiment. Prompt compression stays justified on **maintainability + safety**
grounds — just not as the cost play for this class of workload.

---

## Bottom line

- ✅ The cheat sheet's **safety claim replicates** on a real production agent — compress freely.
- ⚪ The **18% cost claim is workload-bound** — it didn't show up on a tool-heavy agent, and the
  cheat sheet's own caveats predict exactly this.
- 🎯 For agents, the token budget is in the **tool-context loop**, not the prompt. Aim there next.
- 🔬 The cheat sheet's "verify the win via output tokens" guidance is the hero — it's what kept
  us from shipping a false result.

*Experiment: `feat/prompt-tax-compression`, high stability (3×20), gosym-probe golden-light
suite, A/B against the published `main` develop prompt. Significance via Welch t-test on
per-trial scores.*
