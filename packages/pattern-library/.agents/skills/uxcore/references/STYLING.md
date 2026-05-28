# CSS Styling Best Practices

This reference covers CSS organization, selectors, overrides, and z-index management for UXCore applications.

## CSS Organization

Keep styles as close to the component as possible. This makes it easier to identify when styles are no longer needed.

**Organization hierarchy (closest to component is best):**

1. CSS creates the component (Style Components or similar)
2. CSS in the same directory/file as the component
3. CSS directory in the component project
4. "Utility" CSS file (least preferred)

Utility selectors that work across the page should be rare and typically provided by the platform team (e.g., `box-sizing: border-box`).

## Selector Naming

Create classes that describe the purpose of the element or its state:

```jsx
// Good: Descriptive class names
<MyCard className="my-card my-card--selected" />

// Good: Using data attributes for states
<MyCard className="my-card" data-selected="true" />

// Good: Using ARIA attributes (when semantically appropriate)
<MyCard className="my-card" aria-selected="true" />
```

```css
/* Targeting your custom class */
.my-card { }
.my-card--selected { }

/* Targeting data attributes */
.my-card[data-selected="true"] { }

/* Targeting ARIA (only when semantically appropriate) */
.my-card[aria-selected="true"] { }
```

**Never add test-only attributes to production:**

```jsx
// Bad: Test anchors in production
<div data-cy="submit-button" />

// If needed, add conditionally by environment
```

## Override Best Practices

**Avoid overriding CSS wherever possible.**

When design doesn't match existing resources:

1. Double-check with design partners about using existing components
2. Consult the component team (#uxcore-support on Slack)
3. If override is required, follow these rules:

### Never Target Internal Classes

```css
/* BAD: Targeting classes you don't control */
.ux-modal {
  z-index: 1000000;
}

/* BAD: UXCore internal classes */
.ux-button__text { }
.ux-card__content { }
```

### Use Your Own Classes

```jsx
<Alert className="my-custom-class">Content</Alert>
```

```css
/* GOOD: Target your custom class */
.my-custom-class {
  margin: auto;
}
```

### Document Overrides

When overriding is necessary, add comments explaining why:

```css
/*
 * Override: Modal positioning
 * Reason: Design requires modal centered in sidebar, not viewport
 * TODO: Remove when Modal supports `container` prop (UXC-1234)
 */
.sidebar-modal {
  position: absolute;
}
```

## Limiting Styles

Custom classes aren't just for overrides—use them for layout composition:

```jsx
<Card className="product-card">
  <Button className="product-card__action" />
</Card>
```

```css
.product-card {
  /* Layout positioning */
}

.product-card__action {
  /* Placement within card */
}
```

## Legacy Utility Classes

**Do not use legacy Bootstrap-style utility classes** (historically from `@ux/style-common`).

These classes (e.g., `mt-3`, `p-2`, `d-flex`) were copied from Bootstrap 3 (2015) and are deprecated.

| Legacy Utility | UXCore Replacement |
|----------------|-------------------|
| `background-color` classes | Use `@ux/intents` |
| `border-color` classes | Use `@ux/intents` |
| `color` classes | Use `@ux/intents` |
| `.clearfix` | Use `@ux/box` |
| `.d-flex`, `.flex-*` | Use `@ux/box` |
| `.pull-left`, `.pull-right` | Use `@ux/box` |
| `.p-*`, `.px-*`, `.py-*` | Use `@ux/box` or `@ux/space` |
| `.m-*`, `.mx-*`, `.my-*` | Use `@ux/box` with `gap` |
| Font utilities | Use `@ux/text` |
| `.card-*` | Use `@ux/card` |

### Replacing Spacing Utilities

```jsx
// Instead of: <div className="p-3 mb-4">
<Box blockPadding="md" inlinePadding="md">
  <Box>Content with gap below handled by parent</Box>
</Box>

// Instead of: <div className="d-flex align-items-center justify-content-between">
<Box
  orientation="horizontal"
  blockAlignChildren="spaceBetween"
  inlineAlignChildren="center"
>
  <span>Left</span>
  <span>Right</span>
</Box>
```

## z-index Best Practices

### Avoid z-index Entirely

Elements appear in DOM order by default. Use this natural stacking:

```jsx
function MyApp() {
  return (
    <div>
      <Dropdown id="in-app" />    {/* Behind modal */}
      <Modal />                    {/* On top */}
      <Dropdown id="in-modal" />  {/* On top of modal */}
    </div>
  );
}
```

### Avoid Creating Stacking Contexts

Properties that create stacking contexts can cause unexpected layering:

- `position: relative/absolute/fixed` with `z-index`
- `opacity` less than 1
- `transform`, `filter`, `perspective`
- `isolation: isolate`

### Use CSS Grid for Overlapping Elements

Instead of position absolute:

```css
/* Old approach (creates stacking context) */
.parent {
  position: relative;
}
.parent > * {
  position: absolute;
  inset: 0;
}

/* Better: CSS Grid (no stacking context) */
.parent {
  display: grid;
}
.parent > * {
  grid-area: 1 / 1 / -1 / -1;
}
```

### When z-index is Unavoidable

If you must use z-index:

1. Use the smallest value that works
2. Document why it's needed
3. Keep values in a centralized location
4. Consider if DOM order can solve the problem instead

```css
/*
 * z-index: Required for sticky header
 * Must be above content but below modals
 */
.sticky-header {
  position: sticky;
  top: 0;
  z-index: 1;
}
```

## Resources

- [MDN: z-index](https://developer.mozilla.org/en-US/docs/Web/CSS/z-index)
- [MDN: Stacking context](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_positioned_layout/Understanding_z-index/Stacking_context)
- [What The Heck, z-index?? by Josh W. Comeau](https://www.joshwcomeau.com/css/stacking-contexts/)
