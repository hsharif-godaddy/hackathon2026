# FloatingPanel

A draggable, resizable, viewport-constrained chat window. Non-modal by
default — it renders `role="dialog"` with `aria-modal="false"` so
assistive technologies treat it as a non-modal overlay that coexists
with the rest of the page.

Drag it near the **left or right viewport edge** to snap it into a fixed
non-modal side panel, or over a `FloatingPanel.DropZone` to dock it as an
in-page sidebar in the normal DOM flow.

```tsx
import { FloatingPanel } from '@airo-ux/pattern-library/surfaces/floating-panel';
import '@airo-ux/pattern-library/surfaces/floating-panel/styles';
import '@airo-ux/pattern-library/surfaces/panel-chrome/styles';

<FloatingPanel
  defaultShow
  title="Airo"
  onClose={() => setShow(false)}
  footer={<Composer />}
>
  <Messages />
</FloatingPanel>
```

## When to use

- The team is **A/B testing** or **feature-flagging** a detachable chat
  window alongside the existing `Panel` edge-drawer. Swap surfaces at the
  import level — the `children`, `footer`, and `header` props are the same
  contract.
- The user needs to **see the page behind** the chat while it is open (the
  panel floats above content, non-blocking).
- The user wants to **reposition** or **resize** the chat to a comfortable
  corner.
- The page has a **designated sidebar slot** where the panel can live as an
  in-page companion (see [DropZone](#dropzone-in-page-sidebar)).

## When not to use

- A permanently edge-attached side panel — use `@airo-ux/pattern-library/surfaces/panel`.
- A centered, full-viewport dialog — use
  `@airo-ux/pattern-library/surfaces/fullscreen-dialog`.
- A non-interactive notification or tooltip — the overhead of drag+resize is
  not justified.

## Composition

`FloatingPanel` composes:

- `react-rnd` for drag (mouse + touch) and resize. The chrome's header is
  the drag handle; all eight resize handles are enabled.
- `PanelChrome` for the inner UI (header band, scrollable content, sticky
  footer). Escape-to-close and focus-restore run inside the chrome because
  `modal={false}`.
- A React portal to `document.body` (no scrim, no focus trap).

## Snap-to-dock

Dragging the panel within `snapThreshold` px (default `80`) of either
viewport edge or over a registered `FloatingPanel.DropZone` triggers a snap
preview. Releasing the drag locks the panel into the target:

| Drag target | Docked mode | Rendering |
|---|---|---|
| Left viewport edge | `'left'` | `position: fixed; left: 0; height: 100vh` |
| Right viewport edge | `'right'` | `position: fixed; right: 0; height: 100vh` |
| `FloatingPanel.DropZone` | `HTMLElement` | Portaled into the zone element (in DOM flow) |

**Priority**: drop zone overlap beats edge proximity.

Once docked, the drag-handle pill becomes the drag-to-undock target, and the
corner actions show **Expand**, **Undock**, and **Close**. Clicking Undock
(or pressing Tab to reach it, then Enter/Space) returns the panel to floating
mode at its last floating position.

### Controlled docking

```tsx
const [dockedTo, setDockedTo] = useState<FloatingPanelDockedTo>(null);

<FloatingPanel
  show
  dockedTo={dockedTo}
  onDock={setDockedTo}
  onUndock={() => setDockedTo(null)}
  title="Airo"
  onClose={() => setShow(false)}
>
  <Messages />
</FloatingPanel>
```

### Disable viewport-edge snapping

Set `snapToEdges={false}` (default `true`) to skip the left / right
viewport-edge snap targets. The panel will still dock into registered
`FloatingPanel.DropZone`s — useful for layouts where the only valid
docked positions are explicit drop zones inside the page layout.

```tsx
<FloatingPanel
  snapToEdges={false}
  dropZones={[sidebarRef]}
  title="Notes"
  onClose={() => setOpen(false)}
>
  Body content
</FloatingPanel>
```

### Header chrome variants

`headerChrome` (forwarded to `PanelChrome`) controls the header band's
treatment:

- `'default'` — frosted-glass band with `box.backgroundColor`, backdrop
  blur, and a subtle drop shadow.
- `'ghost'` — transparent band, no shadow, no backdrop blur. Useful
  when the panel is docked into a page layout that already provides a
  full-width app header — only the drag-handle pill remains visible
  in the panel's header area.

## DropZone — in-page sidebar

Place `FloatingPanel.DropZone` inside your page layout wherever you want
the panel to be able to dock as a sidebar within the page flow. Pass a
`ref` to the zone and supply it to `FloatingPanel` via `dropZones`.

The zone **collapses to zero width** when no panel is docked there, so it
takes no space in the layout until it's needed. It expands automatically in
two situations:

- **While dragging** — as the user drags the panel near the zone, it expands
  to preview where the panel will land (the `--active` state).
- **While docked** — once the panel snaps in, the zone holds its full width
  for as long as the panel is docked (the `--docked` state).

Set the target width via the `--airo-fp-drop-zone-width` CSS custom property
(defaults to `320px`):

```tsx
import { FloatingPanel } from '@airo-ux/pattern-library/surfaces/floating-panel';

const sidebarRef = useRef<HTMLDivElement>(null);

// In your page layout:
<div style={{ display: 'flex', height: '100vh' }}>
  <main style={{ flex: 1 }}>Page content</main>
  <FloatingPanel.DropZone
    ref={sidebarRef}
    style={{ '--airo-fp-drop-zone-width': '360px' }}
  />
</div>

// The FloatingPanel anywhere in the tree:
<FloatingPanel
  show={show}
  onClose={() => setShow(false)}
  dropZones={[sidebarRef]}
  title="Airo"
>
  <Messages />
</FloatingPanel>
```

When the panel docks into the zone it portals directly into that DOM node —
no `position: fixed`, no scrim. The zone's CSS controls the sidebar width;
the panel fills it with `width: 100%; height: 100%`.

### Optional zone divider — `borderSides`

Pass `borderSides` on `FloatingPanel.DropZone` to render a 1 px divider
on one or more **logical** sides (`'block-start'` | `'block-end'` |
`'inline-start'` | `'inline-end'`). Logical sides keep the divider on
the visually-correct edge under both LTR and RTL writing modes — no
consumer special-casing required.

```tsx
// Leading-positioned (left in LTR, right in RTL) sidebar with an inner divider
<FloatingPanel.DropZone ref={sidebarRef} borderSides="inline-end" />

// Multiple sides at once
<FloatingPanel.DropZone ref={zoneRef} borderSides={['block-start', 'inline-end']} />
```

The divider is only painted while the zone is expanded (drag-active or
panel-docked) — it collapses to nothing when the zone has zero width.

A full composed chat (Airo header, `ChatLayout`, `ChoiceList`, floating
`footerChrome` + `FloatingFooter` + borderless `PromptBox`) that **starts docked**
and can be **dragged off** the zone lives in Storybook as **Examples / Floating
Chat Panel → Split workspace (docked, floating composer)**. That story also shows
a **viewport-tall (`100vh`) `position: sticky` drop zone** beside a scrolling main
column so the docked assistant stays visible.

**Best practice**: prefer a `DropZone` over edge-snap on wide viewports so
the panel sits in the page flow alongside content rather than overlapping it.
If the page hasn't registered a drop zone, edge snapping falls back to the
fixed side-panel behavior automatically.

## Smart auto-scroll

Pass `autoScroll="smart-bottom"` to keep the content area pinned to the
bottom as new content arrives. Identical semantics to `Panel` — disengages
on scroll-up, re-engages when the user scrolls back within
`autoScrollThreshold` px (default `144`) of the bottom.

```tsx
<FloatingPanel
  defaultShow
  title="Airo"
  onClose={() => setShow(false)}
  footer={<Composer />}
  autoScroll="smart-bottom"
>
  <StreamingMessages />
</FloatingPanel>
```

See [PanelChrome — Smart auto-scroll](../panel-chrome/README.md#smart-auto-scroll)
for the full behavior contract.

## Docked-panel resize

When the panel is snapped to a viewport edge (`dockedTo="left"` or
`dockedTo="right"`) or docked into a `FloatingPanel.DropZone`, a resize
handle appears on the panel's inner edge. Dragging it updates `style.width`
on the panel root (tracked via the internal `currentSize` state), which
also drives the `width` prop forwarded to `react-rnd` when the panel
returns to floating mode. While docked into a DropZone, the resize handle
also live-syncs the zone's `--airo-fp-drop-zone-width` custom property so
adjacent canvas content reflows in real time.

Set `resizableWhenDocked={false}` (default `true`) to suppress the
resize handle and the live width sync. The panel still gets an initial
width assignment when it docks (otherwise a zone-docked panel would
render at 0 px wide), but the user has no built-in way to grow or
shrink it from there. To pin the panel at a specific width regardless
of how it was floating before docking, control `defaultSize.width` /
`size.width` from the consumer.

The handle carries `role="separator"` with `aria-orientation="vertical"`,
`aria-valuemin`, `aria-valuemax`, and `aria-valuenow` (the current width in
pixels). It is focusable (`tabIndex={0}`) and supports keyboard resizing.
The grow / shrink directions mirror the docked side so a right-docked
panel uses ArrowLeft to grow (separator pushed inward toward the canvas).

| Key | Left-docked | Right-docked |
|---|---|---|
| ArrowRight | Grow by 12 px | Shrink by 12 px |
| ArrowLeft | Shrink by 12 px | Grow by 12 px |
| Shift+Arrow | ±24 px | ±24 px |
| Home | Jump to minimum width | Jump to minimum width |
| End | Jump to maximum width (if finite) | Jump to maximum width (if finite) |

## Locked dock (no detach)

Set `lockedDocked={true}` to prevent the user from snapping the panel off
its dock. The drag-handle pill is suppressed and the drag-to-undock
pointer gesture is not wired, so a docked panel stays docked. Pair with a
single `dropZones` ref and a controlled `dockedTo` (always pointing at
that ref) to express a "fixed sidebar" layout — the chat panel becomes a
permanent fixture of the workspace rather than an opt-in floating tool.

`resizableWhenDocked` is unaffected by `lockedDocked`, so consumers can
offer width adjustment without offering detach. The prop has no effect
while floating; it only modifies docked behavior.

```tsx
import { FloatingPanel } from '@airo-ux/pattern-library/surfaces/floating-panel';
import '@airo-ux/pattern-library/surfaces/floating-panel/styles';
import { useLayoutEffect, useRef, useState } from 'react';

function Example() {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (sidebarRef.current) setDocked(sidebarRef.current);
  }, []);

  return (
    <>
      <FloatingPanel.DropZone ref={sidebarRef} />
      <FloatingPanel
        show
        dropZones={[sidebarRef]}
        dockedTo={docked}
        // No-op: the user cannot trigger an undock when lockedDocked is true.
        onUndock={() => {}}
        lockedDocked
        resizableWhenDocked
        aria-label="Airo"
      >
        <Messages />
      </FloatingPanel>
    </>
  );
}
```

## Expand to full screen

The **Expand** button (visible in the corner actions for both floating and
docked panels) stretches the panel to fill the full viewport — `position:
fixed; inset: 0`. While expanded the drag handle is hidden and the corner
actions show only **Collapse** and **Close**. Collapsing restores the panel to
the exact state it was in before expanding (floating at its previous position,
or docked to the same edge or drop zone). If the drop zone element was removed
from the DOM while the panel was expanded, the panel falls back to floating
mode.

```tsx
// Uncontrolled — panel starts open and can be expanded by the user
<FloatingPanel defaultShow title="Airo" onClose={() => setShow(false)}>
  <Messages />
</FloatingPanel>

// Controlled expanded state
const [expanded, setExpanded] = useState(false);

<FloatingPanel
  show
  title="Airo"
  onClose={() => setShow(false)}
  expanded={expanded}
  onExpandedChange={setExpanded}
>
  <Messages />
</FloatingPanel>
```

## Position and size

Controlled (`position` + `onPositionChange`) and uncontrolled
(`defaultPosition`) parity is provided. Same for `size` / `onSizeChange`
/ `defaultSize`.

```tsx
// Fully controlled
const [pos, setPos] = useState({ x: 24, y: 24 });
const [sz, setSz] = useState({ width: 384, height: 560 });

<FloatingPanel
  show={show}
  onClose={() => setShow(false)}
  position={pos}
  onPositionChange={setPos}
  size={sz}
  onSizeChange={setSz}
  title="Airo"
/>
```

Default position: `{ x: 24, y: 24 }`. Default size: `384 × 560 px`.

## Constraints

Use `minSize` and `maxSize` to limit the resize range. Use `bounds` to
constrain drag + resize:

- `'window'` (default) — stays inside the viewport.
- `'parent'` — stays inside the portal target.

## Keyboard support

When the header has focus:

| Key | Action |
|---|---|
| Arrow keys | Move the panel 8 px in the arrow direction |
| Shift + Arrow | Resize the panel 8 px in the arrow direction |
| Escape | Close the panel |
| Tab → Enter/Space on Undock button | Undock from edge or zone |
| Tab → Enter/Space on Expand button | Enter full-screen mode |
| Tab → Enter/Space on Collapse button | Exit full-screen mode |

## Accessible name

The chrome renders `role="dialog"`. Both AT landmarks and WCAG 2.1 §1.3.6
require a programmatic name. Satisfy it with one of:

- a string `title` (simplest),
- an explicit `aria-label`, or
- an `aria-labelledby` pointing at a heading in a custom `header`.

The TypeScript discriminated union on `FloatingPanelProps` enforces this at
compile time.

## Accessibility

- `role="dialog"` + `aria-modal="false"` — non-modal landmark semantics.
- Default close, expand, collapse, and undock buttons are real `<button>`
  elements with accessible labels (`closeLabel`, `expandLabel`,
  `collapseLabel`, `undockLabel`).
- Header has `cursor: grab` and `user-select: none` in floating mode to
  communicate drag affordance.
- Keyboard move and resize (Arrow + Shift+Arrow on the header) are
  implemented natively.
- Snap indicator and drop-zone highlight are `aria-hidden="true"`.
- `prefers-reduced-motion` disables all transitions and animations.

## Gotchas

- Import both stylesheets — the chrome stylesheet handles the inner UI
  (`@airo-ux/pattern-library/surfaces/panel-chrome/styles`), and this stylesheet
  handles the panel root, drag/resize affordances, and snap-to-dock styles.
- Expanding to full screen does not change the underlying dock or floating
  state. Collapsing always restores the previous mode. If you need the panel
  to stay full-screen permanently, consider
  `@airo-ux/pattern-library/surfaces/fullscreen-dialog` instead.
- `react-rnd` (and its `react-draggable` + `re-resizable` sub-deps) are
  CJS-only packages. They are listed in `.storybook/main.ts`
  `optimizeDeps.include` so Vite can interop them at dev-server time.
- `FloatingPanel.DropZone` collapses to `width: 0` when empty. The CSS
  custom property `--airo-fp-drop-zone-width` (default `320px`) controls the
  expanded width. Do **not** set a fixed `width` directly on the zone — it
  will fight the CSS transition.
- The drop zone and snap indicator use `color-mix(in srgb, ...)` for the
  preview fill. This degrades gracefully on older browsers (Chrome < 111,
  Firefox < 113, Safari < 15.4): the fill becomes transparent, but the dashed
  border still communicates the snap affordance clearly.

## Related

- [`@airo-ux/pattern-library/surfaces/panel`](../panel/README.md) — edge-attached
  modal/non-modal drawer that composes the same chrome.
- [`@airo-ux/pattern-library/surfaces/fullscreen-dialog`](../fullscreen-dialog/README.md)
  — full-viewport modal surface.
- [`@airo-ux/pattern-library/surfaces/panel-chrome`](../panel-chrome/README.md) —
  the shared inner UI (header, content, footer).
