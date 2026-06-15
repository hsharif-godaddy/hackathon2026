# Develop Agent — Eval Prompt Variants

The injection plumbing for **offline A/Bs of a develop-prompt change**: a gosym
eval run swaps or adds a prompt fragment for one build, gated by a profile flag.
Lets several variants run against the real develop agent in one gosym invocation.

This is a **tool, not the experiment.** The experiment is what gosym does with
these variants — run paired scenarios, score outcomes, read a delta. This
directory only supplies the variant text; the table and resolution rules live in
[`agents/src/agents/develop-prompt-variants.ts`](../../../agents/develop-prompt-variants.ts),
wired into `buildDevelopSystemPrompt`.

## TL;DR — nothing here needs maintaining

The files in this directory are **variant inputs, not production prompts**. They
are not copies of `core.md`, `communication.md`, or any other live fragment, so
there is nothing to keep in sync. The only file shipped today is
`example-arm.md`, a disposable worked example — **delete it whenever you like**.

The mechanism is inert by default: every variant is gated by a profile flag that
defaults **off**. A build with no variant flag set is **byte-identical to
production** — zero behavior change, zero prompt-cache impact. A variant only
acts when its flag is set on the active profile.

## Three positions

A variant injects one markdown file from this directory. `position` decides how:

| Position | Effect | Use for |
| --- | --- | --- |
| `prepend` | inject the file **before** `core.md` | extra framing ahead of the prompt |
| `append` | inject the file **after** the technical fragments | extra guidance at the end |
| `replace` | swap a canonical fragment (`target`) for your variant | **testing a variant of an existing fragment** (e.g. a reworded `core.md`) |

`replace` works for any fragment in `REPLACEABLE_FRAGMENTS` (see
`develop-prompt-variants.ts`) — currently `core.md`, `communication.md`,
`handoff.md`, `backend.md`, `frontend.md`, `seo.md`, `secrets.md`,
`font-theme.md`. `security.md` is intentionally excluded; tenant/security
constraints must survive verbatim.

## Fail-closed

Unlike a production feature flag, a missing variant does **not** fall back
silently. If a variant's flag is set but its file is missing, or a `replace`
variant targets a fragment outside `REPLACEABLE_FRAGMENTS`, resolution **throws**.
A silent fallback would let a missing variant run as control and report "no
effect" — corrupting the trial. The build logs hard evidence as
`develop_agent.prompt.eval_variant { active, injectedFiles, replacedFragments }`
so each run is attributable and reproducible.

## Profiles are not the long-term home

These variants currently activate via a profile flag, but the example profile is
**deliberately not registered** in `agents/src/profiles/index.ts` — that registry
is the allowlist for `GET /profiles` and JWT `resolveProfile` on real sessions,
so anything registered there is selectable in production. The intended direction
is an eval-only request field gated to eval/mock-auth so a variant can never
reach a real session by construction; until then, register a variant's profile
in your eval setup, not in the shipped registry.

> **Ordering constraint — read before shipping a real variant.** This
> intermediate is safe *specifically because no variant profile is registered*:
> with zero registered, nothing is prod-reachable. The moment a real variant
> ships via a **registered** profile flag, you reintroduce the production-leak
> path the registry warning describes — a registered flag is
> JWT-`resolveProfile`-reachable on a real session. So the eval-only transport
> (the `evalPromptVariant` request field gated to eval/mock-auth) must land
> **before or with the first registered variant profile**, not "eventually." The
> `isFlagSet` seam in `develop-prompt-variants.ts` makes that swap cheap; do not
> let a real variant's profile get registered ahead of it.

## Add a variant

This is **table-driven scaffolding, not zero-code config** — adding a variant is
two small code edits plus two files:

1. **Drop a markdown file here.** Lead with an HTML comment marking it as a
   variant input (see `example-arm.md`).
2. **Add a row** to `EVAL_PROMPT_VARIANTS` in `develop-prompt-variants.ts`:

   ```ts
   // add net-new text after the technical fragments:
   { flag: 'develop.myVariant', fileName: 'my-variant.md', position: 'append' },

   // …or test a variant of an existing fragment:
   { flag: 'develop.coreV2', fileName: 'core-v2.md', position: 'replace', target: 'core.md' },
   ```

3. **Activate the flag from your eval setup** via a profile (NOT added to the
   shipped registry). The profile JSON shape:

   ```json
   {
     "name": "my-variant-develop",
     "description": "Eval prompt variant: <what it tests>.",
     "properties": { "develop.myVariant": true }
   }
   ```

A gosym scenario selects that profile as an arm's `agentProfile`, and only that
build gets the change. Multiple variants run in one suite invocation.

## Cleanup

When a variant is done, delete its markdown file and its row in
`EVAL_PROMPT_VARIANTS`. Finished-run output lives in `evals/gosym-probe/runs/`
and is independent of this directory.
