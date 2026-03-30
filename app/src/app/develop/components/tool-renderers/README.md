# Tool Renderer System

A maintainable framework for rendering AI tool calls with custom visualizations.

## Overview

The tool renderer system provides a flexible way to display tool calls in the chat interface. It follows the same pattern as the widget system, allowing for:

1. **Default rendering** - Subtle, compact display for all tools
2. **Custom renderers** - Specialized visualizations for specific tools
3. **Easy extensibility** - Simple registration process for new custom renderers

## Architecture

```
tool-renderers/
├── index.ts                    # Registry and exports
├── DefaultToolRenderer.tsx     # Default subtle renderer
├── README.md                   # This file
└── [CustomRenderer].tsx        # Future custom renderers
```

## Default Rendering

The `DefaultToolRenderer` provides a minimal, subtle display:

- Light gray text with tool name
- Small status indicator (spinner/checkmark/X) on the right
- Takes up minimal vertical space
- No expandable sections by default

### Example Output

```
Reading file main.ts ✓
Editing config.json ⟳
Search failed ✗
```

## Creating Custom Tool Renderers

### Step 1: Create the Renderer Component

Create a new file in `tool-renderers/` directory:

```tsx
// tool-renderers/FileEditToolRenderer.tsx
"use client";

import { DefaultToolRendererProps } from "./DefaultToolRenderer";

export default function FileEditToolRenderer({
  toolName,
  toolStatus,
  duration,
  input,
  result,
  error,
}: DefaultToolRendererProps) {
  // Extract file path from input
  const filePath = input?.path || input?.target_file;

  return (
    <div className="flex items-center gap-2">
      <span className="text-blue-500">📝</span>
      <span className="text-sm">
        Edited <code className="font-mono">{filePath}</code>
      </span>
      {toolStatus === "completed" && <span className="text-green-500">✓</span>}
    </div>
  );
}
```

### Step 2: Register in the Registry

Add your renderer to `tool-renderers/index.ts`:

```typescript
import FileEditToolRenderer from "./FileEditToolRenderer";

export const toolRendererRegistry = {
  file_edit: FileEditToolRenderer,
  edit_file: FileEditToolRenderer,
  // Add more custom renderers here
} as const;
```

### Step 3: Export Types (if needed)

If your custom renderer has special props, export them:

```typescript
export { FileEditToolRenderer };
export type { FileEditToolRendererProps } from "./FileEditToolRenderer";
```

## Usage

The tool renderer is automatically used by `StreamingIntegratedResponse.tsx`:

```tsx
import ToolRenderer from "@/app/develop/components/ToolRenderer";

<ToolRenderer toolCall={toolCall} />;
```

The `ToolRenderer` component:

1. Receives a `ToolCall` object
2. Looks up if a custom renderer exists for that tool name
3. Renders using custom renderer if found, otherwise uses `DefaultToolRenderer`

## Planned (Phase 2)

### Auto-Disappearing Tools

Tools that disappear after completion:

```tsx
export interface ToolRendererConfig {
  autoHideAfterMs?: number; // Hide after X milliseconds
  hideOnSuccess?: boolean; // Only hide on success
}
```

### Tool Grouping

Group related tool calls together:

```tsx
export interface ToolGroup {
  id: string;
  tools: ToolCall[];
  groupType: "file-edits" | "retries" | "custom";
  displayMode: "collapsed" | "expanded" | "summary";
}
```

Example use cases:

- Multiple edits to same file → show as single "Edited file.ts (3 changes)"
- Failed then successful retry → show only final success
- Sequential related operations → collapsible group

## Props Interface

All tool renderers receive these props:

```typescript
interface DefaultToolRendererProps {
  toolName: string; // Name of the tool
  toolStatus: "running" | "completed" | "error"; // Current status
  duration?: number; // Execution time in ms
  input?: Record<string, unknown>; // Tool input parameters
  result?: Record<string, unknown> | string; // Tool result/output
  error?: string; // Error message if failed
  startTime?: number; // Start timestamp
  endTime?: number; // End timestamp
}
```

## Best Practices

### 1. Keep Default Rendering Subtle

- Use muted colors (gray-400, gray-500)
- Minimal vertical space
- No borders or backgrounds by default
- Show essential info only

### 2. Custom Renderers for Rich Data

Create custom renderers when:

- Tool returns structured data (images, tables, charts)
- Tool needs interactive elements
- Tool output requires special formatting
- Tool has domain-specific visualization needs

### 3. Handle All States

Always handle:

- `running` - Show progress indicator
- `completed` - Show success state
- `error` - Show error state clearly

### 4. Progressive Disclosure

- Show summary by default
- Allow expanding for details
- Use collapsible sections for verbose output

### 5. Performance

- Avoid heavy computations in render
- Memoize expensive operations
- Use virtualization for long lists

## Planned (Phase 2): Custom Renderers

### Image Search Renderer

```tsx
// Shows thumbnail grid of search results
<ImageSearchToolRenderer toolCall={toolCall} />
```

### File Diff Renderer

```tsx
// Shows side-by-side diff view
<FileDiffToolRenderer toolCall={toolCall} />
```

### Database Query Renderer

```tsx
// Shows results in table format
<DatabaseQueryToolRenderer toolCall={toolCall} />
```

## Migration from Old System

The old `ToolCallMessage` component provided:

- Expandable sections
- Full input/output display
- Duration display
- Status badges

These features are now:

- **Default**: Minimal display only
- **Custom renderers**: Can implement expandable sections as needed
- **Opt-in complexity**: Only show details when valuable

## Testing

Test your custom renderer:

```tsx
import { render } from "@testing-library/react";
import FileEditToolRenderer from "./FileEditToolRenderer";

test("renders file path", () => {
  const { getByText } = render(
    <FileEditToolRenderer
      toolName="file_edit"
      toolStatus="completed"
      input={{ path: "/src/app.ts" }}
    />,
  );
  expect(getByText(/app.ts/)).toBeInTheDocument();
});
```

## Troubleshooting

### Tool not using custom renderer

1. Check tool name matches registry key exactly
2. Verify import in `index.ts`
3. Check for TypeScript errors

### Renderer not displaying correctly

1. Verify props are being passed correctly
2. Check CSS classes are available
3. Test with different tool states

### Performance issues

1. Use React DevTools Profiler
2. Memoize expensive computations
3. Consider lazy loading for heavy components
