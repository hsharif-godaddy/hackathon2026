# ColorSwatch

A single solid-color circle, icon-equivalent in size and usage. Accepts any valid CSS
color string alongside an optional human-readable name for labelling and tooltips.

```tsx
import { ColorSwatch } from '@airo-ux/pattern-library/primitives/color-swatch';
import '@airo-ux/pattern-library/primitives/color-swatch/styles';

<ColorSwatch color={{ color: '#E03B2F', name: 'Cayenne' }} />
```

## When to use

- Represent a brand color in a chat response, card, or alongside a label.
- Display a color selection anywhere an icon would be used — inline in text, inside a
  button, inside a list item, or beside a heading.
- Compose into `ColorSwatchGroup` when displaying a palette.

## When not to use

- As a standalone interactive element. The swatch is display-only. For click
  interactions, wrap it in a `<button>` or `@ux/card` — the swatch itself should never
  be the actionable element.
- For gradients, patterns, or multi-color fills. Only solid CSS colors are supported.

## Accessibility

`ColorSwatch` renders as `role="img"`. The accessible name resolves in this priority:

1. Explicit `aria-label` prop
2. `color.name` (if provided)
3. Raw `color.color` string (e.g. `"#E03B2F"`) as a last resort

When `color.name` is provided, a native `title` attribute defaults to that name, giving
sighted users a tooltip on hover. Pass an explicit `title` prop to override or suppress
the tooltip (`title=""` for no tooltip).

## Gotchas

- Always import the styles subpath: `import '@airo-ux/pattern-library/primitives/color-swatch/styles'`.
- `background-color` (inner disk), `width`, and `height` are applied as inline styles —
  this is intentional. The fill color and size are arbitrary at runtime and cannot be
  design tokens.
- The outer frame uses the surface background token (`ux.box.backgroundColor`) with
  padding derived from `ux.box.density` (`calc(intent('ux.box.density') * 0.25)` in CSS)
  so the disk stays visible against matching fills — implemented as a padded circle
  rather than an inset shadow for cleaner anti-aliasing.
- `flex-shrink: 0` is applied automatically so the swatch does not squash in flex
  containers.
