# Accessibility — Reference

## Common Problems and Solutions

Use this section when diagnosing or fixing specific accessibility issues.

### Missing or Empty Alt Text

**Problem**: Images without alt text or with empty alt text when they should have descriptions.

**Solution**:
- Add meaningful `alt` text for informative images
- Use empty `alt=""` only for decorative images
- For complex images (charts, graphs), provide detailed descriptions

```html
<!-- Good: Informative image -->
<img src="chart.png" alt="Sales increased 25% from Q1 to Q2" />

<!-- Good: Decorative image -->
<img src="divider.png" alt="" />

<!-- Bad: Missing alt -->
<img src="chart.png" />
```

### Missing Form Labels

**Problem**: Form inputs without associated labels, making them unusable for screen reader users.

**Solution**:
- Use `<label>` elements with `htmlFor` matching input `id`
- Use `aria-label` when visible labels aren't possible
- Use `aria-labelledby` to reference existing text

```html
<!-- Good: Explicit label -->
<label htmlFor="email">Email address</label>
<input id="email" type="email" />

<!-- Good: aria-label -->
<input type="search" aria-label="Search products" />

<!-- Bad: Placeholder only -->
<input type="email" placeholder="Email" />
```

### Insufficient Color Contrast

**Problem**: Text doesn't meet minimum contrast ratios (4.5:1 for normal text, 3:1 for large text).

**Solution**:
- Use contrast checking tools (WebAIM Contrast Checker, browser DevTools)
- Adjust text or background colors to meet requirements
- Test in high contrast mode

**Quick Fix**: Darken text color or lighten background, or vice versa, until contrast ratio is met.

### Missing Focus Indicators

**Problem**: Interactive elements don't show visible focus indicators, making keyboard navigation difficult.

**Solution**:
- Ensure focus styles are visible (minimum 2px outline)
- Use `:focus-visible` pseudo-class for keyboard-only focus
- Test that focus indicators have sufficient contrast

```css
/* Good: Visible focus indicator */
button:focus-visible {
  outline: 2px solid #0066cc;
  outline-offset: 2px;
}
```

### Keyboard Traps

**Problem**: Users can't navigate away from a component using only the keyboard.

**Solution**:
- Ensure all interactive elements are reachable using the keyboard
- In modals, trap focus within the modal but allow escape
- Provide clear exit mechanisms (Close button, Escape key)

### Missing ARIA Labels for Icon Buttons

**Problem**: Buttons with only icons have no accessible name.

**Solution**:
- Add `aria-label` to describe the button's purpose
- Use `aria-labelledby` if descriptive text exists nearby

```html
<!-- Good: Icon button with label -->
<button aria-label="Close dialog">
  <Icon name="close" />
</button>

<!-- Bad: Icon button without label -->
<button>
  <Icon name="close" />
</button>
```

### Incorrect Heading Hierarchy

**Problem**: Headings skip levels (e.g. h1 → h3) or are used for styling instead of structure.

**Solution**:
- Maintain proper heading hierarchy (h1 → h2 → h3, no skipping)
- Use CSS for styling, not heading levels
- Ensure one h1 per page

### Missing Error Message Associations

**Problem**: Form error messages aren't associated with their inputs, so screen readers don't announce them.

**Solution**:
- Use `aria-describedby` to link error messages to inputs
- Use `aria-invalid="true"` on invalid inputs
- Ensure error messages are visible and clear

```html
<!-- Good: Error message associated with input -->
<label htmlFor="email">Email</label>
<input
  id="email"
  type="email"
  aria-invalid="true"
  aria-describedby="email-error"
/>
<span id="email-error" role="alert">Please enter a valid email address</span>
```

### Missing Skip Links

**Problem**: Keyboard users must tab through navigation on every page load.

**Solution**:
- Add "Skip to main content" link at the top of the page
- Make it visible on focus, hidden otherwise

```html
<a href="#main-content" class="skip-link">Skip to main content</a>
```

### Dynamic Content Not Announced

**Problem**: Screen readers don't announce updates to dynamic content (AJAX updates, form validation, etc.).

**Solution**:
- Use ARIA live regions (`aria-live="polite"` or `aria-live="assertive"`)
- Use `role="alert"` for important messages
- Ensure live regions are present in the DOM before updates

```html
<div aria-live="polite" aria-atomic="true" id="status-message"></div>
```
