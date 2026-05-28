# Allowed and Blocked Libraries

`@airo-ux/pattern-library` is a UXCore2-based library. We maintain an **allow
list** rather than a block list: new packages ship every day, so
enumerating bad ones cannot keep up. If a dependency is not on the
allow list below, it is blocked by default and needs an explicit
escalation before it can be added.

This file is the single source of truth. Any new dependency outside
the allow list is a risk-surface escalation (see
[`SKILL.md`](../SKILL.md) → Escalation path): the PR needs an
author-written justification in the PR description **and** an entry
appended to this file in the same PR.

## Allow list (authoritative)

### Always allowed at runtime

- `@ux/*` — UXCore2 primitives. **Peer dependencies**, never bundled.
- `@ux/tailwind-intents` — intent tokens as Tailwind utilities. Runtime
  dependency.
- `classnames` — tiny utility. Runtime dependency.
- Native `Intl.*` APIs (`Intl.DateTimeFormat`, `Intl.NumberFormat`,
  `Intl.Collator`, etc.) are built into the runtime and allowed inside
  a component when the component takes `locale` as a prop. See
  [`BUSINESS-LOGIC.md`](./BUSINESS-LOGIC.md) → "What about native
  `Intl.*` APIs?".

### Allowed for headless / behavioural use only

These ship logic, not styled UI. Use their hooks; never import any
styled component they happen to ship.

- `react-aria`
- `react-stately`
- `react-aria-components` — render-prop / data-attribute components
  designed for consumer styling (e.g. `ToggleButton`, `ToggleButtonGroup`,
  `SelectionIndicator`, plus the `useLocale` hook). Composable with
  `@ux/*` primitives via the `as` prop pattern; treat the components
  the same as the hooks (behaviour first, styling owned by us).
- `@react-aria/*` (scoped packages)
- `@react-stately/*` (scoped packages)
- `@godaddy/antares` and `@godaddy/antares-*`

Why: Antares
([github.com/godaddy/antares](https://github.com/godaddy/antares)) is
built on React Aria + React Stately. Consuming them directly today is
fine and stays fine once Antares lands — we take a hard dependency on
the React Aria model either way.

Usage constraints for these:

1. Use them for **behaviour and accessibility hooks** (`useButton`,
   `useListState`, `useSelect`, etc.).
2. Do **not** import any styled component package they also ship.
   Styling always comes from UXCore2 intent tokens.
3. Compose their hooks with `@ux/*` primitives where one already ships
   the role you need. Don't re-roll `@ux/button` with `useButton` just
   because you can.

### Scoped exceptions to the headless-only rule

These are individual styled components from the "headless-only" list
above that are explicitly allow-listed after going through the
escalation path. Each entry records **what** is imported, **where**,
**why UXCore2 can't cover it today**, and the **PR that signed off**.

| Import | Used in | Rationale | Re-evaluation trigger | PR |
|--------|---------|-----------|----------------------|----|
| `Button`, `Flex`, `Icon`, `Tooltip`, `TooltipTrigger` from `@godaddy/antares` | `src/_vendor/segmented-controller/SegmentedController.tsx` only | Vendor port of [godaddy/antares#187](https://github.com/godaddy/antares/pull/187)'s `SegmentedController`, providing the icon-first `collapseInactive` variant before the upstream PR ships. The PR's source uses internal Antares paths (`#components/{button,layout/flex,icon,tooltip}`); we substitute the public Antares exports so we don't fork the visual language while we wait for the upstream PR to merge. Tooltip + TooltipTrigger are Antares wrappers around React Aria's tooltip stack; Flex / Icon / Button are the same primitives Antares uses internally for this component. UXCore2 does not ship the `Tooltip` half of the pair, so substituting `@ux/*` wouldn't reach feature parity. Note: `AiroHeader` (in `src/surfaces/panel-chrome/`) consumes the vendor, so the `@airo-ux/pattern-library/surfaces/panel-chrome` and `/surfaces/panel` entrypoints transitively rely on this exception until the vendor is removed. | Remove this row when [godaddy/antares#187](https://github.com/godaddy/antares/pull/187) merges and the released `@godaddy/antares` `SegmentedController` is adopted directly (the vendor folder, this exception, and the `react-aria-components` peer entry all leave together). | [#85](https://github.com/gdcorp-ux/airo-components/pull/85) |

Rules for adding a new row:

- The component must be a **specific named export** — no blanket "all
  styled components from `@godaddy/antares`" entries.
- The "Used in" column must name the exact file(s). If the usage
  spreads to new files, update the table in the same PR.
- All four escape-hatch conditions still apply (UXCore2 and Antares
  headless hooks don't cover the need; the PR carries a `## Risk
  surface` section and senior sign-off).
- Any reviewer who sees an antares styled-component import **not in
  this table** should still flag it as a Critical violation.

### Scoped exceptions for drag + resize behaviour

These packages provide positioning and interaction primitives (drag, resize)
that UXCore2 / Antares / React Aria do not ship.

| Import | Used in | Rationale | Re-evaluation trigger | PR |
|--------|---------|-----------|----------------------|----|
| `Rnd` from `react-rnd` | `src/surfaces/floating-panel/FloatingPanel.tsx` only | UXCore2 and Antares have no drag-and-resize primitive. `react-aria` provides keyboard interaction hooks but no imperative drag/resize with mouse/touch support. `react-rnd` is headless-adjacent — it provides a draggable/resizable container `<div>` with no opinion on styling; the rendered chrome inside is `PanelChrome`. Adds `re-resizable` and `react-draggable` as transitive deps (both CJS-only; all three are added to `.storybook/main.ts` `optimizeDeps.include`). Bundle impact: ~12 kB minzipped, scoped to the `floating-panel` subpath entry which consumers opt into explicitly. | Remove when UXCore2 or Antares ships a native drag-and-resize primitive. | (this PR) |

### Scoped exceptions for rich-text editing

Some components host a contenteditable surface where UXCore2 does not
ship a primitive and the editor needs more than a plain `<textarea>`
(inline atomic chips, decorator-driven ghost text, paste interception).
Each entry records **what** is imported, **where**, **why UXCore2 can't
cover it today**, and the **PR that signed off**.

| Import | Used in | Rationale | Re-evaluation trigger | PR |
|--------|---------|-----------|----------------------|----|
| `@lexical/react`, `lexical`, `lexical-beautiful-mentions` | `src/input/prompt-box/LexicalInput.tsx` only | UXCore2 ships `@ux/text-entry` (a styled `<textarea>`) but no rich-text editor primitive — and `react-aria` / `react-stately` have no contenteditable composer either. PromptBox needs to host inline element-mention atoms (`#3 Button`), decorator-driven ghost-text suggestions, and paste interception (large text → host callback, files → host callback, image → screenshot capture); a plain `<textarea>` cannot represent a non-text atomic node. Lexical is Meta's contenteditable framework — headless, intent-token-friendly (no built-in chrome to override), and the same library `airo-app-builder` was already using for its bespoke ~571-line composer. Moving the composer into `@airo-ux/pattern-library` deduplicates that consumer-side editor. `lexical-beautiful-mentions` is a thin Lexical plugin for the mention-node lifecycle (insert / replace / serialise); the visual chrome lives in `MentionChip` and is bound to `actionControl*` intent tokens. All three are peer dependencies — consumers that already host another Lexical composer get them deduped automatically. | Remove when UXCore2 ships a sanctioned rich-text editor primitive (e.g. `@ux/rich-text` with mention support), or when a smaller composer covers the mention-atom + paste-interception + ghost-text contract. | [#97](https://github.com/gdcorp-ux/airo-components/pull/97) |

### Scoped exceptions for content rendering

Some components render content (markdown, rich text, diagrams) where
UXCore2 does not ship a primitive and the render path has a material
security contract. Each entry records **what** is imported, **where**,
**why UXCore2 can't cover it today**, and the **PR that signed off**.

| Import | Used in | Rationale | Re-evaluation trigger | PR |
|--------|---------|-----------|----------------------|----|
| `react-markdown` | `src/chat/agent-message/AgentMessage.tsx` only | UXCore2 does not ship a markdown renderer. Agent output is untrusted content — parsing it ourselves would duplicate the full remark/rehype AST pipeline that `react-markdown` already battle-tests. Pairing `react-markdown` with `rehype-sanitize` is the sanctioned pattern in `SECURITY.md §4.1` (sanitiser lives in the component). Runtime dependency, pinned to a conservative major. | Remove when UXCore2 ships a sanctioned markdown primitive (e.g. `@ux/markdown`). | [#27](https://github.com/gdcorp-ux/airo-components/pull/27) |
| `rehype-sanitize` | `src/chat/agent-message/AgentMessage.tsx` only | The hardened sanitize step for agent-authored markdown. Narrows the tag allow list, enforces `http`/`https`/`mailto` URL schemes, and strips `id`/`name`/`class`/`style` so model output cannot clobber the DOM. Runtime dependency because the sanitizer must always run — it is not optional. | Remove alongside `react-markdown` when UXCore2 ships a sanctioned markdown primitive. | [#27](https://github.com/gdcorp-ux/airo-components/pull/27) |
| `remark-gfm` | `src/chat/agent-message/AgentMessage.tsx` only | GitHub-flavored markdown parser (tables, strikethrough, task lists, autolinks). Agents emit GFM by default, so supporting it is a correctness need, not a feature ask. Runtime dependency; plugin is a small AST transform, no UI surface. | Remove alongside `react-markdown` when UXCore2 ships a sanctioned markdown primitive. | [#27](https://github.com/gdcorp-ux/airo-components/pull/27) |

Rules for adding a new row to this table:

- The dependency must be **behaviour or content-rendering logic**, not a
  styled-component package. The four categorical blocks ("styled
  component libraries", "runtime CSS-in-JS with a component API", "icon
  packs", "client-side i18n libraries") still apply here.
- The "Used in" column must name the exact file(s). If the usage
  spreads to new files, update the table in the same PR.
- The PR must carry a `## Risk surface` section and senior sign-off.
- The sanitiser / renderer must live **inside** the component, not in a
  hook the consumer is expected to remember (see `SECURITY.md §4.1`).

## What is blocked (by category, not by name)

If an import doesn't resolve to something in the allow list above, it
is blocked. The categories below describe **what kinds of packages are
blocked**; the package names are illustrative, not exhaustive.

### Styled component libraries — hard block, no escape hatch

Any package that ships pre-styled UI components. UXCore2 owns the
visual layer in this repo; a second styled system creates drift, bloats
the bundle, and bypasses the intent-token theming pipeline.

Pattern to recognise: packages that export `Button`, `Dialog`,
`Dropdown`, `Modal`, `Select`, etc. with their own styles baked in.
Examples include Material UI, Chakra, Ant Design, React Bootstrap,
Evergreen, Grommet, Semantic UI React, and the styled surfaces of
Radix — but the rule is categorical, not tied to those names.

### Runtime CSS-in-JS with a component API — hard block

Packages that introduce a runtime style engine and expose a
`styled(...)` / `css\`...\`` component factory. Our styling is intent
tokens + Tailwind + BEM — we do not ship a second CSS engine.

Pattern to recognise: a `styled.div`, `styled(Component)`, or template
literals that produce React components at runtime. Examples include
`styled-components`, `@emotion/styled`, and `stitches`.

### Icon packs other than `@ux/icon` — hard block

Every icon in this repo comes from `@ux/icon`. A second icon system
forks the visual language and duplicates bundle weight.

Pattern to recognise: importing an icon as a React component from a
package whose whole purpose is icons. Examples include `react-icons`,
`lucide-react`, `@heroicons/*`, `@tabler/icons-*`.

### Client-side i18n libraries — hard block

Any library whose purpose is to translate UI copy at render time:
`react-intl`, `@lingui/*`, `next-intl`, `@formatjs/*`, `i18next`,
`react-i18next`, `vue-i18n`, and anything in that shape.

Rationale: i18n is a consumer concern. Importing an i18n library
here forces every downstream app onto the same library, which defeats
the purpose of a framework-agnostic primitive. Strings come in as
props — the consumer's translation layer is whatever they prefer. See
[`BUSINESS-LOGIC.md`](./BUSINESS-LOGIC.md) → "Product strings and
i18n".

Native `Intl.*` APIs are not i18n libraries — they are part of the
language runtime and are allowed when the component takes `locale` as
a prop.

### Component-flavour animation libraries — Important

Prefer CSS keyframes in `styles.css`. A heavy motion runtime is rarely
justified for a primitive and tends to break intent theming. This one
has a narrow escape hatch (needs the escalation path), because a
specific animation primitive can occasionally be the right answer.

Pattern to recognise: `<motion.div>` or component-factory exports from
a motion library. Example: `framer-motion`.

### New top-level dependencies

A new runtime dependency that is not in the allow list is Critical
**even if it looks innocuous**. This is the single most common way
drift sneaks into a primitive library. Follow the escape hatch below
or reject the PR.

## Escape hatch

A new dependency outside the allow list is allowed only when **all
four** of the following are true:

1. UXCore2 and Antares do not ship a primitive that covers the need.
2. `react-aria` / `react-stately` do not ship a hook that covers the
   need.
3. The dependency is headless / behavioural, not a styled component
   library or a CSS-in-JS engine.
4. The PR that adds it also:
   - Adds a new entry to the allow list above with library name, what
     it's used for, and why the existing allowed libraries don't fit.
   - Adds the dependency to `package.json`'s `dependencies` or
     `peerDependencies` with a conservative range.
   - Follows the Escalation path in [`SKILL.md`](../SKILL.md): a
     `## Risk surface` section in the PR description and a
     senior-reviewer sign-off.

If the dependency is a styled component library, a runtime CSS-in-JS
engine, or a client-side i18n library, **there is no escape hatch** —
block the PR.

## Review red flags

The signal to act on is the category above, but these are the kinds of
imports that should immediately trigger the allow-list check:

- Any `import { <PascalCaseComponent> } from '<pkg>'` where `<pkg>` is
  not on the allow list — Critical until proven otherwise.
- `import styled from ...` or `import { styled } from ...` from any
  package — Critical.
- An icon imported as a React component from a package whose name
  advertises icons — Critical.
- `<motion.*>` or `styled.*` JSX — flag and check the allow list.
- `import { FormattedMessage, useIntl, defineMessage } from 'react-intl'`
  — Critical. Same for `@lingui/*`, `next-intl`, `@formatjs/*`,
  `i18next`, `react-i18next`. See
  [`BUSINESS-LOGIC.md`](./BUSINESS-LOGIC.md).
- A new entry in `package.json`'s `dependencies` or `peerDependencies`
  without a matching entry added to the allow list in the same PR —
  Critical.
- `react-aria` / `react-stately` imports used to re-render a styled
  button when `@ux/button` already ships the role — Important.
