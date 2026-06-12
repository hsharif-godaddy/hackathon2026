---
title: Engaging APoSD reviews — verify symptoms, stress-test prescriptions
date: 2026-05-18
category: workflow-issues
module: code-review
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - reviewer applies APoSD/Ousterhout framing (shallow modules, info leak, change amplification)
  - findings are sophisticated and bundle a symptom claim with a concrete prescription
  - PR touches shared infra (preflight, env loaders, supervisors, scripts) where blast radius is unclear
  - 3+ findings in one review, mixing real symptoms with surface-similarity false positives
related_components:
  - testing_framework
  - tooling
tags:
  - aposd
  - ousterhout
  - code-review
  - pr-defend
  - subagents
  - evidence-based
  - verify-claims
  - software-design-review
---

# Engaging APoSD reviews — verify symptoms, stress-test prescriptions

## Context

A `/kb-software-design-review` run on PR #3689 (local BMS integration) produced five APoSD-style findings — one Critical, two Major, one Minor, and two noted bugs. Each finding bundled two distinct claims: a **symptom diagnosis** (what's wrong) and a **prescription** (what to do about it). The reviewer was substantively careful and footnoted alternatives where they existed, but the primary remedies on three findings rested on factual claims about the codebase that turned out to be wrong on inspection, and one rested on a model of "scattered logic" that didn't match how the predicates actually composed.

The default failure modes when receiving such reviews are equally bad: rubber-stamp the prescription on the strength of the diagnosis (false humility), or reflexively defend (false confidence). Neither uses the review's evidence. The job is to engage the review with the same rigor it was written with — separately verifying both halves of every finding before responding.

This learning captures the methodology that produced 1/5 findings adopted (with a different remedy than proposed), 4/5 prescriptions withdrawn after the reviewer concurred with the verification, and zero unproductive back-and-forth.

## Guidance

Treat every APoSD-style finding as **two separable claims** and verify them independently:

1. **The symptom claim** — "X is leaking / X is shallow / X is scattered / X is silent." Verifiable by file reads, grep, empirical tests, and quantification.
2. **The prescription claim** — "Therefore do Y." Verifiable by checking whether Y's prerequisites exist, whether cited precedents actually do what they're cited as doing, and whether Y composes with the rest of the system.

A finding can be 100% right about the symptom and 100% wrong about the fix. The reviewer's *footnote* alternative often beats the *primary* remedy — the primary tends to be the most architecturally aspirational version, while the footnote is the version the reviewer has already pressure-tested.

**Verification techniques to deploy before responding:**

- **Empirical bash/shell tests** for parsing or edge-case claims. Print actual output, don't reason about it. Single-quoted vs double-quoted env values, `$?` capture timing, `set -euo pipefail` behavior under specific compound expressions — all easier to check than to argue.
- **Direct file-reads of cited precedents.** "Follow how X does it" claims falsify with one Read tool call. If the reviewer says "LCP's env fixer factors out its template," open `lcp_env.go` and check.
- **CE subagent stress-tests** for prescription viability:
  - `ce-architecture-strategist` for "is this fix viable in this architecture?" — checks for required hook surfaces, lifecycle phases, framework affordances.
  - `ce-pattern-recognition-specialist` for "are these N callsites actually duplication?" — grep audits + semantic comparison.
  - `ce-framework-docs-researcher` for authoritative behavior of underlying tools (Compose v2 naming rules, gasket env resolution, etc.).
- **Quantify scattered-ness claims.** "Three places encode this" → grep, then read each. They may encode three orthogonal conditions, not one duplicated one.
- **Identify cross-runtime substrate problems.** Single source of truth across JS+bash+Go is often impossible. If so, the leak isn't fixable, only acknowledgeable.

**When verification disagrees with the reviewer, respond with the artifact** — the file contents, the bash output, the grep — not just the conclusion. Once both sides are looking at the same evidence, agreement converges fast.

## Why This Matters

Sophisticated reviewers can still misremember which file does what or model a system by analogy that doesn't fit. Accepting their prescriptions on the strength of their symptom diagnosis amplifies that error into the codebase — which is much harder to walk back than a review comment.

The inverse failure (defending without verifying) is equally costly: it burns reviewer trust, leaves real symptoms in place, and trains the team that reviews are negotiations rather than diagnostics.

Verification before response makes the conversation cheap. The Critical finding on PR #3689 was a real symptom (silent seed failure cascade) with an infeasible prescription ("move into a post-start preflight check" — but no PostStart hook surface exists). The reviewer's *footnote* — write a sentinel file — was viable, fit the existing preflight machinery, and landed in 6 files with full test coverage. The disagreement on the primary remedy never became friction because we showed up with `internal/hooks/` proving there was no PostStart phase to attach to (session history).

The withdrawn findings each represented a different category of unverified claim: cited precedent that didn't exist (Item 4 — `lcp_env.go` actually uses the same inline-template pattern as `bms_env.go`), surface-similarity duplication (Item 3 — `local.dev` appears in three places encoding three orthogonal predicates, with `local.dev + AUTH_TYPE=mock` proving they're not synonyms), and internal-tidiness critique that didn't survive a deep-module reframe (Item 2 — from dev-runner's perspective, `dev-start.sh` IS already a deep module: small interface, isolated BMS API knowledge).

## When to Apply

- Any review that bundles symptom + prescription (most APoSD/architecture/design reviews)
- Reviews citing precedents ("follow how X does it") — verify the precedent
- Findings about "scattered" or "duplicated" logic — quantify before accepting
- Prescriptions that depend on a hook surface, lifecycle phase, or framework affordance — verify it exists
- Cross-runtime claims (single source of truth across language boundaries) — check feasibility before promising
- High-severity findings where the proposed fix has high blast radius — stress-test the fix independently of the symptom
- Reviews from automated bots (Copilot, Claude CI) — same methodology applies; bots are particularly prone to citing nonexistent precedents (session history)

## Examples

### Example 1 — Symptom real, prescription infeasible (Critical → adopted footnote)

**Symptom claim:** "`seed_after_healthy &` runs the seed in a backgrounded subshell, then `exec make dev` replaces the parent. Failures are observable only as ad-hoc echoes interleaved with Air output. Two of three failure modes leave budget-service running with no patched subscription, agent-token bypass forces `budgetServiceEnabled=true` but no `bmsBudgetId`, migration block silently flips it back off."

**Prescription claim:** "Move the seed into a dev-runner Go preflight check that runs after Postgres + budget-service come up."

**Verification (`ce-architecture-strategist` subagent):** Read `dev-runner/internal/preflight/runner.go`, `tui/model.go:67-75`, `update.go:214-222`, `internal/hooks/hooks.go`. Finding: dev-runner's preflight phases (Tools → Environment → Services) all run **strictly before** any dev-runner.yml process starts. `PhasePreflightChecking → PhaseHooks → PhaseRunning` (only here does `manager.StartAll()` fire). `internal/hooks/` only services `PreStart`. The periodic `healthCheckMsg` poll has no first-transition edge trigger. The proposed "post-start preflight check" requires net-new lifecycle machinery: a new phase, an edge-triggered transition detector inside `healthCheckMsg`, a hook registry, plus TUI status rendering. Roughly the same surface area as `internal/hooks/` itself.

**Outcome:** Symptom AGREED. Prescription declined, replaced with the reviewer's *footnote* alternative — write a `.dev-seed-status` sentinel file (`ok` / `skipped: <reason>` / `failed: <reason>`) at every terminal path; add a `BMSSeedStatusCheck` to the existing Services category that maps file states to `StatusPass`/`StatusWarn`/`StatusFail`. Failed seeds surface as a red TUI line on the next preflight cycle. Same diagnostic-visibility benefit, no new lifecycle phase. The reviewer concurred and noted the revised fix sketch should have been the primary remedy, not a footnote.

### Example 2 — Cited precedent doesn't exist (Minor → withdrawn)

**Symptom claim:** "`BMSEnvFixer` hardcodes `LOCAL_AUTH_DISABLE=true`, the connection string, and `LOG_LEVEL=info` as a string literal. `budget-service/.env.local` (committed) holds the source of truth. Two places now need to agree."

**Prescription claim:** "Have the fixer read `.env.local` and copy it to `.env` if missing, then `upsertEnvVarUnquoted` only the keys it needs to enforce. **LCP's env fixer does exactly this pattern with its template.**"

**Verification (file read, 30 seconds):** Open `dev-runner/internal/preflight/fixers/lcp_env.go`. Lines 19-34 use `fmt.Sprintf` against an inline string literal — identical pattern to `bms_env.go`. Then grepped the rest of the family: `image_search_env.go`, `eval_probe_env.go`, the agents/app `env.go` — all hardcode inline templates. The cited precedent doesn't exist; adopting the proposed pattern for BMS alone would *introduce* divergence, not follow precedent.

**Outcome:** WITHDRAWN. Two minutes of file-reading saved a refactor that would have created the abstraction the reviewer assumed already existed. The reviewer concurred immediately when shown the lines.

### Example 3 — Surface similarity, not semantic duplication (Major → withdrawn)

**Symptom claim:** "Three places have to agree about what counts as 'local dev': `route.ts:392` (`gasket.config.env === 'local.dev'`), `dev-start.sh:25` (`AUTH_TYPE=jwt` parse), and dev-runner's env management."

**Prescription claim:** "Define a single `isLocalDevWithStubbedMgmt(gasketEnv)` predicate in `app/src/lib/features.ts`. Have agent-token route call it. Go-side preflight could read the same source via `parseEnvFile` if the seed moves there."

**Verification (`ce-pattern-recognition-specialist` subagent):**

- `gasket.config.env` runtime reads in production code: **1 site** (route.ts).
- `process.env.GASKET_ENV` runtime reads: 2 sites, neither uses `=== 'local.dev'` predicate (knowb-driver uses `startsWith('local')` for an entirely different purpose).
- The three cited places encode three **orthogonal** conditions:
  1. `route.ts` asks: "is the dev-runner-seeded LCP subscription in play?"
  2. `dev-start.sh` asks: "would unauthenticated PATCH to LCP 401?"
  3. dev-runner doesn't perform a runtime check — it generates env files keyed by name.
- **`local.dev + AUTH_TYPE=mock` is a valid configuration where the predicates legitimately disagree.** Bypass should fire; seed PATCH should also fire. They're answering different questions.
- Cross-runtime substrate: app TS can't read `app/.env` at runtime, bash can't import a TS predicate, Go can't resolve `gasket.config.env`. No common substrate. A `LOCAL_MODE=stubbed-mgmt` env var would be a *fourth* duplicate, not a collapse.
- `features.ts` placement explicitly violates `app/CLAUDE.md`'s Layer-1/Layer-2 charter ("Do not add feature rollout flags here; use Switchboard").

**Outcome:** WITHDRAWN. The counterexample (`local.dev + AUTH_TYPE=mock`) collapsed the duplication claim instantly. Faster than arguing about intent.

### Example 4 — Real bug, real fix, no design issue (noted bugs → fixed)

**Claims:** (a) `dev-start.sh:46` references `$rc` but the loop's `rc=$?` is captured only after the success path returned — on failure `$rc` is the exit code of the last redirect. (b) `dev-start.sh:25` parses `AUTH_TYPE` with `grep | cut | tr -d '"'` — fails on single-quoted values, trailing comments, embedded `=`.

**Verification (empirical bash tests, see [session history (auto memory [claude])]):**

```bash
# Single-quoted: tr only strips double quotes
$ printf "AUTH_TYPE='jwt'\n" > /tmp/.env
$ grep '^AUTH_TYPE=' /tmp/.env | cut -d= -f2 | tr -d '"'
'jwt'   # ← still has single quotes; "$result" == "jwt" check fails

# Trailing comment
$ printf "AUTH_TYPE=jwt # comment\n" > /tmp/.env
$ grep '^AUTH_TYPE=' /tmp/.env | cut -d= -f2 | tr -d '"'
jwt # comment   # ← also fails the equality check
```

**Outcome:** AGREED, fixed. AUTH_TYPE parser switched to `awk` with explicit comment-stripping and matching-quote-stripping. `patch_subscription` captures `last_rc=$?` directly after the curl call instead of after the `if`. Both edge cases verified empirically before declaring done.

## Related

- [docs/solutions/best-practices/verify-subagent-claims-before-relaying-2026-04-28.md](../best-practices/verify-subagent-claims-before-relaying-2026-04-28.md) — primary-evidence-wins principle for subagent output; this doc applies the same pattern to human reviewers.
- [docs/solutions/workflow-issues/triaging-ci-bot-review-comments-2026-04-24.md](triaging-ci-bot-review-comments-2026-04-24.md) — multi-agent triage of bot review comments with file:line citations; same methodology applied to a different reviewer class (79% false-positive rate on bot comments).
- [docs/solutions/workflow-issues/review-catches-what-plans-miss-2026-05-08.md](review-catches-what-plans-miss-2026-05-08.md) — adversarial review catching what forward-mode planning misses, including verification that proposed fixes actually fix.
- [docs/solutions/best-practices/judge-config-revert-premature-abstraction-2026-04-15.md](../best-practices/judge-config-revert-premature-abstraction-2026-04-15.md) — reviewer pushed extraction; reverted because evidence didn't justify. Adjacent on "reviewer prescription not always right."
- PR: https://github.com/gdcorp-partners/airo-app-builder/pull/3689 — the canonical worked example. 5 findings, 1 adopted (with different remedy), 2 bugs fixed, 4 prescriptions withdrawn.
