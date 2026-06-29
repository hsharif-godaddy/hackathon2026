---
name: media-video
description: Custom or generated video after explicit user confirmation. Not for stock video or code/tool-only requests.
whenToUse: Only when the user explicitly asks for generated, custom video from a text prompt, and stock video or code/tool changes would not be enough. When ambiguous, use stock video.
---

## Cost Gate

Never call `generate_video` on the same turn as the user's original request. First call the global `askQuestion` tool and stop.

Stock video must be the first choice:

```json
{
  "questions": [{
    "question": "Generated videos are experimental, expensive & slow to generate",
    "type": "chips_single",
    "suggestions": [
      { "text": "Search stock videos instead", "value": "stock" },
      { "text": "I understand, continue", "value": "confirmed" }
    ],
    "allowOther": false,
    "multiSelect": false
  }]
}
```

- `stock`: use `media` with `mediaType: 'video'`.
- `confirmed`: now call `generate_video` with `userConfirmed: true`.

The tool also enforces this at runtime: the current user message must be the confirmation answer.

## Generate

- Duration: 4, 8, or 12 seconds.
- Always pass `slotName`; use the exact existing media slot when replacing content.
- Keep prompts simple: one subject, one motion, one mood. Ask for continuous loopable motion when needed.
- Prefer returned `structuredContent.slotUrl` in source: `<video src={slotUrl} loop muted playsInline autoPlay />`.
- If generation fails or budget is exhausted, fall back to stock video.
