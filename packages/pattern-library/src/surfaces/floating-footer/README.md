# FloatingFooter

Overlay-elevation horizontal sheet for **bottom composer chrome** — prompt toolbars, attachment + send rows, or any floating strip that should read at the same visual depth as `@ux/flyout` / modal surfaces.

## When to use

- Wrapping a **borderless** `PromptBox` (or any bottom composer) so the whole capsule gets **raised** elevation from `@ux/box` (softer depth than overlay / modal chrome).
- Any bottom-anchored sheet that should read as **lifted** toolbar chrome without full overlay treatment.

## When not to use

- Full-width flush toolbars inside an existing card — use `@ux/box` with `elevation="card"` or compose inside the parent surface instead of adding a second float.
- Page-level footers that are not floating sheets — prefer plain layout primitives.

## Usage

```tsx
import { PromptBox } from '@airo-ux/pattern-library/input/prompt-box';
import '@airo-ux/pattern-library/input/prompt-box/styles';
import { FloatingFooter } from '@airo-ux/pattern-library/surfaces/floating-footer';
import '@airo-ux/pattern-library/surfaces/floating-footer/styles';

<FloatingFooter>
  <PromptBox appearance="borderless" placeholder="Message…" onSubmit={send} />
</FloatingFooter>
```

For attach, token budget, microphone, and typeahead, pass **`toolbarStart`**, **`beforeSubmit`**, and optionally **`suggestions`** / **`onSuggestionsRequest`** on `PromptBox` — see Storybook **Surfaces / FloatingFooter → Borderless PromptBox** and **Borderless PromptBox + typeahead**.

Or with arbitrary children:

```tsx
import { FloatingFooter } from '@airo-ux/pattern-library/surfaces/floating-footer';
import '@airo-ux/pattern-library/surfaces/floating-footer/styles';

<FloatingFooter>
  <div>{/* left / right toolbar content */}</div>
</FloatingFooter>
```

`FloatingFooter` composes **`@ux/box` with `elevation="raised"`** so background, border radius, and drop-shadow come from the registered `@ux/box` theme. The companion stylesheet only constrains width in flex layouts — it does **not** add an extra shadow layer on top of Box.

See Storybook **Surfaces / FloatingFooter → Borderless PromptBox** (toolbar) and **Borderless PromptBox + typeahead** for live examples with `PromptBox` `appearance="borderless"`.

## Accessibility

- The surface is a **layout container only** — it does not introduce landmark roles. Put `role="toolbar"` (or appropriate semantics) on the child if the region is a single control group.
- Ensure sufficient contrast for custom children; the raised surface inherits theme tokens from `@ux/box`.

## Gotchas

- **Styles are required** — without `…/floating-footer/styles`, the sheet skips Airo width constraints (Box still provides raised elevation from the consumer’s registered `@ux/box` theme).
- **Borderless `PromptBox`** — `PromptBox` does not bundle this surface; import **`@airo-ux/pattern-library/surfaces/floating-footer/styles`** whenever you wrap content in `FloatingFooter`.
