# Inbox Data & Realtime Architecture — Design

**Date:** 2026-06-08
**Status:** Approved (design); open items deferred to planning
**Area:** `app/src/app/[market]/develop/components/preview/` (Inbox)

## Problem

The inbox preview surface is being built. `InboxIframe` currently routes between a
conversation **list** screen and a conversation **detail** screen based on
`activeConversationId`. Two data needs and one realtime need are not yet wired:

1. The list screen needs a paginated list of conversations.
2. The detail screen needs the messages for the selected conversation.
3. Pusher events (already connected via `usePusher`, but currently unused) should
   trigger a refetch of the conversation list while the list is showing, and a
   refetch of messages while a conversation's messages are showing.

The design question driving this spec: **where does data fetching live**, and does
the realtime/refetch requirement change that answer?

## Decision

Fetching lives in the **leaf screens**, not in the `InboxIframe` container. The
Pusher requirement does **not** change this, because React Query decouples the
*refetch trigger* (cache invalidation) from the *fetching component*.

### Component roles

- **`InboxIframe`** — the stable shell. Mounted for the whole inbox session. Owns
  exactly two responsibilities:
  - **Routing/selection state:** holds `activeConversationId` and renders
    `activeConversationId ? <ConversationDetail> : <InboxConversationList>`.
  - **The Pusher connection:** calls `usePusher`, and translates inbox realtime
    events into React Query invalidations.
  - It does **not** fetch list or message data and does **not** hold that data.

- **List screen (`InboxConversationList`)** — calls `useInboxConversations(brandId)`
  internally. Renders list / loading / error / "load more" (paginated via the
  `until` cursor). Receives a single callback prop: `onSelect(conversationId)`.

- **Detail screen (`ConversationDetail`)** — calls
  `useConversationMessages(activeConversationId)` internally. Receives a single
  callback prop: `onBack()`.

### Boundary rule

**Callbacks flow down; fetched data never crosses the boundary.** The only props
into the leaf screens are behavior (`onSelect`, `onBack`). Cross-screen freshness
flows *sideways* through the React Query cache, not through the parent.

## Why fetching stays in the leaves

1. **The two fetches are independent and single-consumer.** The list query is
   needed only by the list screen; the messages query only by the detail screen.
   Colocating fetch-with-render makes each screen a self-contained, independently
   testable unit: give the list a `brandId` and it works; give the detail an `id`
   and it works.

2. **React Query is the sharing/caching mechanism.** Results are keyed by
   `brandId` / `conversationId`. The usual reason to lift fetching up — sharing
   results, avoiding refetch — is already solved by the query cache *without*
   lifting. Returning to the list after viewing a conversation is instant from
   cache.

3. **Lazy detail fetch.** With `AnimatePresence` mounting one branch at a time, the
   messages query fires only when the detail screen actually mounts.

4. **`InboxIframe` stays small and stable.** Adding a field the detail screen needs
   never touches the parent or the list screen.

### Tradeoff named

If the *parent* later needs something only the list's fetched data knows (e.g.
badge counts, scroll-to-selected), this design would push toward a shared hook or
lifting that specific piece. Cross that bridge when a concrete need appears — do
not pre-lift everything now (YAGNI).

## Realtime → refetch

### Connection scope vs fetch scope are independent

`usePusher` opens **one account-scoped channel**
(`presence-admin-account-${accountId}`) and tears it down on unmount. That
connection must live somewhere mounted for the whole inbox session — the leaf
screens mount/unmount as the user navigates, so putting the connection in a leaf
would churn the presence channel (disconnect / re-auth / re-subscribe) on every
open/close. Therefore the **connection lives in `InboxIframe`** regardless of where
fetching lives.

### Invalidation is decoupled from fetching

With React Query, you do not refetch by calling a fetch function — you call
`queryClient.invalidateQueries({ queryKey })`. Invalidation is global: any code
with the `queryClient` can invalidate the conversations key or a messages key, and
React Query refetches **only the queries currently mounted/active**; inactive ones
are marked stale and refetch on next mount.

This makes the "refetch the list *if the list is showing* / refetch messages *if
messages are showing*" logic **free** — there is no conditional to write:

```ts
// in InboxIframe, on a relevant inbox Pusher event:
queryClient.invalidateQueries({ queryKey: queryKeys.inboxConversations(brandId) });
queryClient.invalidateQueries({
  queryKey: queryKeys.inboxConversationMessages(evt.conversationId, brandId),
});
```

If the list screen is mounted, its query refetches now; otherwise it is stale on
next open. Same for the messages query. The messages key is derived from the
**event's** `conversationId`, so the handler does not even need
`activeConversationId`.

### `usePusher` becomes a dumb transport (option i)

`usePusher` currently *swallows* events — it binds `autoupdate_version` internally
and returns only `{ isConnected, isAuthenticating, error }`. To let `InboxIframe`
invalidate on inbox events, `usePusher` must surface them to its consumer via an
`onEvent` handler / event-handler map (and keep returning the same status object).

The inbox-specific knowledge — *which events map to which query keys* — lives in
`InboxIframe`, next to the inbox, **not** inside `usePusher`. This keeps `usePusher`
decoupled from React Query and reusable for other realtime needs.

(Rejected alternative: an inbox-aware `useInboxRealtime` hook that wraps `usePusher`
and does the invalidation itself. Rejected to keep `usePusher` a generic transport.)

## Final shape (summary)

- `InboxIframe`: owns `activeConversationId` (routing) **and** the Pusher connection
  (stable mount) → maps inbox events to `queryClient.invalidateQueries(...)`.
- List screen: `useInboxConversations(brandId)` internally; `onSelect` up.
- Detail screen: `useConversationMessages(id)` internally; `onBack` up.
- Crossing the boundary: callbacks down; query invalidation sideways via the cache.
  No fetched data is drilled.

## Open items (resolve during planning — not blockers)

1. **Pusher event contract:** exact inbox event name(s) and payload shape on the
   `presence-admin-account-${accountId}` channel, and whether the payload carries a
   `conversationId` (needed for the precise messages-key invalidation above).
2. **List pagination mechanism:** keep the existing single-query `until` cursor
   (`useInboxConversations`) with manual "load more", or move to
   `useInfiniteQuery`.
3. **Detail data hook:** naming/signature for the detail screen's
   `useConversationMessages`. The existing `useInboxConversationMessages` carries a
   threaded-children shape we may or may not need on day one.

## Resolved Open Items

### Item 2: List pagination — page-based with `useQuery`

**Decision:** Use server-side page-based pagination (`?page=N`) with a standard
`useQuery`, not `useInfiniteQuery`. The conversation list renders one page at a time
with `@ux/pagination` controls (prev/next) rather than an infinite-scroll
"load more" pattern.

**Rationale:** The Reamaze API returns `page_count` and `page_size` in its response,
making offset-based pagination natural. An infinite/accumulating list would hold
stale conversations in memory across pages and complicate the status filter (which
resets to page 1). Discrete pages keep memory bounded and align with the
`@ux/pagination` component the design system provides.

The `until` cursor parameter is retained in the API route for backward compatibility
but is no longer used by the client for list pagination.

### Item 3: Detail message hook — new `useInfiniteInboxConversationMessages`

**Decision:** Create a new `useInfiniteQuery`-based hook rather than refactoring the
existing `useInboxConversationMessages`.

**Rationale:**

1. **Different query primitive.** The message thread needs reverse-chronological
   infinite scroll (user scrolls up to load older messages). This requires
   `useInfiniteQuery` which accumulates pages and exposes `fetchNextPage` /
   `hasNextPage`. The existing hook uses `useQuery` (single page, caller-managed
   cursor) — a fundamentally different return-type contract.

2. **The existing hook serves a second use case.** `useInboxConversationMessages`
   accepts `childrenFetchData` for fetching threaded child messages (replies to a
   specific parent). This is a distinct query pattern (fetch children of message X)
   that does not fit infinite scroll semantics. Refactoring the existing hook would
   either break this contract or require overloading one hook with two pagination
   strategies.

3. **Separate query keys enable independent cache control.** The infinite query
   accumulates pages keyed by `['reamaze', 'inboxConversationMessagesInfinite', id,
   brandId]`. Invalidation on send-reply clears the accumulated pages without
   affecting any future threaded-children queries that use the original key.

**Cleanup note:** If threaded-children fetching is not needed on the current
surface, the old `useInboxConversationMessages` export and its corresponding
invalidation in `useSendInboxReply` should be removed to avoid dead code.

## Non-goals

- No unrelated refactoring of the existing inbox hooks beyond what this wiring
  requires.
- No new shared/lifted state for cross-screen data unless a concrete need appears.
