# Airo Source Mapper

A Vite plugin that adds source mapping attributes to React components for development tools and debugging.

## Features

- **Accurate Line Mapping**: Preserves original source code line numbers in transformed output
- **Component Detection**: Automatically detects and maps React component names
- **File Path Mapping**: Maps elements back to their source files
- **Development-Only**: Only processes files outside of `node_modules`
- **Source Map Support**: Generates proper source maps for browser debugging

## Installation

```bash
npm install @airo/source-mapper
```

## Usage

Add the plugin to your Vite configuration:

```typescript
import { defineConfig } from 'vite'
import { sourceMapperPlugin } from '@airo/source-mapper'

export default defineConfig({
  plugins: [
    sourceMapperPlugin(),
    // ... other plugins
  ],
})
```

## How It Works

The plugin transforms JSX elements by adding development attributes:

**Input:**
```tsx
export default function MyComponent() {
  return (
    <div className="container">
      <h1>Title</h1>
      <p>Content</p>
    </div>
  );
}
```

**Output:**
```tsx
export default function MyComponent() {
  return (
    <div 
      className="container"
      data-dev-file="/src/MyComponent.tsx"
      data-dev-line="4"
      data-dev-component="MyComponent"
    >
      <h1 
        data-dev-file="/src/MyComponent.tsx"
        data-dev-line="5"
        data-dev-component="MyComponent"
      >
        Title
      </h1>
      <p 
        data-dev-file="/src/MyComponent.tsx"
        data-dev-line="6"
        data-dev-component="MyComponent"
      >
        Content
      </p>
    </div>
  );
}
```

## Attributes Added

- `data-dev-file`: Relative path to the source file
- `data-dev-line`: Line number where the JSX element starts
- `data-dev-component`: Name of the React component containing the element

## Browser Debugging

The plugin includes browser debugging utilities. In your browser console:

```javascript
// Analyze all mapped elements
debugSourceMapper()

// Validate line number accuracy
validateLineNumbers()

// Highlight elements with potential issues
highlightIssues()

// Compare with actual source code
compareWithSource(sourceCode, 'MyComponent.tsx')
```

## Testing

The plugin includes comprehensive tests covering:

- Line number accuracy
- Component name detection
- Edge cases (fragments, nested components, etc.)
- Source map generation
- Error handling

Run tests:
```bash
npm test           # Run all tests
npm run test:watch # Run tests in watch mode
```

## Line Number Accuracy Fix

**Issue**: Previous versions generated compressed/minified output, causing line number mismatches in the browser.

**Solution**: The plugin now uses Babel generator options to preserve original formatting:

```typescript
const result = generate(ast, {
  sourceMaps: true,
  sourceFileName: id,
  compact: false,      // Don't compress output
  minified: false,     // Don't minify
  retainLines: true,   // Preserve line structure
}, code);
```

This ensures that:
- Original line numbers are preserved in transformed code
- Browser debugging shows accurate source locations
- Source maps correctly map between original and transformed code

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build the plugin
npm run build

# Watch for changes during development
npm run dev
```

## Supported File Types

- `.tsx` - TypeScript React files
- `.jsx` - JavaScript React files  
- `.ts` - TypeScript files (if they contain JSX)
- `.js` - JavaScript files (if they contain JSX)

Files in `node_modules` are automatically excluded.

## Component Name Detection

The plugin detects component names from:

1. **Function declarations**: `function MyComponent() {}`
2. **Arrow functions**: `const MyComponent = () => {}`
3. **Function expressions**: `const MyComponent = function() {}`
4. **Default exports**: `export default function() {}` (mapped as "default")

## Error Handling

The plugin gracefully handles:
- Malformed/unparseable code
- Files without JSX content
- Missing source location information
- Babel parsing errors

Errors are logged as warnings and don't break the build process.

## Performance

- Only processes React component files
- Skips files that already have `data-dev-*` attributes
- Uses efficient AST traversal
- Minimal impact on build times

## License

MIT
