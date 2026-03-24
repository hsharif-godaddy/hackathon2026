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

| User request                               | Tool to use             |
| ------------------------------------------ | ----------------------- |
| "Generate a logo for my business"          | `media__generate_logo`  |
| "Create an AI image of a sunset"           | `media__generate_image` |
| "Design a custom banner"                   | `media__generate_image` |
| "Edit this photo to remove the background" | `media__edit_image`     |
| "Generate a short video clip"              | `media__generate_video` |

---

## Available Tools

### Logo Generation

**`media__generate_logo`** — Generate professional logos for a business

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
    ]
  }
}
```

Use `transparentUrl` or `solidUrl` for placing the logo. The `mockupUrl` shows the logo in a realistic context.

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
  prompt: 'Remove the background and replace with a gradient blue sky',
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

After calling any media generation tool, the response includes CDN URLs (`isteam.wsimg.com`) to the generated content. These URLs are **already optimized for serving** — do NOT download and save locally.

### Using the CDN URLs Directly

```tsx
// Logo — prefer transparentUrl for placement, solidUrl for opaque backgrounds
<img src="https://isteam.wsimg.com/genai-assistant/mcp/generated_logos/abc123.png" alt="Company Logo" />

// Next.js Image component (add isteam.wsimg.com to next.config.js remotePatterns if needed)
<Image src={logoUrl} alt="Company Logo" width={200} height={200} />

// Video
<video src="https://isteam.wsimg.com/genai-assistant/mcp/generated_videos/xyz789.mp4" controls />
```

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
- Offer style customization options (style preset, colors, symbol)
- Generate multiple variations (3-4) so user has choices
- Use the CDN URLs directly in components
- Fill in aesthetic and style details to get the best results (determine style based on brand personality and audience if not specified)

**DON'T:**

- Ask for brand name/description if already known from context
- Use `media__generate_image` for logos — it won't return transparent/solid/mockup variants
- Download and re-save CDN media locally (wastes storage, slower delivery)
- Assume business details beyond what's in context — ask the user for unknowns

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

| Tool                    | Service           | Use Case                                                             |
| ----------------------- | ----------------- | -------------------------------------------------------------------- |
| `media__generate_logo`  | `LogoService`     | Professional logos — multi-variant output (transparent/solid/mockup) |
| `media__generate_image` | `ImagegenService` | Custom AI-generated images                                           |
| `media__edit_image`     | `ImagegenService` | Modify existing images with AI                                       |
| `media__generate_video` | `ImagegenService` | AI-generated video (async, up to 5min)                               |
