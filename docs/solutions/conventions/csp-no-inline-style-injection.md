---
title: "CSP: no inline style injection in React components"
date: 2026-06-08
category: conventions
module: app
problem_type: convention
component: frontend_stimulus
severity: medium
applies_when:
  - "Adding CSS keyframe animations to React components"
  - "Injecting styles at runtime via dangerouslySetInnerHTML or document.createElement"
  - "Needing to hide/show portaled content from outside its React tree"
tags:
  - csp
  - inline-styles
  - globals-scss
  - keyframes
  - content-security-policy
  - dangerouslySetInnerHTML
related_components:
  - tooling
---

# CSP: no inline style injection in React components

## Context

The app's CSP policy (`app/gasket.ts`) sets `style-src: ['self', 'https://img1.wsimg.com']` with no `'unsafe-inline'`. Injected `<style>` elements (via `dangerouslySetInnerHTML` or `document.createElement('style')`) require `'unsafe-inline'` and violate this policy. CSP violations are silent in local dev (no CSP headers) but break in production.

React inline `style={{}}` props (style attributes on elements) are NOT blocked by `style-src`. Only injected `<style>` elements are. The app has 178+ inline style props that work fine.

Discovered during PR #4151 review when copilot flagged `dangerouslySetInnerHTML` style tags.

## Guidance

**Rule: never inject `<style>` elements. Move all CSS to `globals.scss` or scoped stylesheets.**

**For keyframe animations**, add to `app/src/styles/globals.scss` inside the `@layer utilities` block (matching existing patterns: `animate-agent-pulse`, `animate-gradient`, `animate-thumb-bounce-up`):

```scss
@keyframes paywall-skeleton-shimmer {
  0% { background-position: 100% 100%; opacity: 0.6; }
  50% { opacity: 1; }
  100% { background-position: -50% -50%; opacity: 0.6; }
}

.skeleton-shimmer {
  background: linear-gradient(150deg, ...);
  background-size: 400% 400%;
  animation: paywall-skeleton-shimmer 3s ease infinite;
  border-radius: 4px;
}
```

Then in TSX: `className="skeleton-shimmer"` instead of inline style objects or injected tags.

**For runtime style toggling** (hiding/showing portal elements), use a data-attribute + static CSS:

```scss
// globals.scss
body[data-paywall-loading] #UpgradeLibraryPortal {
  opacity: 0 !important;
  pointer-events: none !important;
}
```

```typescript
// Instead of: document.createElement('style') + textContent
document.body.setAttribute('data-paywall-loading', 'true')

// Cleanup:
document.body.removeAttribute('data-paywall-loading')
```

The attribute lives on `document.body` (always present, idempotent `removeAttribute`), and the CSS matches the portal as a descendant once UPP mounts `#UpgradeLibraryPortal` to body. Setting the attribute on the portal element itself would require the portal to already exist.

**Where to place styles in globals.scss:**
- Keyframe animations: inside `@layer utilities` (alongside existing `@keyframes` + `.animate-*` classes)
- Portal/overlay overrides: near existing `#UpgradeLibraryPortal` and `.ux-disrupt-backdrop` rules
- Modal backdrop overrides: unlayered (outside `@layer`) to beat third-party CSS specificity

## Why This Matters

CSP `style-src` distinguishes between:
- `<style>` elements (inline stylesheets): blocked without `'unsafe-inline'`
- `style` attributes on elements (React's `style={{}}` prop): controlled by `style-src-attr` (not set, so unrestricted)

Injecting `<style>` tags works in dev because Gasket's helmet middleware doesn't emit CSP headers on `local.*` environments. Production emits them. A feature that works locally but has invisible styling in production is a hard-to-diagnose regression.

## When to Apply

- Adding CSS animations or keyframes to any component
- Needing to hide/show elements in portals outside your component tree
- Any time you reach for `dangerouslySetInnerHTML` with a `<style>` tag
- Any time you reach for `document.createElement('style')`

## Examples

**Before (CSP violation):**

```tsx
const STYLES = `@keyframes shimmer { 0% { opacity: 0.6 } 100% { opacity: 1 } }`;
<style dangerouslySetInnerHTML={{ __html: STYLES }} />
<div style={{ animation: 'shimmer 3s ease infinite' }} />
```

**After (CSP compliant):**

```scss
// globals.scss, inside @layer utilities
@keyframes shimmer { 0% { opacity: 0.6 } 100% { opacity: 1 } }
.skeleton-shimmer { animation: shimmer 3s ease infinite; }
```

```tsx
<div className="skeleton-shimmer" style={{ width: '50%', height: '96px' }} />
```

Dimensional inline styles (`width`, `height`, `margin`) remain as `style` props. They are per-instance layout values, not visual-effect definitions.

**Before (CSP violation):**

```typescript
const style = document.createElement('style')
style.textContent = '#UpgradeLibraryPortal { opacity: 0 !important; }'
document.head.appendChild(style)
return () => { style.remove() }
```

**After (CSP compliant):**

```typescript
// static rule in globals.scss: body[data-paywall-loading] #UpgradeLibraryPortal { ... }
document.body.setAttribute('data-paywall-loading', 'true')
return () => { document.body.removeAttribute('data-paywall-loading') }
```

## What Didn't Work

(session history) **Style injection in render body**: DOM mutation during render violates React concurrent mode rules. Style leaked into `document.head` on unmount (no cleanup return). Moved to `useLayoutEffect` first, then to static CSS entirely.

(session history) **Inline LoadingComponent={() => null}**: Unrelated but discovered in same session. Creates new function reference each render. Fixed with module-level `const NullLoadingComponent = () => null`.

## Related

- `docs/solutions/architecture-patterns/cds-modal-loading-lifecycle.md` (paywall skeleton architecture, uses these CSP-compliant patterns)
- `docs/solutions/design-patterns/react-portal-content-escapes-ancestor-css-and-attrs.md` (portals escape ancestor CSS)
- PR #4151 (`feat/paywall-spinner-in-button`)
