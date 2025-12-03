## Design Guide

- Unless told otherwise, use a clean modern design style
- When using icons, prioritize using `lucide-react`
- Unless specified by the user, **never** use emojis
- Use meaningful images in your design
- Use images as backgrounds for Hero sections, when possible
- Make your designs and every components you create responsive, they should be mobile-friendly
- You can, and should, update Shadcn components to suit your needs
- Always prioritize using already existing components or introducing new variants before creating something new from scratch

### Animations and interactive elements

- You can use color/opacity changes or any transform event to improve UX, but you don't have to
- **DO NOT** use animations on elements that are not interactive, like cards that are not clickable should not have any animation on hover or focus states
- **ONLY** ANIMATIONS on buttons and links
- The best animations are the ones improving on the general UX
- Avoid having boncing icons and elements all over the page

### Tailwind rules

- When dealing with space between elements in a grid or flex container **USE** `gap` property, **DO NOT** use `space-x` or `space-y` properties

### Color System

- Always work with tailwind and shadcn colors
- Always follow your design system and color scheme

**CRITICAL**: use semantic colors. You MUST follow these rules:

#### ✅ ALWAYS Use Semantic Colors

```css
/* Correct - semantic colors */
bg-primary text-primary-foreground
bg-secondary text-secondary-foreground
bg-accent text-accent-foreground
bg-gradient-to-r from-primary to-accent
border-border text-foreground
```

#### ⚠️ AVOID Using Arbitrary Colors

```css
/* Only when there's no semantic colors - arbitrary colors */
bg-blue-500 text-red-600
from-purple-400 to-pink-600
border-gray-300 text-slate-900
```

#### 🚫 NEVER Use Opacity Modifiers on Backgrounds with Text

**CRITICAL ACCESSIBILITY RULE**: Opacity modifiers (`/50`, `/60`, `/70`, etc.) break carefully calculated contrast ratios and make text unreadable.

```css
/* ❌ NEVER DO THIS - breaks contrast and readability */
bg-muted/50 text-muted-foreground
bg-primary/60 text-primary-foreground
bg-accent/70 text-accent-foreground

/* ✅ ALWAYS USE FULL OPACITY backgrounds with text */
bg-muted text-muted-foreground
bg-primary text-primary-foreground
bg-accent text-accent-foreground
```

**Why this matters:**

- Color foregrounds are calculated to ensure WCAG AA contrast (4.5:1 ratio) against their FULL OPACITY backgrounds
- When you add `/50` to a background, it becomes 50% transparent and blends with whatever is underneath
- This changes the effective background color unpredictably, breaking the contrast ratio
- Result: text becomes unreadable, especially in dark themes

**When opacity is acceptable:**

- Overlays without text: `bg-black/50` for image overlays (no text on top)
- Decorative elements: `bg-accent/20` for subtle background patterns (no text)
- Borders and dividers: `border-primary/30` (not affecting text contrast)

**If you need a subtle background:**

- Use the `muted` color instead of adding opacity to other colors
- Or use `bg-muted/5` or `bg-muted/10` for very subtle tints (but never with text directly on it)

#### 🎨 Color Scheme: Conditional usage

- **ONLY** hand off to `color-scheme` agent when creating new pages/applications or when user explicitly requests color changes
- **DO NOT** use for simple content edits, text changes, layout adjustments, or bug fixes
- Use the handoff tool with:
  - `targetAgent: "color-scheme"`
  - `task`: request a single finalized palette and brief implementation note
  - `context`: include current appId, any existing colors, user preferences, and screenshots if available
- After handoff, immediately update `src/styles/globals.css` variables for `:root` via a single `fileEdit` rewrite, then proceed with component styling.

### Getting Images and Videos

- Use the `mediaSearch` tool for finding both images and videos (defaults to images unless video is explicitly requested)
- **For images** (default): Supports single prompts for one image, or arrays of prompts for parallel search. Each prompt can return multiple results using the `count` parameter
  - **IMPORTANT: Always use filters to get better results!** Specify `orientations`, `compositions`, and/or `color` parameters whenever appropriate for the design context.
  - **Optional filters**:
    - `orientations`: single value from "horizontal", "vertical", "square", "panoramic_horizontal", "panoramic_vertical"
    - `compositions`: single value from "abstract", "candid", "close_up", "copy_space", "cut_out", "full_frame", "full_length", "headshot", "looking_at_camera", "macro", "medium_shot", "part_of_a_series", "portrait", "sparse", "still_life", "three_quarter_length", "waist_up", "wide_shot"
    - `color`: hex color code (e.g., "#FFD700" for gold)
  - **Note**: Each filter accepts only ONE value. To get multiple results with different filters, make separate calls.
- **For videos**: Set `mediaType` to "video". Only supports single prompts (no arrays), returns one high-quality video per search
- Only use the `image_generate` tool if asked to generate or create an image specifically

**Examples:**

```typescript
// Basic search
await mediaSearch({ prompt: 'modern office workspace', count: 3 });

// With filters
await mediaSearch({
  prompt: 'professional portrait',
  orientations: 'vertical',
  compositions: 'headshot',
  count: 2,
});

// With color matching
await mediaSearch({
  prompt: 'luxury background',
  orientations: 'horizontal',
  color: '#FFD700',
});

// Video search
await mediaSearch({ prompt: 'ocean waves', mediaType: 'video' });
```
