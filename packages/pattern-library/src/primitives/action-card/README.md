# ActionCard

A tile that stacks an icon over a title, bound to the `actionControl` intent
family. It is the quick-action card used by `CommandPalette` (Attach / Screenshot /
Reference a file), and is general enough for any action grid or empty-state CTA.

Renders a real `<button>` and forwards every native button attribute
(`onClick`, `disabled`, `type`, `aria-*`, `data-*`, `id`, `role`, ref), so it
is keyboard- and screen-reader-operable with no extra wiring.

```tsx
import { ActionCard } from '@airo-ux/pattern-library/primitives/action-card';
import '@airo-ux/pattern-library/primitives/action-card/styles';
import AsyncIcon from '@ux/icon/async-icon.js';

<ActionCard icon={<AsyncIcon icon="attachment" />} title="Attach" onClick={attach} />;
```

## When to use

- A compact, icon-led action presented as a tile rather than a text row.
- A row or grid of equal-weight quick actions (set the width on the container;
  the card stretches to fill it).
- Inside a higher-level component that needs a uniform action tile — e.g.
  `CommandPalette.Card` renders an `ActionCard` with option semantics layered on.

## When not to use

- A text-first menu action with a leading icon → use a menu/option row
  (`ResponsiveMenu`, `CommandPalette.Item`).
- A persistent toggle/selected state → `ActionCard` is a stateless trigger;
  `active` is only a visual highlight, not a checked state.
- A link/navigation target → `ActionCard` renders a `<button>`; wrap or use a
  link-aware component if you need an `<a>`.

## Accessibility

- The icon is decorative (`aria-hidden`); the **title is the accessible name**,
  so always pass a meaningful `title`.
- `active` is a visual-only highlight and intentionally does **not** set
  `aria-selected` or move focus — the owning component decides the correct
  ARIA semantics (e.g. `CommandPalette.Card` adds `role="option"` +
  `aria-selected`).
- `:focus-visible` renders an inset ring via the `actionControlFocused` intent.

## Gotchas

- The card has no intrinsic width; it stretches to `100%` of its container.
  Constrain width on the parent (flex row, grid track, fixed-width wrapper).
- Default state uses the matched `actionControl` background + foreground pair;
  `:hover` and `--active` switch to the `actionControlHovered` pair. Don't
  restyle these by targeting `@ux/*` internals — pass `className` instead.
