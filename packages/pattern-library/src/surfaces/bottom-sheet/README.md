# BottomSheet

A mobile overlay surface anchored to the viewport's bottom edge. Built on
`@ux/disrupt` (scrim + focus-lock + portal) and slides up with rounded top
corners, a decorative grab-handle pill, and an optional header (a
`@ux/text-lockup` title + an `@ux/corner-actions` dismiss X). Closes on the X,
scrim tap, or Escape. Set `showCloseButton={false}` (and omit `title`) for a
chromeless sheet dismissed by the scrim or Escape — the header is then omitted
entirely, leaving the decorative drag handle (a dismissibility affordance, not
itself interactive).

```tsx
import { BottomSheet } from '@airo-ux/pattern-library/surfaces/bottom-sheet';
import '@airo-ux/pattern-library/surfaces/bottom-sheet/styles';

const [open, setOpen] = useState(false);

<BottomSheet show={open} onClose={() => setOpen(false)} title="Actions">
  <button type="button" onClick={onRename}>Rename</button>
</BottomSheet>;
```

## When to use

- The mobile rendering of a menu or action list (see **`ResponsiveMenu`**,
  which composes this).
- Any bottom-anchored, modal sheet of content on small viewports — filters,
  pickers, confirmations.

## When not to use

- An edge-attached side panel for chat/settings — use **`Panel`**.
- A full-viewport takeover — use **`FullscreenDialog`**.
- A desktop anchored dropdown — use `@ux/menu` (or `ResponsiveMenu`, which
  picks the right surface per breakpoint automatically).

## Accessibility

- Renders `role="dialog"` + `aria-modal="true"`. A string `title` is wired to
  `aria-labelledby`; otherwise supply `aria-label` or `aria-labelledby` (the
  prop types enforce that one is present).
- `@ux/disrupt` traps focus while open and restores it on close; Escape closes
  regardless of `showCloseButton`, so the sheet always has a keyboard dismissal.
- When shown, the header's dismiss button is a real `@ux/button`
  (`design="control"`) with an `aria-label` (`closeLabel`, default `"Close"`).
  With `showCloseButton={false}`, Escape remains the keyboard dismissal.
- Honors `prefers-reduced-motion` — the slide transition is dropped.

## Gotchas

- **Presentational only.** Open/close state lives in the consumer; when
  controlled (`show`), the sheet does not self-close — update `show` in your
  `onClose`.
- Content taller than `85dvh` scrolls inside the sheet body; the header stays
  pinned.
- Portals to `document.body` by default — override with `portalElem`.
