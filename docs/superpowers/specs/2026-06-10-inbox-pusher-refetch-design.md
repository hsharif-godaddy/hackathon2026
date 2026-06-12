# Inbox Pusher → React Query Refetch — Design

**Date:** 2026-06-10
**Status:** Approved (pre-implementation)

## Problem

The Inbox subscribes to a Pusher presence channel via `usePusher`, but the hook's
result is discarded and the only bound event (`autoupdate_version`) merely logs in
non-prod. As a result, conversations and messages shown in the Inbox never refresh
in response to real-time activity — the user must remount the view or wait out the
60s React Query `staleTime`.

We want incoming Pusher events to invalidate the relevant React Query caches so the
conversation list and the active conversation/messages refetch automatically.

## Decisions

1. **Event source:** Use the existing `autoupdate_version` event only. Its payload
   (`{ autoupdate_version: number }`) carries no conversation/message identifiers, so
   we treat it as a generic "something changed" signal and refetch broadly. (Richer
   Reamaze events like `message_created` are out of scope for this change.)
2. **Placement:** `usePusher` stays a generic transport hook. It gains an optional
   `onAutoupdate` callback. The invalidation policy lives in the inbox layer (`Inbox`).
3. **Scope + burst handling:** Invalidate everything under the `['reamaze']` query key
   (list + active conversation + messages), debounced ~400ms so a burst of counter
   increments produces a single invalidation.

## Current State (for reference)

- `Inbox` ([app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx]) calls
  `usePusher({ accountId })` and discards the result (`// state unused for now`).
- `usePusher` ([app/src/hooks/usePusher.ts]) subscribes to
  `presence-admin-account-${accountId}` and binds `autoupdate_version` →
  `handleAutoupdateVersion`, which only logs in non-prod.
- Data hooks ([app/src/app/[market]/develop/hooks/useInbox.ts]):
  `useInboxConversations`, `useInboxConversation`, `useInboxConversationMessages`, all
  keyed under `['reamaze', ...]` via [app/src/lib/inbox/constants/queryKeys.ts]
  (`queryKeys.all === ['reamaze']`).
- Precedent: `useSendInboxReply` already calls `queryClient.invalidateQueries` after a
  reply.
- `QueryClientProvider` wraps the tree at [app/src/app/[market]/layout.tsx], so
  `useQueryClient()` is available in `Inbox`.
- No debounce util/library exists; the codebase uses a `setTimeout` + `useRef` +
  cleanup pattern (e.g. `UnifiedSearch.tsx`).

## Component 1 — `usePusher` gains an `onAutoupdate` callback

**Type change** (`app/src/types/pusher.ts`):

```ts
export interface UsePusherOptions {
  accountId?: string;
  onAutoupdate?: (data: AutoupdateVersionPayload) => void;
}
```

**Hook change** (`app/src/hooks/usePusher.ts`): route the callback through a
latest-callback ref so `handleAutoupdateVersion` stays referentially stable. The
subscribe effect depends on `handleAutoupdateVersion`; depending on the caller's
callback identity directly would tear down and rebuild the entire Pusher connection on
every parent re-render. The ref keeps the connection stable while always invoking the
latest callback.

```ts
const onAutoupdateRef = useRef(options.onAutoupdate);
useEffect(() => { onAutoupdateRef.current = options.onAutoupdate; });

const handleAutoupdateVersion = useCallback((data: AutoupdateVersionPayload) => {
  if (isNotProd) {
    logger.info('pusher.event.autoupdate_version', { accountId, version: data.autoupdate_version });
  }
  onAutoupdateRef.current?.(data);
}, [accountId]);
```

## Component 2 — `Inbox` wires events to debounced invalidation

In `Inbox.tsx`, replace the discarded `usePusher({ accountId })` call:

```ts
const queryClient = useQueryClient();
const invalidateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

const handleAutoupdate = useCallback(() => {
  if (invalidateTimeoutRef.current) clearTimeout(invalidateTimeoutRef.current);
  invalidateTimeoutRef.current = setTimeout(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.all }); // ['reamaze']
  }, 400);
}, [queryClient]);

useEffect(() => () => {
  if (invalidateTimeoutRef.current) clearTimeout(invalidateTimeoutRef.current);
}, []);

usePusher({ accountId, onAutoupdate: handleAutoupdate });
```

- `invalidateQueries({ queryKey: ['reamaze'] })` matches every inbox query. React
  Query refetches mounted queries immediately and marks the rest stale so they refetch
  when next observed — the intended "all inbox queries" scope.
- Debounce window: 400ms, using the established `setTimeout` + `useRef` + unmount-cleanup
  pattern.
- `handleAutoupdate` deps `[queryClient]` keep it stable; combined with Component 1's
  ref, the Pusher connection never needlessly reconnects.

## Data Flow

```
Reamaze
  → Pusher channel (presence-admin-account-<accountId>)
    → autoupdate_version event
      → usePusher.handleAutoupdateVersion (logs, calls onAutoupdateRef.current)
        → Inbox.handleAutoupdate (debounce 400ms)
          → queryClient.invalidateQueries(['reamaze'])
            → conversation list + active conversation + messages refetch
```

## Error Handling / Edge Cases

- Connection/auth failures: unchanged — handled inside `usePusher`. No new error surface.
- No events: behavior identical to today.
- Unmount mid-debounce: pending timeout cleared; no invalidation against an unmounted tree.
- `accountId` absent: `usePusher` no-ops (as today); callback never fires.

## Testing

- **usePusher** (`app/src/hooks/usePusher.test.ts`, already has a `trigger` helper):
  - Triggering `autoupdate_version` invokes `onAutoupdate` with the payload.
  - Changing the `onAutoupdate` prop across re-renders does NOT re-subscribe (assert
    `subscribe` called once).
- **Inbox** (jsdom): mock `usePusher` to capture `onAutoupdate`, render with a real
  `QueryClient`, spy on `invalidateQueries`, fire the captured callback rapidly, advance
  fake timers, assert `invalidateQueries` called once with `{ queryKey: ['reamaze'] }`.

## Out of Scope

- Binding additional Reamaze events (`message_created`, `conversation_updated`, etc.).
- Targeted (per-conversation) invalidation.
- Surfacing `usePusher` connection state (`isConnected` / `error`) in the UI.
