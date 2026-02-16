---
name: media
description: AI generation of logos, images, and videos. Only load when user explicitly says "generate", "create", or "design" - for stock photos use the media tool instead.
---

# Media Skill

**Purpose:** Generate professional logos, images, and videos for applications using AI-powered MCP services.

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

| Parameter             | Type             | Required | Description                                                                                                        |
| --------------------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `businessName`        | string           | Yes      | Name of the business/app                                                                                           |
| `businessDescription` | string           | Yes      | What the business does (1-2 sentences)                                                                             |
| `businessVibe`        | string           | No       | Desired feeling (modern, playful, professional, elegant, minimalist, bold)                                         |
| `logoColors`          | string or object | No       | Color preferences - either natural language ("warm earth tones") or `{ description: string, hexValues: string[] }` |
| `logoSymbol`          | string           | No       | Specific icon/symbol (e.g., "coffee cup", "mountain", "shield")                                                    |
| `logoText`            | string           | No       | Text to incorporate into the logo                                                                                  |
| `logoCount`           | number (1-4)     | No       | Number of variations to generate (default: 4)                                                                      |

**Example:**

```typescript
media__generate_logo({
  businessName: 'Sunrise Cafe',
  businessDescription: 'A cozy neighborhood coffee shop serving artisan coffee and fresh pastries',
  businessVibe: 'warm and welcoming',
  logoColors: 'warm earth tones with orange accents',
  logoSymbol: 'coffee cup with sunrise',
});
```

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

| Parameter     | Type   | Required | Description                                                                    |
| ------------- | ------ | -------- | ------------------------------------------------------------------------------ |
| `prompt`      | string | Yes      | Description of the video (max 1000 chars)                                      |
| `model`       | enum   | No       | `'sora-2'`, `'veo-2'`, or `'veo-3'` (default: `'veo-2'`)                       |
| `orientation` | enum   | No       | `'landscape'` or `'portrait'` (default: `'landscape'`)                         |
| `duration`    | string | No       | Duration in seconds (model-specific: sora-2: 4/8/12, veo-2: 5-8, veo-3: 4/6/8) |

**Example:**

```typescript
media__generate_video({
  prompt: 'Aerial drone shot of a sunrise over mountain peaks with fog in the valleys',
  model: 'veo-2',
  orientation: 'landscape',
  duration: '8',
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

**DO:**

- Always ask for business name and description before generating
- Offer style customization options (vibe, colors, symbols)
- Generate multiple variations (3-4) so user has choices
- Use the CDN URLs directly in components
- Provide clear usage instructions with the CDN URL

**DON'T:**

- Generate logos without gathering business context first
- Use generic image generation for logos (use `generate_logo` instead)
- Download and re-save CDN media locally (wastes storage, slower delivery)
- Assume business details - always ask the user

### Image Generation

**When to use `media__generate_image` vs `mediaSearch`:**

- Use `mediaSearch` for stock photos and common imagery
- Use `media__generate_image` when:
  - Image search doesn't find suitable results
  - User explicitly requests AI-generated/custom images
  - Specific creative vision that stock photos can't match
  - Unique compositions or concepts

### Video Generation

- Video generation takes longer (30-120 seconds)
- Choose the right model for the use case:
  - `veo-2`: Best balance of quality and speed (recommended default)
  - `sora-2`: Good for shorter clips
  - `veo-3`: Highest quality, longer processing

---

## Fallback Strategy

If MCP servers are unavailable, fall back to existing tools:

1. **For image generation**: Use `media` tool (stock photos as alternative)
2. **For image editing**: Use `imageEditor` tool
3. **For video search**: Use `media` tool with `mediaType: 'video'`

---

## Error Handling

If generation fails:

1. Check error message for specific issue
2. Verify all required parameters are provided
3. Try with simpler/shorter prompts
4. Fall back to alternative tools if MCP server is down
5. Inform user clearly about the issue

---

## Summary

| Tool                    | Use Case                          |
| ----------------------- | --------------------------------- |
| `media__generate_logo`  | Professional logos for businesses |
| `media__generate_image` | Custom AI-generated images        |
| `media__edit_image`     | Modify existing images with AI    |
| `media__generate_video` | AI-generated video content        |
