---
title: "React portals escape ancestor CSS and DOM attributes — gate the mount to hide a portaled modal"
date: 2026-06-01
last_updated: 2026-06-01
category: design-patterns
module: "app / paywall UpgradeContainer + PaywallLoadingModal"
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "a child renders via ReactDOM.createPortal (@ux/modal, @ux/disrupt, Radix, MUI, Headless UI, react-modal)"
  - "you try to hide that child by styling its React-parent wrapper (visibility, opacity, overflow, display)"
  - "you try to suppress it via DOM-scoped attributes on the wrapper (aria-hidden, inert, hidden)"
  - "a reviewer claims visibility:hidden does NOT remove a subtree from the accessibility tree / focus order"
  - "you need a portaled modal kept mounted-but-hidden during an async load so its onLoadSuccess can fire"
related_components:
  - frontend_stimulus
  - payments
tags:
  - react-portal
  - createportal
  - visibility-hidden
  - accessibility
  - focus-lock
  - ux-modal
  - mount-gating
---

# React portals escape ancestor CSS and DOM attributes — gate the mount to hide a portaled modal

## Context

Third-party modal containers often expose an `onLoadSuccess`-style callback that fires only once the component fully mounts and finishes its async work. To capture that signal while the modal lazily loads (the CDS/UPP upgrade modal takes ~700ms), the natural move is to keep the container mounted but visually hidden, then reveal it once loading completes.

In `UpgradeContainer.tsx` this was done by wrapping the inner container in a div with `{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }` during the load window, with a `PaywallLoadingModal` shown in front of it.

The friction: the inner container does not render its modal as a normal DOM child. `@ux/modal` renders through `@ux/disrupt` via `ReactDOM.createPortal(component, document.body)`, wrapped in `react-focus-lock` (`app/node_modules/@ux/modal/src/index.jsx:95,98`; `app/node_modules/@ux/disrupt/src/index.jsx:155,164`). So the wrapper's hiding styles never touch the actual modal DOM.

## Guidance

**To hide a portaled component, gate its mount. Do not rely on any ancestor styling or attribute.**

A React portal's children are not DOM descendants of the React parent that renders them; they attach wherever the portal targets (here, `document.body`). Every subtree-hiding mechanism is scoped to the DOM subtree:

- `visibility: hidden`, `opacity`, `overflow`, the `hidden` attribute, `aria-hidden`, and `inert` on an ancestor wrapper **do not reach portaled content**. They affect only real DOM descendants ([React `createPortal`](https://react.dev/reference/react-dom/createPortal)).

So an ancestor wrapper can hide the loader's *inline* placeholder (a real DOM child) but cannot hide the modal the inner container portals to `document.body`.

```tsx
// ANTI-PATTERN: ancestor styling can't reach the portal
<div style={loading ? { visibility: 'hidden' } : undefined}>
  <ModalContainer />   {/* portals to document.body */}
</div>

// CORRECT — conditional mount
{!loading && <ModalContainer />}

// CORRECT — an open/isOpen prop the library honors
<ModalContainer isOpen={!loading} />

// CORRECT — the loader's LoadingComponent swap (one modal at a time)
<Loader LoadingComponent={Spinner} onLoadSuccess={...} />
```

Supporting a11y detail (relevant only for non-portaled, real-DOM subtrees): `visibility: hidden` *does* remove descendants from the accessibility tree and tab/focus order ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/visibility), [WCAG C7](https://www.w3.org/WAI/WCAG21/Techniques/css/C7)), with one caveat: a descendant that sets `visibility: visible` re-exposes itself. Contrast `opacity: 0` and offscreen `clip` (the `.sr-only` technique), which keep content in the a11y tree and focus order. So the common reviewer claim that `visibility: hidden` leaves a real subtree focusable is itself false — but that is moot when the content is portaled, because none of it applies.

## Why This Matters

- **Accessibility breakage.** During the load window two `@ux/modal` instances can coexist on `document.body` (`PaywallLoadingModal` also portals there, per its own doc comment). That means duplicate dialogs in the a11y tree, competing `react-focus-lock` instances fighting over focus, and tabbable controls inside a modal the user is meant to perceive as hidden.
- **Wasted, false-confidence fixes.** Adding `aria-hidden` or `inert` to the wrapper does nothing to portaled content. The change looks plausible in a diff, passes review, and ships without changing behavior, so the real defect persists while everyone believes it was fixed.

## When to Apply

Any time you try to visually hide a subtree that contains a portaling component — modal, dialog, popover, tooltip, select/listbox menu, toast. Portaling is the default for most modern UI libraries:

- `@ux/modal` / `@ux/disrupt` (GoDaddy UXCore)
- Radix UI (`Portal` primitive)
- MUI (`Modal`, `Popover`, `Menu`)
- Headless UI (`Dialog`, `Popover`)
- `react-modal`

If the thing you want to hide renders into `document.body` (or any portal root), reach for mount-gating, not wrapper CSS/ARIA.

## Examples

Before — wrapper styling that cannot reach the portal:

```tsx
<>
  {paywallLoading && <PaywallLoadingModal /* portals to document.body */ />}
  <div
    style={
      paywallLoading
        ? { position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }
        : undefined
    }
  >
    <DirectToPaidContainer {...props} />  {/* renders @ux/modal -> portal to document.body */}
  </div>
</>
```

The `visibility: hidden` hides the loader's inline placeholder but not the portaled `@ux/modal`; both modals end up live on `document.body`.

After — gate the mount so the portaled modal never exists during load:

```tsx
<>
  {paywallLoading && <PaywallLoadingModal />}
  {!paywallLoading && <DirectToPaidContainer {...props} />}
</>
```

If the container must stay mounted to receive its `onLoadSuccess`, drive visibility through a prop the modal library honors (e.g. `isOpen={!paywallLoading}`) so the library controls whether it portals — never through ancestor CSS/ARIA/`inert`.

> Note on the source case (resolved, historical): the `visibility: hidden` wrapper described above was the pre-PR-#4151 code in `UpgradeContainer.tsx`. The wrapper hid `DirectToPaidContainer` / `HigherPlansUpgradeContainer` (real DOM descendants) but could not reach the `@ux/modal` those containers portal to `document.body`. PR #4151 shipped the fix this doc recommends: UpgradeContainer now mount-gates the skeleton and drives the portaled modal's visibility through a body data-attribute + static CSS rather than a wrapper style. The skeleton uses `focusLock={false}` so only UPP's `@ux/modal` runs `react-focus-lock`, resolving the two-focus-locked-modals concern. See `docs/solutions/architecture-patterns/cds-modal-loading-lifecycle.md` for the shipped lifecycle.

## Related

- `docs/solutions/best-practices/cds-esm-react19-compat-shims-2026-04-23.md` — Section 3 documents the `@ux/modal` focus-trap flash during the CDS LoadingComponent→RemoteMyComponent swap and the interim "LoadingComponent returns null" workaround; this doc is the generalized principle behind why that and the "skeleton-as-LoadingComponent" / "portal reuse" attempts failed.
- `docs/solutions/architecture-patterns/cds-esm-centralized-deps-alias.md` — `react-focus-lock` provenance in the UPP fallback chunks.
- `docs/solutions/developer-experience/smoke-test-cds-esm-against-prod-cdn-from-local-dev-2026-05-08.md` — how to browser-verify CDS-ESM loading-modal behavior against the prod CDN hash.
- PR #4151 (`feat/paywall-spinner-in-button`) — origin of this learning.
