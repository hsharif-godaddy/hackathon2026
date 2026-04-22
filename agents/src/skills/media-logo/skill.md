---
name: media-logo
description: AI logo generation. Load when user wants to generate or redesign a logo.
whenToUse: User wants to create, generate or edit a logo. Phrases like "make a logo", "edit the logo", "add X to the logo", "make the logo more X".
---

## Slot URL Usage in Source Code

Generated logos auto-save to the media slot system. Use the returned `slotUrl` in all code placements:

```tsx
// Transparent (default) — use on light backgrounds:
<img src="/airo-assets/images/logo/primary" alt="Sunrise Cafe logo" />

// Solid — use on dark backgrounds:
<img src="/airo-assets/images/logo/primary?variant=solid" alt="Sunrise Cafe logo" />
```

The user can swap logos anytime via the LogoGridWidget — the slot URL stays the same.

## Placement Flow

After generation, decide based on context:

1. **Place immediately** when the conversation implies it — e.g., "build a site with a logo" or you're following a handoff that includes building pages. Use `?variant=solid` for dark backgrounds.
2. **Present and wait** when the user only asked to generate a logo. Show the results and let them browse. Place when asked later.

## Context Gathering

Before calling `media-logo__generate_logo`, check conversation context for brand name (`app.title`), description (`app.description`), and colors (color palette from app plan). Only ask the user for information not already available — the tool auto-enriches missing colors as fallback. Don't assume business details beyond what's in context.

<example>
User: "Move the company name to the right of the icon and make the background transparent"

Correct — regenerate with adjusted style description:

```typescript
media-logo__generate_logo({
    brandName: 'Sunrise Cafe',
    brandDescription: 'A cozy neighborhood coffee shop',
    style: 'handmade',
    styleDescription:
      'Icon on the left, company name "Sunrise Cafe" on the right in a horizontal side-by-side layout.',
    symbol: 'coffee cup with sunrise',
    brandColors: 'warm earth tones with orange accents',
    count: 4,
  });
// Use the returned slotUrl — transparentUrl is the default
```

Wrong — editing the existing logo:

```typescript
media-image__edit_image({ prompt: 'Move text to the right...', imageUrl: '...' }); // Loses transparency, can't reposition
terminalCommand({ command: 'curl ... -o public/assets/logo.png' }); // Bypasses delivery infrastructure
```

</example>
