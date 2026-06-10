# Prompt-Tax Patterns #2–#6 on a Real Agent — Results (handoff/working notes)

> Durable record of the multi-arm A/B so the verdicts + numbers survive a context
> compaction. Companion to `PROMPT-TAX-EXPERIMENT-RESULTS.md` (Pattern #1, compression).
> **This file is for us, not the article.**

## What this tests

The [Prompting Tax cheat sheet](https://godaddy-corp.atlassian.net/wiki/spaces/ENBLMNT/pages/4400349396/)
has six patterns. Pattern #1 (compression) was validated separately and produced a
statistical null on cost (the agent's cost is ~99% cached tool-context input, not the
prompt). This experiment validates the remaining five **atomically** on the same
`develop` agent + gosym-probe harness, all in **one run** so every arm shares
machine/time/build and is compared like-for-like against an in-run control.

## Design — one suite, sibling arms (improves on the compression A/B)

The compression experiment used a `PROBE_COMPRESSED_DEVELOP` env flag and two separate
runs on different days. This experiment instead uses **first-class sibling scenarios**
in the `prompt-tax` suite, each carrying an `agentProfile` (or persona) that travels
over the socket to AAB — no env var on either process — and runs control + all
treatments in a single `--suite prompt-tax` invocation.

| Scenario | Pattern | Single lever vs control | Activation |
|---|---|---|---|
| `pt-portfolio-control` | — | none (in-run baseline) | canonical prompt, standard persona |
| `pt-portfolio-compressed` | #1 | compressed prompt | `agentProfile: compressed-develop` |
| `pt-portfolio-emotional` | #3 | +emotional-stakes fragment (prepended) | `agentProfile: emotional-develop` |
| `pt-portfolio-persona` | #6 | +code-reviewer persona (prepended) | `agentProfile: persona-develop` |
| `pt-portfolio-generic` | #2 | +generic coding advice (appended) | `agentProfile: generic-develop` |
| `pt-portfolio-haiku` | #5 | develop agent on Haiku | `agentProfile: haiku-develop` (`model.default: haiku`) |
| `pt-portfolio-blind` | #4 | blind self-review turn | `persona: blind-review` |

Base task = the golden-light `simple-portfolio` prompt + goal, held constant across all
arms (atomicity). Profile fragments live in `agents/src/prompts/develop/experiments/`;
the develop agent injects them in `buildDevelopSystemPrompt()` gated by `develop.*`
profile flags and logs `develop_agent.prompt.experiment.arm` per build.

## Pre-registered hypotheses (state BEFORE running)

The compression finding generalizes to a predictive rule: cost effects that are
**output-verbosity driven** won't move this agent's bill (output ≈ 1% of tokens), but
effects that are **extra-turn driven** will (turns = tool round-trips = the real cost).

| Pattern | Cheat-sheet claim | Predicted real-agent result | Mechanism |
|---|---|---|---|
| #2 Generic | verbose generic = cost, no quality | **null cost, null quality** | output ≈ 1% of cost; agent already project-specific |
| #3 Emotional | +69% output, −3.33 quality | **null cost; quality may drop** | cost lever is input; quality harm (if real) still shows |
| #6 Persona | helps only low baseline | **no lift** (agent baseline ≈ 100%) | diminishing returns at high baseline |
| #5 Haiku | Haiku matches (Python) | **cost ↓; quality may drop** | task is TS/React = the "use Sonnet/Opus" bucket |
| #4 Blind review | 2–3× tokens, −5.09 quality | **cost ↑ here (unlike prompt size)** | extra turns → more tool round-trips → the *actual* cost lever |

## How to run

```bash
# 1. Start AAB (canonical default; arms flip per-scenario via agentProfile)
SOCKET_DIAGNOSTICS=true AUTH_TYPE=mock pnpm run dev   # repo root

# 2. Smoke each arm activates (grep agents/dev.log for the arm log)
cd evals/gosym-probe
pnpm run eval --scenario pt-portfolio-emotional --trials 1 --skip-baseline
#   → expect develop_agent.prompt.experiment.arm {emotionalStakes:true}
#   repeat for -persona, -generic, -haiku (model=haiku), -blind (blind-review turn fires)

# 3. Full screening run — one suite, all 7 arms, 20 trials each = 140 builds
MAX_CONCURRENCY=2 pnpm run eval --suite prompt-tax --trials 20 --fan-out --skip-baseline
#   (recover a rate-limit collapse with: --resume <runId>)

# 4. Analyze — Welch t-test of each arm vs the in-run control
pnpm run prompt-tax-compare <runId>
```

## Verdicts — COMPLETE (run `dac5864d`, 7 arms × 20 trials, 2026-06-05)

Welch t-test of each arm vs the in-run control (n=20 each). Significant = |t| > 2.
Control means: token-usage 894K, turn-duration 252K, output-quality 0.844,
silent-hallucination 0.879, jtbd 1.00, bug-hit 1.00.

| Pattern | Predicted | Observed token-usage (Δ%, t) | Quality | Verdict |
|---|---|---|---|---|
| #2 Generic | null cost, null quality | +12.5%, t=0.80 — **NS** | all NS (quality −1.7% NS) | ✅ **Confirmed** — null cost, null quality |
| #3 Emotional | null cost; quality may drop | +17.6%, t=1.01 — **NS** | all NS (jtbd −7.5% t=1.83, halluc −7.6% t=1.42 — trend down, NS) | ✅ **Cost null confirmed.** Quality harm directionally present but not significant at n=20 |
| #6 Persona | no lift (high baseline) | +25.8%, t=1.31 — **NS** | NO lift; 2 metrics significantly WORSE (implicit-feature-gap t=−2.37, silent-halluc t=−2.89) | ✅ **Confirmed + sharper** — persona on a high-baseline agent doesn't help and measurably *hurts* hallucination |
| #5 Haiku | cost ↓; quality may drop | +2.4%, t=0.18 — **NS (flat)** | silent-halluc −10.4% t=−2.00 **sig**; output-quality −1.9% NS | ⚠️ **Refined** — cost did NOT drop (input-dominated, not output), and Haiku significantly raised hallucination on the TS/React build. The cheat sheet's "Haiku for Python" does NOT extend to this workload |
| #4 Blind review | cost ↑ | **+36.1%, t=3.19 — SIGNIFICANT** | turn-duration +23.2% t=2.75 sig; silent-halluc −25.3% t=−4.85 sig; intent-align −4.5% t=−2.52 sig; latency +486% t=6.95 sig | ✅ **Confirmed — the headline.** The ONLY arm with a significant cost increase, because it adds a turn (more tool round-trips). Also the worst quality hit (hallucination −25%) |

### The headline finding (generalizes the compression null into a predictive rule)

**On a tool-heavy agent, prompt-side levers (#2 generic, #3 emotional, #6 persona, #1
compression) produce NO significant token-cost change — every one is statistically null
on token-usage.** The only arm that moved cost significantly is **#4 blind review
(+36%, t=3.19)** — because it adds a *conversation turn*, and turns drive tool
round-trips, which is where this agent's cost actually lives (cached tool-context input,
not the prompt or its output).

This is exactly what the compression experiment predicted: *cost effects that are
output-verbosity-driven don't transfer to tool-heavy agents; cost effects that are
turn-driven do.* Five independent arms now confirm it.

### TOST rescore via #4583 (control-as-baseline gating) — secondary analysis

After PR #4583 (`minMargin` floor) merged, we rescored the same 140-trial run through
the TOST `RegressionComparator`, treating the **control arm as a baseline** (script:
`pnpm run prompt-tax-rescore <runId>`). This is a *different* analysis from the Welch
co-run above and exercises the exact gating path #4583 fixed.

**What #4583 does here:** the flat-1.00 quality metrics (`bug-hit-rate`,
`jtbd-completion`, `tool-failure-rate`, `prompt-efficiency`, `agent-steps`) are
zero-variance in the control. Pre-#4583, strict uniform-match would hard-fail *any*
deviation; the floor (0.05) instead runs proper TOST with a minimum tolerance. The
rescore confirms all five are correctly `margin-floored` on every arm.

**Result: every treatment arm gates FAIL** — and that is *correct*, not an artifact.
The control was a perfect 20/20 on `bug-hit-rate` and `jtbd-completion`; every treatment
arm dropped ≥1 real trial (jtbd 0.90–0.975, bug-hit 0.95–1.0). A 1-in-20 binary drop from
a perfect baseline exceeds even the floored 0.05 margin.

**The methodological lesson:** a zero-variance / perfect-1.00 baseline is inherently
brittle for TOST gating — #4583's floor prevents the *trivial* false positive (deviation
with no baseline variance) but cannot rescue a baseline that is genuinely at the ceiling.
The Welch co-run (above) is the statistically sounder comparison for this A/B: it accounts
for the fact that the control's "perfection" is 20 lucky trials, and correctly calls these
same small drops non-significant. **Two analyses, complementary:** Welch (mean-difference,
variance-aware) is the primary verdict; the TOST rescore demonstrates #4583's floor works
and illustrates why perfect baselines need "more trials for a tighter baseline" (the PR's
own warning).

### Secondary findings
- **`silent-hallucination` is the most sensitive quality metric** — it dropped under
  persona (t=−2.89), haiku (t=−2.00), and blind (t=−4.85). But see the FDR addendum
  below: only the **blind** drop is statistically robust; persona is a directional
  trend (raw p=0.008) and **haiku is NOT significant** (p=0.057). Whenever an arm
  perturbed the agent, hallucination *trended* down first.
- **Haiku's cost saving did NOT materialize here** (refines cheat-sheet #5): no cost
  saving (cost is input-bound). Hallucination trended worse (−10.4%) but at p=0.057 it
  did not reach significance — a directional warning, not a confirmed regression. The
  "cheaper model matches" claim is Python-specific and the *cost* win does not extend to
  the agent's TS/React build task.
- **bug-hit-rate held at 1.00 on every arm** — none of these perturbations broke
  functional correctness; the (mostly directional) damage shows up in subtler quality
  metrics (hallucination, intent-alignment).
- **All token-usage deltas are noisy** (σ≈µ): even the "null" arms show +12–26% point
  estimates that don't survive a t-test — reinforcing the methodology lesson (raw
  per-trial Welch, never trimmed-mean-vs-raw).

### FDR / multiple-comparisons addendum (added 2026-06-08, before #airo-agent release)

The per-arm Welch table above runs **48 arm×metric tests** (6 treatment arms × 8
metrics) at the `|t|>2` (≈α=0.05) threshold. With no correction, ~2 false positives
are expected by chance, so the raw count of 7 "significant" cells is optimistic.
Recomputed exact two-tailed p-values (Welch–Satterthwaite df) directly from the raw
per-trial `eval-results.json` (run `dac5864d`, harness `isValidTrialScore` filter
applied — drops `unknown`/`evaluatorFailed`), then corrected:

| Correction | Survivors |
|---|---|
| **Benjamini-Hochberg FDR** (q=0.05) | **3, all on the blind arm:** latency (p=3e-8), silent-hallucination (p=8e-5), token-usage (p=0.003) |
| **Bonferroni** (α/48≈0.001) | **2:** blind latency (p=3e-8), blind hallucination (p=8e-5). Blind token-usage (p=0.003) is just outside. |

Raw-p<.05 but **NOT FDR-robust** (downgrade to *directional trend*): persona
silent-hallucination (p=0.008), blind turn-duration (p=0.010), blind
intent-to-output-alignment (p=0.017), persona implicit-feature-gap (p=0.024).
**Haiku silent-hallucination is p=0.057 — not significant even uncorrected** (the
`|t|>2.0` rule-of-thumb rounded t=−2.00 across the line; the exact p is just over).

**Net:** the cost headline (prompt-side levers null; only the turn-adding blind arm
moves cost, +36%) is robust — it survives FDR, and its sibling latency/hallucination
effects survive Bonferroni. The secondary *quality* story (persona/haiku "hurt
hallucination") is **suggestive, not confirmed at n=20** and would need more trials.
The published Confluence Part 2 page (v3) was corrected to match: haiku→"No (p=0.057,
trend)", persona→directional, plus a multiple-comparisons note.

## Wiring fix — agentProfile over the socket in mock auth (resolved 2026-06-04)

The first smoke run silently ran the **canonical** prompt despite selecting
`pt-portfolio-emotional`. Root cause: in `AUTH_TYPE=mock`, AAB's WS handshake
(`agents/src/server/ai-lib-websocket-server.ts`, mock branch) **rebuilds**
`agentContext` from scratch and sources `agentProfile` ONLY from the decoded
**JWT token** claims — it ignores the structured `auth.agentContext.agentProfile`
the probe was sending. So `profile.resolve.none` fired on every build → canonical
prompt. (The compression experiment never hit this because it used the
`DEVELOP_PROMPT_COMPRESSED` env var, process-wide — the socket-profile path was
never exercised by an eval before this suite.)

**Fix (probe-only, zero AAB prod change):** the probe now also sends `auth.token`
as an unsigned mock JWT carrying `{agentProfile, siteId, ...}` via `mockAuthToken()`
in `aab-client.ts`, wired in the `makeAgentClient` factory in `index.ts`. Mock auth
decodes that token and picks up `agentProfile`.

**Verified:** re-run of `pt-portfolio-emotional` logged
`agent_router.develop_variant {profileName:"emotional-develop"}` (no more
`profile.resolve.none`), all 14 evaluators scored, and token-usage jumped ~695K→2.79M
vs the earlier mislabeled-canonical run — the emotional fragment is measurably active.
Run dir: `runs/20260605030841_9f59ef91-...`.

> **Pre-run check for every arm:** after launching, grep `agents/dev.log` for
> `agent_router.develop_variant {profileName:"<arm>-develop"}`. If you instead see
> `profile.resolve.none`, the profile did NOT flow — do not trust the numbers.

## Notes / caveats

- **Blind-review arm is persona-steered.** If the GoCode synthetic user short-circuits
  to `DONE` without performing the blind-review turn, escalate to a `ReviewStrategyUser`
  wrapper in `simulation.ts` (forces one blind-review turn after first build). Verify the
  turn actually fires in step 2 before trusting the #4 numbers.
- **Methodology guardrail (from the compression run):** compare raw per-trial arrays with
  Welch — never a stored trimmed-mean against a fresh raw mean (that manufactured a phantom
  "9–15% regression" last time). `prompt-tax-compare` enforces this.
- **Per-trial variance is enormous** (σ ≈ µ; tokens 465K–6.6M). Expect most cost deltas to
  be insignificant at n=20; that itself is the finding for output-driven patterns.
- **Cost:** ~1–6M tokens per build. 140 builds is the screening floor. Expand to
  `multipage-catalog` + `cleaning-biz-ambiguity` only where the screen shows a real effect.
