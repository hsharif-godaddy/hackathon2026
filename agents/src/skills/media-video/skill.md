---
name: media-video
description: AI video generation from text prompts.
whenToUse: User wants to generate a video, create a video clip, make a video. Use the media tool with mediaType video for stock search — not this skill.
---

# Media Video Skill

Generate videos from text prompts via `ImagegenService`.

## Placement

1. Tool returns `structuredContent.url` (mp4).
2. **Place immediately** when building pages — use `<video src={url} controls playsInline />` (add `poster` for a preview frame).
3. **Present first** when the user only asked to generate a clip; embed when they ask.

## Usage Notes

1. **Warn the user** generation takes up to 5 minutes — the tool blocks until complete or timeout.
2. Duration must be exactly 5, 6, 7, or 8 seconds.
3. Write detailed, vivid prompts for best results.
4. **Fallback:** if generation fails or service is unavailable, use the `media` tool with `mediaType: 'video'` for stock video.
5. On error: simplify the prompt, verify duration, then fall back to stock video.
