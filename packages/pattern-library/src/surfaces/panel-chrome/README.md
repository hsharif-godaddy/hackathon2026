# PanelChrome

The shared inner UI for every Airo surface — `Panel`, `FloatingPanel`,
`FullscreenDialog` (and any future surface that hosts the same content
shape). Owns the header band, scrollable content region, sticky footer
slide animation, focus management, and the `dialog` / `complementary`
landmark semantics.

```tsx
import { PanelChrome } from '@airo-ux/pattern-library/surfaces/panel-chrome';
import '@airo-ux/pattern-library/surfaces/panel-chrome/styles';

<PanelChrome title="Settings" onClose={handleClose}>
  <Box inlinePadding="lg" blockPadding="md">
    <p>Body content</p>
  </Box>
</PanelChrome>
```

## When to use

- **As a surface author** — composing a new `@airo-ux/pattern-library` surface
  (a sheet, an inline rail, a modal stack, anything that carries
  conversational content). `PanelChrome` gives every surface the same
  header / content / footer contract for free, and consumers learn the
  prop API once.
- **As a consumer** — almost never directly. Reach for one of the
  surfaces (`Panel`, `FloatingPanel`, `FullscreenDialog`) instead. The
  surfaces add the host strategy (Disrupt portal, plain portal, edge
  positioning, draggable window, …) and the outer animation that
  `PanelChrome` deliberately leaves out.

## When not to use

- A centered dialog without a slide-in animation — use
  `@airo-ux/pattern-library/surfaces/fullscreen-dialog` (or `@ux/modal` directly
  for plain confirmation dialogs).
- An edge-attached drawer — use `@airo-ux/pattern-library/surfaces/panel`.
- A draggable, resizable, non-modal window — use
  `@airo-ux/pattern-library/surfaces/floating-panel`.

## Composition

`PanelChrome` is a presentational primitive. It does not render a
portal, scrim, focus lock, or any positioning of its own. Its outer
`<div role="…">` carries `tabIndex={-1}` so it can receive focus on
mount, plus the `className` you forward and any `data-*` attributes
spread onto the root.

A surface composes the chrome by:

1. Mounting it inside whatever host fits the surface (Disrupt portal,
   plain portal, fixed-position div, …).
2. Forwarding its own positioning class via `className` so the surface's
   stylesheet drives geometry and animation. Multiple class names are
   composed cleanly — e.g. `Panel` adds
   `airo-surfaces-panel__panel airo-surfaces-panel__panel--open`
   without disturbing the chrome's own `airo-surfaces-panel-chrome`
   root class.
3. Choosing a value for `modal`. `true` switches the chrome to
   `role="dialog"` + `aria-modal="true"` and disables the
   chrome's own Escape handler / focus-restore (the surface's modal
   host owns those). `false` switches to `role="complementary"` and
   the chrome handles Escape + focus-restore itself.

```tsx
// Sketch of how `Panel` composes `PanelChrome`
function Panel({ show, onClose, title, children, ...rest }) {
  if (!show) return null;
  return (
    <Disrupt onClose={onClose}>
      <Scrim onClick={onClose} />
      <PanelChrome
        {...rest}
        className="airo-surfaces-panel__panel airo-surfaces-panel__panel--open"
        title={title}
        onClose={onClose}
        modal={true}
      >
        {children}
      </PanelChrome>
    </Disrupt>
  );
}
```

## Header

The default header pairs a `@ux/text-lockup` of `title` with a
`@ux/corner-actions` block containing **expand** and **close** buttons.
Use the `cornerActions` prop to swap the action set without losing the
title layout, or pass a `header` ReactNode to replace the entire band.
Pass `header={null}` to omit the header band entirely.

For a branded variant with the Airo wordmark + a `@godaddy/antares`
`SegmentedController`, pass `<AiroHeader />` (also exported from this
subpath) as the `header` slot. See [the `AiroHeader` section](#airoheader)
below.

### `headerChrome`

- **`default`** (default) — frosted-glass band: 60% `box.backgroundColor`
  + `backdrop-filter: blur(...)` + a subtle drop shadow.
- **`ghost`** — transparent band, no backdrop blur, no shadow. Useful
  when the panel sits inside a layout that already supplies a
  full-width app header (e.g. a docked chat panel below a builder
  app bar) — only the drag-handle pill stays visible in the panel's
  header area.

```tsx
<PanelChrome
  headerChrome="ghost"
  header={<></>}            // empty fragment keeps the drag-handle slot rendered
  dragHandle
  title="My panel"
  onClose={onClose}
>
  Body content
</PanelChrome>
```

## Sticky / hide-on-scroll

By default the header is sticky at the chrome's leading block edge and
hides on scroll-down / reveals on scroll-up — the same pattern mobile
apps use to maximize reading area. The hide threshold is 24px of scroll
travel and 4px of scroll-delta sensitivity, both rAF-throttled. Disable
the behavior with `stickyHeader={false}` and the header pins
permanently.

## Footer

The footer is a normal in-flow flex child below the scrollable content
region. When `footer` is nullish, no footer DOM is rendered. When
`footer` is a node, the region mounts and `hideFooter` toggles a
height-collapse animation (`grid-template-rows: 1fr → 0fr`) — the DOM
stays mounted while hidden so input state survives the toggle.

### `footerChrome`

- **`default`** (default) — solid footer background, top-edge `box-shadow`
  (via `--airo-surfaces-panel-chrome-footer-shadow`), and an inner `@ux/box`
  with `blockPadding="sm"` and `inlinePadding="lg"` wrapping `footer`.
- **`floating`** — **transparent** footer band, **no** footer shadow, **no**
  top padding on the inner gutter; **inline** inset uses
  `calc(intent('ux.box.density') * 3)` (**`lg`**) and **block-end** uses
  `calc(intent('ux.box.density') * 2)` (**`md`**). Use when `footer` is a
  **`FloatingFooter`** wrapping a borderless **`PromptBox`** (or any child that
  brings its own surface depth) so the capsule is not double-padded or
  double-shadowed by the chrome rail.

See Storybook **Surfaces / PanelChrome → Floating footer chrome**.

## Frosted-glass header

The header band is absolutely positioned on top of the content area and
uses a `backdrop-filter` blur with a semi-transparent fill. This lets
the scrollable body flow visually behind it while maintaining
legibility. `padding-block-start` on the content is set to the header's
natural (fully-expanded) height via `--airo-pchr-header-h` and held
there even while the header is hidden — so `scrollHeight` never shrinks
and `scrollTop` is never clamped during the hide/show animation.

The footer has a solid background (unless `footerChrome="floating"`) and its
height is accounted for by the flex layout — no JS measurement or CSS custom
property coordination needed.

Both the header and footer ship with a default `box-shadow` via CSS custom
properties **when `footerChrome` is `default`**. Shadow colors are black with
alpha (not theme foreground). Override or suppress per-instance:

| Custom property | Applied to | Default |
|---|---|---|
| `--airo-surfaces-panel-chrome-header-shadow` | Header band | `0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 0 rgba(0, 0, 0, 0.05)` |
| `--airo-surfaces-panel-chrome-footer-shadow` | Footer band | `0 -2px 8px rgba(0, 0, 0, 0.08), 0 -1px 0 rgba(0, 0, 0, 0.05)` |

```css
/* Suppress the shadow on a specific instance */
.my-panel {
  --airo-surfaces-panel-chrome-header-shadow: none;
  --airo-surfaces-panel-chrome-footer-shadow: none;
}
```

## Smart auto-scroll

Pass `autoScroll="smart-bottom"` to keep the content area pinned to the
bottom as new content arrives — typical for streaming responses and
live-updating chat surfaces:

```tsx
<PanelChrome
  aria-label="Chat"
  onClose={onClose}
  autoScroll="smart-bottom"
  footer={<PromptBox … />}
>
  {messages}
</PanelChrome>
```

**Behavior**

- On every DOM mutation (child insertion or text-node update) the
  content area scrolls instantly to its bottom if auto-scroll is
  currently engaged.
- Scrolling up disengages auto-scroll. The scroll position is left
  exactly where the user left it.
- Scrolling back to within `autoScrollThreshold` px of the bottom
  (default `144`) re-engages it.

The threshold is deliberately generous — small accidental touches or
keyboard scrolls that land near the bottom re-engage automatically,
while a deliberate scroll to read earlier content stays stable.



The default corner actions include an expand toggle. The chrome owns
the expanded state for the **icon** on the toggle button, but it does
**not** style anything based on `expanded` — it leaves all visual
expansion semantics to the surface (e.g. `Panel` swaps width to 100%).
Surfaces that don't want an expand button should pass a custom
`cornerActions` node (or `null`).

Controlled (`expanded` + `onExpandedChange`) and uncontrolled
(`defaultExpanded`) parity is provided.

## Accessible name

The chrome renders as `role="dialog"` (when `modal`) or
`role="complementary"` (non-modal). Both landmarks need an accessible
name. The prop type enforces this with a discriminated union: at least
one of `title: string`, `aria-label: string`, or `aria-labelledby:
string` must be passed. In development a `console.warn` fires if none
of the three resolve at runtime — useful when `title` is a non-string
ReactNode (e.g. a logo) and the consumer forgets to add `aria-label`.

## AiroHeader

The same subpath also exports `AiroHeader`, the alternate header
variant for Airo-branded surfaces. It replaces the title text-lockup
with the Airo wordmark + Beta tag, and adds a `@godaddy/antares`
`SegmentedController` row underneath for section-switching.

```tsx
import { PanelChrome, AiroHeader } from '@airo-ux/pattern-library/surfaces/panel-chrome';

<PanelChrome
  aria-label="Airo"
  onClose={onClose}
  header={
    <AiroHeader
      tabs={[
        { id: 'chat', label: 'Chat' },
        { id: 'activity', label: 'Activity' },
      ]}
      activeTabId={activeTab}
      onTabChange={setActiveTab}
      onClose={onClose}
      onExpandedToggle={() => setExpanded((v) => !v)}
      expanded={expanded}
    />
  }
>
  {/* content for the active tab */}
</PanelChrome>
```

For back-compat, `AiroHeader` is also reachable as `Panel.AiroHeader`
and via `import { AiroHeader } from '@airo-ux/pattern-library/surfaces/panel'`.
New code should prefer the `panel-chrome` subpath.

### `showSections` — hide the tabs/action row

Pass `showSections={false}` when you want the header to render the
wordmark + corner buttons **without** the `SegmentedController` row.
This is the correct prop to set when a surface expands to fullscreen
and the tab/action row is delegated to a `ChatLayout` header slot
instead:

```tsx
// Non-fullscreen: sections row lives in the surface header.
<AiroHeader tabs={TABS} showSections onClose={onClose} />

// Fullscreen: hand the row off to ChatLayout.
<AiroHeader tabs={TABS} showSections={false} onClose={onClose} />
<ChatLayout
  header={
    <AiroHeader.Sections
      tabs={TABS}
      activeTabId={activeTab}
      onTabChange={setActiveTab}
    />
  }
>…</ChatLayout>
```

`showSections` defaults to `true`, so existing code is unaffected.

### `AiroHeader.Sections` — standalone sections row

`AiroHeader.Sections` (also exported directly as `AiroHeaderSections`)
renders only the `SegmentedController` + optional action button row,
without the wordmark or corner buttons. It is designed for use inside
`ChatLayout`'s `header` slot so the tab row can be constrained to the
chat column width rather than the full surface width.

```tsx
import { AiroHeader } from '@airo-ux/pattern-library/surfaces/panel-chrome';

<ChatLayout
  header={
    <AiroHeader.Sections
      tabs={TABS}
      activeTabId={activeTab}
      onTabChange={setActiveTab}
      onActionClick={() => startNewChat()}
      actionLabel="New conversation"
    />
  }
>
  {/* message thread */}
</ChatLayout>
```

The action button is absolutely positioned at the inline-start edge so
the `SegmentedController` is always geometrically centered regardless of
how wide the action button is.

## Accessibility

- Root carries `role="dialog"` (`modal`) or `role="complementary"`
  (non-modal), plus `aria-modal="true"` in the modal case.
- Default close and expand buttons are real `<button>`s with the
  `closeLabel`, `expandLabel`, and `collapseLabel` strings as their
  accessible names.
- The scrollable content region is keyboard-focusable (`tabIndex={0}`)
  so keyboard-only users can scroll it with arrow keys and PageUp/Down.
- Escape closes the chrome in non-modal mode (`modal={false}`); modal
  surfaces wire Escape through their own host.
- `prefers-reduced-motion` disables the header collapse and footer
  height-collapse transitions. State changes happen instantly instead.

### Keyboard model

| Key | Behavior |
| --- | --- |
| `Tab` / `Shift+Tab` | Moves focus through interactive controls in DOM order. |
| `Arrow` / `PageUp` / `PageDown` | When the scrollable content region is focused, scrolls its contents. |
| `Escape` | Closes the chrome in non-modal mode (`modal={false}` or `modal="non-modal-dialog"`). In modal mode (`modal={true}`) the host surface (e.g. `@ux/disrupt`) owns and wires Escape. |

## Gotchas

- `autoScroll="smart-bottom"` observes both child mutations and `characterData`
  mutations so streaming text nodes trigger a scroll. The scroll is applied
  instantly (not smoothly) to keep `scrollTop` accurate during rapid updates —
  smooth scrolling causes the reported position to lag, which would trigger
  false disengages.
- The frosted-glass effect uses `color-mix(in srgb, …, transparent)` for the
  semi-transparent fills. Browsers that predate `color-mix()` support (Chrome <
  111, Firefox < 113, Safari < 15.4) receive an opaque fallback fill instead of
  the blended one. The `backdrop-filter` blur similarly degrades gracefully
  where unsupported.

- When using `PanelChrome` directly, import the chrome stylesheet explicitly:
  ```ts
  import '@airo-ux/pattern-library/surfaces/panel-chrome/styles';
  ```
  For **`Panel`** consumers, `@airo-ux/pattern-library/surfaces/panel/styles`
  already bundles the chrome styles via `@import` — importing both is
  redundant and will duplicate the chrome CSS in your bundle. Other
  surfaces (`FloatingPanel`, `FullscreenDialog`) each import their own
  stylesheet and require the chrome stylesheet separately.
- The chrome does not render any portal, scrim, or focus trap. Surfaces
  must wire those externally (e.g. `Panel` mounts under `@ux/disrupt`
  for the modal case).
- `modal` is a behavior switch, not a styling switch. The chrome will
  not lock focus when `modal={true}` — it expects an external focus
  lock to be in effect.
- BEM prefix is `airo-surfaces-panel-chrome__<part>`. The surface
  prefix (e.g. `airo-surfaces-panel__panel`) is independent — multiple
  classes layer cleanly on the same root element through the
  `className` prop.
- `AiroHeader` depends on `@godaddy/antares` (for `SegmentedController`).
  Importing `AiroHeader` (or `PanelChrome` from this subpath when the
  consumer doesn't tree-shake) pulls antares into the bundle. Antares
  is declared as an **optional** peer dependency, so the consumer must
  install it explicitly when using `AiroHeader`.

## Related

- [`@airo-ux/pattern-library/surfaces/panel`](../panel/README.md) — edge-attached
  overlay surface that composes this chrome.
- [`@ux/disrupt`](https://github.com/gdcorp-uxp/uxcore2/tree/main/packages/components/disrupt) —
  the scrim / focus-lock / portal primitive that modal surfaces compose on.
- [`@ux/corner-actions`](https://github.com/gdcorp-uxp/uxcore2/tree/main/packages/components/corner-actions) —
  positioning for close / expand buttons.
