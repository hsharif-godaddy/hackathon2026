---
name: uxcore
description: UXCore-specific styling patterns (intents, @ux/box, logical properties). Use when applying UXCore themes, Box layouts, or fixing UXCore CSS issues. NOT for general React/CSS questions.
license: Proprietary
metadata:
  author: uxcore
  version: "2500.1"
  category: developer-tools
---

# UXCore Frontend Standards

Router skill for UXCore styling. For component API docs (props, usage), use the UXCore MCP server instead.

## Reference Loading Policy

DO NOT open any `references/*.md` file unless the user request matches a trigger below.
When a trigger matches, open exactly ONE reference file.

| Trigger keywords | Reference to load |
|------------------|-------------------|
| Box, gap, flex, spacing, padding, layout, margin, align, blockAlignChildren, inlineAlignChildren, justify-content, align-items | `references/LAYOUT.md` |
| text, heading, typography, font, Text-Lockup | `references/TYPOGRAPHY.md` |
| intent, theme, color, brand, Presentation Central | `references/THEMING.md` |
| tailwind, @ux/tailwind-intents | `references/TAILWIND-INTENTS.md` |
| container query, responsive, RTL, LTR, logical, bidi | `references/RESPONSIVE.md` |
| selector, override, z-index, legacy, .ux- class, specificity | `references/STYLING.md` |
| container query, responsive, RTL, LTR, logical | `references/RESPONSIVE.md` |
| selector, override, z-index, legacy, .ux- class, specificity, css | `references/STYLING.md` |
| React Aria, RAC, missing component, alternative, primitive | `references/ALTERNATIVES.md` |

If no trigger matches, answer from this file only.

## Output Budget

When answering UXCore questions:
- Quote at most 3-5 rules
- Include at most 1 short code snippet (3-5 lines)
- Do not paste tables from references; summarize instead
- Point user to `references/*.md` path for full details

## Non-Negotiable Rules

These rules always apply. Violations must be flagged.

1. **Use @ux/box for layout** - Use `gap` for spacing between children, `blockPadding`/`inlinePadding` for container space. Avoid margin.

2. **Never hardcode colors** - Use intents: `intent('ux.box.foregroundColor')` in PostCSS or `$ux-box-foregroundColor` in Sass. Never `#333` or `rgb()`.

3. **Use logical properties** - Write `padding-inline-start` not `padding-left`. Supports RTL/LTR automatically.

4. **Never target .ux-* classes** - Add your own `className` and target that. Internal UXCore classes may change.

5. **Avoid z-index** - Use DOM order for stacking. If overlap needed, use CSS Grid (`grid-area: 1/1/-1/-1`).

## Quick Examples

**Correct imports:**
```jsx
import Box, { box } from '@ux/box';
import text from '@ux/text';
import '@ux/box/styles';    // ✓ Correct - no dist/
import '@ux/text/styles';   // ✓ Correct - no dist/
```

**Box layout (correct):**
```jsx
// Default Box is a <div>
<Box orientation="vertical" gap="md" blockPadding="lg">{children}</Box>

// For semantic HTML, use lowercase box.* (polymorphic)
<box.section orientation="vertical" gap="md">{children}</box.section>
<box.article>{content}</box.article>
```

**Text usage (correct):**
```jsx
// Polymorphic element choice via text.h1, text.p, etc.
<text.h1 as="heading" size={2} text="Page Title" />
<text.h3 as="heading" text="Section" />
<text.p as="paragraph" text="Body content" />
<text.span as="caption" emphasis="critical" text="Error message" />

// ✗ WRONG: Text as="heading3" (no such pattern)
```

**Intent colors (correct):**
```css
.card { color: intent('ux.box.foregroundColor'); }
```

**Logical properties (correct):**
```css
.element { padding-inline-start: 1rem; padding-block-end: 0.5rem; }
```

**Custom class override (correct):**
```jsx
<Alert className="my-alert">Content</Alert>
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `className="mt-3 p-2"` | Use `@ux/box` with gap/padding props |
| `color: #111` | Use `intent('ux.box.foregroundColor')` |
| `padding-left: 1rem` | Use `padding-inline-start: 1rem` |
| `z-index: 9999` | Use DOM order or CSS Grid overlap |
| `.ux-button { ... }` | Add custom class, target that instead |
| `@media (max-width:)` | Use `@container` queries for components |
| `import '@ux/box/dist/styles.css'` | Use `import '@ux/box/styles'` (no dist/) |
| `<Text as="heading3">` | Use `<text.h3 as="heading">` (lowercase, polymorphic) |
| `<Box as="section">` | Use `<box.section>` (import `{ box }` for semantic HTML) |
| Swapping `blockAlignChildren`/`inlineAlignChildren` | These map to flexbox main/cross axes, behavior changes with `orientation`. See `references/LAYOUT.md` (Alignment section). |
| Building from scratch when component missing | Use React Aria Components + UXCore intents (see `references/ALTERNATIVES.md`) |

## Box Alignment Quick Reference

**Important**: Box alignment properties map to flexbox and their behavior changes based on `orientation`:

- `blockAlignChildren` → `justify-content` (main axis)
- `inlineAlignChildren` → `align-items` (cross axis)

When `orientation="vertical"` (default), `blockAlignChildren` controls **vertical** alignment.
When `orientation="horizontal"`, `blockAlignChildren` controls **horizontal** alignment.

**For detailed explanation and examples, see `references/LAYOUT.md` (Alignment section).**

## When to Use This Skill

DO use when:
- Styling with @ux/box, @ux/text, @ux/card
- Applying brand colors or themes
- Supporting RTL/LTR layouts
- Fixing UXCore-specific CSS issues
- Building custom components (see `references/ALTERNATIVES.md` for React Aria pattern)

DO NOT use for:
- Component API reference (use UXCore MCP server)
- General React patterns (not UXCore-specific)
- Library contribution (see CONTRIBUTING.md)
- Choosing between component libraries (check UXCore first via MCP)

## Reference Index

Only load when triggers match (see policy above):
- `references/LAYOUT.md` - Box, gap, padding, flex layouts
- `references/TYPOGRAPHY.md` - @ux/text, text-lockup, fonts
- `references/THEMING.md` - Intents, PostCSS/Sass, Presentation Central
- `references/RESPONSIVE.md` - Container queries, logical properties, RTL
- `references/STYLING.md` - Selectors, overrides, z-index, legacy utilities
- `references/TAILWIND-INTENTS.md` - Tailwind intent classes, @ux/tailwind-intents utility prefixes
- `references/ALTERNATIVES.md` - React Aria Components, building missing components
