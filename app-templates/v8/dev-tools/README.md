# Airo Dev Tools

Visual editing and development tools for Airo AI Builder. These tools provide edit mode features including hover hints, inline text editing, and image replacement in preview containers.

## Features

- **Edit Mode**: AI sparkle button on hovered elements for contextual editing
- **Inline Text Editing**: Click-to-edit text with auto-save
- **Image Hover Bar**: Quick image replacement on hover
- **Visual Context**: Section detection and scroll tracking for AI assistance
- **Development Only**: Automatically excluded from production builds

## How It Works

The dev tools are automatically injected into your application during development via a Vite plugin. They:

1. Only activate in development mode (`NODE_ENV=development`)
2. Are completely excluded from production builds
3. Don't require any changes to your application code
4. Work seamlessly with your existing React components

## Usage

### Edit Mode

Edit mode is controlled by the parent builder UI. When enabled:

1. Hover over content elements to see the AI sparkle button
2. Click the sparkle to send an edit request to the AI agent
3. Click text elements to edit inline (auto-saves after 8 seconds or on blur)
4. Hover over images to see the replacement bar

## Analytics & EID Tracking

Dev-tools clicks and visible-surface impressions are tracked via FullStory/CSP. The toolbar runs inside the customer-app iframe and can't reach the builder's `_expDataLayer` directly, so events relay through the `eventBus` to the builder, which re-fires them via the existing `logClickEvent` / `logImpressionEvent` pipeline in `app/src/utils/instrumentation.ts`.

### EID convention

Inputs are 3-segment: `product.section.widget`. The builder-side loggers prepend `appbuilder` and append `.click` / `.impression`. So `devtools.toolbar.bold` resolves to `appbuilder.devtools.toolbar.bold.click` in FullStory.

- `product` is `devtools` for everything in this package.
- `section` is the surface (`toolbar`, future: `multi_select_badge`, `error_overlay`, …).
- `widget` is the specific button or visible UI element, in `snake_case` (`bold`, `replace_image`, `quick_edit_submit`, `multi_select_remove`).
- `surface` is reserved as a custom property on impressions to disambiguate flavors of the same widget (e.g. `view` impression with `surface: 'text' | 'image'`). Don't bake variants into the widget name when a property captures it.

### When to add an EID

- **Every new toolbar button** (or any user-affordance click): emit a `click` event the moment the user's intent is committed (drag-end, popover apply, button click). Don't fire on hover, popover-open, or live-preview drag.
- **Every new visible surface** that appears as a discrete user-facing state: emit one `impression` event per appearance. Dedupe on the appearance transition (`false → true`), not on every render.
- **Toggles / steppers**: separate widget tokens per direction if the user can distinguish them (`text_size_up` vs `text_size_down`). Single token if it's one logical action with multiple values (`text_align` covers all four alignments).
- **Don't track navigation** (link follow), **internal state** (popover open/close), or **purely cosmetic re-renders** (scroll, resize, ResizeObserver ticks).

### API

```ts
import { trackEventBus } from "../utils/eventBus";

// Click — first arg is the 3-segment input, second is optional custom properties
trackEventBus.click("devtools.toolbar.bold");
trackEventBus.click("devtools.toolbar.text_color", { source: "swatch" });

// Impression — same shape; fire once per appearance
trackEventBus.impression("devtools.toolbar.view", { surface: "text" });
```

That's it. `appId` is auto-merged on the builder side, so callers never pass it.

### Example: adding a new toolbar button

```ts
import { trackEventBus } from "../utils/eventBus";

const handleNewAction = useCallback(() => {
  if (!selectedElement) return;
  trackEventBus.click("devtools.toolbar.<widget_token>");
  // … existing action …
}, [selectedElement]);
```

Place the call after the early-return guard and before any other side-effects, so a no-op (e.g. `selectedElement === null`) doesn't fire a phantom event.

### Verifying

In the builder DevTools console after a click:

```js
window._expDataLayer.filter(e => e.schema === 'add_click' || e.schema === 'add_impression')
```

Each entry should carry the full 5-segment EID under `data.traffic.eid` (clicks) or `data.eid` (impressions), plus `appId` in `customProperties` / `custom_properties`.

## Technical Details

### Architecture

- **Plugin-based injection**: Uses Vite plugin to automatically inject tools
- **React components**: Built with React for seamless integration
- **PostMessage API**: Communicates with parent builder via iframe messages
- **Edit mode hooks**: Composable hooks for text editing, hover hints, and image detection

### File Structure

```
dev-tools/
├── src/
│   ├── components/
│   │   ├── DevelopmentMode.tsx    # Main container component
│   │   ├── ImageHoverBar.tsx      # Image replacement hover UI
│   │   └── MessageOverlay.tsx     # Message overlay component
│   ├── hooks/
│   │   ├── useEditMode.ts        # Edit mode orchestrator
│   │   ├── useTextEditing.ts     # Inline text editing
│   │   ├── useHoverHint.ts       # AI sparkle button and hover overlay
│   │   └── useImageHoverDetection.ts # Image hover detection
│   ├── utils/
│   │   ├── postMessage.ts        # Secure postMessage utilities
│   │   ├── element-detection.ts  # Element type detection
│   │   ├── element-helpers.ts    # Selector generation, dev context
│   │   ├── selection-overlay.ts  # Visual selection overlay
│   │   ├── screenshot.ts         # Screenshot capture utilities
│   │   └── translations.ts       # i18n translation loading
│   ├── ErrorBoundary.tsx          # Error boundary component
│   ├── DevToolsProvider.tsx       # App wrapper component
│   └── index.ts                   # Main exports
├── package.json
└── README.md
```

### Integration Points

- **Vite Plugin**: `vite-plugin.ts` - Handles injection into app entry points
- **Source Mapping**: Automatically adds `data-dev-*` attributes to JSX elements
- **Automatic Wrapping**: Wraps your App component with DevToolsProvider
- **Environment Detection**: Only active when `import.meta.env.MODE === 'development'`

## Troubleshooting

### Dev Tools Not Appearing

1. Ensure you're in development mode (`npm run dev`)
2. Check browser console for any errors
3. Verify the plugin is properly configured in `vite.config.ts`

### Edit Mode Not Working

1. Ensure the parent builder has edit mode enabled
2. Check browser console for postMessage errors
3. Try refreshing the preview

## License

Part of the Airo AI Builder template system.
