# ThinkingIndicator

Lightweight "thinking" / loading indicator with three visual variants:

- **`dots`** (default) — three staggered bouncing dots, calibrated for inline use inside chat threads or status rows.
- **`spinner`** — a single rotating circular arc, calibrated for compact status pills (see `Canvas.Status`) and dense surfaces where three-dot motion would feel busy.
- **`godaddy`** — the GoDaddy brand mark with a happy-bounce + brand-color breathing cycle, framed by a soft pulse ring radiating outwards. Heavier visual weight than the other two — reserve for hero "the AI is working on it" moments.

## When to use

- As the animated indicator inside a "the AI is working" status row (e.g. `Thinker`).
- Inline in a chat thread to signal that the next agent message is on its way.
- Inside a compact status chip to signal a long-running side effect (use `variant="spinner"`).
- For prominent / hero "agent is generating" moments where a branded affordance is appropriate (use `variant="godaddy"`).

## When not to use

- For page-level or full-screen loading — prefer a higher-visual-weight progress affordance.
- As a decorative element with no semantic meaning — keep `role="status"` and a meaningful `label` so screen readers announce the loading state.

## Accessibility

`ThinkingIndicator` renders a `role="status"` live region with an `aria-label` (defaults to `"Loading"`). Screen readers announce the label immediately on mount. The animated graphic itself (dots, spinner, or godaddy brand mark) is `aria-hidden`, so assistive technology only hears the label — not three empty dot elements, an unlabelled SVG, or the brand mark.

Pass a descriptive `label` when the context makes "Loading" ambiguous — for example `label="Generating a response"` or `label="Editing your site"`.

`prefers-reduced-motion` is respected by all three variants: animation is disabled when the user has opted out of motion. The dots variant fades to 80% opacity to remain visible; the spinner stops rotating but its dual-opacity arcs still imply rotation direction; the godaddy variant freezes on the rest stop with the pulse ring held at a low-opacity static circle, so the mark stays recognisable without competing for attention.

## Gotchas

- The component does **not** import its own styles — consumers must import `@airo-ux/pattern-library/primitives/thinking-indicator/styles` once at their app root or alongside the component usage.
- The `size` prop multiplies the density unit (`ux.box.density`). A value of `1` (default) gives dots sized to match body text. The spinner and godaddy variants are rendered at 3× that size so a single glyph reads as visually balanced with the three-dot variant. Pass a sub-`1` value (e.g. `0.6`) for compact contexts — note that consumers embedding the spinner inside a pill often pin the spinner size via a CSS custom-property override (`--airo-primitives-thinking-indicator-dot-size`) rather than the `size` prop, so the visual size is density-independent.
- Picking a variant: prefer `dots` inline with text (chat thread, status row); prefer `spinner` inside compact pill chrome where the bouncing motion would compete with the surrounding label; prefer `godaddy` for hero "the AI is working" moments where a branded affordance is appropriate.
- The `godaddy` variant stores a single brand-teal source — Everyday Blue 400 (`#1BDBDB`) — in `--airo-primitives-thinking-indicator-godaddy-brand`. The pulse ring, the rest stop, and the lift-off stop all derive from it via `color-mix(in srgb, …, transparent)` at fixed alpha ratios; the impact stop is the brand color itself. The literal lives in `styles.css` because UXCore2 doesn't tokenize brand identity (same exception that applies to `AiroWordmark`'s gradient stops). Mixing with `transparent` (instead of `white`) means the cycle composites against whatever surface sits behind the mark — so the brand color stays consistent on light and dark surfaces alike. Note: alpha doesn't fully fix dark-mode contrast; it makes the mark *less* visible on a dark background, not more, but it removes the fixed three-hex palette from the brand-system surface area. The animation freezes under `prefers-reduced-motion: reduce`, holding the rest stop so the mark stays recognisable; the pulse ring rests at a low-opacity static circle in that mode.
- The `godaddy` variant's pulse ring scales out to ~1.9× the stage size during its cycle. If you embed the variant inside a container with `overflow: hidden`, the ring will be clipped at the edge — which is usually fine, but check the visual fit before committing. The ring's stroke width is exposed as `--airo-primitives-thinking-indicator-godaddy-pulse-ring-stroke` (default `1.5px`) so themes can adjust it without forking the keyframe; it stays a literal pixel value rather than scaling with `--…-dot-size` because the anti-alias floor is a function of the display, not the indicator size.
- The `godaddy` variant's layout footprint is intentionally smaller than its visual extent. The stage paints at 3× dot-size so the brand mark reads at the correct size, but a negative margin compresses the flow box so neighbouring content sits flush against the mark itself. The pulse ring (and any bounce overshoot) then overflows the bounding box without pushing surrounding content. Consequence: the variant overlaps siblings if they're tightly packed, and a tight-clipping ancestor (`overflow: hidden`, fixed-height row) may crop the pulse expansion.
- Variant set may evolve: any unrecognized `variant` value falls back to the bouncing-dots graphic at runtime, so consumers pinned to a removed variant degrade gracefully rather than rendering an empty container.
