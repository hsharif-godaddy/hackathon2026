# UserMessage

Right-aligned chat bubble for the end-user's turn in a conversation. The
bubble follows `@ux/card` surface conventions (elevated card with padding)
but squares the block-end / inline-end corner so it visually points at the
user's avatar. Supports an optional media gallery above the text, with
image tiles that open a shared lightbox modal.

```tsx
import { UserMessage } from '@airo-ux/pattern-library/chat/user-message';
import '@airo-ux/pattern-library/chat/user-message/styles';

export function Example() {
  return <UserMessage>Can you help me design a landing page?</UserMessage>;
}
```

## When to use

- Render the user's turn in a chat thread.
- Show one or more uploaded images or files above the user's text, as a
  compact gallery.
- Provide an in-context lightbox for tapping image previews, without
  pulling in a full media-viewer component.

## When not to use

- AI-agent responses. Use `AgentMessage` instead — it renders markdown
  through UXCore2 typography and lives in a polite live region.
- Standalone image galleries outside a chat thread. Use a purpose-built
  gallery component.
- Rendering streaming markdown. `UserMessage` renders its string child as a
  single paragraph through `@ux/text`; it does not parse markdown.

## Compound slots

| Slot | Purpose |
| --- | --- |
| `UserMessage` | Root bubble + lightbox modal + accessible group label. |
| `UserMessage.Gallery` | Layout region for 1–N media tiles above the text. |
| `UserMessage.Image` | Image tile. Clicking opens the shared lightbox modal. |
| `UserMessage.File` | Uploaded-file tile. Icon + filename caption. |

The gallery picks one of two layouts from its children:

- **Strip (images-only).** A single image renders at its natural aspect
  ratio, capped at 30 × `box.density` on both axes (and at 100% of the
  bubble inline-size). Two or more images become a "hero + thumbs"
  horizontal strip: the first tile is capped at 75% of the gallery's
  inline size, every tile shares the same `block-size` (so the hero's
  rendered height sets the max-height for the rest), and the whole
  strip is capped at 18 × `box.density` tall — horizontally scrollable
  with scroll-snap when the combined tile widths exceed the bubble.
  Images always keep their original aspect ratio: the rare ultra-wide
  panorama that hits the 75% hero clamp is scaled down proportionally
  (letterboxed on the block axis via `object-fit: contain`) rather than
  cropped.
- **List (mixed / file-bearing).** Whenever the gallery contains any
  `UserMessage.File` tile, it renders as a vertical `@ux/list-item`
  stack framed by a single `@ux/box elevation="card"` surface — the
  rows read as flush slats of one card rather than a column of loose
  tiles. Slats sit edge-to-edge (no inner gap) and use `@ux/list-item`'s
  `compact` variant for tighter row padding. Each row shares a
  64px-square media rail on the inline-start so image thumbnails and
  file-type icons align at a common edge, with the filename caption
  flowing on the trailing side with `min-inline-size: 0` so long
  filenames wrap inside the row instead of pushing the row past the
  gallery width. The list flows directly inside the bubble column —
  there's no inner scroll container or height cap, so the bubble grows
  to fit every attachment the user sent. File-type icons are inferred
  from the filename extension (`.docx` → `word`, `.xlsx` → `excel`,
  `.pptx` → `powerpoint`, `.zip` → `archive`, `.mp4` → `video`, `.ts`
  / `.js` / `.json` / … → `code`) with `attachment` as the fallback
  for unknown extensions — pass `icon="…"` on the file tile to
  override. Force a specific layout via `<UserMessage.Gallery
  layout="strip" | "list">` when the default heuristic disagrees with
  your product's intent.

Strip tiles are separated by an SM gap (1 × `box.density`, matching
`@ux/space`'s `sm` gapFactor). List slats have zero gap — they share
one card surface.

```tsx
import { UserMessage } from '@airo-ux/pattern-library/chat/user-message';
import '@airo-ux/pattern-library/chat/user-message/styles';

export function Rich() {
  return (
    <UserMessage>
      <UserMessage.Gallery>
        <UserMessage.Image src="/photos/hero.jpg" alt="Landing page hero" />
        <UserMessage.Image src="/photos/footer.jpg" alt="Landing page footer" />
        <UserMessage.File name="requirements.pdf" />
      </UserMessage.Gallery>
      Can you use these as the reference for the design?
    </UserMessage>
  );
}
```

## Accessibility

`UserMessage` renders a native `<article>` landmark with an accessible
name (defaults to `"You said"`) so screen-reader users hear a clear turn
label before the visible content. Pass `ariaLabel` to localize or tailor
the copy, or a native `aria-label` attribute for compatibility.

- `UserMessage.Gallery` carries `role="group"` with its own label
  (defaults to `"Attached files"`) so the media region is announced as a
  sub-region of the message.
- `UserMessage.Image` renders a native `<button>` wrapping the thumbnail
  `<img>` — a real, focusable button with `Enter` / `Space` activation
  baked in by the browser. The button's accessible name comes from the
  image's `alt` text (the inner `<img>` is `alt=""` + `aria-hidden` so
  the alt is announced once, not twice); pass a meaningful `alt`
  describing what the user uploaded.
- `UserMessage.File` uses the filename as its accessible label and wraps
  it in an `@ux/card` surface. When `href` is set, the card renders as
  a link with the filename as its text — `target="_blank"` links
  automatically gain `rel="noopener noreferrer"`.
- The lightbox modal (via `@ux/modal`) closes on `Escape` and traps focus
  while open. The close button's accessible name comes from
  `lightboxCloseLabel` (defaults to `"Close image preview"`). The modal
  renders without a title row — the image's `alt` text doubles as a
  caption paragraph below the preview, and the dialog's accessible name
  is wired to that caption via `aria-labelledby`. When `alt` is empty,
  the dialog falls back to an `aria-label` of `"Image preview"`.
- Logical CSS properties are used throughout, so the bubble mirrors its
  tail corner automatically in RTL.

## URL handling (XSS posture)

`UserMessage.Image`'s `src` and `UserMessage.File`'s `href` are rendered
into real DOM sinks (`<img src>`, `<a href>`). Per `SECURITY.md §3.1`,
any URL attribute built from consumer input has to pass a scheme
allow-list before it reaches the sink — otherwise `javascript:` /
`data:text/html` / `vbscript:` / `file:` URLs become a trivial XSS or
local-disclosure vector. The library handles this at two layers:

1. A safe baseline default. Every `<img>` sink goes through
   `isSafeImgSrc` (`http:`, `https:`, relative / fragment URLs); every
   `<a>` sink goes through `isSafeHref` (also allowing `mailto:`,
   `tel:`, `sms:`). Hostile schemes produce a non-interactive placeholder
   tile (image) or a filename-only caption (file) — the accessible name
   and layout are preserved, but no hostile value reaches the DOM.
2. A consumer-override seam. `UserMessage` accepts `validateSrc` and
   `validateHref` props, and the compound `Image` / `File` tiles each
   accept a per-tile override of the same name. Consumers with a
   stricter CSP (e.g. same-origin only) or a legitimate need to widen
   the default (e.g. allow `data:image/svg+xml` from a trusted SVG
   factory) plug their own predicate in at either layer.

The library defaults are re-exported so consumer policy can compose:

```tsx
import { UserMessage, isSafeImgSrc } from '@airo-ux/pattern-library/chat/user-message';

// "Library default OR a specific data: URL from my known-safe factory."
const validateSrc = (src: string) =>
  isSafeImgSrc(src) ||
  src.startsWith('data:image/svg+xml;utf8,');

<UserMessage validateSrc={validateSrc}>
  <UserMessage.Gallery>
    <UserMessage.Image src={generatedSvgDataUrl} alt="Brand diagram" />
  </UserMessage.Gallery>
</UserMessage>
```

```tsx
// Tightening: same-origin `href` only (e.g. a strict intranet app).
const sameOriginOnly = (href: string) => {
  try {
    return new URL(href, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
};

<UserMessage validateHref={sameOriginOnly}>
  <UserMessage.Gallery layout="strip">
    <UserMessage.File name="handbook.pdf" href="/docs/handbook.pdf" />
  </UserMessage.Gallery>
</UserMessage>
```

This is a *policy hook*, not a sanitizer. The predicate only decides
whether a URL is allowed through — it does not rewrite, proxy, or
otherwise transform the value. Consumers enforcing a strict CSP should
still configure `Content-Security-Policy` at the response layer; the
URL guard is a belt to the CSP's suspenders.

## Gotchas

- Always side-effect-import the styles subpath:
  `import '@airo-ux/pattern-library/chat/user-message/styles'`.
- UXCore2 packages such as `@ux/box`, `@ux/card`, `@ux/icon`,
  `@ux/list-item`, `@ux/modal`, and `@ux/text` are peer dependencies.
  Install compatible majors (`^2400 || ^2500`) in the consumer app, and
  import each package's `/styles` subpath at your consumer root (the
  list layout relies on `@ux/list-item/styles`).
- `UserMessage.Image` and `UserMessage.File` apply narrow CSS overrides to
  `@ux/card`'s inner shell padding because `@ux/card`'s public `space`
  prop defaults to `'lg'` with no supported way to opt out. The override
  is scoped to the tile's BEM class; nothing outside `UserMessage` is
  affected. Re-evaluation trigger: `@ux/card` exposes a
  `space.inline = 'none'` escape hatch.
- File upload itself is **out of scope**. `UserMessage` renders what a
  consumer has already uploaded; drag-and-drop, progress bars, and error
  recovery belong in a dedicated input pattern.
- Opening / closing the lightbox is internal state — there is no
  controlled-lightbox API. Consumers that need to drive the modal from
  outside (e.g. keyboard-shortcut handlers) should track which image
  is focused in their own state and scroll-to-focus instead.
- Keyboard navigation between thumbnails in the lightbox (next / previous
  arrows) is a future enhancement. The first release handles single-image
  preview only — press `Escape` to close and `Tab` / `Shift+Tab` to reach
  the next tile for preview.
