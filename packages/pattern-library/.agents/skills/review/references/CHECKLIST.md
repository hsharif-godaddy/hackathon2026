# Ship Checklist

A scannable, review-friendly gate every new component PR and every major
revision PR is graded against. Each item maps to Airo's rules, stack,
and constraints — together they describe what "done" looks like for a
primitive in this repo.

The mechanical checks in [`CONTRIBUTING.md`](../../../../CONTRIBUTING.md)
(`lint`, `tsc`, `test`, `build`, `codex:build`, `check:codeowners`) are
the runtime gate — they tell you the repo still builds. **This checklist
is the semantic gate** — it tells you the component is ready to land in
front of downstream teams via the MCP.

## How to use

- **Authors** — walk through every item before requesting review. Each
  item links to the authoritative rule / reference with the *how*.
- **Reviewers** — a failed item is flagged at the listed severity and
  anchored to the matching rule ID.
- **Conditional items** — marked `[input-only]`, `[interactive-only]`,
  etc. Skip cleanly when they don't apply; don't invent applicability.

## Three surfaces, every item

Every item below is evaluated against **three surfaces** — a component
is "done" only when all three land in the same PR:

1. **Implementation** — `<Name>.tsx` + `styles.css`. The behaviour
   exists.
2. **API surface** — `Props` interface + JSDoc on every export. The
   behaviour is typed and self-describing
   (see [`API-CONVENTIONS.md`](./API-CONVENTIONS.md)).
3. **Narrative** — `README.md` + `<Name>.stories.tsx`. The behaviour is
   discoverable
   (see [`DOCS-AND-STORIES.md`](./DOCS-AND-STORIES.md)).

The MCP codex ingests all three. A state, interaction, or constraint
that the code supports but the README / JSDoc / stories don't mention is
invisible to every downstream team that discovers this component through
the MCP — which is every downstream team. **"I'll document it later" is a
failed review.** Ship the docs with the code.

## Scoring

Checklist items map directly onto the three pillars in
[`SKILL.md`](../SKILL.md#three-pillars). Fail any **Critical** item →
verdict is `Request Changes`. Fail ≥3 **Important** items → verdict is
at most `Needs Discussion`. **Minor** items roll into the Suggestions
table but don't block merge.

Within each item, a missing implementation AND a missing doc are
*separate* failures. A component that handles `aria-expanded` correctly
but whose README doesn't mention the disclosure pattern fails item 7 on
the narrative surface even though the code is fine.

---

## 1. User Interaction States — Critical `[interactive-only]`

**Code.** Every interactive part has explicit `hover`, `focus-visible`,
`active` (or equivalent pressed state), and `disabled` styling. Compose
`@ux/button`, `@ux/link`, `@ux/icon` etc. — those primitives already
ship the state matrix. If you hand-roll an interactive element, all
four states + keyboard parity are mandatory.
See [`UXCORE-USAGE.md`](./UXCORE-USAGE.md) and [`TESTING.md`](./TESTING.md).

**Docs.** The README's `## Accessibility` section (or a dedicated
interaction section for complex widgets) lists which interactive parts
exist and which states each one exposes. Storybook surfaces each state
— either a dedicated story per state or one `Interactive` story whose
controls exercise them — so the states are reachable without reading
the component source.

Red flag: `outline: none` / `:focus { outline: 0 }` without a replacement
focus-visible ring → Critical, rule ID `a11y-focus-removed`.

## 2. Internal Component States — Important

**Code.** Stateful variants (`loading`, `empty`, `error`/`critical`,
`success`, `warning`, `required`, `invalid`, `selected`, etc.) are
expressed via UXCore2 intents or component-scoped CSS custom
properties — never hardcoded colours. Every variant the component
exposes as a prop has a matching Vitest assertion.
See [`UXCORE-USAGE.md`](./UXCORE-USAGE.md).

**Docs.** The README names every state the component can be in and
*when* each one happens (`error` → parent signalled failure; `loading`
→ async work deferred to the consumer; `empty` → no data). Each state
has a Storybook story titled after its intent (e.g. `Loading`, `Empty`,
`CriticalError`), and the prop that triggers it is documented in JSDoc
with a `@default` and an `@example` if the value has non-obvious
semantics.

## 3. Theme Awareness — Critical

**Code.** Every colour, spacing, and font flows from an intent or theme
token — `@ux/tailwind-intents` utilities, documented `var(--ux-<semantic-name>)`
custom properties (kebab-case English, e.g. `--ux-intent-primary-color`), or
Figma-bound tokens. Shadow **colour** must be black `rgba(0, 0, 0, α)` only (not
`ux.box.foregroundColor`); shadow geometry may use literal `px`. No raw
hex/rgb/hsl except that black shadow form, no raw `px`/`rem` outside the Tailwind
config, no hardcoded font stack, **and no opaque `--ux-<hash>` variables** (`var(--ux-1xkykcn, 1.5)`,
`var(--ux-97h3vl, lightgray)`, etc. — these are UXCore's compiler-
generated internals, rule `uxcore-opaque-internal-var`). See
[`UXCORE-USAGE.md`](./UXCORE-USAGE.md) → *Never consume opaque `@ux/*`
CSS variables*.

**Docs.** The README names which intent families the component is
parameterised over (e.g. "accepts `brand`, `neutral`, and `critical`
intents via the `intent` prop"). Any component-scoped CSS custom
property a consumer is allowed to override is documented in the
README's `## Theming` section with its name, default value, and what
it controls — otherwise it is a private implementation detail and
should not be `--ux-`-prefixed.

## 4. Internationalization (RTL / Bi-directionality) — Critical

**Code.** Component CSS uses CSS logical properties throughout —
`inset-inline-*`, `margin-inline-*`, `padding-inline-*`,
`border-inline-*`, `text-align: start/end`. Physical `left`/`right`,
`margin-left`, `padding-right`, `border-left` only appear inside
positioning reset helpers when there is genuinely no logical
equivalent. Directional icons (chevrons, arrows) either flip
automatically via `[dir="rtl"] { transform: scaleX(-1); }` on a
dedicated mirror class, or use UXCore icons that already ship the bidi
behaviour. User-visible strings stay props — localisation is the
consumer's concern, see [`BUSINESS-LOGIC.md#product-strings-and-i18n`](./BUSINESS-LOGIC.md#product-strings-and-i18n).

For the *how*, load the sibling [`uxcore` skill](../../uxcore/SKILL.md)
— it covers logical properties and bidirectional layouts in depth.

**Docs.** The README calls out the component's RTL behaviour in a
dedicated sentence in `## Accessibility` or `## Gotchas`: what flips
automatically, what the consumer has to provide (e.g. a locale-aware
label), and whether the component needs `dir="rtl"` on an ancestor.
Layout-sensitive components ship a `RTL` Storybook story that renders
inside a `<div dir="rtl">` so the behaviour is visible without running
a locale switcher.

Red flags (all Critical, rule ID `i18n-physical-css-property`):

- `margin-left:`, `margin-right:`, `padding-left:`, `padding-right:`,
  `left:`, `right:`, `border-left:`, `border-right:`, `text-align:
  left|right` in a component `styles.css`.
- Directional Unicode characters (`›`, `‹`, `→`, `←`) hardcoded in TSX
  instead of a mirrorable icon.
- Storybook has no `dir="rtl"` variant for layout-sensitive components.
- README has no mention of RTL / bidi behaviour for a component whose
  layout is directional.

## 5. Keyboard Interactions — Critical `[interactive-only]`

**Code.** Every interactive role honours the WCAG 2.1 keyboard
contract: Enter/Space for buttons, Arrow + Home/End for composite
widgets, Escape for dismiss, Tab + Shift+Tab for focus order,
type-ahead where the ARIA pattern calls for it. Storybook play
functions exercise the full keyboard path on Default + every variant.
See [`TESTING.md`](./TESTING.md).

**Docs.** The README's `## Accessibility` section documents the
keyboard model as a **table of key → behaviour** (e.g. `Enter` →
activate, `Escape` → dismiss, `ArrowDown` → next option). A prose
summary is not sufficient — agents surfacing this via the MCP need a
structured key map they can replay in consumer code or test suites.

## 6. Validation — Important `[input-only]`

**Code.** Components that accept user input expose `invalid`,
`required`, and `disabled` state, and render `aria-invalid` /
`aria-required` / `aria-describedby` correctly. Error messages come in
as props (see [`BUSINESS-LOGIC.md#product-strings-and-i18n`](./BUSINESS-LOGIC.md#product-strings-and-i18n)),
never as internal strings. Non-input components skip this item cleanly.

**Docs.** The README demonstrates at least one validation pattern
(required / min / max / pattern / custom) end-to-end — consumer code
showing how `invalid`, `errorMessage`, and `aria-describedby` wire
together. A matching Storybook story renders the invalid state, and a
Vitest assertion pins the ARIA wiring.

## 7. Accessibility Attributes — Critical

**Code.** All applicable ARIA roles and attributes are present:
`aria-expanded` on disclosures, `aria-live="polite"` for streaming
regions, `aria-label` / `aria-labelledby` for icon-only interactive
elements, `aria-current` for active nav items, and so on. Storybook's
`addon-a11y` panel is clean (zero violations) on Default + every
variant story. Load the sibling [`accessibility` skill](../../accessibility/SKILL.md)
when any ambiguity comes up.

**Docs.** The README's `## Accessibility` section lists the ARIA
contract the component implements — the roles it takes on, the
attributes it emits, and the conditions under which they are emitted
(e.g. "renders `aria-expanded="true"` when `open` is `true`"). Any
ARIA attribute the consumer is expected to supply (typically a label
for icon-only interactive elements) is documented on its prop via
JSDoc with a clear note that it is required for a11y.

## 8. Cross-browser Compatibility — Important

**Code.** The component works across the UXCore2 / Antares supported
browser matrix: current + last two majors of Chromium, Firefox, Safari,
Edge. CSS features outside that matrix need a fallback or an explicit
justification in the PR description. Composing `@ux/*` primitives
inherits the matrix for free; the risk surface is hand-rolled CSS —
especially newer properties (`:has()`, `@container`, `color-mix()`,
anchor positioning, view transitions) which need a progressive-enhancement
check.

**Docs.** If the component uses a newer CSS feature that degrades
(rather than breaks) in older supported browsers, the README's
`## Gotchas` section names the minimum browser the full behaviour
requires and what the fallback looks like. Reviewers: if the diff uses
such a feature, verify either a `@supports` guard, a documented
fallback in the README, or a note in the PR explaining why the
degradation is acceptable.

## 9. Unit-test coverage — Critical

At least 90 % line and branch coverage across every new file under
`src/<area>/<name>/`. Required cases: default render, controlled +
uncontrolled parity, every variant, keyboard + a11y smoke, forwarded
`className` + `data-*` + ref. See [`TESTING.md`](./TESTING.md).

## 10. Example Coverage — Critical

Storybook has a `Default` story plus one story per meaningful variant
(size, intent, layout mode, compound usage, edge case). Every story
carries `tags: ['autodocs']` where appropriate and has clean
`addon-a11y`. Every feature exposed through props is demonstrated in
at least one story — if it isn't demoed, the MCP can't surface it. See
[`DOCS-AND-STORIES.md`](./DOCS-AND-STORIES.md).

Stories *are* the example surface of this component — this item is
why the other items on this checklist can say "document in Storybook"
without duplicating the requirement. A feature that passes items 1–8
but has no story fails here.

## 11. Necessary Files & Configuration — Critical

The component folder ships `index.ts`, `<Name>.tsx`, `styles.css`,
`README.md`, `<Name>.stories.tsx`, and `__tests__/<Name>.test.tsx`.
Both the code entry and the CSS entry exist in `tsup.config.ts`, both
subpaths exist in `package.json#exports`, and
[`.github/CODEOWNERS`](../../../../.github/CODEOWNERS) has a
non-default owner for the folder. See
[`COMPONENT-STRUCTURE.md`](./COMPONENT-STRUCTURE.md).

## 12. Linting — Critical

`npm run lint:ci` is clean — Biome check passes with zero manual
`biome-ignore` escape hatches. If a rule is legitimately wrong for this
file, negotiate the rule in `biome.json`; don't disable it inline.

## 13. JSDoc — Critical

The component, its `Props` interface, every prop on that interface, and
every exported helper / type carries a JSDoc block. Component JSDoc has
an `@example`; stateful prop triplets (`value` / `defaultValue` /
`onChange`) cross-reference each other with `@see`; defaults use
`@default`. ts-morph feeds these into the MCP codex — missing JSDoc is
missing from the product. See [`API-CONVENTIONS.md`](./API-CONVENTIONS.md).

## 14. ReadMe — Critical

`README.md` exists, H1 is the component name, and the required H2
sections are present in order: `## When to use`, `## When not to use`,
`## Accessibility`, `## Gotchas`. Code blocks are short, complete, and
copy-pasteable with the correct subpath import. Copy follows the
[`ux-content-guidelines` skill](../../ux-content-guidelines/SKILL.md).
See [`DOCS-AND-STORIES.md`](./DOCS-AND-STORIES.md).

This is the single item that every other item on this checklist folds
into on the narrative surface. The per-item "Docs" expectations above
(states, keyboard model, theming, RTL, ARIA contract, gotchas) all
land here. A README that hits the four required H2s but is silent on
the behaviours items 1–8 demand fails those items, not this one —
this item covers structural presence, the others cover content
completeness.

## 15. Types — Critical

`export type <Name>Props` (or `interface`) alongside the component, not
inlined. Controlled + uncontrolled triplets type-match. No `any`, no
`// @ts-ignore`, no `as unknown as T` outside documented escape hatches
(see [`API-CONVENTIONS.md`](./API-CONVENTIONS.md)). Peer-dep ranges on
`@ux/*` packages stay `^2400 || ^2500`.

## 16. Visual Regression Testing — Minor (today) / Important (future)

This repo runs Vitest 3 today and does **not** yet capture visual
regression baselines. The planned target is **Vitest 4's browser-mode
visual regression** (`toMatchScreenshot` in `@vitest/browser`), which
keeps the VR runner inside the same test suite that already backs
items 5, 6, 9, and 10 — no separate service (Chromatic), no separate
runner (Playwright), no second CI job. Storybook stories are the
de-facto visual baseline that the Vitest 4 pipeline will pin, so treat
them as visual fixtures today:

- No randomised content in story args.
- No live timestamps — use a stable fixture date.
- No network-dependent visuals in stories.
- No animation that can't settle deterministically (use
  `@media (prefers-reduced-motion: reduce)` or gate on a story control).
- No consumer-supplied strings baked into story defaults in ways that
  would force a baseline refresh on copy tweaks — parameterise.

When the Vitest 4 upgrade lands, this item upgrades to Important and
baselines are captured from these stories via
`@vitest/browser` + the Storybook addon bridge.

