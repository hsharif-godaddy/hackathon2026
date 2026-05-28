# ChatLayout

Two-pane layout component for Airo chat surfaces. Sits inside `PanelChrome`'s content area and provides a smooth CSS-driven transition between:

- **Centered** — the chat column is capped at a comfortable reading width and centered in the surface. Used for open-ended chat.
- **Sidebar** — the chat column is pinned to the leading edge (left in LTR); the content pane fills the remaining space to the right with a secondary tool (editor, canvas, etc.).

```tsx
import { PanelChrome } from '@airo-ux/pattern-library/surfaces/panel-chrome';
import { ChatLayout } from '@airo-ux/pattern-library/chat/chat-layout';
import '@airo-ux/pattern-library/surfaces/panel-chrome/styles';
import '@airo-ux/pattern-library/chat/chat-layout/styles';

<PanelChrome aria-label="Airo" onClose={onClose}>
  <ChatLayout
    layout={hasEditor ? 'sidebar' : 'centered'}
    footer={<PromptBox />}
    content={hasEditor ? <WebsiteEditor /> : undefined}
  >
    {messages}
  </ChatLayout>
</PanelChrome>
```

## When to use

- Inside `PanelChrome` (or any full-height scroll container) when the chat surface can expand to fullscreen and may host a secondary tool alongside the conversation.
- When you need a consistent centered reading column that snaps to a sidebar on wider surfaces.

## When not to use

- In the narrow-panel view (where the panel is at its default `24rem` width) — at that size the layout is effectively full-width and `ChatLayout` is unnecessary overhead. Use `ChatLayout` only once the surface expands.
- As a direct replacement for `PanelChrome` — `ChatLayout` composes *inside* it, not instead of it.

## Layout modes

### Centered (default)

The chat column is capped at `--airo-chat-layout-chat-max-width` (default `44rem`) and centered. Equal gutters on both sides.

### Sidebar

The chat column is `--airo-chat-layout-chat-width` wide (default `24rem`) and pinned to the leading edge (left in LTR). The content pane fills all remaining space to the right.

### Controlled

Pass `layout` to control the mode externally. Pair with `onLayoutChange` if you need to observe future internal transitions (passive today — the component fires no internal layout changes):

```tsx
const [layout, setLayout] = useState<'centered' | 'sidebar'>('centered');

<ChatLayout layout={layout}>…</ChatLayout>
```

### Uncontrolled

Pass `defaultLayout` to set the initial mode without managing state:

```tsx
<ChatLayout defaultLayout="sidebar">…</ChatLayout>
```

## CSS variables

Override per-instance via inline style or a parent selector:

| Variable | Default | Purpose |
|---|---|---|
| `--airo-chat-layout-chat-width` | `24rem` | Chat column width in sidebar mode |
| `--airo-chat-layout-chat-max-width` | `44rem` | Max reading width in centered mode |
| `--airo-chat-layout-transition-duration` | `250ms` | Layout transition speed |
| `--airo-chat-layout-header-shadow` | `0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 0 rgba(0, 0, 0, 0.05)` | Drop shadow beneath the `header` sheet (black only). |
| `--airo-chat-layout-footer-shadow` | `0 -2px 8px rgba(0, 0, 0, 0.08), 0 -1px 0 rgba(0, 0, 0, 0.05)` | Drop shadow above the `footer` sheet (black only). |
| `--airo-chat-layout-header-backdrop-blur` | `12px` | Backdrop blur radius on the `header` sheet |

```tsx
<ChatLayout style={{ '--airo-chat-layout-chat-width': '28rem' } as React.CSSProperties}>
  …
</ChatLayout>
```

## Auto-scroll

Pass `autoScroll="smart-bottom"` to keep the message thread pinned to the bottom as content arrives — the same contract as `PanelChrome`'s `autoScroll` prop:

```tsx
<ChatLayout autoScroll="smart-bottom" footer={<PromptBox />}>
  {messages}
</ChatLayout>
```

Do **not** use `PanelChrome`'s `autoScroll` at the same time — `ChatLayout` takes over the scroll region.

## Content pane mounting

When `layout="centered"`, the leading column acts as a gutter — if you pass a `content` element it will remain visible in that space. Pass `content={undefined}` to omit the leading-pane content entirely (the typical case for centered mode).

The common pattern naturally handles this:
```tsx
content={hasEditor ? <WebsiteEditor /> : undefined}
```

## Accessibility

- Root element is a plain `<div>` — landmark semantics are owned by `PanelChrome`.
- Messages scroll region has `tabIndex={0}` so keyboard users can scroll with arrow / page keys.
- No `aria-live` — `AgentMessage` carries its own live region.
- Layout transitions are purely visual; no focus management occurs on mode change.

## Gotchas

- `ChatLayout` must fill `height: 100%` of its container to work correctly. Inside `PanelChrome` this happens automatically.
- `min-height: 0` on `.airo-chat-chat-layout__messages` is load-bearing — without it, the flex child won't shrink below its content height and the scroll region won't activate.
- Import the styles subpath explicitly: `import '@airo-ux/pattern-library/chat/chat-layout/styles'`.
- **Sidebar mode is bidi-aware.** A `:dir(rtl)` CSS override mirrors the physical column order so the chat column pins to the inline-start edge (right in RTL). Validate with the `RTL` Storybook story.
- **Browser compatibility for the sheet effect.** The `header` and `footer` sheets use `color-mix()` for the semi-transparent fill and `backdrop-filter` for the blur. These require Chrome ≥ 111, Firefox ≥ 113, or Safari ≥ 15.4 for the full frosted-glass appearance. Older browsers receive an opaque `intent('ux.box.backgroundColor')` fallback (the second `background-color` declaration) and no blur — visually solid but still correct. Header/footer `box-shadow` colors use `rgba(0, 0, 0, …)` and do not depend on `color-mix()` support.
