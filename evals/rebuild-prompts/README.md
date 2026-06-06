# rebuild-prompts eval

Local eval harness for `PagePromptAgent`. Each fixture is a synthetic
`PagePromptAgent.generate` input pair (`agentOptions` + `generateArgs`) plus a
list of *contracts* — assertions the generated prompt must satisfy.

The point isn't to lock in exact output (LLM temperature drifts; that's a
losing game). It's to lock in the **invariants the directive layer is supposed
to guarantee**:

- When the input has detected interactive patterns, the prompt mentions
  them as load-bearing components.
- When the input has detected forms, the prompt directs a real `<form>`
  element with the listed field names.
- When `isFirstPage: false`, the prompt does NOT contain homepage-only
  setup language (project name, color scheme, redesign guidance).
- When `designDirection: keep-similar` (a faithful clone), the prompt does
  NOT push redesign-only flourishes — bento grids, a "Differentiation
  Element", or "social proof below the fold" — that would invent sections the
  source never had (AIROBUILD-2241). `preserveDesign` is derived from
  `stylePreferences.designDirection` here, exactly as `RebuildPromptBuilder`
  does in production.

Running the eval also writes a `baseline.md` per fixture with the most recent
generated prompt — useful for spot-checking what the agent actually produced.
These are **gitignored by default** (matching the convention in `gosym-probe/`):
they're dev-loop artifacts, not assertion targets, and committing them creates
PR noise on every prompt change.

If you want to lock in a known-good output for a specific fixture (e.g. for a
follow-up PR's reviewer), force-add it: `git add -f fixtures/<name>/baseline.md`.

## Usage

```bash
# Run against current PagePromptAgent
pnpm --filter rebuild-prompts-eval eval

# Refresh baseline.md files (after intentional prompt changes)
pnpm --filter rebuild-prompts-eval eval:update-baselines
```

Both invocations make real LLM calls (one per fixture, ~$0.01 each at current
rates). Run locally before pushing prompt-affecting changes.

## Adding a fixture

1. Create `fixtures/<name>/input.json` matching the `Fixture` type in
   `src/run.ts`.
2. Add an entry to `CONTRACTS` in `src/run.ts` listing the assertions for
   that fixture.
3. Run `pnpm eval:update-baselines` to capture the initial baseline.

Fixtures should be **synthetic and minimal** — bare-bones data that exercises
one specific contract. Real-customer data (Atlas crawls of live sites)
belongs in a different harness later, not here.
