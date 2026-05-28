---
name: review
description: Canonical code-review checklist for @airo-ux/pattern-library pull requests. Use when reviewing a PR, doing a component review, auditing a new component, or grading docs/stories/tests in this repo. Enforces UXCore2 composition, intent tokens, controlled/uncontrolled parity, named exports, JSDoc on every public export, docs-as-product, and the allow/block list for third-party libraries.
license: Proprietary
metadata:
  author: airo-components
  version: "1.0.0"
  category: developer-tools
---

# Review — `@airo-ux/pattern-library` PR review skill

You are reviewing a PR against `@airo-ux/pattern-library`, GoDaddy's Airo React
component library built on UXCore2 (Antares). Components are **re-usable,
sharable primitives** consumed by product teams and discovered by agents
through the MCP codex. Docs and stories are part of the product, not an
afterthought.

This skill is the single source of truth for how to review a PR in this repo.

## Reference Loading Policy

DO NOT open any `references/*.md` file unless the review actually touches the
area described. When a trigger matches, open the minimum set of references
needed — usually one.


| Trigger                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Reference                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Component folder layout, `tsup.config.ts`, `package.json#exports`, `src/<area>/index.ts`, CSS subpath, BEM prefix, `CODEOWNERS` entry for a new component                                                                                                                                                                                                                                                                                                                             | `[references/COMPONENT-STRUCTURE.md](./references/COMPONENT-STRUCTURE.md)`               |
| `@ux/`* primitives, intent tokens, `@ux/tailwind-intents`, theming, hardcoded colors/spacing/fonts, opaque `--ux-<hash>` CSS variables in component styles                                                                                                                                                                                                                                                                                                                             | `[references/UXCORE-USAGE.md](./references/UXCORE-USAGE.md)`                             |
| New dependency added to `package.json`, any `import` from a package not obviously in the allow list, `styled.`* / `<motion.*>` JSX, icons imported as React components                                                                                                                                                                                                                                                                                                                | `[references/ALLOWED-LIBRARIES.md](./references/ALLOWED-LIBRARIES.md)`                   |
| Secrets / tokens / hostnames; `dangerouslySetInnerHTML`, `innerHTML`-via-ref, `eval` / `new Function`; chat or streaming surfaces (including hidden control characters in copy paths); unsanitised URLs and `javascript:` / `data:` schemes; `target="_blank"` `rel` tokens; programmatic navigation from untrusted input; prototype-polluting merges; DOM clobbering; CSP / Trusted Types compatibility; `postMessage` / iframes; clipboard-read; error / stack-trace leakage; ReDoS | `[references/SECURITY.md](./references/SECURITY.md)`                                     |
| Network calls, env vars, feature flags, routing, product copy inside a component                                                                                                                                                                                                                                                                                                                                                                                                      | `[references/BUSINESS-LOGIC.md](./references/BUSINESS-LOGIC.md)`                         |
| Vitest, coverage, test cases, snapshot tests, keyboard/a11y tests                                                                                                                                                                                                                                                                                                                                                                                                                     | `[references/TESTING.md](./references/TESTING.md)`                                       |
| README, stories, Storybook CSF, "When to use", documentation quality                                                                                                                                                                                                                                                                                                                                                                                                                  | `[references/DOCS-AND-STORIES.md](./references/DOCS-AND-STORIES.md)`                     |
| Copy shown to humans — README narrative, Storybook labels/example text, JSDoc `@example` blocks, prescriptive prop wording, CTAs, empty-state copy                                                                                                                                                                                                                                                                                                                                    | `[../ux-content-guidelines/SKILL.md](../ux-content-guidelines/SKILL.md)` (sibling skill) |
| Named exports, default export, compound parts, ref forwarding, peer-dep ranges, prop types, JSDoc on exported symbols / props / types                                                                                                                                                                                                                                                                                                                                                 | `[references/API-CONVENTIONS.md](./references/API-CONVENTIONS.md)`                       |
| `useEffect`, memoisation, waterfalls, barrel imports, `useState` initialiser, `startTransition`, perf patterns                                                                                                                                                                                                                                                                                                                                                                        | `[references/REACT-PERFORMANCE.md](./references/REACT-PERFORMANCE.md)`                   |
| Formatting the review comment itself, severity tags, verdict line                                                                                                                                                                                                                                                                                                                                                                                                                     | `[references/OUTPUT-FORMAT.md](./references/OUTPUT-FORMAT.md)`                           |
| End-to-end ship readiness: new component PR, major revision, or any time you want the full 16-item sweep. Also covers RTL / logical properties, cross-browser matrix, and visual-regression posture                                                                                                                                                                                                                                                                                   | `[references/CHECKLIST.md](./references/CHECKLIST.md)`                                   |


If no trigger matches, grade the PR from this file alone.

## What this library is (top-line posture)

`@airo-ux/pattern-library` ships re-usable components that:

1. **Compose UXCore2 primitives** (`@ux/box`, `@ux/button`, `@ux/text-lockup`,
  `@ux/icon`, `@ux/intents`) — never reimplement them.
2. **Theme via intents** (`@ux/tailwind-intents` utility classes and bound
  intent variables) — never hardcode colours, spacing, or fonts. Shadow **colour**
  is black-with-alpha `rgba` only (see `UXCORE-USAGE.md`); shadow geometry may
  use literal `px`.
3. **Stay re-usable**: no network calls, env vars, product- or
  workflow-specific strings, routing coupling, or feature flags inside a
  component. Generic, overridable default labels and status copy are allowed.
4. **Treat docs as product**: `README.md` + Storybook stories feed the MCP
  codex that every downstream agent consumes. If it's not documented, it
   doesn't exist.
5. **Follow GoDaddy library conventions**: named exports, controlled +
  uncontrolled parity, forwarded `className` / `data-`* / refs, peer-dep
   ranges `^2400 || ^2500`, BEM class prefix `airo-<area>-<name>__<part>`.

Third-party component libraries are a hard block. Headless/behavioural
libraries that Antares itself builds on (`react-aria`, `react-stately`,
`@react-aria/`*, `@react-stately/*`, `@godaddy/antares*`) are allowed today
and remain allowed after the Antares transition. See
`[references/ALLOWED-LIBRARIES.md](./references/ALLOWED-LIBRARIES.md)`.

## Three pillars

Grade every PR along these three dimensions. Each gets a 0–10 score with a
one-line justification; re-rate after fixes so authors see a trajectory, not
just a verdict.

### 1. Component Craft

- Compose UXCore2 primitives (`@ux/box` for layout, `@ux/text-lockup` for
heading+body, `@ux/button` for interactive, `@ux/icon` for icons). Never
reimplement primitives with raw `div`/`span` + inline styles.
- Intent tokens only: `@ux/tailwind-intents` utilities, bound intent
  variables, or Figma-bound tokens. No raw hex/rgb/hsl, no arbitrary `px`
  or `rem` outside the Tailwind config, no hardcoded font families.
  **Exception:** `box-shadow` / `filter: drop-shadow` geometry values
  (offset-x, offset-y, blur, spread) may be literal `px` — UXCore2 does
  not provide tokens for shadow geometry. Shadow *color* must still use
  intent tokens.
- Never restyle `@ux/*` internals. Compose or use variants; never reach in
with descendant selectors like `.ux-button__label { … }`.
- Pair `box.{foreground,background}Color` at the same contrast level.
- Honour the allow list. `@godaddy/antares*`, `react-aria`, `react-stately`,
`@react-aria/*`, `@react-stately/*` are allowed for headless use. Anything
not on the allow list in
`[references/ALLOWED-LIBRARIES.md](./references/ALLOWED-LIBRARIES.md)` is
blocked by default — the rule is categorical (styled component kits,
runtime CSS-in-JS, third-party icon packs, component-flavour motion
libraries), not tied to specific package names.

### 2. API & Structure

- File layout follows `src/<area>/<name>/` with `index.ts` / `<Name>.tsx` /
`styles.css` / `README.md` / `<Name>.stories.tsx` /
`__tests__/<Name>.test.tsx`.
- **Named exports only.** No `export default`. Compound sub-parts attach via
dot-notation: `<Name>.Subpart = <Name>Subpart` (e.g. `Menu.Item = MenuItem`).
- **JSDoc on every public export.** The component, its `Props` interface,
every prop on that interface, and every exported helper/type must carry a
JSDoc block. The component needs an `@example`; stateful prop triplets
cross-reference each other with `@see`; defaults use `@default`. ts-morph
pipes these comments into the MCP codex, so missing JSDoc is missing from
the product. See `[references/API-CONVENTIONS.md](./references/API-CONVENTIONS.md)`.
- **Controlled + uncontrolled parity** for every stateful prop: if `open`
exists, there must be `defaultOpen` + `onOpenChange`.
- `className` and `data-`* forward to the root element. Refs forward on
interactive/focusable roots.
- Exported `Props` type alongside the component: `export type <Name>Props`.
- `tsup.config.ts` entry ↔ `package.json#exports` subpath ↔
`src/<area>/index.ts` re-export must all agree. New CSS subpath must point
at a real generated file.
- **Ownership declared in `CODEOWNERS`.** Every new `src/<area>/<name>/`
folder must ship with a matching entry in `.github/CODEOWNERS`
(`/src/<area>/<name>/ @owner-or-team`). Missing entry is Critical; the
component has no accountable human for future changes without it. See
`[references/COMPONENT-STRUCTURE.md](./references/COMPONENT-STRUCTURE.md)` → Ownership.
- Peer-dep ranges stay `^2400 || ^2500` across `@ux/`*. A range change is
a **risk-surface escalation** — see the Escalation path below.

### 3. Docs as Product

- `README.md` uses MCP-facing structure. Required H2s: **When to use**,
**When not to use**, **Accessibility**, **Gotchas**. Encouraged:
**Design guidelines**, **Usage guidelines**, **Related components**.
- Answer the editorial questions: When should a dev reach for this? When
should they NOT, and what should they use instead? What do devs commonly
get wrong? What parent/peer/provider is required? What other components
pair well with this?
- Organise docs by feature/variant, not by prop name (prefer `## Sizes` over
`## The size prop`).
- Prop triage: focus example sections on **Core** and **Modifier** props.
`Structural` (ref, key) and `Internal` props don't need dedicated examples.
- Storybook stories cover at minimum Default, every meaningful variant, and
interactive states via `play` functions. Use `@storybook/addon-a11y`.
- Avoid AI-slop visual patterns in stories: no generic 3-column card grids,
no centred-everything hero layouts, no decorative icon-in-coloured-circle
sections, no purple/indigo gradient backgrounds.
- **Every PR that changes `src/<area>/<name>/` must touch the component's
`README.md` and/or stories.** Silent prop additions that skip docs are a
Critical finding.

## Severity model

Every finding has a file, a line, a rule ID, a reason, and a suggested fix.

- **Critical** — blocks merge. Security, hardcoded tokens, disallowed
component libraries, missing controlled/uncontrolled parity on a new
interactive component, default export, missing JSDoc on an exported
component or `Props` interface, `README.md` or stories missing for a new
component, missing `CODEOWNERS` entry for a new component folder, CSS
subpath pointing at a non-existent file, peer-dep range drift, missing
Changesets file on a normal PR to `main`, or a changeset bump/body that
contradicts the PR's actual risk surface.
- **Important** — blocks merge once the author is aware. Intent-bypassing
styles, hardcoded colours, missing README H2, missing keyboard test on
interactive component, snapshots of `@ux/`* internals, BEM prefix missing,
forwarded `className`/`data-`* not forwarded.
- **Minor** — follow-up is fine. Copy polish, small refactors, doc wording,
non-blocking perf hints.

## How to act on findings (for authors receiving this review)

1. Fix every **Critical** immediately. They block merge hard.
2. Address every **Important** before continuing further work. Do not defer
  them across multiple PRs.
3. Note **Minor** items and ship them as follow-ups if they don't belong in
  this PR.
4. It is OK to push back with technical reasoning. If a rule feels wrong for
  your specific case, say so explicitly with the code path and reasoning.
   Don't perform agreement — disagree in the PR thread and land a decision.

## Escalation path (risk-surface changes)

Some PRs introduce risk that goes beyond the checklist. These require
explicit author justification in the PR description **and** a senior
reviewer sign-off before merge. They are never "just approve":

- Widening or narrowing a `@ux/`* peer-dependency range (currently
`^2400 || ^2500`). A silent bump breaks one of the two supported
UXCore2 majors.
- Bumping the `react` / `react-dom` peer range (currently `^18`).
- Adding a new top-level runtime dependency not already listed in
`[references/ALLOWED-LIBRARIES.md](./references/ALLOWED-LIBRARIES.md)`
(the same PR must also append the package to that file's allow list
with rationale).
- Deprecating or renaming any public prop/type/export.
- Lowering the coverage floor in `vitest.config.ts`.
- Any change that alters the published API surface in a way consumers
must react to.

For these PRs the author adds a `## Risk surface` section to the PR
description covering: what changed, why now, downstream impact, the
consumer-migration plan (if any), and the deprecation path. Reviewers
treat the absence of that section as a Critical finding.

## Release impact / Changesets

Changesets records release impact; it does **not** decide it. Reviewers
map the existing API and escalation rules to `major` / `minor` / `patch`:

- **major** — consumers must change code or upgrade strategy. Examples:
  removed or renamed public props/types/exports, support drops in peer
  ranges, or behavior changes that require migration.
- **minor** — additive, backwards-compatible surface changes. Examples:
  new components, new exports, new props, new variants, or materially new
  documented capabilities that existing consumers can ignore safely.
- **patch** — backwards-compatible fixes and maintenance. Examples: bug
  fixes, non-breaking behavior corrections, documentation or Storybook
  clarifications, and internal work with no API break.

Rules:

- Every normal PR against `main` should include exactly one new
  `.changeset/*.md` file.
- The generated release PR branch (`changeset-release/main`) and
  Dependabot PRs are exempt.
- The changeset body should describe external impact in 1–3 sentences and
  explicitly say when there is no API change.
- If the PR has a `## Risk surface` section, the changeset must tell the
  same story at release-note granularity. Divergence is a Critical finding.

## Signals to ignore

Do not flag the following — they add noise without changing quality:

- Biome auto-formatting diffs in otherwise-unchanged files.
- Minor wording tweaks in Storybook story names or docs strings, unless
they contradict the
`[DOCS-AND-STORIES.md](./references/DOCS-AND-STORIES.md)` editorial
rules.
- Generated files: `dist/` output and `codex/codex.json`. These are
rebuilt by scripts; flag a missing `.gitignore`/build-script
regression instead of the generated diff.

## Review output format

Every review produced by this skill follows the shape documented in
`[references/OUTPUT-FORMAT.md](./references/OUTPUT-FORMAT.md)`:

- A **Summary** (2–3 sentences).
- A **Critical Issues** table with columns: `File | Line | Rule | Issue`.
- A **Suggestions** table with columns: `File | Line | Category | Suggestion`.
- A **What looks good** bulleted section (optional but encouraged).
- A **Scores** section: Component Craft `N/10`, API & Structure `N/10`,
Docs as Product `N/10`. Re-rate after fixes.
- A **Verdict** line: `Approve` / `Request Changes` / `Needs Discussion`.

## When to use this skill

DO use when:

- Reviewing a PR against `@airo-ux/pattern-library`.
- Auditing a single component folder for completeness.
- Grading docs/stories/tests for a new component.
- Deciding whether an imported package is allowed.

DO NOT use for:

- Reviewing consumer application code that uses `@airo-ux/pattern-library` (that's
application review, different rules).
- Discussions about UXCore2 / Antares internals (use the UXCore MCP server
and the `uxcore` skill instead).
- Planning or designing a new component from scratch (use the brainstorming
skill).

## Reference index

Load only when triggers match. See the table above.

- `[references/COMPONENT-STRUCTURE.md](./references/COMPONENT-STRUCTURE.md)` — file layout, build/exports parity, BEM.
- `[references/UXCORE-USAGE.md](./references/UXCORE-USAGE.md)` — UXCore2 composition, intents, no-bypass.
- `[references/ALLOWED-LIBRARIES.md](./references/ALLOWED-LIBRARIES.md)` — allow/block list, escape hatch.
- `[references/SECURITY.md](./references/SECURITY.md)` — secrets, unsafe HTML sinks (`dangerouslySetInnerHTML`, `innerHTML`-via-ref, `eval`), URL scheme allow-list and `rel` tokens, chat/streaming output (bidi / zero-width control characters, markdown sanitisation), prototype pollution, DOM clobbering, CSP / Trusted Types, `postMessage`, iframe `sandbox`, clipboard, storage, error-stack leakage, ReDoS, and supply-chain. Includes rule-ID table and grep patterns.
- `[references/BUSINESS-LOGIC.md](./references/BUSINESS-LOGIC.md)` — what doesn't belong in a component.
- `[references/TESTING.md](./references/TESTING.md)` — Vitest, coverage, required cases.
- `[references/DOCS-AND-STORIES.md](./references/DOCS-AND-STORIES.md)` — README + Storybook for the MCP.
- `[references/API-CONVENTIONS.md](./references/API-CONVENTIONS.md)` — named exports, parity, peer deps.
- `[references/REACT-PERFORMANCE.md](./references/REACT-PERFORMANCE.md)` — priority-ordered perf patterns.
- `[references/OUTPUT-FORMAT.md](./references/OUTPUT-FORMAT.md)` — how to shape the review comment itself.
- `[references/CHECKLIST.md](./references/CHECKLIST.md)` — 16-item ship-readiness gate. Use for new-component reviews or whenever you want the full sweep.

### Sibling skills in this repo

Invoke these alongside `review` when their trigger matches. They are
authoritative for their domain — this skill defers to them rather
than restating their rules.

- `[../ux-content-guidelines/SKILL.md](../ux-content-guidelines/SKILL.md)`
— GoDaddy UX Content Design Playbook. Load whenever a PR changes
copy in README narrative, Storybook labels/examples, JSDoc
`@example` blocks, or prop-documentation that prescribes wording.
See `[references/DOCS-AND-STORIES.md#copy-voice-and-tone](./references/DOCS-AND-STORIES.md#copy-voice-and-tone)`
and `[references/BUSINESS-LOGIC.md#copy-that-does-live-in-this-repo](./references/BUSINESS-LOGIC.md#copy-that-does-live-in-this-repo)`.
- `[../accessibility/SKILL.md](../accessibility/SKILL.md)` — WCAG 2.1
Level AA. Load for interactive or stateful components, or whenever
`[references/TESTING.md](./references/TESTING.md)` a11y-required
cases apply.
- `[../react-patterns/SKILL.md](../react-patterns/SKILL.md)` — React
composition patterns. Load for hook ordering, derived state,
controlled/uncontrolled parity questions.
- `[../uxcore/SKILL.md](../uxcore/SKILL.md)` — UXCore2 / Antares
composition. Load whenever
`[references/UXCORE-USAGE.md](./references/UXCORE-USAGE.md)` rules
apply.