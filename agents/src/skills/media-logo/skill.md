---
name: media-logo
description: AI logo generation. Load when user wants to generate, redesign, or edit a logo.
whenToUse: User wants to create, generate or edit a logo. Phrases like "make a logo", "edit the logo", "add X to the logo", "make the logo more X", "change the 2nd logo to be blue".
---

## Slot URL Usage in Source Code

Generated logos auto-save to the media slot system. Use the returned `slotUrl` in all code placements:

```tsx
// Header/navbar — horizontal slot
<img src="/airo-assets/images/logo/horizontal" alt="Sunrise Cafe logo" />

// Hero section or sidebar — vertical slot
<img src="/airo-assets/images/logo/vertical" alt="Sunrise Cafe logo" />

// Favicon/app icon — square slot (default)
<img src="/airo-assets/images/logo/primary" alt="Sunrise Cafe logo" />

// If background is required — append ?variant=solid to any slot (only use if the logo is the same color as the background, otherwise it may look worse)
<img src="/airo-assets/images/logo/horizontal?variant=solid" alt="Sunrise Cafe logo" />
```

**IMPORTANT:** Always use the slot URL, never hardcode the generated CDN URLs directly in source code.

The user can swap logos anytime via the LogoGridWidget — the slot URL stays the same.

## Placement Flow

After generation, decide based on context:

1. **Place immediately** when the conversation implies it — e.g., "build a site with a logo" or you're following a handoff that includes building pages.
2. **Present and wait** when the user only asked to generate a logo. Show the results and let them browse. Place when asked later.

## Post-Generation Actions

After calling `media-logo__generate_logo` or `media-logo__edit_logo`, always call
`media-logo__offer_logo_actions` with the transparent URL of the first generated logo.
This gives the user quick-action buttons in the chat (e.g. "Add to my library", "Set as my logo").

Use the layout-specific transparent URL field — passing the wrong field yields `undefined` and no buttons render:

- `layout: "horizontal"` → `result.logos[0].horizontalTransparentUrl`
- `layout: "vertical"` → `result.logos[0].verticalTransparentUrl`
- `layout: "square"` (or omitted) → `result.logos[0].transparentUrl`

```typescript
// Example for a horizontal generation
media-logo__offer_logo_actions({ imageUrl: result.logos[0].horizontalTransparentUrl })
```

## Context Gathering

Before calling `media-logo__generate_logo`, check conversation context for brand name (`app.title`), description (`app.description`), and colors (color palette from app plan). Only ask the user for information not already available — the tool auto-enriches missing colors as fallback. Don't assume business details beyond what's in context.

<example>
User: "Move the company name to the right of the icon and make the background transparent"

Correct - use the edit tool with the source logo reference:

```typescript
// Edit the current saved logo — sessionId and logoId auto-resolved from slot
media-logo__edit_logo({
    prompt: 'Make the logo blue and remove the tagline',
  });

// Edit a specific logo from a known session
media-logo__edit_logo({
    sourceSessionId: 'abc-123-session',
    sourceLogoId: 'logo-1',
    prompt: 'Make the logo blue and remove the tagline',
    layout: 'horizontal',
    count: 2,
  });
```

Wrong — editing the existing logo using the generic image editor or bypassing the slot system:

```typescript
media-image__edit_image({ prompt: 'Move text to the right...', imageUrl: '...' }); // Loses transparency, can't reposition
terminalCommand({ command: 'curl ... -o public/assets/logo.png' }); // Bypasses delivery infrastructure
```

</example>

<example>
User: "Actually I want the logo with a 3d style"

Correct - generate a new logo with the new style, using the same inputs as the original generation (brand name, description, colors) to maintain consistency:

```typescript
// Generate logos in all orientations for a full brand kit
media-logo__generate_logo({
    brandName: 'Sunrise Cafe',
    brandDescription: 'A cozy neighborhood coffee shop serving artisan coffee and fresh pastries',
    style: '3D',
    styleDescription: 'warm and welcoming',
    brandColors: 'warm earth tones with orange accents',
    symbol: 'coffee cup with sunrise',
    layout: 'all',
  });
```

Wrong — asking for edits to the existing logo without referencing it, which may lead to a new unrelated design:

```typescript
media-logo__edit_logo({ prompt: 'Make the logo 3D and warm' }); // May not understand to keep existing design elements
```

</example>
