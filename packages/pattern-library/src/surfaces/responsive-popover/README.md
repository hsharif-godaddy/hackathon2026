# ResponsivePopover

Rich popover content that adapts to viewport size: an anchored `@ux/flyout`
popover on desktop, and a `BottomSheet` on mobile (< 768px). The **same
`children`** render in both surfaces, so a consumer authors its popover body
once and gets the right surface per breakpoint. It is the content-agnostic
sibling of **`ResponsiveMenu`** (which is specialized for action lists).

```tsx
import { ResponsivePopover } from '@airo-ux/pattern-library/surfaces/responsive-popover';
import '@airo-ux/pattern-library/surfaces/responsive-popover/styles';
import '@airo-ux/pattern-library/surfaces/bottom-sheet/styles'; // composed mobile surface

const [open, setOpen] = useState(false);

<ResponsivePopover
  open={open}
  onOpenChange={setOpen}
  sheetTitle="Publish"
  placement="bottom-end"
  popoverClassName="w-[350px] p-3"
  renderTrigger={(tp) => (
    <Button
      text="Publish"
      aria-haspopup={tp['aria-haspopup']}
      aria-expanded={tp['aria-expanded']}
      onClick={tp.onClick}
    />
  )}
>
  <PublishBody />
</ResponsivePopover>;
```

## When to use

- A popover whose body is **rich content** (forms, status, mixed controls) and
  should become a bottom sheet on small viewports — publish/share panels,
  detail popovers, inline editors.
- Any place you'd reach for an anchored dropdown on desktop but want a
  thumb-friendly sheet on mobile, **without** duplicating the body markup.

## When not to use

- A simple **action list** (rows of menu items) — use **`ResponsiveMenu`**,
  which owns row layout, separators, and the `@ux/menu` keyboard model.
- A desktop-only anchored popover — use `@ux/popover` / `@ux/flyout` directly.
- A mobile-only sheet — use **`BottomSheet`** directly.
- An edge-attached side panel — use **`Panel`**; a full-viewport takeover —
  use **`FullscreenDialog`**.

## Accessibility

- Both surfaces expose a `role="dialog"`. Supply the accessible name with one
  of: a string `sheetTitle`, an `aria-label`, or an `aria-labelledby` (the prop
  types enforce that one is present). An explicit `aria-labelledby` wins; a
  string `sheetTitle` names the surface otherwise.
- The trigger receives `aria-haspopup="dialog"` and `aria-expanded` via
  `renderTrigger` — spread them onto your trigger element.
- Desktop: `@ux/flyout` dismisses on outside-click and Escape (reported through
  `onOpenChange(false)`). Mobile: `BottomSheet` traps focus, shows a
  keyboard-reachable dismiss (X), and closes on the X, scrim tap, or Escape.

## Gotchas

- **Controlled-or-uncontrolled.** With `open` set, the surface does not
  self-close — update `open` in your `onOpenChange`. `onOpenChange` always
  reports the *next* desired state, so a consumer can gate opening (e.g. a
  paywall check) before letting it open.
- `popoverClassName` styles the **desktop** content wrapper only (width /
  padding). The mobile sheet owns its own body padding — passing width there
  would fight the full-bleed sheet.
- The trigger is wrapped in an `inline-flex` anchor `<span>` that the desktop
  flyout attaches to, so your trigger element does not need to forward a ref.
- Import the **`BottomSheet` styles** too — `ResponsivePopover` composes it for
  the mobile rendering, and its CSS ships from that component's own subpath.
