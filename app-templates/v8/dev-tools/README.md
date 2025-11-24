# Airo Dev Tools

Visual editing components for Airo AI Builder development mode. These tools allow you to interactively edit CSS styles of elements in your application during development.

## Features

- 🎯 **Element Selection**: Click any element to select and edit it
- 🎨 **Visual Editor**: Intuitive toolbar for font size, weight, colors, spacing
- ⌨️ **Keyboard Shortcuts**: Press `Ctrl/Cmd + Shift + E` to toggle selection mode
- 🔧 **Development Only**: Automatically excluded from production builds
- 🚫 **No Code Pollution**: Never appears in your actual source code

## How It Works

The dev tools are automatically injected into your application during development via a Vite plugin. They:

1. Only activate in development mode (`NODE_ENV=development`)
2. Are completely excluded from production builds
3. Don't require any changes to your application code
4. Work seamlessly with your existing React components

## Usage

### Activation

- **Automatic**: Dev tools are automatically active in development mode
- **Manual**: Press `Ctrl/Cmd + Shift + E` to enter selection mode

### Element Selection

1. Press `Ctrl/Cmd + Shift + E` to activate selection mode
2. You'll see a blue gradient indicator at the top of the screen
3. Hover over any element to see it highlighted in blue
4. Click on an element to select it and open the style editor

### Style Editing

Once an element is selected, you can modify:

- **Font Size**: 12px, 14px, 16px, 18px, 20px, 24px, 30px, 36px
- **Font Weight**: Normal/Bold toggle
- **Text Color**: Black, Gray, Blue, Purple, Green, Red, Yellow, Pink
- **Background Color**: None, White, Gray 100, Blue 100, Green 100, Yellow 100, Red 100
- **Margin**: None, 0.25rem, 0.5rem, 0.75rem, 1rem, 1.5rem, 2rem
- **Padding**: None, 0.25rem, 0.5rem, 0.75rem, 1rem, 1.5rem, 2rem

### Closing the Editor

- Click the "X" button in the toolbar
- Select a different element
- Press `Ctrl/Cmd + Shift + E` again to enter selection mode

## Technical Details

### Architecture

- **Plugin-based injection**: Uses Vite plugin to automatically inject tools
- **React components**: Built with React for seamless integration
- **PostMessage API**: Supports iframe contexts for advanced setups
- **CSS class manipulation**: Directly modifies Tailwind CSS classes

### File Structure

```
dev-tools/
├── src/
│   ├── components/
│   │   ├── DevelopmentMode.tsx    # Main container component
│   │   └── ElementEditor.tsx      # Style editing toolbar
│   ├── hooks/
│   │   └── useDevelopmentMode.ts  # Core selection and state logic
│   ├── plugins/
│   │   └── source-mapper.ts       # Babel plugin for source mapping
│   ├── utils/
│   │   └── postMessage.ts         # Secure postMessage utilities
│   ├── ErrorBoundary.tsx          # Error boundary component
│   ├── DevToolsProvider.tsx       # App wrapper component
│   └── index.ts                   # Main exports
├── package.json
└── README.md
```

### Integration Points

- **Vite Plugin**: `plugins/dev-tools-injector.ts` - Handles injection and source mapping
- **Source Mapping**: Automatically adds `data-dev-*` attributes to JSX elements
- **Automatic Wrapping**: Wraps your App component with DevToolsProvider
- **Environment Detection**: Only active when `import.meta.env.MODE === 'development'`

## Development

### Building the Dev Tools

```bash
cd dev-tools
npm run build
```

### Watching for Changes

```bash
cd dev-tools
npm run dev
```

## Future Enhancements

- **File Saving**: Save style changes back to source files
- **Component Context**: Show which component contains each element
- **Responsive Design**: Edit styles for different breakpoints
- **Layout Tools**: Visual padding/margin adjustment
- **Color Picker**: Custom color selection
- **Undo/Redo**: Style change history

## Troubleshooting

### Dev Tools Not Appearing

1. Ensure you're in development mode (`npm run dev`)
2. Check browser console for any errors
3. Verify the plugin is properly configured in `vite.config.ts`

### Selection Mode Not Working

1. Try refreshing the page
2. Check if any other tools are interfering with click events
3. Ensure JavaScript is enabled

### Styles Not Applying

1. Check that your element has proper Tailwind classes
2. Verify Tailwind CSS is properly configured
3. Look for CSS specificity conflicts

## License

Part of the Airo AI Builder template system.
