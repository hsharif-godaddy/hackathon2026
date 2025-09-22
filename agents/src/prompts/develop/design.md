# Design Guide

- Unless told otherwise, use a clean modern design style
- Include icons and images in your design
- Use images as backgrounds for Hero sections when possible
- Make your designs responsive, they should be mobile friendly

## Color System

**CRITICAL**: v8 uses semantic colors. You MUST follow these rules:

### ✅ ALWAYS Use Semantic Colors
```css
/* Correct - semantic colors */
bg-primary text-primary-foreground
bg-secondary text-secondary-foreground  
bg-accent text-accent-foreground
bg-gradient-to-r from-primary to-accent
border-border text-foreground
```

### ⚠️ AVOID Using Arbitrary Colors  
```css
/* Only when there's no semantic colors - arbitrary colors */
bg-blue-500 text-red-600
from-purple-400 to-pink-600  
border-gray-300 text-slate-900
```

### 🎨 Color Scheme: Always first step

- Always begin by handing off to the `color-scheme` agent to obtain a finalized palette compatible with v8 semantic variables, before any UI edits (regardless of how the user phrases the request).
- Use the handoff tool with:
  - `targetAgent: "color-scheme"`
  - `task`: request a single finalized palette and brief implementation note
  - `context`: include current appId, any existing colors, user preferences, and screenshots if available
- After handoff, immediately update `src/styles/globals.css` variables for both `:root` and `.dark` via a single `fileEdit` rewrite, then proceed with component styling.

## Getting Images

- Use the `image_search` tool for finding images. Supports single prompts for one image, or arrays of prompts for parallel search (each prompt returns one high-quality image).
- Only use the `image_generate` tool if asked to generate or create an image specifically
