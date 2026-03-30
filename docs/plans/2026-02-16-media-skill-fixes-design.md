---
status: implemented
---

# Media Skill Fixes Design

**Date:** 2026-02-16
**Status:** Approved

## Problem Statement

The media skill integration has two main issues:

1. **Tool Selection:** The LLM defaults to using `media__generate_*` skill tools (AI generation) instead of the `media` slot tool (stock photo search) for image requests
2. **Visual Rendering:** The generation tool renderers (`LogoGeneratorToolRenderer`, `ImageGeneratorToolRenderer`, `VideoGeneratorToolRenderer`) don't follow the standard styling patterns and don't display the generation prompts

## Goals

- Default behavior should be stock photo search via `media` tool
- AI generation should only be triggered when user explicitly requests it (generate, create, design, etc.)
- Generation tool renderers should match the styling of `MediaSearchToolRenderer`
- Generation prompts should be visible to users

## Design

### Part 1: Tool Selection Fixes

#### 1.1 Media Skill Update (`agents/src/skills/media/skill.md`)

Update the "When to Use This Skill" section to require explicit generation intent:

```markdown
## When to Use This Skill

**IMPORTANT:** This skill is for AI GENERATION only, not for searching stock photos/videos.

Load this skill ONLY when the user explicitly requests AI-generated content using words like:

- "generate", "create", "make", "design", "AI-generated"
- "edit an image", "modify this image" (for image editing)

**Examples that SHOULD load this skill:**

- "Generate a logo for my business"
- "Create an AI image of a sunset"
- "Design a custom banner"

**Examples that should NOT load this skill (use media search instead):**

- "Add an image of a sunset" → use `media` tool
- "Find a photo of a team meeting" → use `media` tool
- "I need a hero image" → use `media` tool

Default to stock photo search. Only use AI generation when explicitly requested.
```

#### 1.2 Develop Agent Prompt Update (`agents/src/prompts/develop/core.md`)

Update the Media Search section to:

- Reference correct tool name (`media` instead of `mediaSearch`)
- Add clear decision guidance for search vs generation

````markdown
### Media (Images & Videos)

Use the `media` tool for searching stock images and videos:

```typescript
// Search for images (default behavior)
media({
  slot: "pages/home/hero",
  query: "modern office workspace",
  orientations: "horizontal",
  compositions: "wide_shot",
  count: 3,
});

// Search for videos
media({
  slot: "pages/home/background-video",
  query: "ocean waves",
  mediaType: "video",
});
```
````

**Search vs Generation Decision:**

- **Default to search** - Use the `media` tool for most image/video requests
- **Only generate** when user explicitly says "generate", "create", "design", "AI-generated", or "make me a [custom thing]"
- For generation: load the `media` skill with `skill({ action: "load", skill: "media" })`

**Filters**: `orientations` (horizontal/vertical/square), `compositions` (close_up/wide_shot/portrait)

```

### Part 2: Visual Rendering Fixes

#### 2.1 LogoGeneratorToolRenderer

**File:** `app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx`

**Changes:**
- Replace custom modal implementation with `MediaModal` component
- Change grid from `grid-cols-2` to `grid-cols-4`
- Change gap from `gap-2` to `gap-1.5`
- Add prompt display showing business name/description

#### 2.2 ImageGeneratorToolRenderer

**File:** `app/src/app/develop/components/tool-renderers/ImageGeneratorToolRenderer.tsx`

**Changes:**
- Change grid from `grid-cols-3` to `grid-cols-4`
- Change gap from `gap-2` to `gap-1.5`
- Change aspect ratio from `aspect-video` to `aspect-square`
- Add prompt display showing generation prompt

#### 2.3 VideoGeneratorToolRenderer

**File:** `app/src/app/develop/components/tool-renderers/VideoGeneratorToolRenderer.tsx`

**Changes:**
- Add prompt display showing generation prompt
- Keep `aspect-video` (appropriate for video content)

#### 2.4 Styling Consistency Target

| Property | Before | After (Match MediaSearch) |
|----------|--------|---------------------------|
| Grid | cols-2 / cols-3 | cols-4 |
| Gap | gap-2 | gap-1.5 |
| Aspect | square / video | square (images), video (videos) |
| Modal | Custom / MediaModal | MediaModal for all |
| Prompt | Not shown | Show input prompt |

## Files to Modify

1. `agents/src/skills/media/skill.md`
2. `agents/src/prompts/develop/core.md`
3. `app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx`
4. `app/src/app/develop/components/tool-renderers/ImageGeneratorToolRenderer.tsx`
5. `app/src/app/develop/components/tool-renderers/VideoGeneratorToolRenderer.tsx`

## Testing

**Tool Selection:**
- "Add an image of mountains" → should use `media` tool (search)
- "Generate an AI image of mountains" → should load skill, use `media__generate_image`
- "I need a hero image" → should use `media` tool (search)
- "Create a logo for my coffee shop" → should load skill, use `media__generate_logo`

**Visual Rendering:**
- Verify 4-column grid layout in all image renderers
- Verify prompt is displayed in all three generation renderers
- Verify LogoGenerator modal works with MediaModal
- Test keyboard navigation in modals

## Out of Scope

- Changes to the `media` slot tool itself
- Changes to the `mediaSearch` tool
- Creating a MediaSlotToolRenderer (DefaultToolRenderer is acceptable)
```
