# Validating the Prompting-Tax Cheat Sheet on a Real Agent, Part 2: Which Patterns Actually Transfer?

> A real-world test of **five more patterns** from the
> [Prompting Tax — Engineer Cheat Sheet](https://godaddy-corp.atlassian.net/wiki/spaces/ENBLMNT/pages/4400349396/),
> run against a production AI agent. Follow-up to Part 1 (prompt compression).

**TL;DR** — Part 1 found that compressing the AAB `develop` agent's prompt was *safe* but
didn't cut cost, because a tool-heavy agent's bill is ~99% cached *input* tool-context, not
prompt output. We then tested five more cheat-sheet patterns the same way — one arm each,
7 arms × 20 trials = 140 real app builds, all in one run, each compared against an in-run
control with a Welch t-test. **One clean rule fell out:**

> **On a tool-heavy agent, every *prompt-side* lever is statistically null on token cost.
> The only thing that moved cost was adding a conversation *turn* — because turns drive
> tool round-trips, and that's where the tokens actually are.**

Five independent arms confirm what Part 1 predicted: cost effects that are *output-verbosity*
driven don't transfer to agents; cost effects that are *turn-count* driven do.

---

## What we tested

| | |
|---|---|
| **Subject** | AAB `develop` agent (drives real end-to-end app builds) |
| **Harness** | gosym-probe — 14 evaluators per build |
| **Task** | golden-light `simple-portfolio` (held identical across all arms) |
| **Design** | 7 sibling scenarios, one lever each, **20 trials/arm = 140 builds**, single run |
| **Stats** | Welch t-test of each arm vs the in-run control (n=20), significant at \|t\| > 2 |

Holding the task, harness, and run constant — and only changing one lever per arm — is what
makes each comparison atomic. The control means anchor everything: token-usage **894K**,
turn-duration **252K**, output-quality **0.844**, silent-hallucination **0.879**,
jtbd-completion & bug-hit-rate **1.00**. (Higher is better for quality/hallucination scores.)

| Arm | Cheat-sheet pattern | Single lever vs control |
|---|---|---|
| control | — | canonical prompt, standard user |
| compressed | #1 Compressed over verbose | 30%-smaller system prompt |
| generic | #2 Project-specific over generic | + generic coding advice appended |
| emotional | #3 Neutral over emotional stakes | + "this is CRITICAL… I'll tip you $200" framing |
| persona | #6 Code-reviewer persona | + "you are a meticulous code reviewer" |
| haiku | #5 Language-aware model routing | develop agent runs on Haiku instead of Sonnet |
| blind | #4 Closed-loop over blind self-review | user adds one blind "are you sure? review it" turn |

---

## Results

### Token cost: only ONE arm moved it

| Arm | token-usage Δ% | Welch t | Significant? |
|---|---|---|---|
| generic | +12.5% | 0.80 | No |
| emotional | +17.6% | 1.01 | No |
| compressed | +21.1% | 1.50 | No |
| persona | +25.8% | 1.31 | No |
| haiku | +2.4% | 0.18 | No |
| **blind** | **+36.1%** | **3.19** | **Yes** |

Every prompt-side arm is statistically null on cost — the point estimates wander ±2–26% but
none survive a t-test (per-trial variance is huge, σ ≈ µ). **Blind review is the only
significant cost change (+36%)** — and it's significant precisely because it adds a
*turn*: turn-duration also jumped +23% (t=2.75) and time-to-first-content +486% (t=6.95).
A turn means another round of the agent replaying its accumulated tool-context as cached
input. That's the real cost multiplier.

### Quality: correctness held everywhere; subtler metrics caught the damage

`bug-hit-rate` stayed at **1.00 on all 7 arms** — none of these perturbations broke functional
correctness. But `silent-hallucination` (higher = less hallucination) turned out to be the
sensitive canary:

| Arm | silent-hallucination Δ% | Welch t | Significant? |
|---|---|---|---|
| compressed | −3.3% | −1.33 | No |
| emotional | −7.6% | −1.42 | No |
| generic | −8.5% | −1.68 | No |
| persona | −6.1% | −2.89 | **Yes (worse)** |
| haiku | −10.4% | −2.00 | **Yes (worse)** |
| **blind** | **−25.3%** | **−4.85** | **Yes (worse)** |

Every arm that significantly perturbed the agent raised hallucination first — and blind
self-review was the worst quality hit of the whole experiment (−25%, on top of its +36% cost).

---

## Pattern-by-pattern verdicts

**#1 Compressed (re-tested here) — ✅ safe, cost-neutral.** Replicates Part 1: no significant
cost or quality change. Compress for maintainability, not for the agent's token bill.

**#2 Generic coding advice — ✅ confirmed null.** Adding "write clean code, handle edge cases,
use descriptive names" cost nothing significant and changed no quality metric significantly.
On an agent that's already project-specific, generic advice is inert — exactly as the cheat
sheet predicts ("Claude already knows what these mean").

**#3 Emotional stakes — ✅ cost-null; quality trend matches.** The "$200 tip / lives depend on
this / be CRITICAL" framing produced no significant cost change (the cheat sheet's +69%-output
harm lands on output, which barely exists here). Quality metrics trended down (jtbd −7.5%,
hallucination −7.6%) but didn't reach significance at n=20 — directionally consistent with the
cheat sheet, magnitude muted on this workload.

**#6 Code-reviewer persona — ✅ confirmed, and sharper.** The cheat sheet says persona helps
*only* when the baseline is weak. The develop agent's baseline is ~100%, and the persona
delivered **zero lift** — and significantly *worse* hallucination (t=−2.89) and
implicit-feature-gap (t=−2.37). On a strong-baseline agent, the persona is pure downside.

**#5 Haiku — ⚠️ refined / does not transfer.** The cheat sheet's "use Haiku for Python" did
**not** extend to the agent's TS/React build: cost was flat (+2.4%, t=0.18 — no saving, because
cost is input-bound not model-priced at the margin that moved) AND Haiku significantly raised
hallucination (−10.4%, t=−2.00). The model-routing table is the cheat sheet's own
least-durable claim; on this workload the cheaper model is not a free swap.

**#4 Blind self-review — ✅ the headline.** The cheat sheet warns blind "are you sure? review
it" iteration costs 2–3× tokens with no quality gain. On the agent it was the **only** arm with
a significant cost increase (+36%, t=3.19) *and* the worst quality hit (hallucination −25%,
intent-alignment −4.5%). Use closed-loop test feedback, never blind self-review.

---

## Why this matters

Part 1 left an open question: if compression doesn't cut a tool-heavy agent's cost, what does?
This run answers it. **The cost lever for agents is the number of tool round-trips, which is
driven by the number of turns — not by anything in the prompt.** Four different prompt-side
levers (compression, generic advice, emotional framing, persona) all failed to move cost; the
one turn-adding lever moved it by a significant 36%.

Practical takeaways for anyone tuning an AAB-style agent:

1. **Don't expect prompt edits to cut your agent's token bill.** They're safe and good for
   maintainability, but the savings the cheat sheet measured on short coding tasks don't
   transfer. Target the tool loop: fewer turns, smaller tool payloads, better context reuse.
2. **Avoid blind self-review turns.** They're the most expensive *and* most quality-damaging
   thing we tested. If you must iterate, give the agent real signal (test output), not "are you
   sure?".
3. **Re-validate model routing per workload.** Haiku saved nothing and hurt quality here.
4. **Watch hallucination, not just pass/fail.** Correctness (`bug-hit-rate`) was a flat 1.00 and
   hid every regression; `silent-hallucination` was where the damage showed up first.

This is a *refinement* of the cheat sheet, exactly in the spirit of its own caveat that the
patterns are "benchmark-backed recommended defaults, not universal laws." The safety claims
hold on a real agent. The cost-magnitude claims are workload-bound — and we now have a rule for
which way they bend.

---

*Experiment: gosym-probe `prompt-tax` suite, 7 arms × 20 trials = 140 builds, single run
(`dac5864d`), Welch t-test on raw per-trial scores vs an in-run control. AAB `develop` agent on
the golden-light `simple-portfolio` task.*
