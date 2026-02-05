# Font Stack Support (Header + Body Fonts)

## Overview

Enable the font tool to support separate header and body fonts instead of a single font for both. The LLM already recommends pairings; this PR enables the data model, UI, and CSS generation to handle them.

## Approach

**Additive with fallback** - Add `headerFont` and `bodyFont` fields while preserving the legacy `font` field. When only `font` is present, use it for both header and body automatically.

## Data Model Changes

### Types

```typescript
interface FontInfo {
  name: string;
  weights: string[];
  category: string;
}

interface FontTheme {
  id: string;
  name: string;
  description: string;
  // New fields
  headerFont?: FontInfo;
  bodyFont?: FontInfo;
  // Legacy field (deprecated, for backwards compat)
  font?: FontInfo;
}
```

### Fallback Helper

```typescript
function normalizeFontTheme(theme: FontTheme): {
  headerFont: FontInfo;
  bodyFont: FontInfo;
} {
  if (theme.headerFont && theme.bodyFont) {
    return { headerFont: theme.headerFont, bodyFont: theme.bodyFont };
  }
  // Legacy fallback: use single font for both
  const fallbackFont = theme.font!;
  return { headerFont: fallbackFont, bodyFont: fallbackFont };
}
```

### Tool Input Schema

Add optional fields to Zod schema:

- `headerFontName?: string`
- `headerWeights?: string[]`
- `bodyFontName?: string`
- `bodyWeights?: string[]`

Existing `fontName`/`weights` become the legacy path.

## CSS Variable Updates

### updateCssFontVariables()

Update to accept two fonts and set them separately:

```typescript
async function updateCssFontVariables(
  appPath: string,
  headerFont: FontInfo,
  bodyFont: FontInfo,
): Promise<void> {
  // --font-heading gets headerFont
  // --font-sans gets bodyFont
}
```

### buildGoogleFontsUrl()

Handle one or two fonts with deduplication:

```typescript
function buildGoogleFontsUrl(fonts: FontInfo[]): string {
  // Deduplicate if headerFont === bodyFont (same name)
  // Build URL with all unique fonts
}
```

### CSS Output Example

```css
@import url("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600&display=swap");

:root {
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-heading:
    "Playfair Display", -apple-system, BlinkMacSystemFont, sans-serif;
}
```

## UI Changes

### FontThemeGridWidget

Show both fonts in each theme card:

```
┌─────────────────────────────────┐
│  Aa        Modern Professional  │
│            Playfair + Inter     │
│                                 │
│  The Quick Brown Fox  (header)  │
│  The quick brown fox  (body)    │
└─────────────────────────────────┘
```

- Subtitle shows pairing: `"Playfair Display + Inter"` (or single name if same)
- Two pangram samples: header font (bolder/larger), body font (regular)
- Load both fonts for preview (with deduplication, stay under 24-font limit)

### FontThemeToolRenderer

Update apply/set mode preview cards to show both fonts when they differ.

### FontThemeModal

- H1-H6 samples render in `headerFont`
- Body/Small samples render in `bodyFont`

## LLM Prompt Updates

### font-generation.md

Update to request header/body pairings:

- Instruct LLM to recommend a header font and a body font
- Include pairing principles (contrast vs. harmony, serif+sans combinations)
- Output format includes `headerFont` and `bodyFont` objects

### Example LLM Output

```json
{
  "name": "Modern Professional",
  "description": "Playfair Display headers bring elegance, paired with Inter for clean, readable body text",
  "headerFont": {
    "name": "Playfair Display",
    "weights": ["600", "700"],
    "category": "serif"
  },
  "bodyFont": {
    "name": "Inter",
    "weights": ["400", "500", "600"],
    "category": "sans-serif"
  }
}
```

### generateFontsWithLLM()

Parse new response format, validate both fonts, handle edge case where LLM returns single font (treat as both).

## Curated Themes

Update `FONT_THEMES` to include pairings:

```typescript
const FONT_THEMES = {
  "modern-professional": {
    name: "Modern Professional",
    headerFont: {
      name: "Montserrat",
      weights: ["600", "700"],
      category: "sans-serif",
    },
    bodyFont: {
      name: "Inter",
      weights: ["400", "500"],
      category: "sans-serif",
    },
  },
  "elegant-serif": {
    name: "Elegant Serif",
    headerFont: {
      name: "Playfair Display",
      weights: ["600", "700"],
      category: "serif",
    },
    bodyFont: { name: "Lora", weights: ["400", "500"], category: "serif" },
  },
  // ...
};
```

## Testing

### Unit Tests to Add

```typescript
// New font pairing applied correctly
it("should set different fonts for heading and body", async () => {
  // headerFont: Playfair Display, bodyFont: Inter
  // Assert --font-heading contains "Playfair Display"
  // Assert --font-sans contains "Inter"
});

// Backwards compatibility
it("should handle legacy single font format", async () => {
  // Input: { font: { name: 'Inter', ... } }
  // Assert both variables use Inter
});

// Google Fonts URL handles multiple fonts
it("should build URL with multiple font families", () => {
  // Assert URL contains both &family= params
});

// Deduplication when same font
it("should deduplicate when header and body are same font", () => {
  // Assert URL contains only one &family= param
});
```

## Files to Modify

1. `agents/src/tools/ai-lib-tools/font-theme.ts` - Schema, types, CSS writing, curated themes
2. `agents/src/prompts/font-tool/font-generation.md` - LLM prompt for pairings
3. `app/src/app/develop/components/widgets/FontThemeGridWidget.tsx` - Grid display
4. `app/src/app/develop/components/tool-renderers/FontThemeToolRenderer.tsx` - Preview cards
5. `app/src/app/develop/components/tool-renderers/FontThemeModal.tsx` - Detail view
6. `agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts` - Unit tests
