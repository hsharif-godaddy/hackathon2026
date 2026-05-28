# ColorSwatchGroup

A horizontally stacked row of color swatches with ~33% overlap (negative margin of one-third the swatch size). Accepts an array of
`SwatchColor` values and handles layout, overlap, and truncation automatically.

```tsx
import { ColorSwatchGroup } from '@airo-ux/pattern-library/primitives/color-swatch-group';
import '@airo-ux/pattern-library/primitives/color-swatch-group/styles';
import '@airo-ux/pattern-library/primitives/color-swatch/styles';

<ColorSwatchGroup
  swatches={[
    { color: '#E03B2F', name: 'Cayenne' },
    { color: '#2F5FE0', name: 'Royal' },
  ]}
  aria-label="Brand palette"
/>
```

## When to use

- Display a set of AI-suggested brand colors inside a chat thread or response card.
- Show a color palette preview at a glance without listing each color individually.

## When not to use

- When individual swatches need independent click handling. Wrap each `ColorSwatch`
  separately in a `<button>` or `@ux/card` and lay them out yourself.
- When you need a single color. Use `ColorSwatch` directly.

## Accessibility

- `role="group"` on the root element.
- Provide an `aria-label` describing the group (e.g. `"Brand palette"`) in any context
  where the group is meaningful to assistive technology. Without it, no label is emitted.
- Each child swatch is individually labelled by its `name` or color string.
- The overflow chip uses `role="img"` with an accessible name from
  `getOverflowAriaLabel` when provided (only when the chip renders, with a **positive**
  hidden-count argument), or the default English phrase
  `` `${count} more colors` `` so it stays in the accessibility tree while the visible
  `+N` caption remains `aria-hidden`.

## Gotchas

### Truncation

When `swatches.length > max` (default `5`), the group renders `max − 1` swatches
followed by an overflow circle showing `+N`. The overflow circle uses `role="img"`.
Values of `max` less than 1 are treated as 1.

### Stacking and overlap

Later elements in the DOM paint on top of earlier ones — no z-index is used. The
rightmost visible swatch and the overflow circle sit on top. Each chip uses the same
**raised** drop-shadow stack as `@ux/box elevation="raised"` so layered disks read above
the surface. Overlap is ~33% of the swatch diameter, from `margin-inline-start: calc(var(--airo-swatch-size) / -3)`
(RTL-safe).

### Imports and types

- Import both style subpaths: the group styles AND the swatch styles.
  ```ts
  import '@airo-ux/pattern-library/primitives/color-swatch-group/styles';
  import '@airo-ux/pattern-library/primitives/color-swatch/styles';
  ```
- Import `SwatchColor` from `@airo-ux/pattern-library/primitives/color-swatch`, or from the root
  `@airo-ux/pattern-library` entry if you use the flat export surface. `SwatchColor` is not
  re-exported from `@airo-ux/pattern-library/primitives/color-swatch-group`.
- The `size` prop controls the diameter of every swatch and the overflow circle in the
  group. It also sets `--airo-swatch-size` as a CSS custom property on the root element,
  which drives the negative margin calculation.
