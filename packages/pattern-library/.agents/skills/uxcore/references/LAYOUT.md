# Layout

This reference covers layout patterns using the `@ux/box` component.

## Overview

`@ux/box` is a flex-based layout component that provides consistent spacing and alignment while supporting RTL/LTR through CSS logical properties.

**Key principle**: Use `gap` and `padding` for spacing. Avoid margin.

## Why Avoid Margin?

Margin creates spacing issues in flexible layouts:

- **Collapsing margins** cause unpredictable spacing
- **Margin on children** breaks consistent gap-based layouts
- **RTL/LTR issues** with directional margins
- **Harder maintenance** when spacing rules are scattered

Use Box's `gap` for space between children and `padding` for space inside containers.

## Basic Usage

```jsx
import Box from '@ux/box';

function CardLayout() {
  return (
    <Box
      orientation="vertical"
      gap="md"
      blockPadding="lg"
      inlinePadding="md"
    >
      <Box>Header</Box>
      <Box>Content</Box>
      <Box>Footer</Box>
    </Box>
  );
}
```

## Props Reference

| Prop | Values | Description |
|------|--------|-------------|
| `orientation` | `vertical`, `horizontal` | Direction children flow. Default: `vertical` |
| `gap` | `sm`, `md`, `lg`, `xl` | Space between children |
| `blockPadding` | `sm`, `md`, `lg`, `xl` | Padding on block axis (top/bottom in vertical) |
| `inlinePadding` | `sm`, `md`, `lg`, `xl` | Padding on inline axis (left/right in LTR) |
| `blockAlignChildren` | `start`, `center`, `end`, `spaceBetween` | Block-axis alignment |
| `inlineAlignChildren` | `start`, `center`, `end` | Inline-axis alignment |
| `blockAlignSelf` | `start`, `center`, `end` | Self alignment on block axis |
| `inlineAlignSelf` | `start`, `center`, `end` | Self alignment on inline axis |
| `wrap` | `Boolean` | Allow children to wrap (horizontal only) |
| `stretch` | `Boolean` | Fill available space (like `flex: 1`) |
| `displayType` | `String` | CSS display value. Default: `flex` |

## Spacing with Gap and Padding

### Gap for Child Spacing

Use `gap` to create consistent space between children:

```jsx
// Vertical stack with medium gaps
<Box orientation="vertical" gap="md">
  <Box>Item 1</Box>
  <Box>Item 2</Box>
  <Box>Item 3</Box>
</Box>

// Horizontal row with small gaps
<Box orientation="horizontal" gap="sm">
  <Button>Save</Button>
  <Button>Cancel</Button>
</Box>
```

### Padding for Container Space

Use `blockPadding` and `inlinePadding` for internal container spacing:

```jsx
// Card with padding
<Box
  blockPadding="lg"
  inlinePadding="md"
>
  Card content with breathing room
</Box>
```

### Combined Example

```jsx
function Card({ title, children }) {
  return (
    <Box
      orientation="vertical"
      gap="md"
      blockPadding="lg"
      inlinePadding="lg"
    >
      <text.h3 as="title" text={title} />
      {children}
    </Box>
  );
}
```

## Alignment

### Understanding Alignment Properties

**CRITICAL**: `blockAlignChildren` and `inlineAlignChildren` map directly to flexbox properties:

- **`blockAlignChildren`** → **`justify-content`** (main axis alignment)
- **`inlineAlignChildren`** → **`align-items`** (cross axis alignment)

This mapping means the physical direction these properties control **changes based on the `orientation` prop**.

### How Orientation Affects Alignment

**When `orientation="vertical"` (default):**
- Flex main axis is **vertical** (block direction)
- Flex cross axis is **horizontal** (inline direction)
- `blockAlignChildren` → controls **vertical** alignment (justify-content on vertical axis)
- `inlineAlignChildren` → controls **horizontal** alignment (align-items on horizontal axis)

```jsx
<Box orientation="vertical" blockAlignChildren="center">
  {/* blockAlignChildren centers children VERTICALLY */}
  <div>Item 1</div>
  <div>Item 2</div>
</Box>
```

**When `orientation="horizontal"`:**
- Flex main axis is **horizontal** (inline direction)
- Flex cross axis is **vertical** (block direction)
- `blockAlignChildren` → controls **horizontal** alignment (justify-content on horizontal axis)
- `inlineAlignChildren` → controls **vertical** alignment (align-items on vertical axis)

```jsx
<Box orientation="horizontal" blockAlignChildren="spaceBetween">
  {/* blockAlignChildren spaces children HORIZONTALLY */}
  <div>Left</div>
  <div>Right</div>
</Box>
```

### Common Confusion

The property names `blockAlignChildren` and `inlineAlignChildren` suggest they always control block (vertical) and inline (horizontal) directions, but **this is only true when orientation="vertical"**.

The key insight:
- **Padding props** (`blockPadding`, `inlinePadding`) always follow logical axes (block = vertical, inline = horizontal in LTR)
- **Alignment props** (`blockAlignChildren`, `inlineAlignChildren`) follow flexbox axes (main/cross), which change based on `orientation`

| Property | Maps to CSS | Behavior |
|----------|-------------|----------|
| `blockPadding` | `padding-block` | Always vertical in horizontal writing mode |
| `inlinePadding` | `padding-inline` | Always horizontal in LTR writing mode |
| `blockAlignChildren` | `justify-content` | Main axis (vertical or horizontal based on orientation) |
| `inlineAlignChildren` | `align-items` | Cross axis (horizontal or vertical based on orientation) |

### Flexbox Mental Model

Think of alignment properties in flexbox terms:
- `blockAlignChildren` = **main axis** alignment (where children flow)
- `inlineAlignChildren` = **cross axis** alignment (perpendicular to flow)

This makes the behavior predictable once you know the `orientation`.
### Centering Content

```jsx
// Center horizontally and vertically
<Box
  blockAlignChildren="center"
  inlineAlignChildren="center"
  style={{ minHeight: '200px' }}
>
  Centered content
</Box>
```

### Distributing Space

```jsx
// Space between header and actions
<Box
  orientation="horizontal"
  blockAlignChildren="spaceBetween"
  inlineAlignChildren="center"
>
  <Logo />
  <Navigation />
</Box>
```

### Positioning Examples

```jsx
// Top-left corner (vertical orientation)
<Box blockAlignChildren="start" inlineAlignChildren="start">
  Content
</Box>

// Bottom-right corner (vertical orientation)
<Box blockAlignChildren="end" inlineAlignChildren="end">
  Content
</Box>

// Center-left (vertical orientation)
<Box blockAlignChildren="start" inlineAlignChildren="center">
  Content
</Box>
```

## Common Patterns

### Page Layout

```jsx
function PageLayout({ header, sidebar, main, footer }) {
  return (
    <Box orientation="vertical" gap="lg">
      {header}
      <Box orientation="horizontal" gap="lg">
        <Box style={{ width: '250px' }}>{sidebar}</Box>
        <Box stretch>{main}</Box>
      </Box>
      {footer}
    </Box>
  );
}
```

### Form Layout

```jsx
function FormSection({ children }) {
  return (
    <Box orientation="vertical" gap="md" blockPadding="lg">
      {children}
    </Box>
  );
}

function FormRow({ children }) {
  return (
    <Box orientation="horizontal" gap="sm" wrap>
      {children}
    </Box>
  );
}
```

### Card Grid

```jsx
function CardGrid({ cards }) {
  return (
    <Box orientation="horizontal" gap="lg" wrap>
      {cards.map(card => (
        <Box
          key={card.id}
          orientation="vertical"
          gap="sm"
          blockPadding="md"
          inlinePadding="md"
        >
          <text.h4 as="title" text={card.title} />
          <text.p as="paragraph" text={card.description} />
        </Box>
      ))}
    </Box>
  );
}
```

### Button Group

```jsx
function ButtonGroup({ children, align = 'end' }) {
  return (
    <Box
      orientation="horizontal"
      gap="sm"
      blockAlignChildren={align}
    >
      {children}
    </Box>
  );
}
```

## Alternative APIs

### useBox Hook

For applying Box styles to custom elements:

```jsx
import { useBox } from '@ux/box';

function CustomSection({ children }) {
  const boxProps = useBox({
    orientation: 'vertical',
    gap: 'md',
    blockPadding: 'lg'
  });

  return <section {...boxProps}>{children}</section>;
}
```

### Semantic Elements

Use `box.*` for semantic HTML with Box styling:

```jsx
import { box } from '@ux/box';

function Article() {
  return (
    <box.article orientation="vertical" gap="md">
      <box.header>Article Header</box.header>
      <box.main>Article Content</box.main>
      <box.footer>Article Footer</box.footer>
    </box.article>
  );
}
```

## RTL/LTR Support

Box automatically handles bidirectional layouts through CSS logical properties:

- `inlinePadding` applies to start/end (not left/right)
- `blockPadding` applies to block start/end
- Alignment props work correctly in both directions

No additional configuration needed for RTL support.

## Best Practices

### Do

- Use `gap` for space between siblings
- Use `blockPadding` and `inlinePadding` for container spacing
- Nest Box components for complex layouts
- Use `stretch` to fill available space
- Choose semantic elements with `box.*` when appropriate

### Don't

- **Don't use margin** for spacing between components
- Don't apply CSS margin to Box children
- Don't mix margin utilities with Box layouts
- Don't hardcode pixel values for spacing; use t-shirt sizes
- Don't use `displayType` unless specifically needed

## Migrating from Margin

### Before (Margin-Based)

```jsx
// Avoid this pattern
<div className="mb-4">
  <Header />
</div>
<div className="mt-4 mb-4">
  <Content />
</div>
<div className="mt-4">
  <Footer />
</div>
```

### After (Gap-Based)

```jsx
// Preferred pattern
<Box orientation="vertical" gap="lg">
  <Header />
  <Content />
  <Footer />
</Box>
```

### Handling External Components

When wrapping components that use margin internally:

```jsx
// If LegacyComponent has margin, wrap in Box to isolate
<Box orientation="vertical" gap="md">
  <Box>
    <LegacyComponent />
  </Box>
  <NewComponent />
</Box>
```

## Spacing Scale

| Size | Typical Value | Use Case |
|------|---------------|----------|
| `sm` | 8px | Tight spacing, inline elements |
| `md` | 16px | Default component spacing |
| `lg` | 24px | Section spacing |
| `xl` | 32px | Major section breaks |

Actual values are theme-controlled and may vary.
