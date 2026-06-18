---
name: media-upload
description: Place user chat uploads and Asset Manager files on the site — logos, hero/background images, product photos, and other site content. Uses media slots and import_upload, not AI generation.
whenToUse: User uploaded files in chat or selected uploads in Asset Manager and wants them on the site. Phrases like "use this photo", "add my image to the menu", "put this on the homepage", "use the file I uploaded". Do NOT use for AI-generated images (media-image), AI logos (media-logo), or stock Getty search (media tool search action alone).
---

## Before you act

1. Read **Upload Classification** and **Upload handling** in the current message context (or persisted classification on follow-up turns).
2. Follow that block exactly — it overrides generic defaults for each file.
3. Load this skill when you need to **place** uploads in code, not when the user only shared reference/inspiration.

## Decision order

| Signal | Action |
| ------ | ------ |
| `placementIntent: "reference_only"` | Design direction only — do NOT embed in code or register slots |
| `placementIntent: "unclear"` | Ask where it should go; do not embed yet |
| `assetRole: "logo"` + display on site | Copy to `public/assets/` with create + empty `file_text`; use `/assets/…` in code (not a media slot) |
| **Upload handling** includes a `slotUrl` | Use that URL in `<img src="…">` or CSS `background-image` — already registered |
| `display_on_site`, no slot yet | `media({ action: "import_upload", slot: "…", filename: "…" })` then use returned `slotUrl` |
| Non-image files (PDF, font, data) | Copy to `public/assets/`, `public/fonts/`, or `public/data/`; reference project paths |

## import_upload workflow

Use the **stored upload filename** from Upload handling or upload metadata — not the original display name.

```typescript
media({
  action: 'import_upload',
  slot: 'menu/carne-asada-taco', // semantic path — see slot naming below
  filename: 'stored-upload-filename.jpg',
})
// → use structuredContent.slotUrl in code
```

**Slot naming:** `{location}/{descriptive-name}` — e.g. `pages/home/hero`, `products/sunrise-blend`, `team/sarah-chen`. Use item identity for distinct content; numbers only for interchangeable gallery slides.

**Replacing an existing slot:** pass the **exact** existing slot path so the Media Panel updates in place.

**Adding vs replacing — one slot per position:** each position on the page (each card, each section image) is its own slot. ADDING the image as a new element → choose a NEW slot name. REPLACING the image in an existing element → reuse that element's exact slot path. The same uploaded file can back several slots; they stay independent, so editing one position later never changes another. Do NOT reuse another element's slot just because the image is already registered — "already registered" only means the file is stored once, not that it must share one slot. Only the hero/background own a single fixed slot.

## Talking to the user

Describe what changed in plain language — "your photo is now the hero image", "added as the first card in your Favourites section". Never surface slot names, `/airo-assets/…` URLs, or file paths in your reply; they are internal plumbing and mean nothing to the customer.

## Forbidden

- `/files/uploads/…` or agent API URLs in source code (break in production)
- Copying site photos to `public/assets/` when they belong in `/airo-assets/images/{slot}`
- Registering `reference_only` uploads
- Using `media-image` or `media-logo` to "import" a raw chat file — those skills are for AI generation; use `import_upload` or `/assets/` for logos

## Related skills

- **media-logo** — generate or regenerate an AI logo (optionally using an upload as `referenceUrl` for inspiration)
- **media-image** — AI-generate or edit images into slots
- **media** (search) — stock Getty photos/videos, not user uploads
