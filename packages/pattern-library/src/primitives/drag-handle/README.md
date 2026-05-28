# DragHandle

A purely decorative affordance pill that signals "this surface is
draggable / resizable". Standalone — interactive labels and event
handlers belong on the wrapping container; the pill itself is always
`aria-hidden` and `pointer-events: none`.

```tsx
import { DragHandle } from '@airo-ux/pattern-library/primitives/drag-handle';
import '@airo-ux/pattern-library/primitives/drag-handle/styles';

// Wrap the handle in a real interactive element — a `<button>` is
// strongly preferred over `<div role="button" tabIndex={0}>` because
// it gets keyboard activation, focus rings, and disabled-state
// semantics for free, where the div replacement has to re-implement
// every one of those (and tends to break in subtle ways under
// assistive tech). Reach for the div pattern only when the surrounding
// surface absolutely cannot be a `<button>` (e.g. it already nests
// other interactive controls).
<button
  type="button"
  className="airo-primitives-drag-handle__parent"
  aria-label="Drag to reposition"
  onPointerDown={handlePointerDown}
>
  <DragHandle orientation="horizontal" />
</button>
```

## When to use

- As the visual cue inside an existing draggable header
  (`PanelChrome`, panel docking pill, etc.).
- As a vertical grip on a resize handle (e.g. the inner edge of a
  docked `FloatingPanel`).

## When not to use

- For a button or interactive control — wrap your own button
  primitive instead. `DragHandle` carries no semantics.
- As a generic "icon" for a drag affordance in a composed control —
  reach for `@ux/icon` plus your own layout instead.

## Orientation

- `'horizontal'` (default) — wide pill, used inside header bands.
- `'vertical'` — tall narrow grip, used on inner edges of resizable
  containers (left/right of a docked panel, etc.).

The two variants share the same color, opacity, and hover behavior
— only the dimensions differ. Sizing is driven by the
`ux.box.density` intent token so the pill scales with theme density.

## Hover trigger

Opacity is `0.4` at rest and transitions to `1.0` when the parent
element matching `.airo-primitives-drag-handle__parent` is hovered. The
parent can also implement its own hover rule targeting the pill if a
different trigger is preferred (e.g. a focus-within trigger on a
keyboard-active resize handle).

## Accessibility

- The pill is always `aria-hidden="true"` and `pointer-events: none`.
- Wrap the pill with the interactive element that owns the gesture
  (drag, resize, etc.). Put `aria-label`, `tabIndex`, and key handlers
  on that wrapper, never on the pill.

## Gotchas

- **Style import is required.** Pair the component import with
  `import '@airo-ux/pattern-library/primitives/drag-handle/styles';` —
  without it the pill renders as an unstyled inline div.
- **Doesn't capture pointer events.** `pointer-events: none` is on
  by design so the pill never intercepts a click on the wrapping
  element. Don't try to attach handlers directly to the pill.
- **Hover trigger needs the parent class.** If the wrapping element
  doesn't carry `.airo-primitives-drag-handle__parent` (or its own
  hover rule), the pill stays at `0.4` opacity forever.
