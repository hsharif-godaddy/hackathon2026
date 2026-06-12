---
title: "Extract shared state from page-scoped stores"
date: 2026-06-08
category: architecture-patterns
module: app/src/stores
problem_type: best_practice
component: state_management
severity: medium
applies_when:
  - "Multiple unrelated pages or layout components need the same state"
  - "Imperative access outside React is required (websocket handlers, analytics)"
  - "A loading guard or mutex needs a single source of truth across triggers"
  - "Shared components read store state but render on different pages"
tags: [zustand, store-extraction, separation-of-concerns, paywall, state-management]
---

# Extract shared state from page-scoped stores

## Context

`useDevelopPageStore` (~900 lines) held paywall modal state (visibility, source, ITC, loading flag) alongside develop-page-specific concerns (chat tabs, preview mode, feedback banners). Multiple surfaces outside the develop page needed paywall actions:

- manage-plan page (subscription management)
- HeaderUpgradeButton (shared layout component)
- publishAction.ts (websocket handler, imperative `getState()` outside React)
- PricingSection (landing page experiments)

A PR reviewer flagged that manage-plan was importing `useDevelopPageStore`, breaking the store's page-scoped intent. The shared paywall components (`UpgradeContainer`, `DirectToPaidContainer`) internally read `paywallLoading` from the store, so manage-plan's local `useState` couldn't coordinate with them.

## Guidance

When state serves a cross-cutting feature (not a single page), extract it into a dedicated feature store.

```typescript
// app/src/stores/usePaywallStore.ts
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

type PaywallStore = PaywallState & PaywallActions

export const usePaywallStore = create<PaywallStore>()(
  immer((set, get) => ({
    paywallLoading: false,
    showUpgradeModal: false,
    upgradeModalSource: null,
    upgradeModalItc: null,
    // ...credits equivalents

    openUpgradeModal: (source: string, itc?: string) => {
      if (get().paywallLoading) return // mutex guard
      set((state) => {
        state.showUpgradeModal = true
        state.upgradeModalSource = source
        state.upgradeModalItc = itc ?? null
        state.paywallLoading = true
      })
    },
    // ...
  }))
)
```

Consumers import from the feature store directly:
```typescript
// Any page, layout component, or imperative handler
const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal)

// Imperative access outside React (websocket handlers)
usePaywallStore.getState().openUpgradeModal('publish', PAYWALL_ITC.PUBLISH)
```

## Why This Matters

- **Without extraction**: Page-scoped stores become dumping grounds. Cross-page consumers resort to coupling with unrelated stores, duplicating state via local `useState`, or threading props through unrelated ancestors. Loading guards can't coordinate across independent state sources.
- **With extraction**: Clear architectural boundaries. Page stores stay page-focused. Shared features have reusable, independently testable homes. Imperative access works without React context. Coordination logic (loading mutex) has one enforcement point.

## When to Apply

- A feature's state is needed by 3+ unrelated pages/components with no practical common ancestor
- Imperative/non-React access is needed (websocket handlers, analytics triggers, event callbacks)
- State changes require coordination (loading guards, interdependent flags, mutual exclusion)
- Shared components internally read store state and render across different pages

**Do not apply when:**
- State is truly local to a single page (keep in the page store)
- All consumers live within one component tree (use context/provider + props)
- No imperative access needed and the feature is tightly bound to one domain

## Examples

**Before (manage-plan coupled to develop-page store):**
```typescript
// manage-plan/page.tsx
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

function ManagePlan() {
  const showUpgradeModal = useDevelopPageStore((s) => s.showUpgradeModal)
  const openUpgradeModal = useDevelopPageStore((s) => s.openUpgradeModal)
  // ...
}
```

**After (dedicated feature store):**
```typescript
// manage-plan/page.tsx
import { usePaywallStore } from '@/stores/usePaywallStore'

function ManagePlan() {
  const showUpgradeModal = usePaywallStore((s) => s.showUpgradeModal)
  const openUpgradeModal = usePaywallStore((s) => s.openUpgradeModal)
  // ...
}
```

**Migration mechanics (this refactoring touched ~42 files):**
1. Create the new store with extracted state + actions
2. Remove fields/actions from the page store (no re-exports or shims)
3. Update consumer imports: paywall-only files get a simple swap; mixed files add a second import
4. Update test mocks: `vi.mock('@/stores/usePaywallStore', ...)` for paywall selectors
5. Move store tests to the new test file

## Related

- `docs/solutions/architecture-patterns/cds-modal-loading-lifecycle.md` (loading lifecycle mechanics)
- `docs/solutions/best-practices/upp-component-architecture-subtypes-2026-04-14.md` (container types)
