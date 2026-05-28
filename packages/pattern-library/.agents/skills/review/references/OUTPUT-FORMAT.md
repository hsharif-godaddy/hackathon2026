# Output Format

Every review produced by this skill — from a local agent or from GitHub
Copilot code review — uses the same shape. This makes findings easy to
scan, easy to address, and easy to diff against a previous round.

## Structure

```
## Summary

<2–3 sentences: what the PR does, how it scores at a glance, and the
single biggest thing the author should know.>

## Critical Issues

| File | Line | Rule | Issue |
|------|------|------|-------|
| `src/chat/foo/Foo.tsx` | 42 | `no-default-export` | `export default Foo` — named exports only. Rename to `export { Foo }`. |

_No critical issues._  <!-- use this line when the table would be empty -->

## Suggestions

| File | Line | Category | Suggestion |
|------|------|----------|------------|
| `src/chat/foo/styles.css` | 12 | UXCore usage | Replace `padding: 8px` with `<Box blockPadding="sm">` or an intent-aware Tailwind utility. |

_No suggestions._

## What looks good

- <bulleted list of things worth naming, for morale and to anchor the
  author's next round>

## Scores

- Component Craft: `N/10` — <one-line justification>
- API & Structure: `N/10` — <one-line justification>
- Docs as Product: `N/10` — <one-line justification>

## Verdict

**Approve** / **Request Changes** / **Needs Discussion**

<One line tying the verdict to the scores and findings.>
```

## Rule IDs

Every finding has a stable rule ID. Use kebab-case IDs grouped by area:


| Area            | ID prefix    | Examples                                                                                          |
| --------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| Structure       | `structure-` | `structure-missing-readme`, `structure-exports-mismatch`, `structure-missing-styles-subpath`      |
| UXCore usage    | `uxcore-`    | `uxcore-hardcoded-colour`, `uxcore-internal-selector`, `uxcore-opaque-internal-var`, `uxcore-contrast-level-mismatch` |
| Libraries       | `library-`   | `library-blocked-component-lib`, `library-undeclared-new-dep`                                     |
| Business logic  | `biz-`       | `biz-network-call`, `biz-routing-coupling`, `biz-product-string`                                  |
| API conventions | `api-`       | `api-default-export`, `api-missing-parity`, `api-className-not-forwarded`, `api-peer-range-drift` |
| Docs + stories  | `docs-`      | `docs-missing-when-to-use`, `docs-missing-stories`, `docs-ai-slop`                                |
| Testing         | `test-`      | `test-missing-parity`, `test-snapshot-ux-internals`, `test-coverage-floor-dropped`                |
| Perf            | `perf-`      | `perf-unnecessary-effect`, `perf-mutates-props`, `perf-unstable-key`                              |


Stable IDs let authors reference a specific rule in PR replies and make
it trivial to grep for every place that rule applies across the skill
and its references.

## Severity mapping

Every rule belongs to one severity. See each reference file for the
specific rules and their severities.

- **Critical** → blocks merge. Appears in the **Critical Issues** table.
- **Important** → blocks merge once the author is aware. Appears in the
**Critical Issues** table too, tagged with `(important)` in the Issue
cell.
- **Minor** → appears in the **Suggestions** table.

## Re-rate after fixes

On a second round of review, reuse the same structure and:

- Strike through findings that are resolved (leave them visible; authors
like seeing the progress).
- Update the scores — a successful fix should move the needle.
- Update the Verdict.

## Before flagging a finding

Every candidate finding has to clear three gates before it goes in the
review. If any answer is "no" or "I'm not sure", **drop it**:

1. Can you point to the execution path (file + line + what the code
  does) that produces the incorrect behaviour? "Could be a problem"
   isn't enough.
2. Is the concern already handled somewhere else — a type system guard,
  a default prop, a parent provider, a test, a lint rule, a CI check?
   If yes, flagging it again is noise.
3. Are you certain about the framework or language semantics? If you're
  guessing at how React batches, or whether a TypeScript narrowing
   holds, verify first or drop it.

Adapted from the Bitwarden `classifying-review-findings` skill. The goal
is zero false positives — a review full of "maybe" findings trains
authors to ignore the whole review.

## Not valid findings (drop these)

- **Praise** — put it in **What looks good** instead, not as a row in a
findings table.
- **Vague suggestions** ("this could be simpler", "maybe cleaner").
Either measure it (see below) or drop it.
- **Style preferences without an enforced standard.** Biome, the intents
system, and the BEM prefix are the enforced standards; personal taste
is not.
- **Naming nitpicks** unless the name is actively misleading. Renaming
`x` → `item` in a story is noise.
- **Renovate / Dependabot minor-or-patch bumps with passing CI** — they
aren't review surface for this skill.
- **Generated files** — `dist/`, `codex/codex.json`. See "Signals to
ignore" in `[SKILL.md](../SKILL.md)`.

## Measurable-improvement gate for Suggestions

A **Minor** suggestion only belongs in the Suggestions table if it would
measurably improve the code. "Measurable" means one of:

- **Eliminates a bug class** — e.g. swapping `any` for a discriminated
union makes a whole class of runtime errors unrepresentable.
- **Reduces complexity by ≥ 3** — e.g. cyclomatic complexity, nesting
depth, or branch count. Say what the number is and what it drops to.
- **Removes a vulnerability class** — not just a single injection site,
the whole category.
- **Measurable perf win** — you can state the order-of-magnitude change
(`O(n²)` → `O(n)`, removes an N+1, removes a re-render per keystroke).

If you can't state the metric, **drop the suggestion**. Adapted from
`classifying-review-findings`.

Bad suggestion: "This function could be cleaner."
Good suggestion: "This function has cyclomatic complexity 11 (4 nested
conditionals). Extracting the prop-validation branch to a helper drops
it to 6 and makes the happy path readable top-to-bottom."

## Do and don't

Do:

- Cite **file and line** on every finding. No line → Minor at best.
- Give a **one-line suggested fix** with every finding. Don't just name the
problem.
- Keep the Summary tight. Don't restate the PR description.
- Name what's good. Authors read the whole comment more carefully when
they see some of their work recognised.

Don't:

- Emit emoji in the review output. This repo's convention is no emoji
(see repo rules).
- Combine multiple rules into one finding. One rule per row keeps the
action list actionable.
- Use vague severity like "nit" or "consider". Use `Minor` and put it in
the Suggestions table.
- Paste the PR diff back at the author.

