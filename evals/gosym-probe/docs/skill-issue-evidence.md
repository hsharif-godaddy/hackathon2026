# Skill-issue scenarios + main-vs-our-change evidence (1d)

This is the **merge-back evidence format** for the dev-agent work: reproduce a
known skill failure as a scenario, then show its pass rate on `main` next to
its pass rate on an our-change build, side by side. A change earns a merge-back
when it beats main on these scenarios without regressing the others.

## The skill-issue scenarios

The scenarios reproduce documented failure modes (squad tasks 2a.i / 2a.ii),
authored with `createSkillEval`. The first two are the proof-of-concept pair;
the rest expand the **golden skill eval set** across the skills on the
[Skill Refactoring Tracker](https://godaddy.enterprise.slack.com/docs/T02BHKTRC/F0BCZEW2C95),
each grounded in the specific failure that triggered that skill's refactor (per
the `#airo-skill-reliability` channel and the refactor PRs):

| Scenario | Skill | Failure mode (documented source) | How it's detected |
| --- | --- | --- | --- |
| `skill-non-selection-database` | database | Agent uses pretrained knowledge instead of the skill | `expectedSkills: ['database']` → `SkillSelectionEvaluator` fails if the skill never loads; a `required` instruction ("use the database skill, not ad-hoc storage") gives the narrow LLM judge a second signal |
| `wrong-skill-routing-inbox-vs-email` | inbox | Agent loads the *wrong* skill (email instead of inbox for a contact form) | `expectedSkills: ['inbox']` → fails if inbox never loads; a `required` `no-email-skill` instruction fails the trial if email is loaded |
| `skill-non-selection-seo` | seo | Oversized skill.md (645 lines, over the 500 ceiling) loses model attention → agent hand-writes `<meta>`/JSON-LD instead of routing (#5174 SEO refactor; `/skill-review` catalog scan) | `expectedSkills: ['seo']` + `required` "use the seo skill, not raw meta scaffolding" |
| `skill-non-selection-google-analytics` | google-analytics | Refactor replaced LLM-driven file edits with a deterministic install tool; failure = agent hand-pastes a `gtag.js` snippet (skipping consent gating) (#4780) | `expectedSkills: ['google-analytics']` + `required` "use the install flow, no inline gtag" |
| `skill-non-selection-google-reviews` | google-reviews | Refactor consolidated a 3–5 tool-call flow into one stateful workflow tool; failure = agent hand-embeds a widget / loose micro-tool sequence | `expectedSkills: ['google-reviews']` + `required` "use the consolidated workflow, no ad-hoc embed" |
| `skill-non-selection-authentication` | authentication | Skill pins better-auth (latest broke 3 versions, #9554/#9811/#9365); failure = agent hand-rolls JWT auth or `npm i better-auth@latest` | `expectedSkills: ['authentication']` + `required` "install the skill, no unpinned/hand-wired auth" |
| `skill-non-selection-online-appointments` | online-appointments | Skill loaded its instructions only ~30% of the time (accidentally at that); failure = agent hand-builds booking/availability logic | `expectedSkills: ['online-appointments']` + `required` "load the OA skill, no ad-hoc booking scaffold" |
| `wrong-skill-routing-commerce-vs-payment` | commerce | Stripe/GoDaddy Commerce unification ("select the right one"); failure = agent routes a catalog+inventory ask to the generic `payment`/Stripe checkout flow | `expectedSkills: ['commerce']` → fails if commerce never loads; a `required` `no-payment-router` instruction fails the trial if payment/stripe is the chosen route |

The first failure mode (non-selection) and second (wrong routing) are the two
detection shapes; every golden-set scenario is one or the other. The five
`skill-non-selection-*` scenarios share a single contract (one expected skill,
the skill-selection evaluator, a `required` skill-naming instruction, an intent
that never names the skill) and are tested together with `describe.each`.

**Instrumentation requirement.** Skill-load detection reads
`transcript.loadedSkills`, which the agent only emits when
`SKILL_DIAGNOSTICS=true`. Without it, the skill-load check degrades to an
`unknown` verdict (dropped from the pass rate) and only the instruction-level
(LLM-judge) signal remains. **Run skill evals with `SKILL_DIAGNOSTICS=true`** so
the deterministic skill-load signal counts.

## The evidence workflow

1. **Capture the main baseline.** On `main` (or the merge target), run the
   skill scenarios and save the result as a baseline:
   ```
   SKILL_DIAGNOSTICS=true pnpm run eval --suite skill-eval --skip-baseline
   pnpm run save-baseline <run-id> --suite skill-eval
   ```
   `--skip-baseline` matters here: omitting both `--baseline` and
   `--skip-baseline` loads the latest committed baseline and gates against it,
   so a capture run on `main` with a baseline already present would trigger a
   spurious self-comparison. The baseline records `gitSha`/`gitBranch`, so
   "main" is identifiable.

2. **Run the our-change build.** Point the harness at the modified agent and
   run the same scenarios against the saved baseline:
   ```
   SKILL_DIAGNOSTICS=true pnpm run eval --suite skill-eval --baseline <run-id>
   ```

3. **Read the side-by-side report.** `aggregate-report.md` now carries a
   **Pass-Rate Comparison: main vs our-change** section — one row per scenario ×
   pass-rate evaluator with `main | our-change | Δ | Gate`. A row where
   our-change's pass rate exceeds main with the gate green is merge-back
   evidence; a `⚠️` delta is a regression the gate flagged. Score-mode
   evaluators (token cost, latency, agent steps, …) carry an aggregate score
   rather than a pass rate, so they're excluded from this pass-rate table (and
   counted in a footnote) — their regression status appears in the per-scenario
   gated tables above.

## Scope (honest)

This PR delivers the **golden skill eval set + the evidence format + the
workflow**: eight scenarios spanning the skills on the Skill Refactoring
Tracker, each reproducing that skill's documented failure mode. It does **not**
ship a populated main-vs-our-change number, because there is no dev-agent change
to measure yet — that's Sprint-2 task `[2a]` (Ying/Brandon). 1d is the evidence
*mechanism* that 2a consumes: once a candidate dev-agent change exists, steps
1–3 above produce the side-by-side numbers that justify (or reject) its
merge-back. The scenarios also require the live local stack + GoCode to run; the
factory wiring and the report section are unit-tested without it.

**Coverage caveat (no silent caps).** The golden set covers the eight skills on
the tracker, prioritized by Brandon's guidance to expand from the
proof-of-concept pair. The three *Done* skills (database, email→inbox, seo) have
settled definitions, so their scenarios are stable. The five InProgress/InReview
skills (google-analytics, google-reviews, authentication, online-appointments,
commerce) are still being refactored — a scenario asserting on a specific tool
name or workflow shape there may need a touch-up when that refactor lands. Each
scenario's docstring cites the failure it reproduces so the assertion can be
re-grounded against the refactored skill rather than silently going stale. The
~30 catalog skills not on the tracker are out of scope for this set.
