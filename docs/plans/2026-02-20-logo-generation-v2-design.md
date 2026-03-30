---
status: implemented
---

# Logo Generation V2 Design

## Overview

Update the logo generation system to use the new `generate_logos_v2` MCP endpoint, which provides:

- Richer input schema with style presets and refinement support
- Multiple URL variants per logo (transparent, solid, watermarked)
- Entitlement-aware responses

## Changes Required

### 1. Skill Documentation (`agents/src/skills/media/skill.md`)

Update the `media__generate_logo` tool documentation to reflect the v2 API.

**New Input Schema:**

| Parameter           | Type         | Required | Description                                         |
| ------------------- | ------------ | -------- | --------------------------------------------------- |
| `name`              | string       | Yes      | Primary text for the logo (business/brand name)     |
| `tagline`           | string       | No       | Secondary text like tagline, slogan, or "Est. 2020" |
| `description`       | string       | Yes      | What the business does - informs visual choices     |
| `style`             | enum         | Yes      | Logo style preset (see below)                       |
| `styleDescription`  | string       | No       | Additional custom style direction                   |
| `symbol`            | string       | No       | Icon or imagery to incorporate                      |
| `colors`            | string       | No       | Color preferences as description                    |
| `count`             | number (1-4) | No       | Number of variations (default: 4)                   |
| `refinementLogoUrl` | string (URL) | No       | URL of logo to refine from previous generation      |

**Style Options:**

- `line` - Minimalist line art
- `glyph` - Iconic symbol
- `full-color` - Vibrant illustrated
- `dual-tone` - Two colors
- `3d` - Depth/dimension
- `badge` - Emblem/seal
- `flat` - Modern flat design
- `colored-line` - Line art with color
- `handmade` - Hand-drawn feel
- `mascot` - Character illustration
- `monogram` - Initials/lettermark
- `name-mark` - Stylized typography

**New Output Schema:**

```typescript
{
  entitled: boolean,  // Whether user gets full-resolution (true) or watermarked (false)
  logos: [
    {
      id: string,
      transparentUrl?: string,           // PNG with transparent background (entitled only)
      solidUrl?: string,                 // PNG with solid background (entitled only)
      watermarkedTransparentUrl?: string, // Watermarked transparent (non-entitled)
      watermarkedSolidUrl?: string,       // Watermarked solid (non-entitled)
      mockupUrl: string                  // Mockup showing logo in context
    }
  ]
}
```

### 2. LogoData Interface Update

**File:** `app/src/app/develop/components/widgets/LogoGridWidget.tsx`

Update the `LogoData` interface:

```typescript
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

Add helper function to get display URL:

```typescript
function getLogoDisplayUrl(
  logo: LogoData,
  entitled: boolean,
  preferSolid: boolean,
): string {
  if (entitled) {
    return preferSolid ? logo.solidUrl! : logo.transparentUrl!;
  } else {
    return preferSolid
      ? logo.watermarkedSolidUrl!
      : logo.watermarkedTransparentUrl!;
  }
}
```

### 3. LogoGridWidget Changes

**File:** `app/src/app/develop/components/widgets/LogoGridWidget.tsx`

**Behavior changes:**

- Clicking a logo opens the modal (emit event for parent to handle)
- Remove "Save" button (selection happens in modal)
- Keep "More options" button

**Implementation:**

- Change `handleLogoClick` to emit an event that opens modal with selected index
- Remove `handleSave` function
- Remove save button from JSX
- Update helper text

### 4. LogoGeneratorToolRenderer Changes

**File:** `app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx`

**New features:**

1. **Parse `entitled` from response** - Track whether user is entitled
2. **Transparent/solid toggle** - Button to switch background style
3. **"Use this logo" button** - Confirm selection from within modal
4. **Click-to-open from grid** - Listen for logo click events to open modal

**State additions:**

```typescript
const [preferSolid, setPreferSolid] = useState(false);
const [entitled, setEntitled] = useState(true);
```

**Modal enhancements:**

- Add toggle button near main image: "Transparent" / "Solid Background"
- Add "Use this logo" primary button at bottom
- Update image src to use `getLogoDisplayUrl(selectedLogo, entitled, preferSolid)`

**Event handling:**

- Listen for `logo-grid-open-modal` event from LogoGridWidget
- Set `selectedLogoIndex` and `isModalOpen` when event fires

### 5. Result Parsing Update

**File:** `app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx`

Update parsing logic to extract `entitled` flag:

```typescript
let entitled = true; // default to entitled

if (resultObj.structuredContent) {
  entitled = resultObj.structuredContent.entitled ?? true;
  if (resultObj.structuredContent.logos) {
    logos.push(...resultObj.structuredContent.logos);
  }
}
```

## User Flow

### New Flow

1. User requests logo generation
2. Logos appear in 2x2 grid below the tool message
3. User clicks any logo thumbnail
4. Modal opens showing:
   - Thumbnail strip for navigation (top)
   - Toggle for "Transparent" / "Solid Background"
   - Large preview of selected logo
   - Mockup preview below
   - "Use this logo" button (primary)
   - Close button
5. User can:
   - Navigate between logos (thumbnails, arrow keys)
   - Toggle background style
   - Click "Use this logo" to confirm selection
6. On confirm: Modal closes, message sent to chat

### Grid Controls

- **More options** button - Request additional logo variations
- Clicking logo - Opens modal for detailed view/selection

## Files to Modify

1. `agents/src/skills/media/skill.md` - Update documentation
2. `agents/src/skills/media/tools/index.ts` - Already updated (input schema)
3. `app/src/app/develop/components/widgets/LogoGridWidget.tsx` - Interface + click behavior
4. `app/src/app/develop/components/tool-renderers/LogoGeneratorToolRenderer.tsx` - Modal enhancements

## Testing Considerations

- Test with entitled=true response (transparentUrl, solidUrl)
- Test with entitled=false response (watermarkedTransparentUrl, watermarkedSolidUrl)
- Test toggle between transparent/solid
- Test "Use this logo" sends correct message
- Test backward compatibility with old response format (if needed)
- Test keyboard navigation still works
- Test mobile/responsive behavior
