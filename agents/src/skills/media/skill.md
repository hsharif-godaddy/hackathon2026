---
name: media
description: AI generation of logos, images, and videos. Only load when user explicitly says "generate", "create", or "design" - for stock photos use the media tool instead.
whenToUse: User wants AI-generated images, logos, or videos (NOT stock photos). Phrases like "generate a logo", "create an image", "design a banner". Do NOT use for stock photo search — use the media tool instead.
---

# Media Skill

**Purpose:** Generate professional logos, images, and videos for applications using AI-powered services.

> **Note:** This skill provides specialized tools for media generation that are automatically loaded when you activate the skill. Tools are prefixed with the skill name (e.g., `media__generate_logo`) to prevent naming conflicts. You can unload a skill's tools with `skill({ action: 'unload', skill: 'media' })` when no longer needed.

---

## When to Use This Skill

**IMPORTANT:** This skill is for AI GENERATION only, not for searching stock photos/videos.

Load this skill ONLY when the user explicitly requests AI-generated content using words like:

- "generate", "create", "make", "design", "AI-generated"
- "edit an image", "modify this image" (for image editing)

**Examples that SHOULD load this skill:**

- "Generate a logo for my business"
- "Create an AI image of a sunset"
- "Design a custom banner"

**Examples that should NOT load this skill (use media tool for search instead):**

- "Add an image of a sunset" → use `media` tool
- "Find a photo of a team meeting" → use `media` tool
- "I need a hero image" → use `media` tool

Default to stock photo search. Only use AI generation when explicitly requested.

---

## Available Tools

### Logo Generation

**`media__generate_logo`** - Generate professional logos for a business

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

The tool returns a structured response with:

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

---

### Image Generation

**`media__generate_image`** - Generate images from text prompts

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

---

### Image Editing

**`media__edit_image`** - Edit an existing image using AI

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

---

### Video Generation

**`media__generate_video`** - Generate videos from text prompts

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

---

## Using Generated Media

After calling any media generation tool, the response includes CDN URLs (isteam.wsimg.com) to the generated content. These URLs are **already optimized for serving** - do NOT download and save locally.

### Using the CDN URLs Directly

The returned URLs are production-ready CDN links. Use them directly in components:

```tsx
// Logo example - use the CDN URL directly
<img src="https://isteam.wsimg.com/genai-assistant/mcp/generated_logos/abc123.png" alt="Company Logo" />

// Or in Next.js Image component (add domain to next.config.js if needed)
<Image src={logoUrl} alt="Company Logo" width={200} height={200} />

// Video example
<video src="https://isteam.wsimg.com/genai-assistant/mcp/generated_videos/xyz789.mp4" controls />
```

---

## Best Practices

### Logo Generation

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
- Provide clear usage instructions with the CDN URL
- Fill in aesthetic and style details to get the best results (determine style based on brand personality and audience if not specified)

**DON'T:**

- Ask for brand name/description if already known from context
- Use generic image generation for logos (use `generate_logo` instead)
- Download and re-save CDN media locally (wastes storage, slower delivery)
- Assume business details beyond what's in context - ask the user for unknowns

### Image Generation

**When to use `media__generate_image` vs `mediaSearch`:**

- Use `mediaSearch` for stock photos and common imagery
- Use `media__generate_image` when:
  - Image search doesn't find suitable results
  - User explicitly requests AI-generated/custom images
  - Specific creative vision that stock photos can't match
  - Unique compositions or concepts

### Video Generation

- Video generation takes up to 5 minutes — the system polls internally until complete
- Duration must be 5, 6, 7, or 8 seconds

---

## Fallback Strategy

If generation services are unavailable, fall back to existing tools:

1. **For image generation**: Use `media` tool (stock photos as alternative)
2. **For image editing**: Use `imageEditor` tool
3. **For video search**: Use `media` tool with `mediaType: 'video'`

---

## Error Handling

If generation fails:

1. Check error message for specific issue
2. Verify all required parameters are provided
3. Try with simpler/shorter prompts
4. Fall back to alternative tools if generation service is unavailable
5. Inform user clearly about the issue

---

## Summary

| Tool                    | Use Case                          |
| ----------------------- | --------------------------------- |
| `media__generate_logo`  | Professional logos for businesses |
| `media__generate_image` | Custom AI-generated images        |
| `media__edit_image`     | Modify existing images with AI    |
| `media__generate_video` | AI-generated video content        |
