# Responsive Design and Bidirectionality

This reference covers responsive techniques and RTL/LTR support for UXCore applications.

## Core Principles

1. **Think flexibly** - Avoid fixed pixel values
2. **Listen to ancestors, not viewport** - Use container queries over media queries
3. **Use logical properties** - Support RTL/LTR automatically
4. **Maintain visual order** - Don't reorder elements with CSS alone

## Avoiding Fixed Units

### No Magic Numbers

Avoid pixel values that are oddly specific to current content:

```css
/* Bad: Magic number */
.sidebar {
  width: 247px;
}

/* Good: Flexible approach */
.sidebar {
  width: 20%;
  min-width: 200px;
  max-width: 300px;
}
```

### Translation Considerations

Content length varies dramatically across languages. "Buy now!" in English becomes much longer in Mongolian.

```css
/* Bad: Will break with longer translations */
.button {
  width: 80px;
}

/* Good: Content determines size */
.button {
  min-width: 80px;
  padding-inline: 1rem;
}
```

### Prefer Relative Units

| Avoid | Prefer |
|-------|--------|
| `px` (most cases) | `rem`, `em`, `%` |
| Viewport units in components | Container units (`cqi`, `cqb`) |
| Fixed dimensions | `min-*`, `max-*` constraints |

## Container Queries Over Media Queries

### The Problem with Media Queries

Media queries listen to the viewport, not the component's container. A component using `@media (min-width: 600px)` won't adapt when placed in a narrow sidebar—it only knows about the viewport width, not its actual available space.

### Container Query Solution

```css
/* Define the container */
.card {
  container-type: inline-size;
  container-name: card;
}

/* Default: vertical layout */
.card .content {
  display: flex;
  flex-direction: column;
}

/* When card container is wide enough: horizontal */
@container card (min-width: 400px) {
  .card .content {
    flex-direction: row;
  }
}
```

### Container Query Units

Reference the container's size instead of viewport:

| Unit | Description |
|------|-------------|
| `cqi` | 1% of container's inline size (width in LTR) |
| `cqb` | 1% of container's block size (height) |
| `cqmin` | Smaller of `cqi` or `cqb` |
| `cqmax` | Larger of `cqi` or `cqb` |

```css
.content {
  width: 80cqi; /* 80% of container's inline size */
  font-size: clamp(0.875rem, 2cqi, 1.25rem);
}
```

### When Media Queries Are Appropriate

Use media queries when your component is directly related to the viewport:

- Full-page modals and backdrops
- Sticky headers
- Navigation that becomes a hamburger menu
- Print stylesheets

## Bidirectional Support (RTL/LTR)

### CSS Logical Properties

Replace physical directions with logical ones:

| Physical (Avoid) | Logical (Prefer) |
|------------------|------------------|
| `left` | `inline-start` |
| `right` | `inline-end` |
| `top` | `block-start` |
| `bottom` | `block-end` |
| `width` | `inline-size` |
| `height` | `block-size` |

### Property Mapping

```css
/* Physical (only works in LTR) */
.element {
  padding-left: 1rem;
  margin-right: 0.5rem;
  border-top: 1px solid;
  text-align: left;
}

/* Logical (works in RTL and LTR) */
.element {
  padding-inline-start: 1rem;
  margin-inline-end: 0.5rem;
  border-block-start: 1px solid;
  text-align: start;
}
```

### Shorthand Properties

```css
/* Physical shorthand */
padding: 10px 20px 15px 25px; /* top right bottom left */

/* Logical shorthand */
padding-block: 10px 15px;   /* block-start block-end */
padding-inline: 25px 20px;  /* inline-start inline-end */
```

### Modern Display Properties

`display: flex` and `display: grid` are writing-direction aware:

```jsx
// Automatically reverses in RTL
<ul style={{ display: 'flex' }} dir="rtl">
  <li>item 1</li>  {/* Appears rightmost */}
  <li>item 2</li>
  <li>item 3</li>  {/* Appears leftmost */}
</ul>
```

### @ux/box Handles Bidirectionality

The Box component uses logical properties internally:

```jsx
import Box from '@ux/box';

// Automatically works in RTL and LTR
<Box
  blockPadding="lg"      // padding-block
  inlinePadding="sm"     // padding-inline
  gap="md"
>
  <Box>Content</Box>
</Box>
```

**Keyword mapping**:
- `block` → vertical axis (top/bottom in LTR)
- `inline` → horizontal axis (left/right in LTR)
- `start` → beginning of reading direction
- `end` → end of reading direction

## Maintaining Visual Order

### Don't Reorder with CSS Alone

Visually reordering elements breaks accessibility:

```css
/* Bad: Screen readers see different order than visual */
.container {
  display: flex;
  flex-direction: row-reverse;
}

/* Bad: CSS order property */
.first { order: 2; }
.second { order: 1; }
```

### Use JavaScript for Reordering

If reordering is necessary, update the actual DOM:

```jsx
function ResponsiveList({ items }) {
  const containerRef = useRef(null);
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setIsNarrow(entry.contentRect.width < 400);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Reorder in React, not CSS
  const orderedItems = isNarrow ? [...items].reverse() : items;

  return (
    <div ref={containerRef}>
      {orderedItems.map(item => (
        <div key={item.id}>{item.content}</div>
      ))}
    </div>
  );
}
```

### ResizeObserver Pattern

```jsx
function useContainerSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!ref.current) return;

    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height
      });
    });

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
```

> **Warning**: JavaScript-based layout changes are costly. Prefer CSS solutions when possible.

## Best Practices Summary

| Do | Don't |
|----|-------|
| Use container queries for component responsiveness | Use media queries for component layouts |
| Use `cqi`/`cqb` units | Use `vw`/`vh` in reusable components |
| Use `padding-inline-start` | Use `padding-left` |
| Use `@ux/box` for layouts | Use Bootstrap grid classes |
| Reorder DOM with JavaScript when needed | Use CSS `order` or `flex-direction: reverse` |
| Use `rem`/`em`/`%` for sizes | Use pixel magic numbers |

## Resources

- [MDN: Container Queries](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries)
- [MDN: CSS Logical Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_logical_properties_and_values)
- [Google Material: Bidirectionality](https://m2.material.io/design/usability/bidirectionality.html)
- [Responsive Web Design (original article)](https://alistapart.com/article/responsive-web-design/)
