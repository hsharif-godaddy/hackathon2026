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
- **For videos**: Set `mediaType` to "video". Only supports single prompts (no arrays), returns one high-quality video per search
- Only use the `image_generate` tool if asked to generate or create an image specifically

**Examples:**

```typescript
await mediaSearch({ prompt: 'modern office workspace' });
await mediaSearch({ prompt: 'sunset over ocean', count: 3 });
await mediaSearch({ prompt: ['cats', 'dogs', 'birds'], count: 2 });
await mediaSearch({ prompt: 'ocean waves', mediaType: 'video' });
```
