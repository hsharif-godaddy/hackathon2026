# MentionChip

Inline chip primitive for "mention"-shaped references — a small, interactive badge that points to a numbered entity in some host document tree (e.g. an element in a canvas, a layer in a design, a row in a list).

The chip renders an interactive surface with `role="button"` so it can host a real `<button>` for the optional remove affordance. Sizing is em-based and the chip is designed to sit inline with body text without disrupting line-height. Visual states track `@ux/chip`'s three-state token family — `actionControl` at rest, `actionControlHovered` on hover, `actionControlFocused` on keyboard focus — so this primitive reads as visually consistent with UXCore2 chips at every interaction state.

```tsx
import { MentionChip } from '@airo-ux/pattern-library/primitives/mention-chip';
import '@airo-ux/pattern-library/primitives/mention-chip/styles';

// With remove affordance — typical usage inside an editor
<MentionChip
  prefix={1}
  label="Button"
  onActivate={() => scrollToElement(1)}
  onRemove={() => removeMention(1)}
/>

// Read-only chip — no remove button
<MentionChip prefix={3} label="Section" onActivate={focusSection} />

// No prefix — just a labelled chip
<MentionChip label="Pinned note" onActivate={openNote} />
```

## When to use

- As an inline reference to a numbered or named entity inside body text or an editor surface (`PromptBox`, comment threads, chat input).
- When the reference needs both an "activate" gesture (jump to / focus on the referenced thing) and an optional "dismiss" gesture (remove the reference from the surrounding text).
- When the chip needs to behave as a single atomic unit inside a contenteditable host — selection, copy, and delete all operate on the whole chip.

## When not to use

- As a tag or filter chip with toggle semantics. Use `@ux/chip` instead — it ships proper checkbox/toggle wiring and the larger pill geometry expected for filter UIs.
- As a status or category lozenge. Use `@ux/tag` for non-interactive status labels.
- As a standalone CTA. Use `@ux/button` (or [`Chiclet`](../chiclet/README.md) for Airo-flavoured triggers).
- When you need to render a non-numeric prefix that is not a single token. The chip's prefix slot is intended for short identifiers (a number, an icon, a 1–2 character abbreviation).

## Accessibility

- The chip body is a `<span>`. When `onActivate` is provided it adopts `role="button"` and `tabIndex={0}` so keyboard users can activate it; the role-on-span pattern is necessary because the chip can host a real `<button>` for remove, and nested `<button>` elements are invalid HTML. When `onActivate` is omitted (read-only chip), the chip drops both `role` and `tabIndex` so it isn't a phantom focusable element AT users can land on for no reason.
- The body is `contentEditable={false}` so it behaves as an atomic node inside any contenteditable host (Lexical, Slate, plain `[contenteditable]`).
- Keyboard activation: `Enter` and `Space` fire `onActivate` exactly once. Both keys mirror the canonical `<button>` activation contract so AT users get the behaviour they expect.
- Clicks and key events that originate inside the trailing remove `<button>` are deliberately not forwarded to `onActivate` — the two actions stay independent at the call site.
- The remove button defaults its accessible name to `"Remove"`. Override via `removeLabel` for translated copy or to disambiguate when a page contains many chips (e.g. `removeLabel="Remove mention #3"`).
- Both the chip body and the remove button paint a discrete `:focus-visible` ring (`actionControlFocused.outlineColor`, 2px outline, 1px offset). The chip body additionally shifts its background, border, and foreground to the `actionControlFocused` family so the focused state reads clearly even before the outline is rendered.
- The chip uses `vertical-align: baseline` so it sits on the same baseline as the surrounding body text. Use a font-size override on a parent rather than poking at the chip's BEM internals if you need the chip to track a different text scale.
- RTL: chip layout flows naturally under `dir="rtl"` via logical properties (`padding-inline`, `margin-inline-start`). The remove button stays at the trailing edge in both directions.

**Keyboard interaction**

| Key | Behaviour |
|-----|-----------|
| `Tab` | Moves focus to the chip body, then to the remove button (when present), then onwards. |
| `Enter` | Activates the focused element — fires `onActivate` from the chip body, fires `onRemove` from the remove button. |
| `Space` | Activates the focused element — fires `onActivate` from the chip body, fires `onRemove` from the remove button. |

## Gotchas

- The component does **not** import its own styles — consumers must import `@airo-ux/pattern-library/primitives/mention-chip/styles` once at their app root or alongside the component usage.
- The remove affordance renders the `x-thick` icon via `@ux/icon`'s `AsyncIcon`, which fetches its SVG from the consumer's UXCore2 asset host. `@ux/icon` is a peer dependency — the icon will render as an empty box in any environment that doesn't already have `@ux/icon`'s asset pipeline wired up at the app root.
- The chip's `onMouseDown` handler calls `event.preventDefault()` **only when the chip is hosted inside a `contenteditable` surface** (e.g. a Lexical editor) so a click doesn't collapse the selection into the chip's atomic node or steal focus from the editor. Outside a contenteditable host the default fires normally, so the chip can receive focus on click like any other `role="button"`. If you spread an `onMouseDown` handler that calls `event.preventDefault()` itself first, the chip respects `event.defaultPrevented` and skips its own logic.
- The literal `#` glyph in front of the prefix is added by the component. Pass just the value (e.g. `prefix={1}`), not `prefix="#1"`.
- An empty-string `prefix={''}` renders as no prefix at all — same as omitting the prop. To force an explicit `#` with no number, pass `prefix={' '}` (a non-breaking space) or use a different chip primitive.
- The chip is a pure trigger — it has no persistent "selected" state and never sets `aria-pressed`. If you need a chip that pins itself "on" while a panel is open, reach for `@ux/chip` (toggle) or pair the chip with your own `aria-pressed` wiring on a non-mention surface.
- The chip's resting / hover / focus colors are bound to the `actionControl` family (matching `@ux/chip`). Don't mix in a different family's foreground via consumer CSS — UXCore2's contrast guarantees only hold when the foreground/background come from the same intent family.
