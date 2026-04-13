---
name: media
description: AI generation of logos, images, and videos. Only load when user explicitly says "generate", "create", or "design" - for stock photos use the media tool instead.
whenToUse: User wants AI-generated images, logos, or videos (NOT stock photos). Phrases like "generate a logo", "create an image", "design a banner". Do NOT use for stock photo search — use the media tool instead.
---

# Media Skill

**Purpose:** Generate professional logos, images, and videos for applications using AI-powered services.

> **Note:** This skill provides specialized tools for media generation that are automatically loaded when you activate the skill. Tools are prefixed with the skill name (e.g., `media__generate_logo`) to prevent naming conflicts. You can unload a skill's tools with `skill({ action: 'unload', skill: 'media' })` when no longer needed.

---

## Backend Services

Each tool in this skill is backed by a dedicated service. Understanding which service handles each operation is important for debugging and error handling.

| Tool                    | Service           | File                                     | API Endpoint               |
| ----------------------- | ----------------- | ---------------------------------------- | -------------------------- |
| `media__generate_logo`  | `LogoService`     | `agents/src/services/LogoService.ts`     | `POST /api/logo`           |
| `media__generate_image` | `ImagegenService` | `agents/src/services/ImagegenService.ts` | `POST /v2/api/images`      |
| `media__edit_image`     | `ImagegenService` | `agents/src/services/ImagegenService.ts` | `POST /v2/api/images/edit` |
| `media__generate_video` | `ImagegenService` | `agents/src/services/ImagegenService.ts` | `POST /v2/api/videos`      |

---

## Choosing the Right Tool

| User request                         | Tool to use                                                  |
| ------------------------------------ | ------------------------------------------------------------ |
| "Generate a logo for my business"    | `media__generate_logo` (auto-saves to slot)                  |
| "Use logo 1" (after generation)      | Click in LogoGridWidget swaps slot automatically             |
| "Make the logo transparent"          | Use the slot URL with no `?variant` (default is transparent) |
| "Use the solid version"              | Use the slot URL with `?variant=solid`                       |
| "Create an AI image of a sunset"     | `media__generate_image`                                      |
| "Design a custom banner"             | `media__generate_image`                                      |
| "Add a vintage filter to this photo" | `media__edit_image`                                          |
| "Generate a short video clip"        | `media__generate_video`                                      |

---

## Available Tools

### Logo Generation

**`media__generate_logo`** — Generate professional logos and auto-save to the media slot system

**Backed by:** `LogoService` → `logo-agent` API (`POST /api/logo`)

| Parameter          | Type         | Required | Description                                     |
| ------------------ | ------------ | -------- | ----------------------------------------------- |
| `brandName`        | string       | Yes      | Primary text for the logo (business/brand name) |
| `brandTagline`     | string       | No       | Secondary text like tagline or slogan           |
| `brandDescription` | string       | Yes      | What the business does — informs visual choices |
| `style`            | enum         | Yes      | Logo style preset (see options below)           |
| `styleDescription` | string       | No       | Additional custom style direction               |
| `symbol`           | string       | No       | Icon or imagery to incorporate                  |
| `brandColors`      | string       | No       | Color preferences as description                |
| `brandPersonality` | string       | No       | Brand personality traits                        |
| `brandAudience`    | string       | No       | Target audience description                     |
| `count`            | number (1-4) | No       | Number of logo variations (default: 4)          |

**Style options:** `line`, `glyph`, `full-color`, `dual-tone`, `3d`, `badge`, `colored-line`, `handmade`, `mascot`, `monogram`, `name-mark`

**Example:**

```typescript
media__generate_logo({
  brandName: 'Sunrise Cafe',
  brandDescription: 'A cozy neighborhood coffee shop serving artisan coffee and fresh pastries',
  style: 'handmade',
  styleDescription: 'warm and welcoming',
  brandColors: 'warm earth tones with orange accents',
  symbol: 'coffee cup with sunrise',
});
```

**Output Format:**

```typescript
{
  structuredContent: {
    sessionId: string,
    logos: [
      {
        id: string,
        transparentUrl: string,  // PNG with transparent background
        solidUrl: string,        // PNG with solid background
        mockupUrl: string        // Mockup showing logo in context
      }
    ],
    slotUrl: string,   // e.g. "/airo-assets/images/logo/primary"
    slotPath: string   // e.g. "logo/primary"
  }
}
```

All generated logos are **automatically saved** to the media slot system. The first logo's `transparentUrl` is set as the slot's `currentUrl`, with all other logos as alternatives. A `solidUrlMap` (keyed by transparent URL) stores each logo's solid-background variant, so swapping alternatives preserves the correct solid mapping.

**Placement is context-dependent:** See the "Logo Placement Flow" section below for when to place immediately vs. wait for the user.

**Use the `slotUrl` in source code:**

```tsx
// Transparent variant (default):
<img src="/airo-assets/images/logo/primary" alt="Sunrise Cafe logo" />

// Solid variant (for dark backgrounds):
<img src="/airo-assets/images/logo/primary?variant=solid" alt="Sunrise Cafe logo" />
```

> **Note:** Do NOT use `media__generate_image` for logos. `LogoService` produces structured multi-variant output (transparent/solid/mockup) that the generic image generation API cannot provide.

---

### Image Generation

**`media__generate_image`** — Generate images from text prompts

**Backed by:** `ImagegenService` → `imagegen-agent` API (`POST /v2/api/images`)

| Parameter     | Type         | Required | Description                                                         |
| ------------- | ------------ | -------- | ------------------------------------------------------------------- |
| `prompt`      | string       | Yes      | Description of the image to generate (max 1000 chars)               |
| `orientation` | enum         | No       | `'landscape'`, `'portrait'`, or `'square'` (default: `'landscape'`) |
| `imageCount`  | number (1-4) | No       | Number of images to generate (default: 1)                           |

**Example:**

```typescript
media__generate_image({
  prompt: 'Professional business team collaborating in modern office',
  orientation: 'landscape',
  imageCount: 2,
});
```

**Output Format:**

```typescript
{
  structuredContent: {
    sessionId: string,
    images: [
      { id: string, url: string }
    ]
  }
}
```

---

### Image Editing

**`media__edit_image`** — Edit an existing image using AI

**Backed by:** `ImagegenService` → `imagegen-agent` API (`POST /v2/api/images/edit`)

| Parameter  | Type         | Required | Description                                   |
| ---------- | ------------ | -------- | --------------------------------------------- |
| `prompt`   | string       | Yes      | Description of edits to make (max 1000 chars) |
| `imageUrl` | string (URL) | Yes      | URL of the image to edit                      |

**Example:**

```typescript
media__edit_image({
  prompt: 'Add a warm sunset filter and increase the contrast',
  imageUrl: 'https://example.com/image.png',
});
```

**Output Format:**

```typescript
{
  structuredContent: {
    sessionId: string,
    url: string  // URL of the edited image
  }
}
```

> **Transparency limitation:** This tool renders onto an opaque canvas, so edited images always have a solid background. For logos that need transparency, regenerate with `media__generate_logo` — it returns a `transparentUrl` variant that's already transparent with no post-processing needed.

---

### Video Generation

**`media__generate_video`** — Generate videos from text prompts

**Backed by:** `ImagegenService` → `imagegen-agent` API (`POST /v2/api/videos` + polling `GET /v2/api/videos/:sessionId`)

| Parameter     | Type   | Required | Description                                            |
| ------------- | ------ | -------- | ------------------------------------------------------ |
| `prompt`      | string | Yes      | Description of the video (max 1000 chars)              |
| `orientation` | enum   | No       | `'landscape'` or `'portrait'` (default: `'landscape'`) |
| `duration`    | number | Yes      | Duration in seconds: 5, 6, 7, or 8                     |

**Example:**

```typescript
media__generate_video({
  prompt: 'Aerial drone shot of a sunrise over mountain peaks with fog in the valleys',
  orientation: 'landscape',
  duration: 8,
});
```

**Output Format:**

```typescript
{
  structuredContent: {
    sessionId: string,
    url: string  // URL of the completed video (mp4)
  }
}
```

> **Note:** Video generation is asynchronous. `ImagegenService` submits the job then polls the status endpoint every 5 seconds for up to 5 minutes. The tool call will not return until the video is complete or the timeout is reached — inform the user upfront that this may take a few minutes.

---

## Using Generated Media

Logo outputs are **automatically saved to the media slot system**. Always use the returned `slotUrl` (`/airo-assets/images/logo/primary`) in source code. For other generated media (images, videos), use the returned URLs directly — they're persistent and optimized for delivery.

```tsx
// Logo — use slot URL from tool output
<img src="/airo-assets/images/logo/primary" alt="Company Logo" />

// Generated image (url returned by media__generate_image)
<img src={generatedImageUrl} alt="Description" />

// Video (url returned by media__generate_video)
<video src={videoUrl} controls />
```

---

## Logo Placement Flow

After `media__generate_logo` returns, **decide based on context** whether to place the logo in source code immediately or wait for the user:

**Place immediately** when the conversation context implies placement — e.g., the user asked to "build a site with a logo," or you're following a handoff that includes building pages. In this case:

1. Place `/airo-assets/images/logo/primary` in the appropriate `<img>` `src` attributes (header, navbar, footer)
2. For placements on dark backgrounds, use `/airo-assets/images/logo/primary?variant=solid`
3. Continue with remaining build tasks

**Present and wait** when the user only asked to generate a logo — e.g., "generate a logo for my brand." Show the logos and let the user browse them. When the user later asks to place it (e.g., "add the logo to the header"), use the pre-generated slot URL.

The user can swap between logos at any time using the Save button in the LogoGridWidget. The slot URL in source code stays the same — only the underlying image changes.

### Logo Changes

When a user wants to change their logo, **regenerate with `media__generate_logo`** using adjusted parameters (different `style`, `styleDescription`, `symbol`, or `brandColors`) — do not use `media__edit_image` on logos. The user can also swap between previously generated logos via the LogoGridWidget or Image Manager.

---

## Best Practices

### Logo Generation (LogoService)

**Brand Data from Context:**

Before calling `media__generate_logo`, check the conversation context for existing brand information:

- **Brand name**: Use `app.title` from memory context if available
- **Description**: Use `app.description` from memory context if available
- **Colors**: Use the color palette from the app plan context if available

Only ask the user for information that isn't already available in the context. The tool will also auto-enrich missing fields from stored data as a fallback.

**DO:**

- Use known brand data from context before asking the user
- Generate multiple variations (3-4) so user has choices
- Use the returned `slotUrl` in all source code placements
- For transparent background: use slot URL as-is (default is `transparentUrl`)
- For solid background: append `?variant=solid` to the slot URL
- Decide which variant to use based on placement context (background color, container style)
- Fill in aesthetic and style details to get the best results
- **Regenerate with adjusted parameters when the user wants a logo change** — different `style`, `styleDescription`, `symbol`, or `brandColors`

**DON'T:**

- Ask for brand name/description if already known from context
- Use `media__generate_image` for logos — it won't return transparent/solid/mockup variants
- Use `str_replace_based_edit_tool` to create image files — it only writes UTF-8 text and will produce a broken file
- Use `media__edit_image` on logo URLs — the opaque canvas loses transparency, and spatial edits are unreliable. Regenerate with `media__generate_logo` instead
- Use `curl` or `terminalCommand` to download logos to `public/assets/` — files there are gitignored and lost on redeployment
- Assume business details beyond what's in context — ask the user for unknowns

<example>
User: "Move the company name to the right of the icon and make the background transparent"

Correct approach - regenerate with adjusted style description:

```typescript
media__generate_logo({
  brandName: 'Sunrise Cafe',
  brandDescription: 'A cozy neighborhood coffee shop',
  style: 'handmade',
  styleDescription:
    'Icon on the left, company name "Sunrise Cafe" on the right in a horizontal side-by-side layout.',
  symbol: 'coffee cup with sunrise',
  brandColors: 'warm earth tones with orange accents',
  count: 4,
});
// Use the returned slotUrl in source code — transparentUrl is the default
```

Wrong approach - editing the existing logo:

```typescript
// These will fail or produce poor results:
media__edit_image({ prompt: 'Move text to the right...', imageUrl: '...' }); // Can't reposition reliably, loses transparency
terminalCommand({ command: 'curl ... -o public/assets/logo.png' }); // Bypasses delivery infrastructure
terminalCommand({ command: 'npm install jimp' }); // Don't install packages to process images
```

</example>

### Video Generation (ImagegenService)

- Video generation takes up to 5 minutes — `ImagegenService` polls internally until complete
- Duration must be exactly 5, 6, 7, or 8 seconds — no other values are accepted
- Set user expectations upfront: "This will take a few minutes"

---

## Fallback Strategy

If generation services are unavailable, fall back to existing tools:

1. **For logo generation** (`LogoService` down): Inform user; no direct fallback for logo variants
2. **For image generation** (`ImagegenService` down): Use `media` tool (stock photos as alternative)
3. **For image editing** (`ImagegenService` down): Use `imageEditor` tool
4. **For video generation** (`ImagegenService` down): Use `media` tool with `mediaType: 'video'`

---

## Error Handling

If generation fails:

1. Check error message for specific issue
2. Verify all required parameters are provided
3. Try with simpler/shorter prompts
4. Fall back to alternative tools if the generation service is unavailable
5. Inform the user clearly about the issue

---

## Summary

| Tool                    | Service           | Use Case                                                        |
| ----------------------- | ----------------- | --------------------------------------------------------------- |
| `media__generate_logo`  | `LogoService`     | Professional logos — auto-saved with transparent/solid variants |
| `media__generate_image` | `ImagegenService` | Custom AI-generated images                                      |
| `media__edit_image`     | `ImagegenService` | Modify existing images with AI (NOT for logos)                  |
| `media__generate_video` | `ImagegenService` | AI-generated video (async, up to 5min)                          |
