# Typography

This reference covers typography patterns using `@ux/text` and `@ux/text-lockup` components.

## Overview

UXCore provides two typography components:

- **`@ux/text`** - Individual text elements with semantic HTML and visual styling separation
- **`@ux/text-lockup`** - Grouped text elements with standardized relationships and spacing

## @ux/text

The `text` component separates semantic HTML from visual presentation, allowing proper heading hierarchy while controlling appearance independently.

### Basic Usage

```jsx
import text from '@ux/text';

function PageContent() {
  return (
    <>
      <text.h1 as="heading" size={2} text="Page Title" />
      <text.p as="paragraph" text="Body content goes here." />
      <text.span as="caption" text="Additional context." />
    </>
  );
}
```

### Props

| Prop | Values | Description |
|------|--------|-------------|
| `as` | `title`, `heading`, `paragraph`, `label`, `action`, `input`, `caption` | Sets the visual text style (font size, line height) |
| `size` | `0` - `5` | Scales text size based on theme scale factor |
| `emphasis` | `critical`, `warning`, `success`, `info` | Applies feedback color to text |
| `text` | `String` | The text content to display |

### Text Styles

| Style | Use Case | HTML Examples |
|-------|----------|---------------|
| `title` | Titles in confined spaces | Lower `<h#>` elements |
| `heading` | Page headings | Higher `<h#>` elements |
| `paragraph` | Body content | `<p>` elements |
| `label` | Form labels | `<label>` elements |
| `action` | Interactive text | `<button>` elements |
| `input` | Form inputs | `<input>`, `<textarea>` |
| `caption` | Help text, errors | Small supporting text |

### Size Scaling

Sizes `0` through `5` increase text size based on the theme's scale factor:

```jsx
// Base heading size
<text.h2 as="heading" size={0} text="Default Size" />

// Larger heading
<text.h1 as="heading" size={3} text="Larger Heading" />
```

### Semantic vs Visual

The key principle is separating semantic meaning from visual appearance:

```jsx
// Semantic h3, styled as large heading visually
<text.h3 as="heading" size={2} text="Section Title" />

// Semantic h2, styled smaller for tight spaces
<text.h2 as="title" size={0} text="Card Title" />
```

### Emphasis for Feedback

Apply feedback colors for contextual meaning:

```jsx
<text.span as="caption" emphasis="critical" text="This field is required" />
<text.span as="caption" emphasis="success" text="Changes saved successfully" />
```

## @ux/text-lockup

Text Lockups group related text elements with standardized sizing and spacing.

### When to Use

- Title and description pairings
- Hero sections with eyebrow, headline, and body
- Card headers with supporting text
- Any grouped text with visual hierarchy

### Basic Usage

```jsx
import TextLockup from '@ux/text-lockup';

function HeroSection() {
  return (
    <TextLockup
      eyebrow="New Feature"
      title="Welcome to the Platform"
      titleLevel={1}
      size="xl"
    >
      <p>Get started with our comprehensive suite of tools.</p>
    </TextLockup>
  );
}
```

### Props

| Prop | Values | Description |
|------|--------|-------------|
| `eyebrow` | `String` or `ReactNode` | Small text or Tag above the title |
| `title` | `String` | Main title text |
| `titleLevel` | `1` - `6` | Heading level (h1-h6), defaults to `div` |
| `size` | `sm`, `md`, `lg`, `xl` | Overall size of the lockup |
| `children` | `ReactNode` | Supporting content below title |

### Size Guidelines

| Size | Use Case |
|------|----------|
| `sm` | Cards, list items |
| `md` | Section headers |
| `lg` | Page sections |
| `xl` | Hero sections, landing pages |

### With Tag Eyebrow

```jsx
import TextLockup from '@ux/text-lockup';
import Tag from '@ux/tag';

function PremiumFeature() {
  return (
    <TextLockup
      eyebrow={<Tag emphasis="premium" highcontrast>Premium</Tag>}
      title="Advanced Analytics"
      titleLevel={2}
    >
      <p>Unlock deeper insights with our premium analytics dashboard.</p>
    </TextLockup>
  );
}
```

### Multiple Paragraphs

Pass multiple children as direct descendants for proper spacing:

```jsx
<TextLockup title="About Us" titleLevel={2}>
  <p>First paragraph of content.</p>
  <p>Second paragraph with more details.</p>
</TextLockup>
```

## CSS Classes (Alternative)

When not using React components, apply CSS classes directly:

```html
<!-- Individual text styling -->
<h1 class="ux-text ux-text-heading ux-text-size2">Large Heading</h1>
<p class="ux-text ux-text-paragraph">Body content</p>
<span class="ux-text ux-text-caption">Help text</span>
```

### Class Construction

| Base | Style Modifier | Size Modifier |
|------|----------------|---------------|
| `.ux-text` | `.ux-text-heading` | `.ux-text-size0` through `.ux-text-size5` |
| | `.ux-text-title` | |
| | `.ux-text-paragraph` | |
| | `.ux-text-label` | |
| | `.ux-text-action` | |
| | `.ux-text-input` | |
| | `.ux-text-caption` | |

## Best Practices

### Do

- Use semantic HTML elements (`h1`-`h6`, `p`, `span`) with `text.*` components
- Apply visual styling through `as` and `size` props
- Use `TextLockup` for related text groups
- Set `titleLevel` to maintain proper heading hierarchy

### Don't

- Don't skip heading levels in the DOM (h1 → h3)
- Don't apply custom font-size or font-family overrides
- Don't hardcode font colors; use `emphasis` prop or intents
- Don't nest TextLockups

## Theme Integration

Typography scales and font families are controlled by the theme. The GoDaddy theme delivers the brand typefaces (GD Sherpa Display for headings, GD Sherpa Text for body copy) through these components automatically. For the full brand typography rules, sizing guidelines, and typeface usage restrictions (design reference), see the `brand-guidelines` skill (`references/TYPOGRAPHY.md`).

The following intents are available for custom styling when needed:

```css
.custom-text {
  font-family: intent('ux.text.fontFamily');
  font-size: intent('ux.textHeading.fontSize');
  line-height: intent('ux.textHeading.lineHeight');
}
```

See [Theming and Intents](THEMING.md) for complete intent documentation.
