# Making the eval pipeline fast

> **Grounded in one run: `1dee004d`, 2026-06-29, n=1.** The "today" measurements
> below are that single run; the post-Tier projections are estimates derived
> from it, not measured results. Re-baseline after any Tier-1 work lands — the
> "Today: 71 m" row will be stale the moment step-capping or higher concurrency
> ships.

There are two runs to make fast, and they have different bottlenecks:

- The **quick verification pass** — the skill-eval suite took **1h 11m** for 9
  scenarios at 1 trial each. Too slow for the inner loop engineers want: change a
  skill, get a read in minutes.
- The **full golden-light baseline / graduation run** — multi-trial by design
  (5–20 trials per scenario), routinely **a few hours**. This is the run that
  produces a trustworthy regression floor, and it's the one engineers dread.

This doc covers both, ordered by payoff-per-effort and grounded in the
[`skill-eval-baseline-run`](./skill-eval-baseline-run.md) numbers plus the
committed golden-light baselines. The shared root cause is the same; the levers
that matter differ by regime (see "Two regimes" below).

## Where the time actually goes

Measured, run `1dee004d`, sorted by agent time (the `turn-duration` evaluator's
agent-side time, not wall clock):

| Scenario | agent time | LLM cost |
| --- | --- | --- |
| online-appointments | 31 m | $9.37 |
| commerce-vs-payment | 26 m | $4.83 |
| authentication | 18 m | $6.96 |
| inbox | 12 m | $2.37 |
| seo | 6 m | $1.84 |
| inbox-vs-email | 6 m | $1.03 |
| database | 5 m | $1.49 |
| google-reviews | 3 m | $0.74 |
| google-analytics | 1 m | $0.13 |

Two facts drive everything:

1. **The tail is the whole problem.** The 3 slowest scenarios are 75% of
   agent-time and 73% of cost. The fastest finished in 1 minute; the slowest in
   31. Mean is a lie here — the pipeline is only as fast as its worst scenario,
   and at 2 workers the last scenario alone (commerce, started once a worker
   freed) added ~26 m of pure tail to the wall clock.
2. **One eval "turn" is one unbounded agent build.** The harness caps
   *synthetic-user* turns (`maxTurns: 10`) but **not** the agent's internal
   develop loop inside a turn. During this run the live agent log
   (`agents/dev.log`, not the committed run artifact) showed the develop agent
   climbing past **step 80** on a single turn — scaffolding an app, hitting
   TypeScript errors, and grinding `viewLogs`/`str_replace`/`httpCheck` until it
   either recovered or hit the 20-minute per-turn timeout. (The eval transcript
   records only the synthetic-user turns — e.g. online-appointments shows 15 —
   so the agent-internal step explosion is visible in the agent log, not the
   committed transcript.) The skill-eval scenarios only send **one** message
   (`staticFirstMessage`), so 100% of their time is this single unbounded loop
   plus the per-scenario container build.

Conclusion: speeding up the pipeline is mostly about **bounding and
parallelizing the agent build**, not about the harness scoring layer. The
harness's own synthetic-user (probe) LLM cost is a small fraction of each run —
the dollars in the cost table are the *agent's* `llm-cost`, not the probe's —
so the scoring layer is not where the time or money goes.

## Two regimes — and the multi-hour one is the one that hurts

The 71-minute skill-eval run above was a **single-trial verification pass**. The
job engineers actually dread is the **full golden-light baseline / graduation
run**, which is multi-trial by design and routinely takes a few hours.

Golden-light is 3 scenarios (`simple-portfolio`, `multipage-catalog`,
`cleaning-biz-ambiguity`). A standard run is 3 trials each (9 trials), but a
*baseline* worth gating against is a **graduation** run — trial count set by
stability level (`STABILITY_TRIALS`: low=5, medium=10, high=20), not by
`--trials`. Using the mean agent-time from the current committed
`simple-portfolio` baseline (~6.4 min/trial across its 20-trial graduation):

| Run | Trials | Agent-time | Wall @ 2 workers |
| --- | --- | --- | --- |
| Standard (3×3) | 9 | ~1.0 h | ~0.5 h |
| Graduation `low` (3×5) | 15 | ~1.6 h | ~0.8 h |
| Graduation `medium` (3×10) | 30 | ~3.2 h | ~1.6 h |
| Graduation `high` (3×20) | 60 | ~6.4 h | **~3.2 h** |

So a high-stability golden-light baseline is a **half-workday** at the default
2 workers — and that is the run you must do to refresh a trustworthy regression
floor. The multi-trial structure multiplies the *same* per-trial bottleneck
(the unbounded agent build) by 5–20×, so the levers below compound: every minute
shaved off a trial is shaved 60 times over a high graduation.

Two regime-specific notes the tiers must respect:

- **You cannot step-cap your way out of golden-light.** Unlike skill-eval
  (decided at skill-load), golden-light scenarios *do* need the agent to build a
  working app — their evaluators score the artifact. Tier 1.1's `maxAgentSteps`
  is a skill-eval lever, **not** a golden-light one. For golden-light the wins
  are concurrency (1.2), warm workspaces (2.1), capture cost (1.3 / `--max-routes`),
  and — above all — **not re-running trials that don't need re-running** (3.2).
- **Trial-level parallelism is the headline golden-light lever.** A 60-trial
  graduation at `--concurrency 2` wastes most of the available cores. `--fan-out`
  already dispatches trials round-robin across the worker pool; raising the pool
  to the trial count (resources permitting) turns ~3.2 h into roughly the
  slowest *single trial* plus tail. This is why 1.2 and 2.1 matter far more for
  the golden-light regime than for the quick verification pass.

## Tier 1 — do these first (hours of work, minutes saved per run)

### 1.1 Cap the agent's internal step count, not just user turns
The single biggest lever. A `maxAgentSteps` ceiling (config + per-scenario
override, mirroring `maxTurnsOverride`) turns the 31-minute tail into a bounded
cost. A skill-eval scenario is decided the moment the skill does or doesn't
load — it does **not** need the agent to drive the app to a clean build. Suggest
a default around 15–20 steps for the `skill-eval` suite; a scenario that needs
more is a scenario doing too much.
- *Where:* `simulation.ts` already threads `maxTurnsOverride`; add the same seam
  for steps, enforced in the agent-turn await.
- *Risk:* a too-low cap changes outcome verdicts. Mitigate by setting it from
  the observed step distribution (the fast 6 scenarios finished well under 20),
  and keep it suite-scoped so the build-heavy suites are unaffected.

### 1.2 Raise the worker pool — by trial, not just by scenario
`local.dev` defaults to `maxConcurrency: 2`. This is the **single biggest
golden-light lever**, because golden-light's cost is trials, not scenarios.
- *Skill-eval (9 scenarios × 1 trial):* at 2 workers the 109-minute agent-time
  sum serializes into 71 m; at 9 workers it drops to roughly the slowest single
  scenario (~31 m, or ~18 m once 1.1 lands).
- *Golden-light graduation (3 scenarios × 5–20 trials):* with `--fan-out`,
  trials — not just scenarios — dispatch round-robin across the pool, so a
  60-trial `high` run at 2 workers (~3.2 h wall) collapses toward the slowest
  *single trial* plus tail as the pool widens. Going from 2 → 8 workers on a
  60-trial run is the difference between a half-workday and ~50 minutes.
- *Where:* `--concurrency N --fan-out` already works (or raise the per-env
  default). The ceiling is host resources — each worker is an app build +
  preview container + Playwright.
- *Risk:* container/CPU contention on a laptop, and N preview containers + N
  Playwright captures against the single local backend. This is the real reason
  golden-light belongs on a bigger box or CI (Tier 3.1), not a laptop. Pair with
  1.3 so each worker is lighter, and document the per-worker resource cost so a
  high-trial run doesn't OOM the box.

### 1.3 Skip the Playwright capture phase when no evaluator needs it
Skill-eval verdicts come from `loadedSkills` (diagnostics event) + an LLM judge
over the transcript. The screenshot/DOM capture phase (`SiteCapture`, viewports,
route crawl) feeds the *artifact* evaluators, which the non-selection scenarios
mostly don't gate on. Gate capture on "does any active evaluator consume
snapshots?" and skip it otherwise.
- *Payoff:* removes a full browser crawl per trial (seconds–minutes each, and a
  whole class of capture-timeout stalls).

## Tier 2 — structural (days of work, changes the cost curve)

### 2.1 Warm/pooled app workspaces instead of cold per-trial builds
Every **trial** today does control-plane app create → `docker compose up` →
template build. The control-plane log shows repeated `aab-template-v8` /
`aab-publish` image builds. A pre-warmed pool of ready workspaces (or a cached
built template the trial clones) removes minutes of cold-start *per trial* — and
since golden-light pays this 5–20× per scenario, the cold-start tax compounds
hard there. On a 60-trial high graduation, shaving even 1 minute of setup off
each trial is a full hour off the run.
- *Where:* `local-control-plane` provisioning + `runSetup` in `simulation.ts`.

### 2.2 A "skill-load-only" fast mode
For the trigger-accuracy question ("did the right skill load?") we don't need a
working app at all. A mode that sends the message, captures the first
`skill_diagnostics` event, and stops — no build-to-green, no capture — would
answer the most common skill question in **seconds**. Make it a suite flag
(`--skill-load-only`) that short-circuits after the diagnostics event.
- This is the real answer to "engineers won't wait." Most skill refactors only
  need this signal; reserve the full build for the periodic quality pass.

### 2.3 Fix the intermittent `SKILL_DIAGNOSTICS` gap
`google-analytics` degraded to `unknown` (no diagnostics event) on an otherwise
clean trial. Every `unknown` is a wasted full-cost run that produced no
deterministic signal. Making the emit reliable directly raises the useful yield
per minute spent. (Tracked in the baseline-run findings.)

## Tier 3 — when you need volume, not just speed

### 3.1 Remote/CI fan-out off the laptop
The S3 baseline seam (squad task 1c.i, PR #5541 — **open, not yet merged**) is
designed to let CI gate against shared baselines without regenerating them
locally. Once it lands, pair it with a CI runner pool so the suite runs on N
boxes in parallel and engineers read the report instead of running locally at
all. The local fast path (Tier 1 + 2.2) stays for the inner loop; CI covers the
full matrix.

### 3.2 Trial-result memoization (the golden-light multiplier)
A trial whose inputs (scenario def + agent git SHA + model + trial index) are
unchanged should not re-run. Key a cache on that tuple and skip identical
re-runs. This matters most for golden-light: a graduation refresh after a change
that doesn't touch a given scenario should reuse that scenario's prior trials
instead of paying 5–20× again. The `--resume` machinery already reuses completed
trial indices within one run dir; memoization generalizes that across runs and
is what turns "re-baseline after an unrelated change" from a half-workday into a
near-instant cache hit.

### 3.3 Right-size the stability level to the question
A `high` (20-trial) graduation exists to pin a *trustworthy gating floor* — it is
not the run you do to answer "did my change help?". For the iterative question,
`low` (5 trials) is 4× cheaper and usually enough signal; reserve `high` for the
periodic floor refresh. Picking the level deliberately is free and is often the
single biggest "why is this taking hours" fix.

## The target

Estimates, not commitments — "Today" is measured (skill-eval from run
`1dee004d`; golden-light from the current committed 20-trial baselines); the
"After" columns are projections from the bottleneck analysis above and must be
re-measured once each tier ships.

| Path | Today | After Tier 1 (est.) | After Tier 2 (est.) |
| --- | --- | --- | --- |
| Full skill-eval suite (9 trials) | 71 m | ~18 m | < 10 m |
| Single skill, trigger only | ~31 m (worst) | ~bounded | **seconds** (2.2) |
| Golden-light `high` graduation (60 trials) | **~3.2 h** @ 2 workers | ~50 m @ 8 workers | < 30 m (warm workspaces + memoized trials) |

The headline: **the inner-loop win and the multi-hour win are different levers.**
For the quick "did the right skill load?" check, 2.2 (`--skill-load-only`) makes
it feel instant. For the **multi-hour golden-light baseline** — the run engineers
actually dread — the wins are trial-level fan-out (1.2), warm workspaces (2.1),
right-sized stability (3.3), and not re-running unchanged trials (3.2), ideally
off the laptop on CI (3.1). Engineers who won't wait hours for a baseline will
wait ~30 minutes — or none, if CI runs it for them.
