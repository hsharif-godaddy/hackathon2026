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
