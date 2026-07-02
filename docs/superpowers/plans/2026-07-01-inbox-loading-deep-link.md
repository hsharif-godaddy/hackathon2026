# Inbox Loading & Deep Link Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Inbox view so that deep-link navigation respects user input during page load and the Inbox component renders its own loading/error/empty states instead of being gated by external data.

**Architecture:** Remove the `resolving` gate from `getViewAvailability` for Inbox so view initialization happens synchronously on mount. Drop the `inboxBrandId &&` render gate from `PreviewPane` and let the `Inbox` component call `useInboxAccount` directly to own its three sub-states (loading skeleton, API error, no-account empty state). React Query deduplicates the second call with the existing one in `page.tsx`.

**Tech Stack:** React, TypeScript, React Query (`@tanstack/react-query`), Zustand, Vitest + `@testing-library/react`, UXCore (`@ux/button`), `react-intl`.

## Global Constraints

- All variables, parameters, and return types must carry explicit TypeScript annotations (no `any`).
- No new `console.log`; use the structured logger where needed.
- No new Tailwind default color classes (`bg-white`, `text-blue-600`); use UXCore intent classes (`text-ux-text-secondary`, etc.).
- Translation keys must already exist. The two used here (`builder_common_error_generic`, `builder_common_try_again`) are confirmed present in the codebase.
- No trailing whitespace, no consecutive blank lines, no blank line at EOF.
- Lint and typecheck must pass: `pnpm --filter website lint` and `pnpm typecheck`.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `app/src/app/[market]/develop/[id]/page.tsx` | Remove `resolving: isLoadingAccount` from INBOX availability; trim stale deps from `useCallback` |
| Modify | `app/src/app/[market]/develop/components/preview/PreviewPane.tsx` | Remove `inboxBrandId` render gates; remove inbox-account props from `<Inbox />`; drop now-unused store reads |
| Modify | `app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx` | Self-contained: call `useInboxAccount` directly; handle loading / error / no-account states |
| Modify | `app/src/app/[market]/develop/components/preview/inbox/Inbox.test.tsx` | Add tests for the three new Inbox states; verify existing coverage still holds |
| Modify | `app/src/hooks/useView.test.ts` | Remove the now-obsolete "holds while resolving" test; replace with a test that confirms Inbox initializes immediately |

---

## Task 1: Fix `getViewAvailability` in `page.tsx`

**Files:**
- Modify: `app/src/app/[market]/develop/[id]/page.tsx:311-319`

**Context:**
`getViewAvailability` is a `useCallback` that returns `ViewAvailability` for each `ViewMode`. For `INBOX` it currently returns `{ resolving: isLoadingAccount }`, which causes `useView` to hold view initialization until the async `useInboxAccount` query settles. This is the root cause of the deep-link bug.

**Interfaces:**
- Consumes: `ViewMode`, `ViewAvailability` (from `@/hooks/useView`), `isInboxEnabled` (Switchboard flag), `isLoadingAccount` (no longer needed in this callback)
- Produces: `getViewAvailability: (mode: ViewMode) => ViewAvailability` — INBOX now returns `{ available: Boolean(isInboxEnabled), resolving: false }`

- [ ] **Step 1: Locate the current callback**

Open `app/src/app/[market]/develop/[id]/page.tsx` and find lines 311–319:

```typescript
const getViewAvailability = useCallback(
  (mode: ViewMode): ViewAvailability => {
    if (mode === ViewMode.INBOX) {
      return { available: Boolean(isInboxEnabled && brandId), resolving: isLoadingAccount }
    }
    return { available: true, resolving: false }
  },
  [isInboxEnabled, brandId, isLoadingAccount]
)
```

- [ ] **Step 2: Apply the fix**

Replace those lines with:

```typescript
const getViewAvailability = useCallback(
  (mode: ViewMode): ViewAvailability => {
    if (mode === ViewMode.INBOX) {
      return { available: Boolean(isInboxEnabled), resolving: false }
    }
    return { available: true, resolving: false }
  },
  [isInboxEnabled]
)
```

Key changes:
- `available` no longer requires `brandId` to be set — the Inbox view is available whenever the feature flag is on.
- `resolving` is always `false`, matching the Brand/Domain pattern.
- `brandId` and `isLoadingAccount` removed from the dependency array (they are no longer read inside the callback).

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors. (TypeScript will verify the returned shape matches `ViewAvailability`.)

- [ ] **Step 4: Commit**

```bash
git add app/src/app/[market]/develop/\[id\]/page.tsx
git commit -m "fix(inbox): remove resolving gate from getViewAvailability for inbox view

Inbox view now initializes synchronously like Brand/Domain views. The
async useInboxAccount query no longer blocks markViewInitialized(), so a
user clicking another tab while the page loads will not have their choice
overridden when the query settles.

Closes AIROBUILD-3267 (partial)"
```

---

## Task 2: Remove `inboxBrandId` render gates from `PreviewPane`

**Files:**
- Modify: `app/src/app/[market]/develop/components/preview/PreviewPane.tsx`

**Context:**
`PreviewPane` currently reads `inboxBrandId`, `inboxEmbeddableId`, and `inboxCategoryId` from the Zustand store and gates the Inbox render on `inboxBrandId` being truthy. In both the early-return path (no `canvasTabsOverlayMode`) and the canvas-tabs overlay path, the `&& inboxBrandId` guard prevents the Inbox from rendering until data is loaded. With `Inbox` now self-managing its loading state, these guards and props are no longer needed.

**Interfaces:**
- Consumes: none from previous tasks — this is an independent change
- Produces: `<Inbox />` rendered with no props from `PreviewPane`

- [ ] **Step 1: Remove the three store reads that are no longer used in `PreviewPane`**

Find lines 335–337:
```typescript
const inboxBrandId = useDevelopPageStore((state) => state.inboxBrandId)
const inboxEmbeddableId = useDevelopPageStore((state) => state.inboxEmbeddableId)
const inboxCategoryId = useDevelopPageStore((state) => state.inboxCategoryId)
```

Delete all three lines. (These values are now read inside `Inbox` itself.)

- [ ] **Step 2: Fix the early-return render gate (non-canvas-tabs path)**

Find line ~1423:
```typescript
if (isInboxEnabled && inboxBrandId && viewMode === ViewMode.INBOX && !canvasTabsOverlayMode) {
  return (
    <div className="h-full flex flex-col pr-1 md:pr-2.5 pl-1">
      <div className="relative h-full overflow-auto rounded-lg md:rounded-b-none border bg-intents-ux-box-backgroundColor">
        <Inbox brandId={inboxBrandId} embeddableId={inboxEmbeddableId} categoryId={inboxCategoryId} />
      </div>
    </div>
  )
}
```

Replace with:
```typescript
if (isInboxEnabled && viewMode === ViewMode.INBOX && !canvasTabsOverlayMode) {
  return (
    <div className="h-full flex flex-col pr-1 md:pr-2.5 pl-1">
      <div className="relative h-full overflow-auto rounded-lg md:rounded-b-none border bg-intents-ux-box-backgroundColor">
        <Inbox />
      </div>
    </div>
  )
}
```

Changes: removed `&& inboxBrandId` from the condition; removed props from `<Inbox />`.

- [ ] **Step 3: Fix the canvas-tabs overlay path**

Find line ~1626:
```typescript
{isCanvasTabsEnabled && isInboxEnabled && inboxBrandId && hasMountedInboxRef.current && (
  <div ...>
    <Inbox brandId={inboxBrandId} embeddableId={inboxEmbeddableId} categoryId={inboxCategoryId} />
  </div>
)}
```

Replace with:
```typescript
{isCanvasTabsEnabled && isInboxEnabled && hasMountedInboxRef.current && (
  <div ...>
    <Inbox />
  </div>
)}
```

Changes: removed `&& inboxBrandId` from the JSX condition; removed props from `<Inbox />`.

- [ ] **Step 4: Run lint and typecheck**

```bash
pnpm --filter website lint
pnpm typecheck
```

Expected: no errors. TypeScript will catch any remaining `inboxBrandId` references that were missed.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/PreviewPane.tsx
git commit -m "fix(inbox): remove inboxBrandId render gate from PreviewPane

Inbox now renders whenever the view is active and the feature flag is on.
The component handles its own loading/empty/error states internally, so
PreviewPane no longer needs to gate on the resolved brandId."
```

---

## Task 3: Make `Inbox` self-contained (loading / error / no-account states)

**Files:**
- Modify: `app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx`

**Context:**
The `Inbox` component currently requires `brandId`, `embeddableId`, `categoryId` as props and renders only when they are supplied. After removing the external gate, the component must handle three new states itself:
1. **Loading** (`isLoading = true`) → render `InboxConversationListSkeleton`
2. **API error** (`error !== null`) → error message + Retry button using `refetch`
3. **No account** (`!brandId && !isLoading && !error`) → empty state via `InboxConversationListEmptyState`

The component calls `useInboxAccount(isInboxEnabled ? appId : undefined)`. React Query deduplicates this with the existing call in `page.tsx` — no extra network request is made.

**Type notes:**
- `UuidString = string` (see `app/src/types/inbox/local/core.d.ts`), so TypeScript narrowing from `string | null` → `string` satisfies the `brandId: UuidString` prop on child components after the `if (!brandId)` guard.
- `error` from `useInboxAccount` is `Error | null`.

**Interfaces:**
- Consumes: `useAppIdFromParams` (`@/app/[market]/develop/components/utils`), `useSwitchboard` (`@/hooks/useSwitchboard`), `useInboxAccount` (`@/hooks/useInboxAccount`), `useTranslations` (`@/hooks/useTranslations`), `Button` (`@ux/button`), `InboxConversationListSkeleton` (named export from `./InboxSkeletons`), `InboxConversationListEmptyState` (named export from `./InboxConversationListEmptyState`)
- Produces: `Inbox` — default export, no props

- [ ] **Step 1: Replace `Inbox.tsx` with the new implementation**

Overwrite `app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx`:

```typescript
'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import Button from '@ux/button';

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { useConversationId } from '@/hooks/useConversationId';
import { useInboxAccount } from '@/hooks/useInboxAccount';
import { useInboxEntryRef } from '@/hooks/useInboxEntryRef';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import type { IntString, UuidString } from '@/types/inbox/local/core';
import { InboxConversationDetail } from './InboxConversationDetail';
import { InboxConversationList } from './InboxConversationList';
import { InboxConversationListEmptyState } from './InboxConversationListEmptyState';
import { InboxConversationListSkeleton } from './InboxSkeletons';
import { slideMotionProps } from './slideView';

export default function Inbox() {
  const appId: string | undefined = useAppIdFromParams();
  const isInboxEnabled: boolean | undefined = useSwitchboard('app-builder-inbox-button');
  const { brandId, embeddableId, categoryId, isLoading, error, refetch } = useInboxAccount(
    isInboxEnabled ? appId : undefined,
  );
  const t = useTranslations();
  const [direction, setDirection] = useState<number>(1);
  const { activeConversationId, setActiveConversationId } = useConversationId();
  const { consumeEntryRef } = useInboxEntryRef();

  if (isLoading) {
    return (
      <div className="h-full p-3" data-testid="inbox-loading">
        <InboxConversationListSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
        data-testid="inbox-error"
      >
        <p className="text-sm text-ux-text-secondary">
          {t('builder_common_error_generic', undefined, 'Something went wrong. Please try again.')}
        </p>
        <Button design="secondary" size="sm" onClick={() => void refetch()}>
          {t('builder_common_try_again', undefined, 'Try again')}
        </Button>
      </div>
    );
  }

  if (!brandId) {
    return (
      <InboxConversationListEmptyState
        statusFilter="all"
        embeddableId={null}
        categoryId={null}
      />
    );
  }

  const resolvedBrandId: UuidString = brandId;

  function handleConversationClick(conversationId: IntString): void {
    setDirection(1);
    setActiveConversationId(conversationId);
  }

  function handleBack(): void {
    setDirection(-1);
    setActiveConversationId(null);
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-ux-surface-base">
      <AnimatePresence initial={false} custom={direction}>
        {activeConversationId ? (
          <motion.div
            key="conversation-detail"
            {...slideMotionProps(direction)}
            className="absolute inset-0 flex flex-col bg-ux-surface-base"
          >
            <InboxConversationDetail
              conversationId={activeConversationId}
              brandId={resolvedBrandId}
              onBack={handleBack}
              consumeEntryRef={consumeEntryRef}
            />
          </motion.div>
        ) : (
          <motion.div
            key="conversation-list"
            {...slideMotionProps(direction)}
            className="absolute inset-0 flex flex-col bg-ux-surface-base"
          >
            <InboxConversationList
              brandId={resolvedBrandId}
              embeddableId={embeddableId}
              categoryId={categoryId}
              onConversationClick={handleConversationClick}
              consumeEntryRef={consumeEntryRef}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

Note on `resolvedBrandId`: assigning `brandId` (narrowed to `string` after the `!brandId` guard) to a `UuidString`-typed const makes the intent explicit and avoids TypeScript needing to infer the narrowing through JSX props.

- [ ] **Step 2: Run lint and typecheck**

```bash
pnpm --filter website lint
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx
git commit -m "feat(inbox): Inbox self-manages loading/error/no-account states

Inbox now calls useInboxAccount directly (React Query deduplicates with
page.tsx). Renders a skeleton while loading, an error state with retry on
API failure, and the setup CTA empty state when no account is configured.
Removes dependency on props for account data."
```

---

## Task 4: Update `Inbox.test.tsx` for the new states

**Files:**
- Modify: `app/src/app/[market]/develop/components/preview/inbox/Inbox.test.tsx`

**Context:**
The existing tests pass `brandId` as a prop. After the refactor, `Inbox` takes no props and sources all data internally. Tests must now mock `useInboxAccount`, `useAppIdFromParams`, and `useSwitchboard`. Add three new cases covering the loading skeleton, error state, and no-account empty state.

Read the current test file first to understand existing mocks and what needs to be preserved or adapted.

- [ ] **Step 1: Read the existing test file**

Open `app/src/app/[market]/develop/components/preview/inbox/Inbox.test.tsx` and identify:
- Which mocks are already set up at the top (e.g., `vi.mock('@/hooks/useInboxAccount', ...)`)
- How `renderInbox(props)` or similar helpers work
- Which tests will break because they pass `brandId` as a prop

- [ ] **Step 2: Update the mock setup and any prop-based render helper**

The test file must mock the three hooks that `Inbox` now calls internally. Add or update the module mocks at the top of the file. The precise content depends on what's already mocked, but the pattern for the new mocks is:

```typescript
// At the top of the file, alongside existing vi.mock() calls:
vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'test-app-id'),
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => true),
}))

vi.mock('@/hooks/useInboxAccount', () => ({
  useInboxAccount: vi.fn(() => ({
    brandId: 'test-brand-id',
    embeddableId: null,
    categoryId: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })),
}))
```

If the existing test already mocks `useInboxAccount`, update that mock to include `isLoading`, `error`, and `refetch` fields.

Remove any `brandId`, `embeddableId`, `categoryId` props from the render calls (they no longer exist on `Inbox`). Change:
```typescript
render(<Inbox brandId="some-uuid" embeddableId={null} categoryId={null} />)
```
to:
```typescript
render(<Inbox />)
```

- [ ] **Step 3: Add the three new state tests**

Add the following three `it` blocks inside the `describe('Inbox', ...)` block. Place them after the existing passing tests:

```typescript
it('shows a loading skeleton while useInboxAccount is loading', () => {
  const { useInboxAccount } = await import('@/hooks/useInboxAccount')
  vi.mocked(useInboxAccount).mockReturnValue({
    brandId: null,
    embeddableId: null,
    categoryId: null,
    isLoading: true,
    error: null,
    refetch: vi.fn(),
    accountId: null,
  })

  render(<Inbox />)

  expect(screen.getByTestId('inbox-loading')).toBeInTheDocument()
  expect(screen.getByTestId('inbox-list-skeleton')).toBeInTheDocument()
})

it('shows an error state with a retry button when useInboxAccount errors', async () => {
  const mockRefetch = vi.fn()
  const { useInboxAccount } = await import('@/hooks/useInboxAccount')
  vi.mocked(useInboxAccount).mockReturnValue({
    brandId: null,
    embeddableId: null,
    categoryId: null,
    isLoading: false,
    error: new Error('fetch failed'),
    refetch: mockRefetch,
    accountId: null,
  })

  render(<Inbox />)

  expect(screen.getByTestId('inbox-error')).toBeInTheDocument()
  const retryButton = screen.getByRole('button', { name: /try again/i })
  expect(retryButton).toBeInTheDocument()

  await userEvent.click(retryButton)

  expect(mockRefetch).toHaveBeenCalledTimes(1)
})

it('shows the empty setup state when loaded but brandId is null', () => {
  const { useInboxAccount } = await import('@/hooks/useInboxAccount')
  vi.mocked(useInboxAccount).mockReturnValue({
    brandId: null,
    embeddableId: null,
    categoryId: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    accountId: null,
  })

  render(<Inbox />)

  // The empty state is the InboxConversationListEmptyState component.
  // The exact testId or text depends on the inboxEmptyState configuration,
  // but the inbox-loading and inbox-error testIds must NOT appear.
  expect(screen.queryByTestId('inbox-loading')).not.toBeInTheDocument()
  expect(screen.queryByTestId('inbox-error')).not.toBeInTheDocument()
})
```

**Note on imports:** If `userEvent` is not already imported, add:
```typescript
import userEvent from '@testing-library/user-event'
```

The `async/await import` pattern in test bodies is used here to access the mocked module after `vi.mock()` hoisting. If the existing test file already uses a different pattern (e.g., top-level `const mockUseInboxAccount = vi.fn()`), adapt accordingly — the important thing is that each test case controls the return value of `useInboxAccount` independently.

- [ ] **Step 4: Run the Inbox tests**

```bash
pnpm --filter website test "inbox/Inbox.test"
```

Expected: all existing tests pass; the three new tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/inbox/Inbox.test.tsx
git commit -m "test(inbox): add tests for loading, error, and no-account states

Adapts existing tests to the prop-less Inbox interface. Adds three new
cases: skeleton while loading, error state with retry, and empty setup
state when no brand account is configured."
```

---

## Task 5: Update `useView.test.ts` to remove the resolving-state test

**Files:**
- Modify: `app/src/hooks/useView.test.ts`

**Context:**
The test `'holds while resolving, then opens inbox once available'` directly exercises the `resolving: true` behavior that we removed in Task 1. Keeping it would be misleading (testing removed behavior) and it would fail if the `getViewAvailability` callback never returns `resolving: true` anymore.

The ticket requirement: "useView tests updated to reflect no `resolving` state for Inbox."

The replacement test confirms the new behavior: INBOX initializes immediately (no resolving hold) without any deferred re-render cycle.

- [ ] **Step 1: Delete the obsolete test**

In `app/src/hooks/useView.test.ts`, find and delete the entire `it('holds while resolving, then opens inbox once available', ...)` block (lines 44–78 in the current file).

- [ ] **Step 2: Add the replacement test**

Add the following test immediately after `'opens inbox from ?view=inbox when available, without clobbering the URL'`:

```typescript
it('opens inbox immediately without a resolving phase', async () => {
  window.history.replaceState(null, '', '/develop/app-123?view=inbox');
  replaceStateSpy.mockClear();

  // Inbox availability returns resolving: false on the first call — no deferred re-render.
  const getViewAvailability = (mode: ViewMode): ViewAvailability =>
    mode === ViewMode.INBOX
      ? { available: true, resolving: false }
      : { available: true, resolving: false };

  renderHook(() => useView({ getViewAvailability }));

  await waitFor(() => {
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.INBOX);
  });
  // Initialized in a single tick — no second rerender required.
  expect(useDevelopPageStore.getState().viewInitializedForPathname).toBe('/develop/app-123');
  expect(window.location.search).toBe('?view=inbox');
  expect(replaceStateSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run the useView tests**

```bash
pnpm --filter website test "useView.test"
```

Expected: all tests pass (the deleted test is gone; the new test passes; remaining six tests are unchanged).

- [ ] **Step 4: Commit**

```bash
git add app/src/hooks/useView.test.ts
git commit -m "test(useView): replace resolving-state test with immediate-init test

The old test exercised Inbox's resolving:true behavior which has been
removed. The replacement confirms Inbox initializes in a single tick
without a deferred re-render cycle."
```

---

## Task 6: Final verification

- [ ] **Step 1: Run the full app test suite for affected packages**

```bash
pnpm --filter website test
pnpm typecheck
pnpm --filter website lint
```

Expected: all tests pass, no type errors, no lint errors.

- [ ] **Step 2: Smoke test the acceptance criteria**

With `pnpm run dev` running locally at `https://local.gasket.dev-godaddy.com:8443`:

1. Open `<app-url>?view=inbox` and immediately click "Website" before content loads → Website view is shown; the `?view=inbox` param is stripped.
2. Open `<app-url>?view=inbox` and wait → Inbox view loads normally with skeleton → transitions to inbox content once ready.
3. Open `<app-url>?view=inbox` for an app with no inbox account → empty setup state with CTAs is shown.
4. Simulate an API error by setting a breakpoint or using network tab to block the `/api/inbox` request → error state with "Try again" button appears; clicking it re-fires the request.

- [ ] **Step 3: Check E2E test files for `data-testid` or flow references**

```bash
grep -r "inbox" tests/e2e/ tests/e2e-v2/ tests/regression/ --include="*.ts" --include="*.tsx" -l
```

If any E2E test references the Inbox view initialization flow or the `inboxBrandId` gate, update it to reflect the new behavior (Inbox renders immediately, shows skeleton while loading).

- [ ] **Step 4: Final commit (if E2E tests were touched)**

```bash
git add tests/
git commit -m "test(e2e): update inbox tests for immediate view init and self-managed loading"
```

---

## Spec Coverage Check

| Requirement | Task |
|-------------|------|
| `?view=inbox` + click other tab before load → other view shown | Task 1 (removes resolving gate) |
| `?view=inbox` + no click → inbox loads normally | Task 1 + Task 3 (skeleton → resolved) |
| Inbox shows loading skeleton while resolving | Task 3 |
| Inbox shows empty state with setup CTAs when no account | Task 3 |
| Inbox shows error state with retry CTA on API error | Task 3 |
| No regressions | Task 6 |
| `useView` tests updated for no resolving state | Task 5 |
| `inboxBrandId` render gate removed from PreviewPane | Task 2 |
