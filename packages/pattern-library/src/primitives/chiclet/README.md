# Chiclet

Airo-branded pill-shaped trigger button — the canonical "Ask Airo" call-to-action.

A wand icon paired with a label sits inside a rounded surface ringed by an animated Airo-purple gradient border that rotates once on mount and continuously while hovered or keyboard-focused.

The chiclet always renders with the **ComponentAiro (Light)** Antares theme partial — the root element carries `data-partial="componentAiro"` so its hover/pressed states match the Figma source (lavender hover, deep-purple pressed) even when the surrounding page is on the plain Antares base. Consumers who genuinely need a different partial can override via the standard `data-partial` attribute.

```tsx
import { Chiclet } from '@airo-ux/pattern-library/primitives/chiclet';
import '@airo-ux/pattern-library/primitives/chiclet/styles';

// Default — renders "Ask Airo" with the wand icon
<Chiclet onClick={openAiroPanel} />

// Custom label
<Chiclet onClick={openAiroPanel}>Try Airo</Chiclet>

// Small size, no icon
<Chiclet size="small" icon={false}>Ask Airo</Chiclet>
```

## When to use

- As the primary entry point to an Airo-powered experience embedded in a host page (e.g. opens a side panel, drawer, or modal where the user can chat with Airo).
- As an inline "ask Airo about this" trigger anywhere a contextual AI assist is offered.
- Anywhere a button needs to read explicitly as **Airo**-branded — the rotating gradient is the brand signature.

## When not to use

- For non-Airo CTAs. Use `@ux/button` directly with the appropriate `design` (`primary`, `secondary`, `inline`, etc.) — this component is deliberately Airo-flavoured and shouldn't be repurposed.
- As a toggle that needs to display a persistent "selected" / "on" state. The chiclet has no such state — its visuals are interaction-only. If you need a button that pins itself "on" while a panel is open, reach for `@ux/toggle-button` or pair `@ux/button` with `aria-pressed`.

## Accessibility

- Renders a real `<button>` so keyboard activation, focus management, and assistive-technology semantics come for free.
- Defaults `type="button"` so the chiclet inside a `<form>` does not accidentally submit it. Consumers can pass `type="submit"` explicitly when needed.
- The leading wand is rendered inside an `aria-hidden` wrapper so screen readers announce only the label, not the icon.
- The "pressed" appearance (solid dark fill) is bound to the CSS `:active` pseudo-class only — i.e. it shows while the mouse button is held or Space is depressed during keyboard activation. There is no persistent "selected" state and no `aria-pressed` toggle semantics; the chiclet is a pure trigger.
- The rotating gradient ring is decorative. Keyboard focus also paints a discrete `actionSecondaryFocused.outlineColor` ring outside the pill so the focus indicator does not depend on motion.
- `prefers-reduced-motion: reduce` collapses both the intro animation and the hover loop to a static gradient ring.
- The icon and label order flips naturally under `dir="rtl"` via CSS flexbox direction inheritance — no additional markup is needed.

**Keyboard interaction**

| Key | Behaviour |
|-----|-----------|
| `Enter` | Activates the chiclet (fires `onClick`). |
| `Space` | Activates the chiclet (fires `onClick`). |

## Gotchas

- The component does **not** import its own styles — consumers must import `@airo-ux/pattern-library/primitives/chiclet/styles` once at their app root or alongside the component usage.
- The Airo brand gradient stops (`#B688F7`, `#946CEE`, `#5034DC`) are deliberately hardcoded and shared with [`AiroWordmark`](../../surfaces/airo-wordmark.tsx). They are exempt from the "no hardcoded colors" rule the same way shadow geometry is — there is no equivalent intent token. If the brand palette changes, update both files in lockstep.
- The chiclet uses `@property --airo-primitives-chiclet-angle` to drive the gradient rotation on the GPU. In browsers without `@property` support (older Safari, Firefox `< 128`), the gradient still renders but rotates discretely between keyframes rather than smoothly. The static look matches the Figma source either way.
- Because the gradient ring is a `border-box` background with a transparent border, custom `border` overrides via `className` will replace the ring entirely. Reach for the BEM root class `airo-primitives-chiclet` only when you need to compose layout (margin, alignment) — leave colour/border styling to the component.
- Sizing matches the default `@ux/button` (`calc(intent('ux.box.density') * 2) calc(intent('ux.box.density') * 3)` padding, `0.5em` icon-to-label gap, `1.5em × 1.5em` icon wrapper around a `1em` icon glyph). This intentionally differs from the Figma source's larger 56px-tall chiclet so the trigger sits inline with other UXCore2 buttons. The wand glyph renders at the label's cap-height — change the label's font-size and the icon scales with it.
- The `size="small"` variant mirrors `@ux/button size="small"`: `density × 1` / `density × 2` padding at `var(--uxText--fontSize-1)` (~14px). Gap, icon size, and ring thickness scale with the inherited font-size automatically. The 2.8px gradient ring thickness is intentionally **not** scaled across sizes — the brand ring keeps a constant visual weight regardless of the chiclet's overall size.
