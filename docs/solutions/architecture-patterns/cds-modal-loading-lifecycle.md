---
title: "CDS modal loading lifecycle: skeleton modal + opacity hiding"
date: 2026-06-02
last_updated: 2026-06-08
category: architecture-patterns
module: app/paywall
problem_type: architecture_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "Loading CDS components on-demand in modals"
  - "warmCache preload fails and user sees no feedback during CDS load"
  - "Remote component (UPP) renders its own @ux/modal internally"
  - "Need to hide UPP's internal loading screen until plan cards are ready"
tags:
  - cds
  - modal
  - loading-lifecycle
  - portal
  - ux-modal
  - paywall
  - skeleton
  - onLoadSuccess
  - warm-cache
  - paywallLoading
  - opacity-hiding
  - focus-lock
related_components:
  - frontend_stimulus
related_docs:
  - docs/solutions/design-patterns/react-portal-content-escapes-ancestor-css-and-attrs.md
  - docs/solutions/best-practices/cds-esm-react19-compat-shims-2026-04-23.md
---

# CDS modal loading lifecycle: skeleton modal + opacity hiding

## Context

The upgrade modal uses CDS (Component Delivery Service) to load plan cards remotely via UPP (Unified Plans and Pricing). CDS's `esm-react-loader` renders `LoadingComponent` bare (no modal shell) during async load, then the remote UPP component renders its own `@ux/modal` when the module finishes loading.

ESSP data from test env showed `warmCache` fails ~57% of the time (70/122 upgrade modal views), making the ~700ms-1.3s loading gap a real user problem.

The solution provides immediate visual feedback via a skeleton loading modal while UPP's portal is hidden via a body data-attribute toggle with static CSS. The skeleton uses `focusLock={false}` to avoid competing with UPP's own focus trap.

## Guidance

**Pattern: skeleton modal (focusLock={false}) + CSS opacity hiding**

Only ONE focus-locked `@ux/modal` ever exists (UPP's). The skeleton modal provides visual feedback during load without competing for focus management. UPP's modal is hidden via a body data-attribute + static CSS until `onLoadSuccess` fires.

1. **Store-level boolean gate** with source tracking (`usePaywallStore`):

```tsx
openUpgradeModal: (source, itc?) => {
  if (get().paywallLoading) return
  set((state) => {
    state.showUpgradeModal = true
    state.upgradeModalSource = source
    state.paywallLoading = true
  })
}
```

2. **Skeleton modal with focusLock={false}** (in UpgradeContainer):

```tsx
{paywallLoading && (
  <PaywallLoadingModal
    onClose={handleClose}
    variant={PaywallLoadingModalVariant.HigherPlans}
    source={source}
    component="UpgradeContainer"
    focusLock={false}
  />
)}
<DirectToPaidContainer {...props} />
```

The skeleton modal uses `@ux/modal` for UXCore consistency but disables `focusLock` so it doesn't compete with UPP's own focus trap when both portals exist on `document.body` simultaneously.

3. **Body data-attribute toggle with static CSS** (in UpgradeContainer):

```tsx
useLayoutEffect(() => {
  if (!paywallLoading) return
  document.body.setAttribute('data-paywall-loading', 'true')
  return () => {
    document.body.removeAttribute('data-paywall-loading')
  }
}, [paywallLoading])
```

Static CSS in `globals.scss` (applies retroactively when the portal mounts):

```scss
body[data-paywall-loading] #UpgradeLibraryPortal {
  opacity: 0 !important;
  pointer-events: none !important;
}
```

Why body attribute instead of style injection: `document.body` always exists (no null checks), `removeAttribute` is idempotent (safe from multiple callers), CSS applies retroactively when UPP creates `#UpgradeLibraryPortal`, CSP-compliant (static stylesheet, no runtime injection), no stale refs.

4. **onLoadSuccess clears the attribute and loading state:**

```tsx
const handleLoadSuccess = useCallback(() => {
  document.body.removeAttribute('data-paywall-loading')
  setPaywallLoading(false)
}, [setPaywallLoading])
```

5. **LoadingComponent as stable module-level constant:**

```tsx
const NullLoadingComponent = () => null  // Module-level, stable reference

<ComponentLoader
  LoadingComponent={NullLoadingComponent}  // NOT null (falsy falls through to default)
  onLoadSuccess={handleLoadSuccess}
  onLoadError={handleLoadError}
/>
```

6. **20s timeout fallback** (in UpgradeContainer) clears loading + removes body attribute if CDS never fires a callback. On timeout, renders `PaywallErrorModal` instead of leaving partial state:

```tsx
const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
useEffect(() => {
  if (paywallLoading) {
    timeoutRef.current = setTimeout(() => {
      if (!usePaywallStore.getState().paywallLoading) return  // race guard
      document.body.removeAttribute('data-paywall-loading')
      setPaywallLoading(false)
      setPaywallTimedOut(true)
    }, 20000)
  }
  return () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }
}, [paywallLoading, setPaywallLoading, source])
```

7. **Mutual exclusion across all paywall modals** (upgrade + credits, both on `usePaywallStore`):

```tsx
openCreditsModal: (source, itc?) => {
  if (get().paywallLoading) return  // blocked if upgrade already loading
  set((state) => {
    state.showCreditsModal = true
    state.paywallLoading = true
  })
}
```

Both `openUpgradeModal` and `openCreditsModal` check `paywallLoading` before opening. Two overlapping CDS portals with competing focus traps = broken UX, so only one paywall modal can be active at a time.

## Why This Matters

**Single focus lock eliminates focus-trap competition**: The skeleton modal has `focusLock={false}`, so only UPP's `@ux/modal` activates `react-focus-lock`. No competing traps, no focus-stealing between modals.

**opacity works where visibility doesn't**: `visibility:hidden` on an ancestor div cannot suppress portalled content (portals escape to `document.body`). But `opacity:0` applied via a static CSS rule targeting `#UpgradeLibraryPortal` (scoped behind a body attribute) works because it targets the portal's actual DOM node, not an ancestor. The body attribute approach applies retroactively (CSS matches as soon as the portal mounts).

**UXCore consistency**: The skeleton uses `@ux/modal` (not a custom div) for consistent styling, backdrop behavior, and close-button patterns. The only deviation is `focusLock={false}`.

**Immediate feedback on click**: The skeleton appears instantly (store flip is synchronous), filling the 700ms-1.3s gap while CDS loads. Users see plan card placeholders immediately.

**Store-level guard simplifies callers**: 10+ call sites use `openUpgradeModal`. The guard prevents double-click at the store level without per-caller defensive code.

**useLayoutEffect for body attribute**: Guarantees the attribute is set after commit but before paint, with guaranteed cleanup on ANY unmount path (navigation, error boundary, explicit close, parent removal). No stale refs, no DOM nodes to track.

**Five exit paths clear loading**: onLoadSuccess, onLoadError, onError, closeUpgradeModal, 20s timeout fallback. Every reachable path clears `paywallLoading` and removes the body attribute.

## When to Apply

- Any CDS-loaded component that renders its own modal internally
- When loading feedback must be a modal skeleton (UX requirement for visual continuity)
- When the remote component's internal loading screen should be hidden until fully ready
- When `warmCache` preloading is unreliable (57% failure rate observed)
- When multiple trigger points need a shared loading guard

## Examples

**Before: dual-modal with competing focus traps**

```tsx
{paywallLoading && <PaywallLoadingModal />}  {/* focusLock defaults to true */}
<div style={paywallLoading ? { visibility: 'hidden' } : undefined}>
  <DirectToPaidContainer />  {/* renders UPP's own @ux/modal */}
</div>
```

Two `@ux/modal` portals compete on `document.body`. Dual backdrops, dual focus locks. `visibility:hidden` wrapper has no effect on portalled content.

**After: skeleton (focusLock={false}) + body attribute hiding**

```tsx
{paywallLoading && (
  <PaywallLoadingModal focusLock={false} />  {/* No focus-trap competition */}
)}
<DirectToPaidContainer
  onLoadSuccess={handleLoadSuccess}  // removes body attribute, clears paywallLoading
  LoadingComponent={NullLoadingComponent}
/>
```

Skeleton provides immediate feedback. UPP's modal hidden via `body[data-paywall-loading]` CSS selector. On `onLoadSuccess`: skeleton unmounts, body attribute removed, UPP's modal appears fully loaded. One focus lock (UPP's), clean transition.

## What Didn't Work

**Spinner-in-button only (no skeleton)**: (session history) Spinner-in-button doesn't scale to all trigger shapes. Of ~15 callsites: shape A (button with icon, ~4 sites) could show spinner, shape B (text link like UpgradeBanner) has no icon element, shape C (programmatic like publishAction) has no clickable element, shape D (popover-mounted like UsageGauge) unmounts itself on click. The surfaces that shipped (gauge, banner) were shapes B/D. UX confirmed (2026-06-05) the skeleton modal is the correct affordance.

**Dual-portal skeleton rendering into #UpgradeLibraryPortal**: (session history) Tried rendering the skeleton directly into the same portal as CDS content. Crashed because two React trees managing the same DOM element have uncoordinated cleanup during CDS's LoadingComponent-to-RemoteMyComponent swap.

**inert attribute to suppress UPP focus trap during overlap**: (session history) Spike attempted using MutationObserver to set `inert` + `data-paywall-inert` on UPP's portaled `.ux-disrupt-backdrop` when it appears. Abandoned because skeleton modal never matched UPP layout closely enough for seamless transition, and UPP doesn't export a skeleton component.

**PaywallLoadingModal with focusLock={true} (default)**: Two competing `react-focus-lock` instances on `document.body`. Focus bounces between the skeleton and UPP's modal during the brief overlap window.

**Hidden wrapper (visibility:hidden + position:absolute + inert)**: Portals escape ancestor CSS. `visibility:hidden` on a wrapper div cannot suppress `@ux/modal` content that portals to `document.body`. See `docs/solutions/design-patterns/react-portal-content-escapes-ancestor-css-and-attrs.md`.

**visibility:hidden CSS injection on .ux-disrupt-backdrop**: Conflicts with `@ux/disrupt`'s internal visibility mechanism which uses the same property for its own initialization.

**useEffect cleanup to clear paywallLoading on unmount (shipped)**: UpgradeContainer ships `useEffect(() => () => setPaywallLoading(false), [setPaywallLoading])` to guarantee loading state clears on any unmount path. The earlier concern was React StrictMode double-mounting: a cleanup firing during the dev probe unmount could clear paywallLoading within 55ms. StrictMode is off in Next.js 16 by default, so this is safe in practice; if StrictMode is ever enabled, revisit whether the cleanup races the probe remount.

**Dynamic style injection via useLayoutEffect (replaced 2026-06-08)**: (session history) Created `<style data-paywall-hide>` in `document.head` with `useLayoutEffect`, tracked via `hideStyleRef`. Three components independently called `querySelectorAll('[data-paywall-hide]').forEach(el => el.remove())`. Problems: race conditions between 3 components creating/removing nodes, stale ref if another component removed the style first, CSP concerns with runtime style injection, required target element to exist. Replaced by body data-attribute toggle with static CSS (`body[data-paywall-loading] #UpgradeLibraryPortal`), which is idempotent, retroactive, and CSP-compliant.

**Style injection in render body (not useEffect/useLayoutEffect)**: DOM mutation during render violates React concurrent mode rules. Style leaked into `document.head` on unmount (no cleanup return).

**LoadingComponent={null}**: Falsy value. CDS code: `LoadingComponent || (() => <div>Loading...</div>)`. Must use `() => null`.

**LoadingComponent={() => null} inline**: Creates new function reference every render, causing unnecessary re-renders if `ComponentLoader` is memoized. Fix: module-level `const NullLoadingComponent = () => null`.

## Prevention

- Never render two `@ux/modal` instances with `focusLock={true}` simultaneously
- Always use `focusLock={false}` on skeleton/placeholder modals that coexist with a real modal
- Always use a module-level `const NullLoadingComponent = () => null`, not inline or `null`
- For hiding portalled content: use a body/document-level data attribute + static CSS, not dynamic style injection. CSS attribute selectors on ancestor elements apply to descendants as they mount (retroactive)
- Use `removeAttribute` (idempotent) instead of element removal (one-shot, racy) when multiple components need to clear hiding state
- Test paywall changes with network throttle (Slow 3G) and disabled `CdsEsmPreload` to simulate cold CDS loads
- Five exit paths must clear paywallLoading: onLoadSuccess, onLoadError, onError, closeUpgradeModal, timeout fallback
- Guard timeout callbacks with `usePaywallStore.getState().paywallLoading` to prevent race with onLoadSuccess firing in the same tick
- Use store-level mutual exclusion when multiple CDS modals exist on the same page (upgrade + credits share `paywallLoading` guard)
- (session history) JS-based observers (`setInterval`, `requestAnimationFrame`) starve during main-thread blocking from CDS bundle parse. Use `MutationObserver` for DOM timeline capture during CDS loads

## Related

- `docs/solutions/design-patterns/react-portal-content-escapes-ancestor-css-and-attrs.md` -- portals escape ancestor CSS/attributes
- `docs/solutions/best-practices/cds-esm-react19-compat-shims-2026-04-23.md` Section 3 -- predecessor documenting null-LoadingComponent hack
- `docs/solutions/ui-bugs/paywall-renewal-modal-stuck-2026-04-30.md` -- related paywall cleanup pattern (every exit path must close modal + invalidate queries)
- `docs/solutions/best-practices/paywall-e2e-test-infrastructure.md` -- E2E validation patterns for skeleton transitions
- AIROBUILD-1624 -- Jira ticket
- PR #4151 (`feat/paywall-spinner-in-button`) -- implementation PR
