---
allowedAgents: [deep-build]
name: design-preview
description: Installs a focused design taste preview at /design-preview showing palette, typography, and component samples. Used by the design sub-agent for user approval before proceeding to build.
whenToUse: >-
  Installed by the design sub-agent after writing docs/design.md and
  syncing globals.css. Shows a focused preview of the design direction
  (palette, typography, components) for user approval. The agent must
  also write src/components/design-preview/brand-data.tsx with the
  palette entries and brand info before installing this skill.
---

# Design Taste Preview

This skill installs a focused design preview page at `/design-preview` showing:
1. **Color palette** — brand colors with names and hex values
2. **Typography hero** — display + body fonts in actual use
3. **Component samples** — buttons, card, input styled with design tokens

## Prerequisites

Before installing, the agent must have:
1. Written `docs/design.md` with the design system spec
2. Synced CSS variables to `src/styles/globals.css`
3. Written `src/components/design-preview/brand-data.tsx` exporting:

```typescript
export const brandData = {
  brandName: "Brand Name",
  tagline: "Brand tagline",
  palette: [
    { token: "color-primary", hex: "#hex", name: "Color Name" },
    // ... 4-6 key colors
  ],
};
```

## Installation

```
skill({ action: "install", skill: "design-preview", overwrite: true })
```

After installing, call `showDoc({ type: "doc", path: "design-preview" })` to display it.
