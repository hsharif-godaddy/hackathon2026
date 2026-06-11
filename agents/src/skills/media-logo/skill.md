---
name: media-logo
description: AI logo generation. Load when user wants to generate, redesign, or edit a logo.
whenToUse: User wants to create, generate, or edit a logo. Phrases like "make a logo", "edit the logo", "make the logo more X", "make a logo from this image", "redesign the logo".
---

## Authoring the prompt

Write a complete, plain-English description of the logo you want — subject, style, mood, composition, level of detail. The tool appends the brand color palette to your prompt automatically, so **do not list hex values yourself**. Don't repeat colors that are already in the palette.

Good prompt:
> A minimalist line-art glyph of a coffee cup with steam curling above it and a small sunrise behind, monoline strokes, generous padding, suitable for a cozy neighborhood cafe.

Bad prompt (lists colors the tool will add anyway, and is too vague about composition):
> Coffee cup logo, primary #B96B3C, secondary #2A4D3E, friendly.

## Reference images

The tool's `referenceUrl` parameter has two intended uses:

1. **User uploaded an inspiration image** ("make a logo like this", "use this style"). Pass the upload's signed URL — visible in conversation context as a `https://<app-id>.agent.<cluster>.airoapp.ai/files/uploads/...` URL. The tool fetches the image and seeds the generation from it.

2. **Iterating on the saved logo** ("make it blue", "remove the tagline", "make the icon larger"). **Omit** `referenceUrl` — the tool resolves the current saved logo from the slot system automatically. Don't manually supply the slot URL; let auto-resolution handle it.

If neither applies — the user wants a fresh logo from scratch — omit `referenceUrl`.

## Layouts

One layout per call (or `all` for the full kit):

- `square` (1024x1024) — favicon, app icon, social profile
- `horizontal` (1536x1024, default) — header, navbar, email signature
- `vertical` (1024x1536) — sidebar, hero, mobile, signage
- `all` — generates all three orientations in one call

If the user names a placement ("add it to the header"), generate the matching layout. If they don't, default to `horizontal` and ask later if they need other orientations, or generate `all` proactively when scaffolding a new app.

## Async generation (background by default)

`generate_logo` runs in the background by default. It returns immediately with animated placeholder slots (status `queued`) while the real logo is generated; the finished logo overwrites the placeholders automatically when it is ready. You can reference the logo slots in source code right away — they update in place, so no rebuild is needed.

While a job is `queued` or `generating`, do **not** tell the user the logo is finished, ready, or done. It's fine to say the logo is being generated in the background and will appear automatically — just don't claim a result you don't have yet.

Pass `background: false` only when your very next step depends on the finished logo — for example, you're about to ask the user to react to it or act on it in the same turn. In that mode the tool WAITS and returns the completed (or failed) outcome before you continue.

`set_venture_logo` is async-aware: if you call it while a logo job is still in flight, it returns a pending result and applies the logo to the venture dashboard automatically once generation completes — you don't need to poll or re-call it.

## Slot URL placement in source code

Generated logos auto-save to per-orientation media slots. **Use the slot URL in source code, never the raw CDN URL** — the user can swap logos via the LogoGridWidget and the slot URL stays the same.

```tsx
// Header / navbar — horizontal slot
<img src="/airo-assets/images/logo/horizontal" alt="Sunrise Cafe logo" />

// Hero / sidebar — vertical slot
<img src="/airo-assets/images/logo/vertical" alt="Sunrise Cafe logo" />

// Favicon / app icon — square slot
<img src="/airo-assets/images/logo/primary" alt="Sunrise Cafe logo" />
```

## Placement decision

After generation, decide based on context:

1. **Place immediately** when the conversation implies it ("build a site with a logo", or you're following a handoff that includes building pages).
2. **Present and wait** when the user only asked to generate or redesign a logo. Show the result and let them browse. Place when asked later.

## Examples

<example>
User: "Make me a logo for Sunrise Cafe — a cozy neighborhood coffee shop."

Correct — descriptive prompt, layout matches a natural first-fit (header), let the tool inject the palette:

```typescript
media-logo__generate_logo({
  prompt: 'A warm, hand-drawn logo for Sunrise Cafe — a stylized coffee cup with a small sunrise rising behind it, friendly monoline strokes, generous padding, cozy neighborhood feel.',
  layout: 'horizontal',
});
```

Wrong — agent restates the palette the tool will add anyway, and the prompt is too generic:

```typescript
media-logo__generate_logo({
  prompt: 'Coffee shop logo. Primary #B96B3C, secondary #2A4D3E, accent #F2C94C. Friendly.',
  layout: 'horizontal',
});
```
</example>

<example>
User: "Make the logo blue."

Correct — referenceUrl omitted; tool auto-resolves the current saved logo:

```typescript
media-logo__generate_logo({
  prompt: 'Recolor the existing logo to a deep navy blue, keeping all other design elements unchanged.',
  layout: 'horizontal',
});
```

Wrong — agent passes the slot URL manually, defeats auto-resolution and adds noise:

```typescript
media-logo__generate_logo({
  prompt: 'Make it blue.',
  layout: 'horizontal',
  referenceUrl: '/airo-assets/images/logo/horizontal',
});
```
</example>

<example>
User uploaded an image of a vintage badge. "Make me a logo like this for my brewery."

Correct — pass the signed upload URL as referenceUrl:

```typescript
media-logo__generate_logo({
  prompt: 'A vintage-style brewery badge in the same illustrated style as the reference image — central crest, banner ribbon, ornate border, warm earth tones.',
  layout: 'all',
  referenceUrl: 'https://app-1.agent.c4.test-airoapp.ai/files/uploads/app-1/vintage-badge.png?sig=...&exp=...',
});
```
</example>
