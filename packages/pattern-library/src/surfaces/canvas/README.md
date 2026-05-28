# Canvas

A `<section>` surface that hosts AI-generated content (typically an HTML site preview, an artifact viewer, or an editor) alongside the chat panel. Owns three slots — `header` (toolbar), `children` (primary content), and `status` (a floating chip pinned top-center) — and provides a themed, rounded chrome with a scrollable content region.

Ships a compound `Canvas.Status` chip — a rounded themed pill with a small spinner and a label — for surfacing in-progress agent actions without blocking the underlying preview.

## When to use

- As the right-hand pane of a dual-pane chat layout: `ChatLayout` (sidebar mode) or `FloatingPanel` on the left, `Canvas` on the right.
- Anywhere the agent renders a discrete generated artifact that the user should be able to scroll, zoom, and interact with — distinct from the conversation thread itself.
- For chrome around an iframe-based site preview where you want the agent to be able to flag "I'm editing this" without rolling a full overlay.

## When not to use

- For inline message attachments inside the chat thread — those belong on `AgentMessage` or message-bubble children.
- As a fullscreen modal — use `FullscreenDialog`.
- As the chat panel itself — use `Panel`, `FloatingPanel`, or `PanelChrome`.
- As a hand-rolled status frame for non-canvas surfaces — `Canvas.Status` is generic enough to live anywhere on the page (just position it yourself), but the canvas-content frame is purpose-built for rendered artifacts.

## Scroll fade

When the canvas's content overflows, a soft gradient mask fades the content's top edge while the user is scrolled away from the start, and the bottom edge while they're scrolled away from the end. The mask is applied to an internal scroll wrapper, so:

- The `header` slot is **never** masked — it sits above the scroll wrapper as a sibling of the body.
- The `Canvas.Status` chip is **never** masked — it sits as a sibling of the scroll wrapper inside the body, so the mask paints over the scrolling content underneath without dimming the chip on top.

The fade distance defaults to `calc(intent('ux.box.density') * 14)` (**56px** at default density) and can be overridden by setting the `--airo-surfaces-canvas-fade-distance` custom property on the canvas root or any ancestor:

```tsx
<Canvas style={{ ['--airo-surfaces-canvas-fade-distance' as string]: '32px' }}>
  …
</Canvas>
```

Set `fadeOnScroll={false}` to turn the mask off — useful when the consumer wants a hard edge or when the canvas hosts content that already provides its own gradient affordance.

## Slots

```tsx
import { Canvas } from '@airo-ux/pattern-library/surfaces/canvas';
import '@airo-ux/pattern-library/surfaces/canvas/styles';

<Canvas
  aria-label="Site preview"
  header={<DeviceSwitcher value={device} onChange={setDevice} />}
  status={isEditing ? <Canvas.Status label="Editing…" /> : null}
>
  <iframe src={previewUrl} title="Site preview" />
</Canvas>
```

- **`children`** — primary content. Rendered inside an inner scroll container (`overflow: auto`); an oversized child fills the remaining space without escaping the canvas chrome. The body wrapping it is the positioning context for the status slot.
- **`header`** — toolbar above the content area. Has its own divider and small padding; pass any node.
- **`status`** — floating chip anchored top-center over the content area. Typically `<Canvas.Status label="…" />`. The slot is `pointer-events: none` so the canvas content underneath stays clickable; the chip itself re-enables pointer events.

## Canvas.Status

```tsx
<Canvas.Status label="Editing…" />
```

A `role="status"` live region styled as a rounded themed pill with a small spinner-variant `ThinkingIndicator` and a label. Screen readers announce label changes politely as the status transitions through phases.

`Canvas.Status` renders no positioning of its own — when used inside `Canvas`'s `status` slot the canvas anchors it; when used outside, the consumer is responsible for positioning (see the standalone example in `Canvas.Status`'s JSDoc).

## Accessibility

- The root element is a semantic `<section>`. Pass `aria-label` (or `aria-labelledby`) to give it an accessible name when it functions as a landmark region. Without an accessible name a `<section>` is treated as generic — that is fine if Canvas is just a styled frame; provide a name when consumers should be able to navigate to it as a region.
- `Canvas.Status` is a `role="status"` live region. Its visible label doubles as the accessible name in the common case (string label). Pass `aria-label` explicitly when `label` is a non-string node.
- The inner spinner is `aria-hidden`, so the announced text is exactly the visible label and never doubles up.
- `prefers-reduced-motion` is respected by the inner spinner — see the `ThinkingIndicator` README.

## Corner radius

Canvas defaults to a `calc(intent('ux.box.density') * 2)` card-corner radius (**16px** under `godaddy-antares` / **8px** with bare intents; `--airo-surfaces-canvas-corner-radius`), exposed as a custom property so consumers can override per surface without touching the BEM root:

```tsx
<Canvas style={{ ['--airo-surfaces-canvas-corner-radius' as string]: '8px' }}>
  …
</Canvas>
```

When the canvas's bottom edge touches the viewport bottom (detected on every scroll/resize via `getBoundingClientRect`), the trailing-block corners flatten to 0 — the canvas reads as flush with the viewport floor instead of a card hovering above it. Top corners always keep their radius. The detection uses logical CSS properties (`border-end-start-radius` / `border-end-end-radius`), so the right corner flattens correctly under both LTR and RTL writing modes.

## Gotchas

- The component does **not** import its own styles — consumers must import `@airo-ux/pattern-library/surfaces/canvas/styles` once at their app root or alongside the component usage.
- `Canvas` does not render a portal. The `status` node is a child of the canvas DOM. Consumers who need viewport-anchored or fullscreen-overlaying status chrome should mount `<Canvas.Status />` themselves outside the canvas tree.
- Very tall content scrolls inside the canvas instead of expanding the whole page — `overflow: auto` is on the inner `__scroll` wrapper, not the body (which is a positioning context for the status slot). Set an explicit canvas `block-size` on the parent if the canvas itself should be fixed-height; `Canvas` sizes to its container.
- The canvas border + corner radius come from the `ux.box.*` intent tokens. To present an "edge-to-edge" canvas without chrome, pass a `className` that overrides the border and radius (or wrap your content in your own surface).
