---
status: implemented
---

# Logo Generation V2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update logo generation to use v2 API with multiple URL variants and modal-based selection.

**Architecture:** The logo tool already calls `generate_logos_v2`. We need to update the skill documentation, the `LogoData` interface to support new URL fields, modify `LogoGridWidget` to open modal on click, and enhance `LogoGeneratorToolRenderer` with background toggle and in-modal selection.

**Tech Stack:** React, TypeScript, UXCore Button, Tailwind CSS, Custom Events

---

## Task 1: Update Skill Documentation

**Files:**

- Modify: `agents/src/skills/media/skill.md`

**Step 1: Update the skill.md file**

Replace the Logo Generation section with the new v2 API documentation. The new input schema has different field names and adds style presets. The output now includes entitled flag and multiple URL variants.

```markdown
### Logo Generation

**`media__generate_logo`** - Generate professional logos for a business

| Parameter           | Type         | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`              | string       | Yes      | Primary text for the logo (business/brand name)                                                                                                                                                                                                                                                                                                                                                                |
| `tagline`           | string       | No       | Secondary text like tagline, slogan, or "Est. 2020"                                                                                                                                                                                                                                                                                                                                                            |
| `description`       | string       | Yes      | What the business does - informs visual choices for the logo design                                                                                                                                                                                                                                                                                                                                            |
| `style`             | enum         | Yes      | Logo visual style preset. Options: `line` (minimalist line art), `glyph` (iconic symbol), `full-color` (vibrant illustrated), `dual-tone` (two colors), `3d` (depth/dimension), `badge` (emblem/seal), `flat` (modern flat design), `colored-line` (line art with color), `handmade` (hand-drawn feel), `mascot` (character illustration), `monogram` (initials/lettermark), `name-mark` (stylized typography) |
| `styleDescription`  | string       | No       | Additional custom style direction beyond the preset (e.g., "make it more playful" or "corporate and serious")                                                                                                                                                                                                                                                                                                  |
| `symbol`            | string       | No       | Icon or imagery to incorporate into the logo (e.g., "coffee cup", "mountain", "abstract waves")                                                                                                                                                                                                                                                                                                                |
| `colors`            | string       | No       | Color preferences as a description (e.g., "warm orange and brown", "professional blue"). Leave empty for AI to choose appropriate colors.                                                                                                                                                                                                                                                                      |
| `count`             | number (1-4) | No       | Number of logo variations to generate (default: 4)                                                                                                                                                                                                                                                                                                                                                             |
| `refinementLogoUrl` | string (URL) | No       | URL of a specific logo to refine. Use the URL from a previous generation response to create variations of that logo.                                                                                                                                                                                                                                                                                           |

**Example:**

\`\`\`typescript
media\_\_generate_logo({
name: 'Sunrise Cafe',
description: 'A cozy neighborhood coffee shop serving artisan coffee and fresh pastries',
style: 'handmade',
styleDescription: 'warm and welcoming',
colors: 'warm earth tones with orange accents',
symbol: 'coffee cup with sunrise',
});
\`\`\`

**Output Format:**

The tool returns a structured response with:

\`\`\`typescript
{
entitled: boolean, // Whether user gets full-resolution or watermarked logos
logos: [
{
id: string, // Unique ID for this logo
transparentUrl?: string, // PNG with transparent background (entitled only)
solidUrl?: string, // PNG with solid background (entitled only)
watermarkedTransparentUrl?: string, // Watermarked transparent PNG (non-entitled)
watermarkedSolidUrl?: string, // Watermarked solid PNG (non-entitled)
mockupUrl: string // Mockup showing logo in context
}
]
}
\`\`\`

For entitled users, use `transparentUrl` or `solidUrl`. For non-entitled users, use `watermarkedTransparentUrl` or `watermarkedSolidUrl`. The `mockupUrl` is always available and shows the logo in a realistic context.
```

**Step 2: Verify the changes**

Run: `cat agents/src/skills/media/skill.md | grep -A 5 "media__generate_logo"`
Expected: Shows the new description line

**Step 3: Commit**

```bash
git add agents/src/skills/media/skill.md
git commit -m "docs: update media skill with logo generation v2 API"
```

---

## Task 2: Update LogoData Interface

**Files:**

- Modify: `app/src/app/develop/components/widgets/LogoGridWidget.tsx`

**Step 1: Update the LogoData interface**

Find the `LogoData` interface (around line 15) and replace it with the v2 version that includes new URL fields:

```typescript
/**
 * Logo data structure
 */
export interface LogoData {
  id: string;
  // V2 URL variants
  transparentUrl?: string;
  solidUrl?: string;
  watermarkedTransparentUrl?: string;
  watermarkedSolidUrl?: string;
  mockupUrl?: string;
  // Legacy field (deprecated, for backward compat)
  url?: string;
  // Existing optional fields
  logoFeatures?: {
    logoStyle?: string;
    businessDescription?: string;
    logoColors?: {
      description?: string;
      hexValues?: string[];
    };
  };
  foregroundColor?: string;
  backgroundColor?: string;
  palette?: string[];
}
```

**Step 2: Add helper function after the interface**

Add a helper function to get the appropriate display URL based on entitlement and background preference:

```typescript
/**
 * Get the appropriate logo URL based on entitlement and background preference
 */
export function getLogoDisplayUrl(
  logo: LogoData,
  entitled: boolean,
  preferSolid: boolean,
): string | undefined {
  // Try v2 URLs first
  if (entitled) {
    const url = preferSolid ? logo.solidUrl : logo.transparentUrl;
    if (url) return url;
  } else {
    const url = preferSolid
      ? logo.watermarkedSolidUrl
      : logo.watermarkedTransparentUrl;
    if (url) return url;
  }
  // Fall back to legacy url field
  return logo.url;
}
```

**Step 3: Verify TypeScript compiles**

Run: `pnpm --filter website exec tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: No errors related to LogoData

**Step 4: Commit**

```bash
git add app/src/app/develop/components/widgets/LogoGridWidget.tsx
git commit -m "feat: update LogoData interface for v2 URL variants"
```

---

## Task 3: Update LogoGridWidget Click Behavior

**Files:**

- Modify: `app/src/app/develop/components/widgets/LogoGridWidget.tsx`

**Step 1: Update props interface to accept onLogoClick callback**

Find `LogoGridWidgetProps` and add a callback prop:

```typescript
/**
 * Logo Grid Widget Props
 */
export interface LogoGridWidgetProps {
  logos: LogoData[];
  entitled?: boolean;
  onLogoClick?: (index: number) => void;
  className?: string;
}
```

**Step 2: Update component signature**

Update the function parameters:

```typescript
export default function LogoGridWidget({
  logos,
  entitled = true,
  onLogoClick,
  className = ''
}: LogoGridWidgetProps) {
```

**Step 3: Update handleLogoClick to call the callback**

Replace the `handleLogoClick` function:

```typescript
/**
 * Handle click on logo - open modal for selection
 */
function handleLogoClick(logo: LogoData, index: number) {
  // Call the parent callback to open modal
  if (onLogoClick) {
    onLogoClick(index);
  }

  logger.debug("logo_grid.logo.clicked", {
    logoId: logo.id,
    logoIndex: index,
  });
}
```

**Step 4: Remove the selectedLogo state and related code**

Remove these lines:

- `const [selectedLogo, setSelectedLogo] = useState<LogoData | null>(null)`
- The `useEffect` that listens for 'logo-select' events
- The `handleRevert` function
- The `handleSave` function

**Step 5: Update the button onClick in the grid**

Change the onClick handler in the logo button:

```typescript
onClick={() => handleLogoClick(logo, index)}
```

**Step 6: Update the image src to use getLogoDisplayUrl**

Update the img src:

```typescript
<img
  src={getLogoDisplayUrl(logo, entitled, false)}
  alt={`Logo ${index + 1}`}
  className="w-full h-full object-contain p-2 opacity-90 group-hover:opacity-100 transition-opacity"
/>
```

**Step 7: Remove the selection styling**

Update the button className to remove selection state:

```typescript
className={clsx(
  "aspect-square group cursor-pointer overflow-hidden rounded-md border-2 transition-all duration-200 hover:shadow-md bg-intents-ux-boxLowContrast-backgroundColor",
  "border-border hover:border-intents-ux-boxHighContrast-borderColor"
)}
```

**Step 8: Simplify the buttons section**

Remove Save and Revert buttons, keep only More Options:

```typescript
{/* Button Controls */}
<div className="mt-3 flex items-center justify-end pr-0.5">
  <Button
    text={t('builder_common_more_options')}
    design="tertiary"
    size="sm"
    disabled={isProcessing}
    onClick={handleMoreOptions}
  />
</div>
```

**Step 9: Update the helper message**

```typescript
{/* Helper message */}
<div className="flex items-center gap-1 text-xs text-intents-ux-textSubtle-textColor mt-2">
  <span className="text-sm">Click a logo to view details and select</span>
</div>
```

**Step 10: Verify TypeScript compiles**

Run: `pnpm --filter website exec tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: No errors

**Step 11: Commit**

```bash
git add app/src/app/develop/components/widgets/LogoGridWidget.tsx
git commit -m "feat: update LogoGridWidget to open modal on click"
```

---

## Task 4: Update LogoGeneratorToolRenderer - State and Parsing

**Files:**

- Modify: `app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx`

**Step 1: Add new imports**

Add to the imports at the top:

```typescript
import {
  getLogoDisplayUrl,
  type LogoData,
} from "@/app/develop/components/widgets/LogoGridWidget";
import { useSendUserMessage } from "@/app/develop/components/chat/ChatContext";
import {
  useIsActivelyStreaming,
  useIsLoading,
} from "@/stores/useStreamingConversationStore";
```

**Step 2: Remove the duplicate type alias**

Remove this line:

```typescript
type LogoResult = LogoData;
```

**Step 3: Add new state variables**

After the existing state declarations, add:

```typescript
const [preferSolid, setPreferSolid] = useState(false);
const [entitled, setEntitled] = useState(true);
const sendUserMessage = useSendUserMessage();
const isStreaming = useIsActivelyStreaming();
const isLoading = useIsLoading();
const isProcessing = isStreaming || isLoading;
```

**Step 4: Update result parsing to extract entitled**

In the result parsing section (around line 44-93), update to extract the entitled flag. Find where `resultObj.structuredContent?.logos` is handled and add:

```typescript
if (resultObj.structuredContent) {
  setEntitled(resultObj.structuredContent.entitled ?? true);
  if (resultObj.structuredContent.logos) {
    logos.push(...resultObj.structuredContent.logos);
  }
}
```

Note: The `setEntitled` call should be in a useEffect to avoid setting state during render. We'll handle this properly in the next step.

**Step 5: Extract entitled in a useEffect**

Actually, since parsing happens during render, we need to track entitled differently. Change the approach - make entitled a local variable from parsing, not state:

Remove: `const [entitled, setEntitled] = useState(true)`

Add after the parsing block:

```typescript
// Extract entitled from parsed result
let entitled = true;
if (result) {
  try {
    const resultObj = typeof result === "string" ? JSON.parse(result) : result;
    if (resultObj?.structuredContent?.entitled !== undefined) {
      entitled = resultObj.structuredContent.entitled;
    }
  } catch {
    // Keep default
  }
}
```

**Step 6: Verify TypeScript compiles**

Run: `pnpm --filter website exec tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: No errors

**Step 7: Commit**

```bash
git add app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx
git commit -m "feat: add state and parsing for logo v2 response"
```

---

## Task 5: Update LogoGeneratorToolRenderer - Grid Integration

**Files:**

- Modify: `app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx`

**Step 1: Add handler for logo click from grid**

Add a new handler function after the existing handlers:

```typescript
const handleLogoClickFromGrid = (index: number) => {
  setSelectedLogoIndex(index);
  setIsModalOpen(true);
};
```

**Step 2: Update LogoGridWidget usage**

Find where `<LogoGridWidget logos={logos} />` is rendered and update it:

```typescript
<LogoGridWidget
  logos={logos}
  entitled={entitled}
  onLogoClick={handleLogoClickFromGrid}
/>
```

**Step 3: Verify TypeScript compiles**

Run: `pnpm --filter website exec tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```bash
git add app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx
git commit -m "feat: connect grid clicks to modal opening"
```

---

## Task 6: Update LogoGeneratorToolRenderer - Modal Enhancements

**Files:**

- Modify: `app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx`

**Step 1: Add handler for using selected logo**

Add a new handler function:

```typescript
const handleUseLogo = () => {
  if (!selectedLogo || isProcessing || !sendUserMessage) return;

  const logoIndex = selectedLogoIndex + 1;
  sendUserMessage(`Use logo ${logoIndex}`, { isActionRequest: true });
  setIsModalOpen(false);
};
```

**Step 2: Update modal thumbnail images**

Find the thumbnail navigation section in the modal and update the img src:

```typescript
<img
  src={getLogoDisplayUrl(logo, entitled, preferSolid)}
  alt={`Logo ${index + 1}`}
  className="w-full h-full object-contain"
/>
```

**Step 3: Add background toggle UI**

After the thumbnail navigation and counter, add the toggle:

```typescript
{/* Background toggle */}
<div className="flex justify-center gap-2 mb-3">
  <Button
    text="Transparent"
    design={!preferSolid ? 'primary' : 'secondary'}
    size="sm"
    onClick={() => setPreferSolid(false)}
  />
  <Button
    text="Solid Background"
    design={preferSolid ? 'primary' : 'secondary'}
    size="sm"
    onClick={() => setPreferSolid(true)}
  />
</div>
```

**Step 4: Update main logo image src**

Find the main logo image and update its src:

```typescript
<img
  src={getLogoDisplayUrl(selectedLogo, entitled, preferSolid)}
  alt={`Logo ${selectedLogoIndex + 1}`}
  className="max-w-full max-h-[50vh] object-contain"
/>
```

**Step 5: Add "Use this logo" button at the bottom**

After the mockup preview section, add the action button:

```typescript
{/* Action button */}
<div className="mt-4 flex justify-center">
  <Button
    text="Use this logo"
    design="primary"
    size="md"
    disabled={isProcessing}
    onClick={handleUseLogo}
  />
</div>
```

**Step 6: Verify TypeScript compiles**

Run: `pnpm --filter website exec tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: No errors

**Step 7: Commit**

```bash
git add app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx
git commit -m "feat: add background toggle and selection button to logo modal"
```

---

## Task 7: Final Cleanup and Verification

**Files:**

- Review: `app/src/app/develop/components/widgets/LogoGridWidget.tsx`
- Review: `app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx`

**Step 1: Run full typecheck**

Run: `pnpm --filter website typecheck`
Expected: No errors

**Step 2: Run lint**

Run: `pnpm --filter website lint`
Expected: No errors (or only warnings)

**Step 3: Run build**

Run: `pnpm --filter website build`
Expected: Build succeeds

**Step 4: Manual testing checklist**

Test the following scenarios:

- [ ] Generate logos - grid displays 4 logos
- [ ] Click logo in grid - modal opens with that logo selected
- [ ] Navigate between logos in modal (thumbnails + arrow keys)
- [ ] Toggle between Transparent and Solid Background
- [ ] Click "Use this logo" - sends message and closes modal
- [ ] "More options" button works from grid
- [ ] Keyboard navigation (Escape closes modal)

**Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address any issues from verification"
```

---

## Summary of Changes

| File                                                                          | Changes                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `agents/src/skills/media/skill.md`                                            | Updated documentation for v2 API                                    |
| `app/src/app/develop/components/widgets/LogoGridWidget.tsx`                   | New interface fields, helper function, click-to-open-modal behavior |
| `app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx` | Entitled parsing, background toggle, in-modal selection             |
