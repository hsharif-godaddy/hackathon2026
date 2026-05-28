# FullscreenDialog

A full-viewport modal surface that always covers the entire screen —
edge-to-edge, no margins, no border-radius. Backed by `@ux/disrupt` for
the scrim, focus trap, and Escape-to-close. Inner UI (header, scrollable
content, sticky footer) is provided by `PanelChrome`.

```tsx
import { FullscreenDialog } from '@airo-ux/pattern-library/surfaces/fullscreen-dialog';
import '@airo-ux/pattern-library/surfaces/fullscreen-dialog/styles';
import '@airo-ux/pattern-library/surfaces/panel-chrome/styles';

const [open, setOpen] = useState(false);

<FullscreenDialog
  show={open}
  onClose={() => setOpen(false)}
  title="Airo"
  footer={<Button design="primary" text="Done" />}
>
  <Box inlinePadding="lg">
    <p>Content</p>
  </Box>
</FullscreenDialog>
```

## When to use

- The team is testing a **full-viewport takeover** for the chat surface —
  swap `Panel` for `FullscreenDialog` at the import level; the
  `children`, `footer`, `header`, and `footerChrome` props follow the same
  `PanelChrome` contract as `Panel`.
- The user task benefits from **maximum focus** — removing all
  surrounding page chrome while in the chat session.

## When not to use

- An edge-attached side panel — use `@airo-ux/pattern-library/surfaces/panel`.
- A draggable, resizable floating window — use
  `@airo-ux/pattern-library/surfaces/floating-panel`.
- A quick confirmation or destructive action — use `@ux/modal` directly.
  `FullscreenDialog` is tuned for long-form, scrollable content surfaces
  (like a chat session), not for single-decision prompts.

## Composition

`FullscreenDialog` composes:

- `@ux/disrupt` for the scrim (dim backdrop), focus trap, Escape-to-close,
  and React portal. No new dependencies — Disrupt is already a peer dep at
  `^2400 || ^2500`.
- `PanelChrome` for the inner UI (header band, scrollable content, sticky
  footer), with `modal={true}` so the chrome defers Escape/focus-restore
  to Disrupt's focus lock.

## Layout

The dialog always fills the full viewport — the scrim wrapper is
`position: fixed; inset: 0` and the chrome stretches to fill it
(`width: 100%; height: 100%`). There are no margins, max-size constraints,
or border-radius. Overflow inside the content region is handled by
`PanelChrome`'s scrollable content area.

## Accessible name

The chrome renders `role="dialog"` + `aria-modal="true"`. Both AT
landmarks and WCAG 2.1 §1.3.6 require a programmatic name. Satisfy it
with one of:

- a string `title` (simplest),
- an explicit `aria-label`, or
- an `aria-labelledby` pointing at a heading in a custom `header`.

The TypeScript discriminated union on `FullscreenDialogProps` enforces
this at compile time.

## Accessibility

- `role="dialog"` + `aria-modal="true"` — the entire page behind the
  dialog is hidden from assistive technology while the dialog is open.
- `@ux/disrupt`'s focus lock traps Tab/Shift+Tab inside the dialog and
  restores focus to the previously-focused element when the dialog closes.
- Escape closes the dialog (wired through Disrupt's `onClose`).
- Default close button is a real `<button>` with the `closeLabel` string
  as its accessible name.
- `prefers-reduced-motion` disables any future entrance transition.

## Gotchas

- Import both stylesheets — the chrome stylesheet handles the inner UI
  (`@airo-ux/pattern-library/surfaces/panel-chrome/styles`), and this stylesheet
  handles the backdrop and full-viewport layout.
- There is no `expanded` prop — "fill the viewport width while staying
  edge-attached" is `Panel`'s expand mode. `FullscreenDialog` is always
  full-viewport.

## Related

- [`@airo-ux/pattern-library/surfaces/panel`](../panel/README.md) — edge-attached
  overlay surface that composes the same chrome.
- [`@airo-ux/pattern-library/surfaces/floating-panel`](../floating-panel/README.md)
  — draggable, resizable, non-modal window.
- [`@airo-ux/pattern-library/surfaces/panel-chrome`](../panel-chrome/README.md) —
  the shared inner UI (header, content, footer).
- [`@ux/disrupt`](https://github.com/gdcorp-uxp/uxcore2/tree/main/packages/components/disrupt) —
  the scrim / focus-lock / portal primitive.
