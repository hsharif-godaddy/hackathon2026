# Media Skill Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix media skill tool selection (default to search, not generation) and standardize generation tool renderer styling.

**Architecture:** Prompt engineering changes to guide LLM behavior + React component refactoring to match existing patterns.

**Tech Stack:** Markdown (prompts), React, TypeScript, Tailwind CSS, UXCore

---

## Task 1: Update Media Skill "When to Use" Section

**Files:**

- Modify: `agents/src/skills/media/skill.md:14-26`

**Step 1: Read current file to understand context**

Run: Read `agents/src/skills/media/skill.md`

**Step 2: Update the "When to Use This Skill" section**

Replace lines 14-26 with:

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

**Examples that should NOT load this skill (use media tool for search instead):**

- "Add an image of a sunset" → use `media` tool
- "Find a photo of a team meeting" → use `media` tool
- "I need a hero image" → use `media` tool

Default to stock photo search. Only use AI generation when explicitly requested.
```

**Step 3: Verify the file looks correct**

Run: Read `agents/src/skills/media/skill.md` and verify changes

**Step 4: Commit**

```bash
git add agents/src/skills/media/skill.md
git commit -m "docs(media-skill): clarify when to use generation vs search"
```

---

## Task 2: Update Develop Agent Core Prompt

**Files:**

- Modify: `agents/src/prompts/develop/core.md:209-229`

**Step 1: Read current Media Search section**

Run: Read `agents/src/prompts/develop/core.md` lines 200-240

**Step 2: Replace the Media Search section**

Find the `### Media Search` section (around line 209) and replace it with:

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

````

**Step 3: Verify changes**

Run: Read `agents/src/prompts/develop/core.md` lines 200-250

**Step 4: Commit**

```bash
git add agents/src/prompts/develop/core.md
git commit -m "docs(develop-agent): clarify media search vs generation decision"
````

---

## Task 3: Fix ImageGeneratorToolRenderer - Grid and Aspect

**Files:**

- Modify: `app/src/app/develop/components/tool-renderers/ImageGeneratorToolRenderer.tsx`

**Step 1: Read current file**

Run: Read `app/src/app/develop/components/tool-renderers/ImageGeneratorToolRenderer.tsx`

**Step 2: Parse input to get prompt**

Add after line 35 (after the `images` array declaration):

```tsx
// Parse input to get the generation prompt
let generationPrompt = "Image";
if (_input) {
  try {
    const inputObj = typeof _input === "string" ? JSON.parse(_input) : _input;
    generationPrompt = inputObj?.prompt || "Image";
  } catch {
    // Keep default
  }
}
```

**Step 3: Update the grid layout**

Change line 164 from:

```tsx
<div className="grid grid-cols-3 gap-2">
```

To:

```tsx
<div className="grid grid-cols-4 gap-1.5">
```

**Step 4: Update the image button aspect ratio**

Change line 169 from:

```tsx
className =
  "aspect-video group cursor-pointer overflow-hidden rounded-lg border-2 border-border hover:border-primary transition-all bg-intents-ux-boxLowContrast-backgroundColor relative";
```

To:

```tsx
className = "aspect-square group cursor-pointer overflow-hidden rounded-md";
```

**Step 5: Update the completed text to show prompt**

Change line 161-163 from:

```tsx
<div className="text-sm text-foreground/70 mb-2 flex items-center gap-1">
  <Sparkles className="w-3 h-3" />
  <span>
    Generated {imageCount} image{imageCount !== 1 ? "s" : ""}
  </span>
</div>
```

To:

```tsx
<div className="text-sm text-foreground/70 mb-2 flex items-center gap-1">
  <Sparkles className="w-3 h-3" />
  <span>
    Generated {imageCount} image{imageCount !== 1 ? "s" : ""}: &quot;
    {generationPrompt.length > 50
      ? generationPrompt.substring(0, 50) + "..."
      : generationPrompt}
    &quot;
  </span>
</div>
```

**Step 6: Run typecheck**

Run: `pnpm --filter website typecheck`
Expected: No errors

**Step 7: Commit**

```bash
git add app/src/app/develop/components/tool-renderers/ImageGeneratorToolRenderer.tsx
git commit -m "fix(ImageGeneratorToolRenderer): match MediaSearch grid style and show prompt"
```

---

## Task 4: Fix VideoGeneratorToolRenderer - Add Prompt Display

**Files:**

- Modify: `app/src/app/develop/components/tool-renderers/VideoGeneratorToolRenderer.tsx`

**Step 1: Read current file**

Run: Read `app/src/app/develop/components/tool-renderers/VideoGeneratorToolRenderer.tsx`

**Step 2: Parse input to get prompt**

Add after line 33 (after `let video: VideoResult | null = null`):

```tsx
// Parse input to get the generation prompt
let generationPrompt = "Video";
if (_input) {
  try {
    const inputObj = typeof _input === "string" ? JSON.parse(_input) : _input;
    generationPrompt = inputObj?.prompt || "Video";
  } catch {
    // Keep default
  }
}
```

**Step 3: Update the completed text to show prompt**

Change lines 144-147 from:

```tsx
<div className="text-sm text-foreground/70 mb-2 flex items-center gap-1">
  <Video className="w-3 h-3" />
  <span>Generated video</span>
</div>
```

To:

```tsx
<div className="text-sm text-foreground/70 mb-2 flex items-center gap-1">
  <Video className="w-3 h-3" />
  <span>
    Generated video: &quot;
    {generationPrompt.length > 50
      ? generationPrompt.substring(0, 50) + "..."
      : generationPrompt}
    &quot;
  </span>
</div>
```

**Step 4: Run typecheck**

Run: `pnpm --filter website typecheck`
Expected: No errors

**Step 5: Commit**

```bash
git add app/src/app/develop/components/tool-renderers/VideoGeneratorToolRenderer.tsx
git commit -m "fix(VideoGeneratorToolRenderer): show generation prompt"
```

---

## Task 5: Fix LogoGeneratorToolRenderer - Migrate to MediaModal

**Files:**

- Modify: `app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx`

**Step 1: Read current file**

Run: Read `app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx`

**Step 2: Add MediaModal import and remove unused imports**

Change the imports at the top. Remove `AnimatePresence`, `motion`, and `createPortal`:

```tsx
"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { DefaultToolRendererProps } from "@/app/develop/components/tool-renderers/DefaultToolRenderer";
import MediaModal from "@/app/develop/components/tool-renderers/MediaModal";
import ToolHeader from "@/app/develop/components/tool-renderers/ToolHeader";
import { logger } from "@/lib/request-context";
```

**Step 3: Parse input to get business name**

Add after line 48 (after `const logos: LogoResult[] = []`):

```tsx
// Parse input to get business name for display
let businessName = "Logo";
if (_input) {
  try {
    const inputObj = typeof _input === "string" ? JSON.parse(_input) : _input;
    businessName = inputObj?.businessName || "Logo";
  } catch {
    // Keep default
  }
}
```

**Step 4: Update the grid layout**

Change line 299 from:

```tsx
<div className="grid grid-cols-2 gap-2">
```

To:

```tsx
<div className="grid grid-cols-4 gap-1.5">
```

**Step 5: Update the logo button styling**

Change line 304 from:

```tsx
className =
  "aspect-square group cursor-pointer overflow-hidden rounded-lg border-2 border-border hover:border-primary transition-all bg-intents-ux-boxLowContrast-backgroundColor relative";
```

To:

```tsx
className = "aspect-square group cursor-pointer overflow-hidden rounded-md";
```

**Step 6: Update the completed text to show business name**

Change lines 295-298 from:

```tsx
<div className="text-sm text-foreground/70 mb-2 flex items-center gap-1">
  <Sparkles className="w-3 h-3" />
  <span>
    Generated {logoCount} logo{logoCount !== 1 ? "s" : ""}
  </span>
</div>
```

To:

```tsx
<div className="text-sm text-foreground/70 mb-2 flex items-center gap-1">
  <Sparkles className="w-3 h-3" />
  <span>
    Generated {logoCount} logo{logoCount !== 1 ? "s" : ""} for &quot;
    {businessName}&quot;
  </span>
</div>
```

**Step 7: Replace custom modal with MediaModal**

Delete the entire `modalContent` variable (lines 145-275) and replace it with using `MediaModal` component at the end of the return statement.

Replace the return statement (from around line 280 to end) with:

```tsx
return (
  <div>
    {shouldShowHeader && (
      <ToolHeader
        icon={<Sparkles className="w-2 h-2" />}
        displayName={
          toolStatus === "completed" && hasLogos
            ? `Generated ${logoCount} logos`
            : "Generating logos..."
        }
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={hasDetails ? () => setIsModalOpen(true) : undefined}
      />
    )}

    {/* Logo gallery grid */}
    {toolStatus === "completed" && hasLogos && (
      <div className="my-2">
        <div className="text-sm text-foreground/70 mb-2 flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          <span>
            Generated {logoCount} logo{logoCount !== 1 ? "s" : ""} for &quot;
            {businessName}&quot;
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {logos.map((logo, index) => (
            <button
              key={logo.id || index}
              onClick={() => handleLogoClick(index)}
              className="aspect-square group cursor-pointer overflow-hidden rounded-md"
              title={
                logo.logoFeatures?.logoStyle
                  ? `${logo.logoFeatures.logoStyle} Style`
                  : `Logo ${index + 1}`
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logo.url}
                alt={`Logo ${index + 1}`}
                className="w-full h-full object-contain p-1 opacity-90 group-hover:opacity-100 transition-all hover:scale-105"
              />
            </button>
          ))}
        </div>
      </div>
    )}

    <MediaModal
      isOpen={isModalOpen}
      onClose={handleModalClose}
      title="Generated Logos"
      maxWidth="max-w-2xl"
    >
      {/* Logo thumbnails navigation */}
      {logos.length > 1 && (
        <div className="flex flex-nowrap gap-2 mb-3 overflow-x-auto pb-2 w-full">
          {logos.map((logo, index) => (
            <button
              key={logo.id || index}
              ref={(el) => {
                thumbnailRefs.current[index] = el;
              }}
              onClick={() => setSelectedLogoIndex(index)}
              className={`flex-shrink-0 w-16 h-16 rounded-lg border-4 overflow-hidden transition-all hover:cursor-pointer hover:opacity-100 bg-intents-ux-boxLowContrast-backgroundColor ${
                selectedLogoIndex === index
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border opacity-70"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logo.url}
                alt={`Logo ${index + 1}`}
                className="w-full h-full object-contain"
              />
            </button>
          ))}
        </div>
      )}

      {/* Logo counter */}
      {logos.length > 1 && (
        <div className="w-full text-center mb-3 pb-2 border-b border-border">
          <p className="text-sm text-foreground/60">
            {selectedLogoIndex + 1} of {logos.length}
          </p>
        </div>
      )}

      <div className="flex flex-col items-center">
        {/* Color palette display */}
        {selectedLogo?.palette && selectedLogo.palette.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-foreground/70">Colors:</span>
            <div className="flex gap-1">
              {selectedLogo.palette.map((color, i) => (
                <div
                  key={i}
                  className="w-6 h-6 rounded-full border border-border shadow-sm"
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>
        )}

        {/* Main logo image */}
        <div className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-4 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={selectedLogo?.url}
            alt={`Logo ${selectedLogoIndex + 1}`}
            className="max-w-full max-h-[50vh] object-contain"
          />
        </div>

        {/* Mockup preview if available */}
        {selectedLogo?.mockupUrl && (
          <div className="mt-4 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-4 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedLogo.mockupUrl}
              alt="Logo mockup"
              className="max-w-full max-h-[30vh] object-contain rounded"
            />
          </div>
        )}
      </div>
    </MediaModal>
  </div>
);
```

**Step 8: Run typecheck**

Run: `pnpm --filter website typecheck`
Expected: No errors

**Step 9: Run lint**

Run: `pnpm --filter website lint`
Expected: No errors (or only pre-existing warnings)

**Step 10: Commit**

```bash
git add app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx
git commit -m "fix(LogoGeneratorToolRenderer): migrate to MediaModal and match grid style"
```

---

## Task 6: Final Verification

**Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: No errors

**Step 2: Run full lint**

Run: `pnpm lint`
Expected: No new errors

**Step 3: Build check**

Run: `pnpm build`
Expected: Build succeeds

**Step 4: Commit any formatting fixes**

If lint/prettier made changes:

```bash
git add -A
git commit -m "style: apply formatting fixes"
```

---

## Testing Checklist (Manual)

After implementation, manually test:

1. **Tool Selection Tests:**

   - [ ] "Add an image of mountains" → uses `media` tool (search)
   - [ ] "Generate an AI image of mountains" → loads skill, uses `media__generate_image`
   - [ ] "I need a hero image" → uses `media` tool (search)
   - [ ] "Create a logo for my coffee shop" → loads skill, uses `media__generate_logo`

2. **Visual Rendering Tests:**
   - [ ] ImageGeneratorToolRenderer shows 4-column grid with square images
   - [ ] ImageGeneratorToolRenderer shows generation prompt
   - [ ] VideoGeneratorToolRenderer shows generation prompt
   - [ ] LogoGeneratorToolRenderer shows 4-column grid
   - [ ] LogoGeneratorToolRenderer shows business name
   - [ ] LogoGeneratorToolRenderer modal opens/closes correctly
   - [ ] Keyboard navigation (arrow keys) works in all modals
