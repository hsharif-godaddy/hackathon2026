---
name: accessibility
description: Apply WCAG 2.1 Level AA accessibility standards when implementing or reviewing UI, forms, components, and content. Use when building or auditing for accessibility, fixing a11y issues, choosing component libraries, or when the user mentions accessibility, a11y, screen readers, keyboard navigation, or inclusive design.
---

# Accessibility

Use this skill when implementing or reviewing code for accessibility. Follow WCAG 2.1 Level AA and the guidelines below. For common issues and fix patterns, see [references/REFERENCE.md](references/REFERENCE.md).

## When to Use This Skill

- Implementing or updating UI components, forms, or pages
- Reviewing code for accessibility
- Choosing or using component libraries
- Fixing reported accessibility issues
- Adding keyboard support, ARIA, or semantic markup
- Working with color, contrast, or focus styles

## Quick Start

1. **Audit**: Use testing tools and techniques below
2. **Use accessible components**: Prefer libraries built to WCAG 2.1 Level AA (e.g. UXCore, React-Aria, Chakra UI)
3. **Test early**: Integrate a11y testing into the workflow
4. **Fix common issues**: See [references/REFERENCE.md](references/REFERENCE.md) for problems and solutions
5. **Get help**: #a11y Slack channel for questions

## Standards and Principles

- **Target**: WCAG 2.1 Level AA; alignment with ADA, Section 508, EAA
- **Assistive tech**: Support screen readers, magnifiers, voice recognition, alternative input

### The Four Principles (WCAG)

1. **Perceivable** — Present information in ways users can perceive: text alternatives, sufficient contrast, adaptable content, clear audio/visuals
2. **Operable** — All functionality from keyboard; enough time; no seizure-inducing content; navigable and orienting
3. **Understandable** — Readable text, predictable behavior, help avoiding and correcting errors
4. **Robust** — Valid semantic HTML, proper ARIA when needed, compatible with assistive technologies

## Implementation Guidelines

### HTML and Semantic Markup

- Use semantic HTML5: `<header>`, `<nav>`, `<main>`, `<article>`, `<section>`, `<aside>`, `<footer>`
- Heading hierarchy: h1 → h2 → h3 without skipping
- `<button>` for actions, `<a>` for navigation
- Lists: `<ul>`, `<ol>`, `<dl>`; tables: `<thead>`, `<tbody>`, `<th>` with scope
- Images: meaningful `alt`; use `alt=""` for decorative only
- Forms: see Forms and Input below

### ARIA

Prefer semantic HTML over ARIA. Use ARIA to enhance, not replace.

- **Roles**: `role="button"`, `role="dialog"`, etc.
- **States**: `aria-expanded`, `aria-hidden`, `aria-required`
- **Labels**: `aria-label` or `aria-labelledby` when visible labels aren’t sufficient
- **Live regions**: `aria-live` for dynamic updates
- **Landmarks**: `role="navigation"`, `role="main"`, `role="complementary"` when semantic elements aren’t available

### Keyboard Navigation

- Logical tab order following visual flow
- Visible focus indicators (min 2px outline) on all interactive elements
- Document shortcuts; avoid conflicts with browser/AT
- Skip link to main content
- Focus management in modals, dropdowns, dynamic content
- No keyboard traps; standard patterns (Enter/Space for buttons, Arrow keys for menus)

### Color and Contrast

- **Normal text** (< 18pt or 14pt bold): min 4.5:1 contrast
- **Large text** (18pt+ or 14pt+ bold): min 3:1 contrast
- **UI/graphics**: 3:1 contrast
- Never convey information by color alone (use icons, text, or patterns)
- Focus indicators: 3:1 against adjacent colors
- Tools: WebAIM Contrast Checker, Colour Contrast Analyser, DevTools

### Mobile

- Touch targets: min 44×44 CSS pixels
- Adequate spacing between controls
- Support portrait and landscape
- Support up to 200% zoom without horizontal scroll or loss of function
- Provide alternatives for complex gestures

### Cognitive Accessibility

- Plain language; consistent navigation and layout
- Clear instructions, validation, and error messages
- Allow extending or disabling time limits when possible
- Minimize distractions; don’t require memorizing across steps

### Multimedia

- Synchronized captions for video; transcripts for audio-only
- Audio descriptions when visual info isn’t in the audio
- Keyboard-accessible media controls; text alternatives

### Forms and Input

- Associate every input with a visible label (`<label>` or `aria-label`/`aria-labelledby`)
- Required: `aria-required="true"` plus visual indicator
- Errors: `aria-describedby`/`aria-errormessage`, `aria-invalid="true"`
- Group related controls with `<fieldset>` and `<legend>`

### Dynamic Content and JavaScript

- Build on semantic HTML; enhance with JS
- Move focus when content changes (modals, dropdowns)
- Use `aria-live="polite"` or `assertive` for dynamic announcements
- Expose state changes via ARIA; core functionality should work without JS when possible

## Accessible Component Libraries

When selecting or using component libraries:

- Prefer libraries that meet WCAG 2.1 Level AA and document a11y
- Use components as intended; apply `aria-*` props when appropriate
- Don’t remove or override built-in accessibility
- Look for: proper labels, keyboard support, focus management, screen reader testing

Features to expect: form label/error handling, keyboard nav, skip links/landmarks, modal focus trap and Escape, table/list semantics.

## Testing

### Workflow

- **During development**: DevTools a11y, automated tools (axe DevTools, WAVE), keyboard and focus checks
- **Before review**: Full automated scan (axe-core, Lighthouse), keyboard-only pass
- **Before release**: Manual checklist, at least one screen reader, zoom and responsive check, contrast review

### Tools

| Use case        | Tools |
|-----------------|--------|
| Development     | Accessibility Inspector, axe DevTools, Lighthouse, WAVE |
| Automated/CI    | axe-core, jest-axe, Pa11y, Accessibility Insights |
| Manual          | NVDA, VoiceOver, JAWS, TalkBack, Narrator |

### Manual Checklist (summary)

- **Keyboard**: All interactive elements reachable; logical tab order; visible focus; no traps; skip links; modals trap/return focus; menus with arrow keys
- **Screen reader**: Content and labels announced; errors and dynamic updates announced; landmarks and headings logical
- **Visual**: Readable at 200% zoom; contrast 4.5:1 normal / 3:1 large text; info not by color alone; focus contrast
- **Reflow** — Content must reflow without loss of information or functionality at 400% zoom on a viewport equivalent to 320 CSS pixels wide
- **Forms**: Labels, required indicators, error association, keyboard completion

Screen readers: NVDA (Windows, free), JAWS (Windows), VoiceOver (macOS/iOS), TalkBack (Android), Narrator (Windows).

### Resources

- [WCAG Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [WebAIM 508 Checklist](https://webaim.org/standards/508/checklist)
- [A11y Project Checklist](https://www.a11yproject.com/checklist/)
- [W3C Easy Checks](https://www.w3.org/WAI/test-evaluate/preliminary/)

## Common Problems and Solutions

For detailed problems and fix patterns (alt text, form labels, contrast, focus, keyboard traps, icon buttons, heading hierarchy, error association, skip links, live regions), see [references/REFERENCE.md](references/REFERENCE.md).

## Development Workflow

- Consider a11y in design and code reviews
- Use WCAG 2.1 Level AA component libraries; document a11y and shortcuts
- Add automated a11y checks to CI/CD; consider pre-commit hooks
- Include people with disabilities in usability testing when possible

## Additional Information

- [WCAG](https://www.w3.org/WAI/standards-guidelines/wcag/)
- [GoDaddy Accessibility Policy](https://www.godaddy.com/en/legal/agreements/accessibility-statement)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [U.S. Web Design System Accessibility](https://designsystem.digital.gov/documentation/accessibility/)
- [Apple HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
