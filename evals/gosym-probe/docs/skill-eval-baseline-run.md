# Skill-eval baseline run (1d verification)

> **Snapshot as of 2026-06-29, run `1dee004d`, n=1 (single trial per scenario).**
> Every number below is one point-in-time observation, not re-validated and not
> a representative average. Treat the verdicts and cost/latency figures as
> directional. The committed baseline JSON (`gitSha`/`gitBranch` fields) is the
> durable source of truth; this doc is the human-readable narrative of that run.

First populated run of the golden skill eval set on `feat/eval-smolsquad`,
capturing the `main`-side baseline that the 1d merge-back evidence format
([`skill-issue-evidence.md`](./skill-issue-evidence.md)) gates against. This is
the run that proves the scenarios actually fire end-to-end against the live
agent — not just that the factory wiring unit-tests pass.

## Run identity

| Field | Value |
| --- | --- |
| Run ID | `1dee004d-5037-4a89-8c6d-2395ac4eda70` |
| Git | `8673c47` on `jchilcher/ae-1d-skill-eval-verify` (off `feat/eval-smolsquad`) |
| Model | `claude-sonnet-4-6` (GoCode S2S) |
| Scenarios | 9 (the full `skill-eval` suite), 1 trial each |
| Concurrency | `--fan-out`, 2 workers |
| Instrumentation | `SKILL_DIAGNOSTICS=true` on the agent |
| Wall clock | 1h 11m |

Baselines saved under `baselines/<scenario>/…_1dee004d….json` (committed with
`git add -f`; ~3.7 KB each — score summaries, not transcripts).

## What this verified

The point of the run was to confirm the merge-back mechanism behaves as the
scenarios claim. It does:

- **`SKILL_DIAGNOSTICS` instrumentation works end-to-end.** 8 of 9 trials
  emitted `loadedSkills`, so the deterministic skill-load signal counted
  (`skillMode: "true"`) rather than degrading to the LLM-judge-only proxy.
- **The skill-selection evaluator detects both shapes.** Non-selection
  (`expectedSkills` never loads) and wrong-routing (the forbidden skill loads)
  both produced the verdicts their docstrings predict.
- **The pass-rate comparison report renders.** `aggregate-report.md` carries the
  per scenario × evaluator rollup the format depends on.

### Skill-selection verdicts (the deterministic signal)

| Scenario | skill-selection | Note |
| --- | --- | --- |
| skill-eval-inbox | pass | inbox loaded |
| skill-non-selection-database | pass | database loaded |
| skill-non-selection-seo | pass | seo loaded |
| skill-non-selection-google-reviews | pass | google-reviews loaded |
| skill-non-selection-online-appointments | pass | online-appointments loaded |
| wrong-skill-routing-inbox-vs-email | pass | inbox loaded, email not |
| wrong-skill-routing-commerce-vs-payment | pass | commerce loaded, payment not |
| skill-non-selection-authentication | **fail** | authentication skill never loaded |
| skill-non-selection-google-analytics | **unknown** | no `skill_diagnostics` event this trial |

Suite skill-selection pass rate: **78%** (7 pass / 9 trials) — the number the
harness computes and gates on. `TrialAggregator` keeps `unknown` in
`totalTrials` (only evaluator *exceptions* are subtracted), and `unknown` is not
counted as a pass, so it lowers the pass rate exactly like a fail. The rate is
therefore 7/9, not 7/8: the 1 `authentication` fail and the 1 `google-analytics`
`unknown` both count against the denominator.

If you instead read the signal as "of the trials where skill-load was
*observable*, how many passed," that known-only view is 7/8 ≈ 87.5% — but that
is **not** what the reports or regression gate compute. Quote 78% when comparing
against baselines.

## Findings (real, n=1 — directional only)

1. **`authentication` non-selection fired a true negative.** The agent did not
   load the authentication skill for a task whose correct path is that skill —
   exactly the failure mode the scenario reproduces (better-auth pinning). At
   n=1 this is a single observation, not a regression call, but it is the
   scenario working as designed.
2. **`google-analytics` degraded to `unknown` on one trial** despite
   `SKILL_DIAGNOSTICS=true` set globally. The trial ran clean (77 s, no errors)
   but emitted no `skill_diagnostics` event, so the skill-load check dropped to
   the proxy verdict. This is an **intermittent instrumentation gap** worth
   tracking — and it is *not* free: because the aggregator keeps `unknown` in
   the denominator without crediting it as a pass, a missing diagnostics emit
   directly lowers the reported pass rate (here, 87.5% known-only → 78%
   harness-computed). A flaky emit thus erodes the deterministic signal the
   format relies on. Making `unknown` truly neutral would require changing the
   aggregation semantics (excluding it from `totalTrials`) — a follow-up, not
   current behavior.
3. **`skill-outcome` (LLM-judge) ran low (22% pass)** across the suite. This is
   the *quality* judge, not the skill-load check — at n=1 with the InProgress
   skills mid-refactor it is expected to be noisy and is informational, not
   gated. It is the dimension to re-ground once the skills settle.

## Cost & latency (the bottleneck)

The run was slow and expensive, dominated by a long tail:

| Scenario | agent time | LLM cost |
| --- | --- | --- |
| skill-non-selection-online-appointments | 31 m | $9.37 |
| wrong-skill-routing-commerce-vs-payment | 26 m | $4.83 |
| skill-non-selection-authentication | 18 m | $6.96 |
| skill-eval-inbox | 12 m | $2.37 |
| skill-non-selection-seo | 6 m | $1.84 |
| wrong-skill-routing-inbox-vs-email | 6 m | $1.03 |
| skill-non-selection-database | 5 m | $1.49 |
| skill-non-selection-google-reviews | 3 m | $0.74 |
| skill-non-selection-google-analytics | 1 m | $0.13 |
| **Total** | **~108 m agent-time / 71 m wall** | **$28.76** |

(Per-scenario minutes are rounded; the unrounded agent-time sum is 109.3 m.
"agent time" is the `turn-duration` evaluator's measured agent-side time, not
the wall clock — the suite ran 2 workers in parallel, so 71 m wall < 108 m
summed agent-time. The aggregate report also carries a separate
`Total Duration: 1h 58m` field, which is the harness's own end-to-end
accounting including capture/scoring overhead.)

The three slowest scenarios consume ~75% of agent-time and ~73% of cost. See
[`eval-pipeline-speedup.md`](./eval-pipeline-speedup.md) for the remediation
plan.

## On committing this baseline

These 9 files are an **n=1 snapshot from a personal branch**
(`gitBranch: jchilcher/ae-1d-skill-eval-verify`, `stabilityTrials: 1`),
committed as the first populated baseline so the 1d evidence format has a
`main`-side reference to diff against. They are **not** a multi-trial graduated
gate: before this becomes the shared regression floor that blocks other
engineers' PRs, it should be re-run via `--graduate-suite` (medium/high
stability = 10/20 trials) so the floor reflects a distribution, not one draw.

The `baselines/` directory grows monotonically — every saved snapshot is a new
file, and the loader reads only the lexically-latest per scenario
(`baseline-store.ts`), so older snapshots become dead weight the gate never
reads. Retention policy: when graduating a scenario, delete its superseded
single-trial snapshots in the same commit rather than letting them accumulate.

One serialization caveat: the `google-analytics` baseline records its
`unknown` skill-selection trial with no `trialScores`, which a naive reader
could mistake for a hard 0. The save itself is legitimate (other evaluators on
that scenario produced comparable verdicts, clearing the
`assessBaselineEligibility` guard), but a future regression compare on that
scenario's skill-selection should treat a `trialScores`-less baseline entry as
not-comparable, not as a 0 floor.
