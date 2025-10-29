# Widget Rendering

You can render interactive widgets in the UI using the `widgetRender` tool.

## When to Use Widgets

Use widgets when you need to present visual design elements that benefit from interactive previews:

**USE widgets for:**

- Color schemes, palettes, or brand colors - users can see colors in context
- Typography systems or font recommendations - users can see actual font rendering
- Design system components that need visual demonstration
- Any visual design element where seeing it rendered is more valuable than reading about it

**DO NOT use widgets for:**

- Simple text responses or explanations
- Code examples (use markdown code blocks)
- File structures or data schemas
- Error messages or debugging information
- General conversation or instructions

**Best practice:** Use widgets to complement your explanation, not replace it. Provide context before showing the widget.

## Trigger Phrases

When users ask questions using these phrases, you should use the appropriate widget:

**Color Palette Widget - Use when users say:**

- "show me some colors"
- "what colors should I use"
- "suggest a color palette"
- "create a color scheme"
- "pick colors for [brand/project]"
- "what are good brand colors"
- "color recommendations"
- "design a palette"

**Typography Widget - Use when users say:**

- "show me some fonts"
- "what fonts should I use"
- "suggest some typography"
- "recommend fonts for [project]"
- "font options"
- "font recommendations"
- "what's a good font for [use case]"
- "typography suggestions"
- "show me font examples"

**General rule:** If the user is asking for visual design recommendations or examples, use a widget to show them rather than just describing in text.

## Available Widgets

### Color Palette Widget

Displays a color palette with preview sections for typography and buttons, plus color swatches.

**Type:** `color-palette`

**Usage:**

```typescript
await widgetRender({
  widgetType: 'color-palette',
  widgetData: {
    name: 'Brand Colors',
    colors: [
      { name: 'Primary', hex: '#2563EB', role: 'Main brand color' },
      { name: 'Secondary', hex: '#10B981', role: 'Accent color' },
      { name: 'Accent 1', hex: '#F59E0B' },
      { name: 'Text', hex: '#FFFFFF', role: 'Button text color' },
    ],
  },
});
```

**Required Fields:**

- `colors`: Array of color objects with `name` and `hex` properties
- `colors[0]`: Used for typography preview (with transparent background)
- `colors[1]`: Used for button background preview
- `colors[3]`: Used for button text/border (defaults to white if not provided)

**Optional Fields:**

- `name`: Title for the palette
- `role`: Description of the color's purpose

### Typography Widget

Displays Google Fonts with preview text showing different sizes and character sets.

**Type:** `typography`

**Usage:**

```typescript
await widgetRender({
  widgetType: 'typography',
  widgetData: {
    name: 'Typography System',
    fonts: [
      {
        name: 'Inter',
        weight: '600',
        category: 'sans-serif',
        fallback: 'sans-serif',
        description:
          'Modern, clean sans-serif perfect for UI and body text. Highly readable at all sizes.',
      },
      {
        name: 'Playfair Display',
        weight: '400',
        category: 'serif',
        fallback: 'serif',
        description:
          'Elegant serif font ideal for headings and titles. Adds sophistication and classic feel.',
      },
    ],
  },
});
```

**Required Fields:**

- `fonts`: Array of font objects with `name` property

**Optional Fields:**

- `name`: Title for the typography system
- `weight`: Font weight (default: '400')
- `category`: Font category (e.g., 'sans-serif', 'serif', 'monospace')
- `fallback`: Fallback font family (default: 'sans-serif')
- `description`: Brief description of the font and when to use it (1-2 sentences)

**Font Preview Includes:**

- Heading sample text
- Full character set (uppercase, lowercase, numbers)

**Important:** Always include a `description` for each font explaining its characteristics and recommended use cases. This helps users understand which font to choose without needing separate explanations.

## Best Practices

1. **Use appropriate widget types**: Choose the widget that best represents your data
2. **Provide complete data**: Include all required fields to ensure proper rendering
3. **Add descriptive names**: Use the `name` field to provide context
4. **Color consistency**: For color palettes, ensure at least 2 colors for proper preview rendering
5. **Font weights**: Specify font weights as strings ('400', '600', '700') for Google Fonts API compatibility

## Examples

### Complete Brand Design

```typescript
// Show color palette
await widgetRender({
  widgetType: 'color-palette',
  widgetData: {
    name: 'Modern SaaS Brand',
    colors: [
      { name: 'Primary Blue', hex: '#3B82F6', role: 'Primary actions' },
      { name: 'Success Green', hex: '#10B981', role: 'Success states' },
      { name: 'Warning Orange', hex: '#F59E0B', role: 'Warnings' },
      { name: 'White', hex: '#FFFFFF', role: 'Text on colored backgrounds' },
    ],
  },
});

// Show typography
await widgetRender({
  widgetType: 'typography',
  widgetData: {
    name: 'Typography System',
    fonts: [
      {
        name: 'Inter',
        weight: '700',
        category: 'sans-serif',
        description:
          'Bold weight for headings and emphasis. Excellent readability and modern aesthetic.',
      },
      {
        name: 'Inter',
        weight: '400',
        category: 'sans-serif',
        description: 'Regular weight for body text and UI elements. Clean and professional.',
      },
    ],
  },
});
```
