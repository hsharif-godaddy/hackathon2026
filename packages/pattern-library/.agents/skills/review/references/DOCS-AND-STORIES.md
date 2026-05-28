# Docs and Stories

`@airo-ux/pattern-library` is discovered by agents through the MCP codex. The codex
is built from `README.md` narratives and Storybook CSF stories. If it's not
documented, it doesn't exist.

Review every PR that touches `src/<area>/<name>/` against this file.
`src/*` changes without a `README.md` or stories update is a Critical
finding — "silent" prop additions are the fastest way to poison the MCP.

## Editorial questions (Step 0 of every review)

Before scoring the docs, make sure they answer:

1. **When should a dev reach for this component?** (Primary use cases.)
2. **When should they NOT, and what should they use instead?** (Cites the
   alternative UXCore2 primitive or other Airo component.)
3. **What do devs commonly get wrong?** (Gotchas: prop interaction quirks,
   common misuse patterns, perf footguns.)
4. **What parent/peer/provider is required?** (Required context,
   intl provider, theme provider, etc.)
5. **What other components pair well with this?** (Related components.)

If a `README.md` doesn't answer 1–4, the doc review is Important at best,
Critical if 1 or 2 are missing entirely.

## Required README structure

H1 is the component name (becomes the entry heading in the MCP). Required
H2 sections in this order:

- `## When to use` — primary use cases, in sentence form.
- `## When not to use` — cite the alternative. Examples: "Use `@ux/tag` for
  static status labels" or "Use `<SiblingComponent>` instead for <different
  use case>".
- `## Accessibility` — for interactive components the keyboard model is
  a **key → behaviour table** (e.g. `Enter` → activate, `Escape` →
  dismiss, `ArrowDown` → next option). Also lists the ARIA contract
  (which attributes are emitted, under what conditions), focus
  behaviour, screen-reader behaviour, RTL/bidi notes where layout is
  directional, and any known limitations.
- `## Gotchas` — prop interactions, perf caveats, common misuse,
  browser-specific fallback behaviour for newer CSS features.

Encouraged H2 sections:

- `## Design guidelines` — visual rules consumers should follow (spacing
  between instances, placement in a layout, max width, etc.).
- `## Usage guidelines` — editorial/UX guidance (copy length, icon use,
  dismissibility).
- `## Theming` — **required when the component exposes overridable CSS
  custom properties or parameterises over an intent family.** Lists
  each public custom property with its name, default, and what it
  controls, and names which intents the component understands (e.g.
  "accepts `brand`, `neutral`, `critical` via the `intent` prop").
  Private implementation details do not belong here — if a custom
  property is listed, the component is committing to its name and
  shape as part of its public API.
- `## Related components` — cross-links.
- `## Props` — only for non-obvious props. Props are extracted automatically
  from TypeScript via ts-morph; don't hand-maintain a prop table.

Organise docs by **feature or variant**, not by prop name:

- Good: `## Sizes`, `## Intents`, `## Streaming`, `## Compound usage`.
- Bad: `## The size prop`, `## The intent prop`.

Prop triage: put example sections around the props consumers actually
choose.

- **Core** (`label`, `children`, `intent`, `size`) — usually get a
  dedicated section.
- **Modifier** (`disabled`, `compact`, `as`) — mentioned, one example
  each.
- **Structural** (`ref`, `key`) — rarely need their own section.
- **Internal** (props intended for framework consumers, not end devs) —
  document in JSDoc; don't promote in README.

## Code blocks feed the MCP

Fenced code blocks (```tsx) in `README.md` are extracted as usage examples
by the Aichemy codex pipeline and merged/deduped with Storybook stories.

- Keep blocks short, complete, and copy-pasteable. No `…` placeholders where
  the reader needs to guess.
- Show the import, because `@airo-ux/pattern-library` uses subpath imports and the
  import path is part of the knowledge the MCP surfaces.
- One purpose per block. Don't combine "basic usage" and "advanced streaming"
  in the same block.

```tsx
import { Callout } from '@airo-ux/pattern-library/feedback/callout';
import '@airo-ux/pattern-library/feedback/callout/styles';

export function Example() {
  return <Callout intent="info">Heads up</Callout>;
}
```

## Stories (Storybook CSF 3)

Every component that's part of the public surface has `<Name>.stories.tsx`
with at minimum:

1. `Default` — the bare-minimum render.
2. One story **per meaningful variant** (size, intent, layout mode,
   compound usage).
3. **Interactive states** via the Storybook `play` function for any role
   with hover/focus/press semantics. Exercise keyboard interactions in
   `play` so the story doubles as an a11y smoke test.

Every story has `tags: ['autodocs']` where appropriate so Storybook's
Autodocs picks it up. The `@storybook/addon-a11y` panel must be clean for
Default and every variant.

### AI-slop blacklist

Stories for this library are reviewer- and designer-facing. They must not
fall back to generic AI-generated layouts. Instant-fail patterns in stories:

- Generic 3-column card grids.
- Centred-everything hero layout (max-width 600, centred, oversized
  headline).
- Decorative icon-in-coloured-circle rows used as list markers.
- Purple/indigo gradient backgrounds.

If a story needs a background because the component is transparent, use
`@ux/box` with an intent-aware background at the correct contrast level.

## Stories are examples, not tests

Story files must not assert behaviour via `expect`. They demonstrate
usage; Vitest asserts behaviour. If a scenario is worth asserting,
write a matching Vitest test (see [`TESTING.md`](./TESTING.md)).

## Copy, voice, and tone

Every user-visible string in this repo — README narrative, Storybook
story labels, example JSX text, JSDoc `@example` blocks, and any
prop-documentation that prescribes wording — must follow the GoDaddy
UX Content Design Playbook. Consumers can set their own rules in their
app, but the copy we publish here is what the MCP codex and Storybook
teach every downstream team about how to use these primitives, so it
has to read as on-brand GoDaddy product copy.

The canonical source is the `ux-content-guidelines` skill at
[`../../ux-content-guidelines/SKILL.md`](../../ux-content-guidelines/SKILL.md).
Load it whenever a PR adds or changes copy in any of those surfaces,
or when a prop's JSDoc tells callers what shape their strings should
take (e.g. "sentence case, action-oriented, one verb where possible").
See also ["Product strings and i18n"](./BUSINESS-LOGIC.md#product-strings-and-i18n)
for why no product copy lives inside the component itself.

## Review red flags

- New component, no `README.md` — Critical.
- New component, no stories — Critical.
- New component `README.md` missing `## When to use`, `## When not to use`,
  `## Accessibility`, or `## Gotchas` — Important (Critical if two or more
  missing).
- Prop added to TSX, `README.md` untouched — Critical.
- Hand-maintained prop table in `README.md` duplicating what ts-morph
  extracts — Minor (ask to delete).
- Docs organised "one H2 per prop name" — Minor (ask to reorganise by
  feature/variant).
- Story uses `expect(…)` — Important (move to a Vitest test).
- AI-slop visual pattern in stories — Important.
- Fenced code block in `README.md` without an `import` line — Minor.
- Copy in README, stories, `@example` blocks, or prescriptive prop
  JSDoc that contradicts the
  [`ux-content-guidelines`](../../ux-content-guidelines/SKILL.md)
  skill — Important (Critical if it ships a brand-voice regression
  such as exclamation-heavy CTAs, title-case headings, emoji in
  example copy, or "click here" links).
