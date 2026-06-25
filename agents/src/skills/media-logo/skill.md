---
name: media-logo
description: AI logo generation and editing. Load when user wants to generate, redesign, or edit a logo.
whenToUse: User wants to create, generate, or edit a logo. Phrases like "make a logo", "edit the logo", "make the logo more X", "make a logo from this image", "redesign the logo".
---

## Tool Selection

Pick the right tool based on whether a logo already exists:

| Situation | Tool |
|-----------|------|
| No logo exists yet, user wants one from scratch | `generate_logo` |
| No logo exists yet, user uploads image(s): "make me a logo like this" | `generate_logo` |
| Logo exists, user wants to change it ("make it blue", "remove the tagline") | `edit_logo` |
| Logo exists, user uploads image(s): "make it more like this one" | `edit_logo` |

**When in doubt:** If the user has a saved logo and is asking for a modification, use `edit_logo`. If they want something completely new or there's no existing logo, use `generate_logo`.

**Inspiration images are handled automatically.** If the user uploaded images in the current message, both tools detect them from context and use them as style references — you do not need to pass any URLs.

## Authoring the prompt

### For `generate_logo`

Write a complete, plain-English description of the logo — subject, style, mood, composition, level of detail. The tool appends the brand color palette automatically, so **do not list hex values yourself**.

**Never include taglines, slogans, or descriptive phrases** in your prompt unless the user explicitly asked for one. The logo should contain only the brand name as text.

Good prompt:
> A minimalist line-art glyph of a coffee cup with steam curling above it and a small sunrise behind, monoline strokes, generous padding, suitable for a cozy neighborhood cafe.

Bad prompt:
> Coffee cup logo, primary #B96B3C, secondary #2A4D3E, friendly.

### For `edit_logo`

Describe the **change** relative to what exists. Be specific about what to modify and what to keep. The tool retrieves the current logo automatically.

Good prompt:
> Recolor the dots to deep navy blue, keeping all other design elements and composition unchanged.

Bad prompt:
> Make it blue.

## Inspiration images

Both tools automatically detect uploaded images from the current message's context. You do not need to pass URLs.

- **`generate_logo` + uploaded images:** "Make me a logo in this style" — generates a NEW logo influenced by the uploaded images
- **`edit_logo` + uploaded images:** "Make my logo more like this" — edits the existing logo, also influenced by the uploaded images

Multiple uploaded images are all used as inspiration.

## Layouts

One layout per call (or `all` for the full kit):

- `square` (1024x1024) — favicon, app icon, social profile
- `horizontal` (1536x1024, default) — header, navbar, email signature
- `vertical` (1024x1536) — sidebar, hero, mobile, signage
- `all` — generates all three orientations in one call

If the user names a placement ("add it to the header"), generate the matching layout. If they don't, **always default to `horizontal`**. Never generate `square`, `vertical`, or `all` unless the user explicitly asks.

## Async generation (background by default)

Both tools run in the background by default. They return immediately with animated placeholder slots (status `queued`) while the real logo is generated; the finished logo overwrites the placeholders automatically.

While a job is `queued` or `generating`, do **not** tell the user the logo is finished. Say it's being generated and will appear automatically.

Pass `background: false` only when your very next step depends on the finished logo.

`set_venture_logo` is async-aware: if called while a logo job is in flight, it applies automatically once generation completes.

## Slot URL placement in source code

Generated logos auto-save to per-orientation media slots. **Use the slot URL in source code, never the raw CDN URL** — the user can swap logos via the LogoGridWidget and the slot URL stays the same.

```tsx
// Header / navbar — horizontal slot
<img src="/airo-assets/images/logo/horizontal" alt="Logo" />

// Hero / sidebar — vertical slot
<img src="/airo-assets/images/logo/vertical" alt="Logo" />

// Favicon / app icon — square slot
<img src="/airo-assets/images/logo/primary" alt="Logo" />
```

## Placement decision

After generation, decide based on context:

1. **Place immediately** when the conversation implies it ("build a site with a logo", or following a handoff that includes building pages).
2. **Present and wait** when the user only asked to generate or edit a logo. Show the result and let them browse. Place when asked later.

## Examples

<example>
User: "Make me a logo for Sunrise Cafe — a cozy neighborhood coffee shop."

Correct — descriptive prompt, default horizontal layout:

```typescript
media-logo__generate_logo({
  prompt: 'A warm, hand-drawn logo for Sunrise Cafe — a stylized coffee cup with a small sunrise rising behind it, friendly monoline strokes, generous padding, cozy neighborhood feel.',
  layout: 'horizontal',
});
```
</example>

<example>
User: "Make the dots blue."

Correct — edit_logo with specific change description:

```typescript
media-logo__edit_logo({
  prompt: 'Recolor the dots to deep navy blue, keeping all other design elements unchanged.',
  layout: 'horizontal',
});
```
</example>

<example>
User uploads 2 images: "Make me a logo combining the style of these"

Correct — generate_logo (uploaded images are picked up automatically from context):

```typescript
media-logo__generate_logo({
  prompt: 'A logo for Sunrise Cafe combining the vintage badge style and hand-lettering aesthetic of the uploaded reference images, warm earth tones, ornate border detail.',
  layout: 'horizontal',
});
```
</example>

<example>
User has a logo, uploads an image: "Make my logo more like this vintage style"

Correct — edit_logo (existing logo auto-resolved from slot, uploaded image auto-detected from context):

```typescript
media-logo__edit_logo({
  prompt: 'Restyle the existing logo with a vintage distressed texture and aged color palette inspired by the uploaded reference image, preserving the current icon and brand name.',
  layout: 'horizontal',
});
```
</example>
