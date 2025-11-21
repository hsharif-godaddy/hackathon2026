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
│   ├── secrets-utils.ts           # Secrets management utilities
│   └── index.ts                   # Main exports
├── package.json
└── README.md
```

### Integration Points

- **Vite Plugin**: `plugins/dev-tools-injector.ts` - Handles injection and source mapping
- **Source Mapping**: Automatically adds `data-dev-*` attributes to JSX elements
- **Automatic Wrapping**: Wraps your App component with DevToolsProvider
- **Environment Detection**: Only active when `import.meta.env.MODE === 'development'`

## Secrets Management

### Overview

The dev-tools package includes utilities for accessing non-system-managed secrets from `/alloc/config.json` in the running container. These utilities are located in `src/secrets-utils.ts` and exported from the main package for easy importing.

### Available Functions

#### `getSecret(secretName: string)`

Retrieves a non-system-managed secret value by name.

```typescript
import { getSecret } from "@dev-tools";

// Get a secret value
const apiKey = getSecret("OPENAI_API_KEY");
if (apiKey) {
  console.log("API Key found:", apiKey);
} else {
  console.log("Secret not found or is system-managed");
}
```

**Parameters:**

- `secretName` (string): Name of the secret to retrieve

**Returns:**

- `string | object | null`: Secret value if found and non-system-managed, null otherwise

**Behavior:**

- Returns `null` if secret doesn't exist
- Returns `null` if secret is system-managed
- Returns the actual value (string or parsed JSON object) for non-system-managed secrets

#### `listSecretNames()`

Lists all non-system-managed secret names.

```typescript
import { listSecretNames } from "@dev-tools";

// Get all non-system-managed secret names
const secretNames = listSecretNames();
console.log("Available secrets:", secretNames);
// Output: ['OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'DATABASE_URL']
```

**Returns:**

- `string[]`: Array of non-system-managed secret names (sorted alphabetically)

**Behavior:**

- Only includes secrets with `SYSTEM_MANAGED: false`
- Returns empty array if config file cannot be read
- Results are sorted alphabetically

### Security Notes

- ⚠️ These utilities **ONLY** access non-system-managed secrets
- 🔒 System-managed secrets are completely inaccessible via these functions
- 📁 Secrets are read from `/alloc/config.json` in the container
- ⚙️ Intended for server-side use only (Node.js environment)

### Example Use Cases

**Dynamic API Configuration:**

```typescript
import { getSecret } from "@dev-tools";

const openaiKey = getSecret("OPENAI_API_KEY");
const stripeKey = getSecret("STRIPE_SECRET_KEY");

if (openaiKey && stripeKey) {
  // Initialize services with secrets
  initializeOpenAI(openaiKey);
  initializeStripe(stripeKey);
}
```

**Secret Validation:**

```typescript
import { listSecretNames, getSecret } from "@dev-tools";

const requiredSecrets = ["DATABASE_URL", "API_KEY", "JWT_SECRET"];
const availableSecrets = listSecretNames();

for (const required of requiredSecrets) {
  if (!availableSecrets.includes(required)) {
    console.error(`Missing required secret: ${required}`);
  }
}
```

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
