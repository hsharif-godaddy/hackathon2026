---
name: media-image
description: AI image generation and editing. Load when user wants to generate a custom AI image or edit an existing image.
whenToUse: User wants AI-generated images or image editing. Phrases like "generate an image", "create a custom image", "design a banner", "edit this image", "add a filter". Do NOT use for logos (use media-logo) or stock photos (use the media tool directly).
---

## Placement

1. `generate_image` returns `structuredContent.images[].url` and `structuredContent.slotUrl` for the proxy-resolved path; `edit_image` returns `structuredContent.url`.
2. **Always pass `slotName`** — this registers the images in the Media Panel so the user can manage them.
   - **Replacing an existing image slot:** pass the EXACT existing slot path (e.g., `"pages/home/hero"`). This updates that slot in-place so the Media Panel grid reflects the change.
   - **New placement:** use the standard slot naming convention (e.g., `"pages/about/featured-1"`).
3. When `slotUrl` is returned, use it in source code (`<img src={slotUrl} alt="..." />` or CSS `background-image`) instead of the raw CDN URL — this enables runtime resolution and user swapping.
4. **Present first** when the user only asked to generate/edit an image; place into the site when they ask.

## Key Constraints

- **Opaque canvas:** `edit_image` renders onto a solid background — no transparency. For transparent logos, use `media-logo__generate_logo` which returns a `transparentUrl` variant.

## Fallback

- Image generation unavailable → use `media` tool (stock photos)
- Image editing unavailable → use `imageEditor` tool
- On failure: check error, simplify prompt, fall back to alternatives, inform user
