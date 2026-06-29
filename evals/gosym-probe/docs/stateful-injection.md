# Stateful Injection: Reducing Synthetic-Sim Variance

Synthetic simulations are noisy because **both** the synthetic user and the
agent are non-deterministic, and every trial starts "from scratch": an empty
app, with the synthetic user LLM-generating each turn from turn 0. The power
analysis in [regression-gating.md](./regression-gating.md) quantified the
dominant noise source — per-trial cost/step variance ≈ mean (σ≈µ), driven by
*how many tool round-trips a build happens to take*.

Stateful injection reduces that variance by fixing the starting conditions.
It has two independent halves; a scenario can use either or both.

---

## Half 1 — Prefab chat history (`ScriptedSyntheticUser`)

Removes **synthetic-user** variance: the words and number of turns the user LLM
picks differ run to run.

A scenario declares a fixed script:

```typescript
{
  name: 'my-scenario',
  scriptedTurns: [
    'Build a landing page for a coffee shop.',
    'Add a menu section with prices.',
    'Now add a contact form.',
  ],
  scriptEndsConversation: true, // optional — see below
  // ...
}
```

`ScriptedSyntheticUser` (wired in once around the default `GocodeSyntheticUser`)
replays entry `n` verbatim on the nth user turn with **no LLM call**. Behaviour:

- **With `scriptedTurns`**: turn 0 → `scriptedTurns[0]`, turn 1 → `[1]`, etc.
- **Script exhausted, `scriptEndsConversation: true`**: the conversation ends
  (synthetic user returns `null`) — fully deterministic user side.
- **Script exhausted, default**: hands off to the LLM-backed user for free-form
  continuation (a scripted prefix, then natural follow-up).
- **No `scriptedTurns`**: passes straight through to the LLM user. Every existing
  scenario is unaffected.

`scriptedTurns` supersedes the single-turn `staticFirstMessage`: when both are
set, `scriptedTurns[0]` is used and `staticFirstMessage` is ignored.

This half is offline and deterministic — no infra required.

---

## Half 2 — Pre-generated app (shared app + reset between trials)

Removes the **dominant build** variance: instead of provisioning a fresh app and
building from nothing each trial, one app is provisioned, and each trial resets
its workspace to a known state and runs a small uniform increment.

```typescript
createGoldenLightScenario({
  name: 'my-scenario',
  statefulInjection: { resetBetweenTrials: true },
  // ...
}, gocode, ctrlPlane);
```

> **Serial trials required.** A stateful scenario shares one app workspace, so
> its trials **must run sequentially** — resetting the workspace while a
> concurrent trial is mid-build would corrupt both. The factory marks such
> scenarios `requiresSerialTrials`, and the runner **throws** if effective trial
> concurrency is > 1 (including any `--fan-out` run) rather than silently
> producing corrupted measurements. Run stateful scenarios at `--concurrency 1`,
> not under `--fan-out`. (Note: only the *provision* step is concurrency-safe —
> the memoized promise means parallel first-setups share one provision — but the
> reset/build cycle is not, which is why serial execution is enforced.)

> **Throughput (current limitation).** `--fan-out` dispatches `(scenario,
> trial)` work items round-robin across a worker pool with **no per-scenario
> lock**, so it can run two trials of the *same* scenario at once — which would
> corrupt a shared workspace. The guard therefore rejects fan-out outright
> (`scenarioConcurrency > 1`) whenever **any** scenario in the suite is
> `requiresSerialTrials`. Consequence: a suite containing a stateful scenario
> currently has **no parallel path** — it must run sequentially at
> `--concurrency 1`. Recovering cross-scenario throughput (run distinct
> scenarios concurrently while each stateful scenario's own trials stay serial)
> would require a per-scenario serialization lock in fan-out mode — the old
> `--parallel-suites` behaviour, before it was repurposed into the round-robin
> `--fan-out`. Tracked as a follow-up; not implemented here.

Mechanism (`createStatefulApp`):

1. **Provision once.** The first trial's `setup()` provisions the app; the call
   is memoized via a shared promise, so concurrent trials all await the same
   provision rather than each creating an app.
2. **Reset between trials.** The first trial runs against the fresh app and
   establishes the baseline. Every subsequent trial's `setup()` calls the
   control-plane reset endpoint
   (`POST .../apps/{appId}/reset`) first, restoring the workspace to its
   baseline commit (`git reset --hard` + `git clean -fd`) and restarting the
   containers so dependencies re-sync.
3. **Delete once.** Per-trial `teardown` is a no-op (deleting the shared app
   mid-suite would break remaining trials). The app is deleted once via
   `teardownShared`, run on process exit; the control plane's reconciler reaps
   it as a backstop if the process is killed.

### Control-plane reset endpoint

`POST /api/airo/v1/subscriptions/{subId}/systems/{sysId}/apps/{appId}/reset`
with optional body `{ "commit"?: string, "restart"?: boolean }`. Resets the
git working tree (`git-repo/.git` + `preview/` working tree) to `commit`
(or HEAD), removes untracked files, and restarts the containers unless
`restart: false`. See `local-control-plane` `ResetApp` / `ResetWorkspace`.

### Independence caveat

Sharing an app trades trial isolation for lower variance. Because the workspace
is reset to a committed baseline between trials, file state does not bleed across
trials **as long as the agent's changes are committed and the reset target is the
intended baseline**. Two things to keep in mind:

- The reset restores *files*, not the *database*. Scenarios whose outcome depends
  on accumulated DB rows are not isolated by this mechanism.
- The "known state" the first trial establishes is itself one agent run, so the
  baseline carries that run's idiosyncrasies. The point is that the *increment*
  each trial measures starts from the same place — quantify the variance drop
  before trusting it for a given scenario.

Use `resetBetweenTrials: false` to share an app without resetting (e.g. when the
scenario is purely additive and order-independent).

---

## Measuring the variance reduction

The mechanism's offline guarantee — identical starting state across trials — is
covered by unit tests (`scripted-synthetic-user.test.ts`,
`create-stateful-app.test.ts`) and the control-plane reset tests. The
end-to-end variance drop on a live scenario (σ before vs after, via the existing
`score-stats` / trial aggregation) requires a real run against the local stack +
GoCode and is the recommended confirmation before enabling stateful injection on
a scoring baseline. **Enabling stateful injection changes a scenario's variance
profile, so re-graduate its baseline** — do not compare a stateful run against a
from-scratch baseline.

### Live validation (2026-06-24) and two findings

A live run on the local stack validated the mechanism and surfaced two design
constraints that shape *how* stateful injection must be used to actually reduce
variance.

**Mechanism — validated live.** A 10-trial stateful run (`multipage-catalog`,
`--concurrency 1`) provisioned exactly **one** shared app (vs 10 fresh apps for
the control), reset between every trial, and the serial guard held. Resetting to
a pinned commit was verified end-to-end against the deployed endpoint: after an
agent edits + adds an untracked file, the reset restored a **byte-identical
working tree** (same git tree hash), removed the untracked file, and preserved
`node_modules` (`clean -fd`, not `-fdx`).

**Finding 1 — the reset target must be a *pre-increment* baseline, not HEAD.**
The first stateful run reset to `HEAD`, but after trial 0 builds the site, HEAD
*is* the finished product. Trials 1+ then reset to a complete site, received the
same "build the site" prompt, saw nothing to do, and no-op'd in ~6s
(token-usage 1.25M → 69K, agent-steps 0). Pin `resetCommit` to the commit that
represents the intended *starting* state, and give the scenario an *incremental*
task (e.g. "add a product-detail page" to an already-built site). Resetting to
the bare template is **not** a variance win either: a template-reset start is
equivalent to a fresh-provision start, so the build runs from scratch with the
same variance — only provisioning cost is saved.

**Finding 2 — a clean matched A/B needs per-turn metric isolation (RESOLVED in
follow-up).** The σ≈µ evaluators score the whole conversation per trial, so a
build-then-increment control couldn't separate the build's variance from the
increment's. Resolved by **per-turn token capture** (`Turn.tokens`, fed from the
per-message `token_usage_summary` events) plus **fixed-base reuse**
(`createStatefulApp.existingApp` + pinned `resetCommit`): pre-build one base app,
then run an increment-only script that resets every trial to that fixed commit,
and read the increment turn's tokens in isolation.

### Variance result (live, 2026-06-24, AE 1b.ii follow-up)

Increment task ("add a product-detail page at /product/:id") on a fixed pre-built
`multipage-catalog` base, vs the from-scratch build control:

| Arm | n | mean tokens | CV |
|-----|---|-------------|----|
| BEFORE — from-scratch build | 10 | 1,848K | **0.137** |
| AFTER — increment on fixed base (working trials) | 7 | 1,224K | **0.106** |

A **~23% lower coefficient of variation** (and ~34% lower absolute token cost,
since the increment doesn't rebuild the site). Honest caveats:

- **3 of 10 increment trials no-op'd** (0 tool calls, ~73K tokens, jtbd=0), all
  immediately after a reset+restart. This is a **reset-readiness gap**:
  `DockerManager.Restart` returns before the preview/agent is ready, so those
  trials hit a not-ready app and bailed. Excluded from the working-set CV;
  **needs a post-restart readiness poll** (follow-up). The reset/git mechanics
  themselves are correct — the byte-identical-tree check passed.
- The reduction is modest because the increment turn still reads the whole built
  site into context (input tokens stay ~1.2M); the cache, not the base file
  count, dominates token volume. The variance win is real but bounded for this
  task shape.
- n=7 working trials is a directional signal, not a tight estimate.

## AE 1b.ii.i follow-up — reset readiness + conversation-state seeding

The 1b.ii result above left two clauses open: the reset-readiness no-ops capping
n, and "mid-state" being filesystem-only (the conversation always restarted from
turn 0). Both are now addressed in code; the re-measurement is a runbook (below).

### Reset readiness (closes the no-op gap)

Provisioning waits for the preview to serve (`waitForPreviewReady` → `/airo/health`,
up to 45s) after `DockerManager.Up`. `ResetApp` did not — it ran
`docker compose restart` and returned immediately, so the next trial could hit a
not-yet-serving preview and no-op (the 3/10 exclusion above). `ResetApp` now
waits for preview readiness after a successful restart and reports
`ready`/`readyError`; the harness client (`AABCtrlPlaneClient.resetApp`) treats
`ready !== true` as a hard degraded failure (like an un-restarted reset) and uses
a longer `resetTimeoutMs` (90s) so it can't abort mid-poll.

### Conversation-state seeding (closes "mid-state is filesystem-only")

A run can now start **mid-conversation**, not just mid-filesystem-state. This
mirrors how AAB already works: when a summary row exists for an app, the agent
loads it on turn 0 (`getPinnedOrLatestSummary` → `findLatestForApp`) and injects
it as a `# Memory` user message. We prefabricate that state before the trial.

- **Endpoint:** `POST /debug/:appId/seed-summary` (agents, eval-only, JWT-scoped)
  writes a `ConversationSummary` via the same store the `BackgroundSummarizer`
  uses. Optional `priorTurns` seeds a tail of raw user/agent turns into a
  conversation the trial then resolves into (`getOrCreateForApp` returns the
  app's latest conversation) — so the agent reads **summary + recent raw turns**,
  matching production's steady state (higher fidelity than summary-only). The
  endpoint clears the app's conversations + summaries first, so every resetting
  trial starts from identical seeded state (no cross-trial accumulation).
- **Harness:** `AABAgentsApiClient.seedSummary(appId, { summaryText, priorTurns, … })`;
  `StatefulAppOptions.seededSummary` + a `SummarySeeder` passed to
  `createStatefulApp`, which seeds **after** each filesystem reset. So each trial
  starts from the same file base AND the same conversation memory.

Filesystem mid-state (`resetCommit`) + conversation mid-state (`seededSummary` /
`priorTurns`) together are a genuine mid-conversation resume — the variance lever
1b.ii is after (the agent re-reads less of the site each trial).

### Runbook — re-measure the variance (AE 1b.ii.i clause: tighten n)

The `mid-conversation-increment` scenario (suite `mid-conversation-variance`) runs
the increment on a fixed pre-built base **with** conversation state seeded. It is
operator-gated: absent from normal runs unless the fixed base is configured.

1. **Provision and build a base app once**, then pin its commit. Use the local
   control plane (`pnpm run dev` or `local:test`); build a small business/landing
   site, note the `appId`, preview URL, and the commit the build sits at (the
   reset target). The harness does NOT build the base — that keeps the base
   build's own variance out of the measurement.

2. **Author the seeded state** to match that base. Edit `SEEDED_SUMMARY` in
   `src/scenarios/mid-conversation-increment.ts` so `summaryText` describes the
   built site's actual state and `priorTurns` is a plausible recent tail. (The
   committed default describes a generic single-page marketing site.)

3. **Point the scenario at the base** via env, then run serially (stateful
   injection requires `--concurrency 1`):

   ```bash
   cd evals/gosym-probe
   export EVAL_INCREMENT_APP_ID=<app-id>
   export EVAL_INCREMENT_PREVIEW_URL=<preview-url>
   export EVAL_INCREMENT_RESET_COMMIT=<base-commit-sha>
   pnpm run eval --suite mid-conversation-variance --trials 12 --concurrency 1 --skip-baseline
   ```

   With reset readiness fixed, expect **0 post-reset no-op trials**, so the full
   trial count is usable (no n=7 working-set exclusion). Read the `token-usage`
   evaluator's per-trial values and compute CV; compare against the BEFORE
   (from-scratch) and summary-only arms. This is the empirical step that closes
   the "tighten n / re-establish significance" clause — it requires a live local
   stack and is not run in CI.

   Sanity-check the seeding took: the first build turn should show a `# Memory`
   block and the seeded `priorTurns` in context (inspect via the debug context
   endpoint or `PROBE_DEBUG_EVENTS=1`), and the agent should NOT re-read the
   whole site before making the increment.

### Variance result (live, 2026-06-25, AE 1b.ii.i)

Increment task ("add an FAQ section with three Q&A pairs") on a fixed pre-built
base, reset + mid-conversation-seeded (summary + 2 raw prior turns) every trial,
run serially (`--concurrency 1`):

| Arm | n | mean tokens | CV (pop) |
|-----|---|-------------|----------|
| BEFORE — from-scratch build (#5437) | 10 | 1,848K | **0.137** |
| 1b.ii — increment on fixed base, working trials only | 7 | 1,224K | **0.106** |
| **1b.ii.i — mid-conversation seed, full n (no exclusions)** | **12** | **278K** | **0.097** |
| — same, excluding one 356K high-variance trial | 11 | 270K | **0.050** |

What this closes, by AC clause:

- **Reset readiness / no-op elimination:** **0 of 12 trials no-op'd.** Every trial
  produced real tool calls and an edited artifact — the readiness gate
  (`ResetApp` → `waitForPreviewReady`) removed the post-reset no-ops that capped
  the earlier run at n=7. This is the direct fix for the 3/10 exclusion.
- **Tighten n / significance:** CV **0.097 at full n=12** (no working-set
  exclusion needed), vs the 0.137 from-scratch baseline — **~29% lower**, and it
  held without dropping trials. Excluding the single high-variance trial (356K,
  three edits — a genuine tail, not a no-op) gives CV **0.050**.
- **Conversation seeding verified live:** trials resolved into the seeded
  conversation (`getOrCreateForApp` returned it; `totalMessages` carried the 2
  seeded turns), and the seeded prior turns + summary were in the agent's context
  on turn 0.

Honest caveats:

- **Mean is not comparable across arms.** This base is the bare v8 template + a
  small increment; #5437's base was the heavier `multipage-catalog`. That's why
  mean dropped ~7× (1,848K → 278K). **CV is the apples-to-apples metric** — and
  it is lower at higher n.
- **jtbd verdicts were mixed** (3 pass / 4 partial / 2 fail / 2 unknown). Every
  trial *ran and built*; the mixed quality reflects that the committed
  `SEEDED_SUMMARY` (a "Sweet Crumb Bakery" site) does not match the bare-template
  files, so the judge sometimes scored the FAQ partial. This is a base/summary
  mismatch, not a variance-mechanism issue, and does not affect the token CV.
  Building a base that matches the seeded summary would tighten jtbd.
