# Inbox Pusher → React Query Refetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Pusher `autoupdate_version` event arrives on the Inbox account channel, invalidate all inbox React Query data (debounced) so the conversation list and active conversation/messages refetch automatically.

**Architecture:** `usePusher` stays a generic transport hook but gains an optional `onAutoupdate` callback, routed through a latest-callback ref so the Pusher connection never re-subscribes when the caller's callback identity changes. `Inbox` supplies a debounced callback (400ms `setTimeout` + `useRef`, matching the existing `UnifiedSearch` pattern) that calls `queryClient.invalidateQueries({ queryKey: ['reamaze'] })`.

**Tech Stack:** React (hooks), `pusher-js`, `@tanstack/react-query`, Vitest + `@testing-library/react` (jsdom).

**Spec:** `docs/superpowers/specs/2026-06-10-inbox-pusher-refetch-design.md`

---

## File Structure

- **Modify** `app/src/types/pusher.ts` — add `onAutoupdate` to `UsePusherOptions`.
- **Modify** `app/src/hooks/usePusher.ts` — add latest-callback ref; invoke callback from `handleAutoupdateVersion`.
- **Modify** `app/src/hooks/usePusher.test.ts` — tests for callback invocation + no-resubscribe.
- **Modify** `app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx` — debounced invalidation wiring.
- **Modify** `app/src/app/[market]/develop/components/preview/inbox/Inbox.test.tsx` — test event → debounced invalidation.

All commands run from repo root unless noted. The app package filter is `website`.

---

## Task 1: Add `onAutoupdate` callback to `usePusher`

**Files:**
- Modify: `app/src/types/pusher.ts`
- Modify: `app/src/hooks/usePusher.ts:18-52` (options destructure + `handleAutoupdateVersion`)
- Test: `app/src/hooks/usePusher.test.ts`

- [ ] **Step 1: Add the failing tests**

Add these two tests inside the existing `describe('subscription lifecycle', ...)` block in `app/src/hooks/usePusher.test.ts`, right after the existing `it('logs the autoupdate_version event payload', ...)` test (ends at line 254):

```ts
    it('invokes onAutoupdate with the payload when the event fires', function callsOnAutoupdate() {
      const onAutoupdate = vi.fn();
      renderHookWithProviders(() => usePusher({ accountId: 'acct-1', onAutoupdate }));

      const channel = latestClient().channels.get(CHANNEL_NAME('acct-1'));
      act(function trigger() {
        channel?.trigger('autoupdate_version', { autoupdate_version: 7 });
      });

      expect(onAutoupdate).toHaveBeenCalledTimes(1);
      expect(onAutoupdate).toHaveBeenCalledWith({ autoupdate_version: 7 });
    });

    it('does not re-subscribe when the onAutoupdate identity changes', function stableSubscription() {
      const { rerender } = renderHookWithProviders(
        ({ cb }: { cb: () => void }) => usePusher({ accountId: 'acct-1', onAutoupdate: cb }),
        { initialProps: { cb: () => {} } }
      );

      // A brand-new callback identity on re-render must not tear down the connection.
      rerender({ cb: () => {} });
      rerender({ cb: () => {} });

      expect(pusherMock.instances).toHaveLength(1);
    });

    it('invokes the latest onAutoupdate after a re-render', function latestCallback() {
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = renderHookWithProviders(
        ({ cb }: { cb: () => void }) => usePusher({ accountId: 'acct-1', onAutoupdate: cb }),
        { initialProps: { cb: first } }
      );

      rerender({ cb: second });

      const channel = latestClient().channels.get(CHANNEL_NAME('acct-1'));
      act(function trigger() {
        channel?.trigger('autoupdate_version', { autoupdate_version: 9 });
      });

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith({ autoupdate_version: 9 });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter website test usePusher.test.ts -- -t "onAutoupdate"`
Expected: The three new tests FAIL — `callsOnAutoupdate` and `latestCallback` fail because `onAutoupdate` is never invoked (assertion: expected mock to have been called). `stableSubscription` may pass already; that's fine, it's a guard for Step 3.

- [ ] **Step 3: Add `onAutoupdate` to the options type**

In `app/src/types/pusher.ts`, replace the `UsePusherOptions` interface (lines 11-13):

```ts
export interface UsePusherOptions {
  accountId?: string;  // Reamaze account UUID (hook is no-op if missing)
  /**
   * Invoked when an `autoupdate_version` event arrives on the channel. Used by
   * callers (e.g. Inbox) to trigger data refetches. The hook routes this through
   * a ref so changing its identity never re-subscribes the Pusher connection.
   */
  onAutoupdate?: (data: AutoupdateVersionPayload) => void;
}
```

- [ ] **Step 4: Route the callback through a latest-callback ref in the hook**

In `app/src/hooks/usePusher.ts`, the options are destructured at line 19 (`const { accountId } = options;`). Leave that line as-is, then add the ref + sync effect immediately after the existing `pusherClientRef`/`channelRef` declarations (after line 31). Insert:

```ts
  // Hold the latest onAutoupdate callback in a ref so handleAutoupdateVersion can
  // stay referentially stable. The subscribe effect depends on that handler;
  // depending on the caller's callback identity directly would tear down and
  // rebuild the entire Pusher connection on every parent re-render.
  const onAutoupdateRef = useRef(options.onAutoupdate);
  useEffect(() => {
    onAutoupdateRef.current = options.onAutoupdate;
  });
```

Then update `handleAutoupdateVersion` (lines 42-52) to invoke the ref after logging:

```ts
  // Event handler for autoupdate_version
  const handleAutoupdateVersion = useCallback(
    (data: AutoupdateVersionPayload) => {
      if (isNotProd) {
        logger.info('pusher.event.autoupdate_version', {
          accountId,
          version: data.autoupdate_version,
        });
      }
      onAutoupdateRef.current?.(data);
    },
    [accountId]
  );
```

Note: `useEffect` is already imported at line 4 (`import { useCallback,useEffect, useRef, useState } from 'react';`). No import changes needed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter website test usePusher.test.ts`
Expected: PASS — all existing tests plus the three new ones. Confirm the existing `logs the autoupdate_version event payload` test still passes (the log call is unchanged).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter website typecheck`
Expected: PASS, no errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/types/pusher.ts app/src/hooks/usePusher.ts app/src/hooks/usePusher.test.ts
git commit -m "feat(inbox): add onAutoupdate callback to usePusher"
```

---

## Task 2: Wire debounced invalidation in `Inbox`

**Files:**
- Modify: `app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx`
- Test: `app/src/app/[market]/develop/components/preview/inbox/Inbox.test.tsx`

- [ ] **Step 1: Update the usePusher mock to capture options, and add the failing test**

In `app/src/app/[market]/develop/components/preview/inbox/Inbox.test.tsx`, replace the existing `usePusher` mock (lines 25-27):

```ts
const mockUsePusher = vi.fn();
vi.mock('@/hooks/usePusher', () => ({
  usePusher: (options: unknown) => mockUsePusher(options),
}));
```

Set a default return in the existing `beforeEach` (currently lines 76-78) so the mock returns the hook's shape:

```ts
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePusher.mockReturnValue({ isConnected: false, isAuthenticating: false, error: null });
  });
```

Add fake-timer imports/usage and a new test at the end of the `describe('Inbox', ...)` block (after the existing `returns to the list ...` test, before the closing `});` at line 125). First extend the top-of-file imports — change line 6-7 to include `afterEach`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
```

Then add the test:

```ts
  it('invalidates inbox queries (debounced) when an autoupdate_version event fires', () => {
    vi.useFakeTimers();
    try {
      mockUseConversationId.mockReturnValue(null);

      render(<Inbox brandId='brand-1' accountId='acct-1' />);

      // Grab the onAutoupdate callback Inbox passed to usePusher.
      const options = mockUsePusher.mock.calls[0][0] as {
        onAutoupdate?: (data: { autoupdate_version: number }) => void;
      };
      expect(typeof options.onAutoupdate).toBe('function');

      // Fire a burst of events; debounce should collapse them into one invalidation.
      act(() => {
        options.onAutoupdate?.({ autoupdate_version: 1 });
        options.onAutoupdate?.({ autoupdate_version: 2 });
        options.onAutoupdate?.({ autoupdate_version: 3 });
      });

      // Nothing invalidated yet (still within the debounce window).
      expect(invalidateQueriesSpy).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(invalidateQueriesSpy).toHaveBeenCalledTimes(1);
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['reamaze'] });
    } finally {
      vi.useRealTimers();
    }
  });
```

This test needs an `invalidateQueriesSpy` bound to the queryClient `Inbox` uses. Mock `useQueryClient` at the top of the file (add after the `usePusher` mock):

```ts
const invalidateQueriesSpy = vi.fn();
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesSpy }),
  };
});
```

And reset it in `afterEach`:

```ts
  afterEach(() => {
    invalidateQueriesSpy.mockReset();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter website test Inbox.test.tsx -- -t "autoupdate_version"`
Expected: FAIL — `options.onAutoupdate` is `undefined` (Inbox does not pass it yet), so `expect(typeof options.onAutoupdate).toBe('function')` fails.

- [ ] **Step 3: Implement the debounced invalidation in `Inbox`**

In `app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx`, update imports. Replace line 4 (`import { useState } from 'react';`) with:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
```

Add the queryKeys import alongside the other `@/` imports (after line 8):

```ts
import { queryKeys } from '@/lib/inbox/constants/queryKeys';
```

Inside the `Inbox` component, replace the existing Pusher line (lines 28-29):

```ts
  // Initialize Pusher connection for real-time updates (state unused for now)
  usePusher({ accountId });
```

with:

```ts
  const queryClient = useQueryClient();
  const invalidateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce so a burst of autoupdate_version increments triggers a single
  // invalidation. invalidateQueries on the root ['reamaze'] key refetches the
  // mounted inbox queries (list + active conversation + messages) and marks the
  // rest stale. Mirrors the setTimeout + ref debounce used in UnifiedSearch.
  const handleAutoupdate = useCallback(() => {
    if (invalidateTimeoutRef.current) {
      clearTimeout(invalidateTimeoutRef.current);
    }
    invalidateTimeoutRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.all });
    }, 400);
  }, [queryClient]);

  useEffect(
    () => () => {
      if (invalidateTimeoutRef.current) {
        clearTimeout(invalidateTimeoutRef.current);
      }
    },
    []
  );

  // Initialize Pusher connection for real-time updates; refetch inbox data on events.
  usePusher({ accountId, onAutoupdate: handleAutoupdate });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter website test Inbox.test.tsx`
Expected: PASS — the new test plus all four existing routing tests. Confirm the existing tests still pass (the `usePusher` mock change preserves the same return shape via `beforeEach`).

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter website typecheck && pnpm --filter website lint`
Expected: PASS. `queryKeys.all` resolves to `['reamaze']` (readonly tuple); `invalidateQueries({ queryKey: queryKeys.all })` is valid because `QueryClient.invalidateQueries` accepts a readonly `queryKey`.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx app/src/app/[market]/develop/components/preview/inbox/Inbox.test.tsx
git commit -m "feat(inbox): refetch conversations/messages on pusher autoupdate"
```

---

## Final Verification

- [ ] **Step 1: Run the full inbox + pusher test set**

Run: `pnpm --filter website test usePusher.test.ts Inbox.test.tsx`
Expected: All PASS.

- [ ] **Step 2: Typecheck, lint, build the app package**

Run: `pnpm --filter website typecheck && pnpm --filter website lint`
Expected: PASS.

(Optional, slower) Run: `pnpm --filter website build`
Expected: PASS.

---

## Self-Review Notes

- **Spec coverage:** Component 1 (`onAutoupdate` + latest-ref) → Task 1. Component 2 (debounced `['reamaze']` invalidation in Inbox) → Task 2. Testing section (usePusher callback + no-resubscribe; Inbox debounced invalidation) → Task 1 Step 1 and Task 2 Step 1. Edge cases (unmount mid-debounce cleanup, accountId absent no-op) → Task 2 Step 3 cleanup effect + unchanged usePusher no-op.
- **Type consistency:** `onAutoupdate: (data: AutoupdateVersionPayload) => void` is identical in `UsePusherOptions` (Task 1 Step 3) and the hook usage (Task 1 Step 4). `queryKeys.all === ['reamaze']` is the invalidation key in Inbox (Task 2 Step 3) and the asserted key in the test (Task 2 Step 1).
- **No placeholders:** every code step shows full code; commands include expected output.
