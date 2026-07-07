# Media Slots

## Overview

Images managed by the Airo platform are tracked in `airo-media.json` at the project root. This file maps named slots to their metadata (URL, dimensions, last updated timestamp). The dev-tools layer provides visual hover controls for replacing and editing these images in the builder UI.

## airo-media.json Schema

```json
{
  "pages/home/hero": {
    "url": "/airo-assets/images/pages/home/hero",
    "lastUpdated": "2024-01-01T00:00:00.000Z",
    "width": 1920,
    "height": 1080,
    "alt": "Hero image"
  }
}
```

Each key is the **slot path** (see conventions below). The file starts empty (`{}`) for a new app and is populated as images are added via the builder.

## Slot Path Conventions

Slot paths follow a three-segment pattern: `{context}/{name}/{image-name}`

| Context | Example | Used for |
|---|---|---|
| `pages` | `pages/home/hero` | Per-page images |
| `layouts` | `layouts/header/logo` | Layout-level images (header, footer) |
| `components` | `components/card/thumbnail` | Reusable component images |

Keep names lowercase with hyphens. The slot path becomes the URL path segment under `/airo-assets/images/`.

## Referencing Images in Components

Reference slots via their URL path directly in `<img>` tags or CSS background styles:

```tsx
// img tag
<img src="/airo-assets/images/pages/home/hero" alt="Hero" />

// CSS background (inline style)
<div style={{ backgroundImage: 'url(/airo-assets/images/pages/home/hero)' }} />
```

The dev-tools layer detects these URLs and adds hover controls for image replacement in the builder. A `data-media-slot` attribute is not required — detection is URL-based.

## Cache Busting

The `vite-media-versions-plugin` watches `airo-media.json` and pushes `lastUpdated` timestamps to dev-tools via the Vite HMR WebSocket (`media-versions-update` event). Dev-tools fetch the initial manifest from `/airo-media.json` and subscribe to live updates via `import.meta.hot`, appending version query params to image URLs to ensure the browser loads fresh images after replacements without a full page reload.

## Adding a New Slot

1. Add the slot path to `airo-media.json` (or let the builder auto-import it)
2. Reference the URL in your component: `/airo-assets/images/{slot-path}`
3. The builder will show image replace/edit controls when hovering over the image
