---
name: media-video
description: AI video generation from text prompts.
whenToUse: User wants to generate a video, create a video clip, make a video. Use the media tool with mediaType video for stock search — not this skill.
---

# Media Video Skill

Generate videos from text prompts via `ImagegenService`.

## Placement

1. Tool returns `structuredContent.url` (mp4) and `structuredContent.slotUrl` for the proxy-resolved path.
2. **Always pass `slotName`** — this registers the video in the Media Panel so the user can manage it.
   - **Replacing an existing image/video slot:** pass the EXACT existing slot path (e.g., `"pages/home/featured-1"`). This updates that slot in-place so the Media Panel grid reflects the change.
   - **New placement:** use the standard slot naming convention (e.g., `"pages/home/hero"`).
3. When `slotUrl` is returned, use it in source code (`<video src={slotUrl} ...>`) instead of the raw URL — this enables runtime resolution and user swapping.
4. **Present first** when the user only asked to generate a clip; embed when they ask.

## Usage Notes

1. **Warn the user** generation takes up to 5 minutes — the tool blocks until complete or timeout.
2. Duration must be exactly 5, 6, 7, or 8 seconds.
3. Write detailed, vivid prompts for best results.
4. **Fallback:** if generation fails or service is unavailable, use the `media` tool with `mediaType: 'video'` for stock video.
5. On error: simplify the prompt, verify duration, then fall back to stock video.
