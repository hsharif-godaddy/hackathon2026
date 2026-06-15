# Inbox Unread Badge — Design

**Date:** 2026-06-15
**Status:** Approved (pending spec review)

## Summary

Add an unread-conversation count badge to the Inbox button in the develop-page
header. The count is sourced from Reamaze's server-side unread filter and stays
fresh in real time. To support an always-visible badge, the Pusher subscription
(today scoped to the open Inbox view) is hoisted to the develop-page level so it
runs for the whole builder session.

## Behavior (decided)

- **Badge style:** numeric unread count, capped at `99+`. Hidden when count is 0.
- **Clearing:** badge reflects Reamaze server truth only. Opening the inbox view
  does NOT mark conversations read upstream and does NOT clear the badge on its
  own; the count drops only when conversations are actually marked read in
  Reamaze (and the next refetch lands).
- **Freshness:** initial fetch on mount + refetch on Pusher `autoupdate_version`
  event + refetch on window focus (safety net for dropped/missed events).

## Upstream contract

`GET /api/v2/conversations?counts_only=true&filter=unread` on the Reamaze brand
host returns:

```json
{ "total_count": <number> }
```

## Architecture

Four units, each with a single responsibility:

| Unit | File | Responsibility |
|---|---|---|
| Counts BFF route | `app/src/app/api/inbox/conversations/counts/route.ts` (new) | Proxy `counts_only=true&filter=unread` to Reamaze; same auth/validation shape as the existing conversations route. |
| Data hook | `useInboxUnreadCount(brandId)` in `app/src/app/[market]/develop/hooks/useInbox.ts` | React Query hook returning the unread number; gated on `brandId`. |
| Realtime hook | `useInboxRealtime({ accountId })` in `app/src/app/[market]/develop/hooks/useInboxRealtime.ts` (new) | Owns the single `usePusher` subscription + debounced `invalidateQueries(['reamaze'])`. Called once in `page.tsx`. |
| Badge UI | Inbox `ButtonGroup.Item` in `app/src/app/[market]/develop/components/layout/Header.tsx` (line ~207) | Overlay the capped count when `> 0`. |

### Subscription hoisting / dedupe

Today `usePusher` is called inside `Inbox.tsx` (line 62), which only mounts when
`viewMode === ViewMode.INBOX`. The debounced invalidation lives in
`Inbox.tsx:43–59`.

This logic **moves into `useInboxRealtime`**:

- `Inbox.tsx` drops its `usePusher` call and the debounce ref — it becomes purely
  presentational with respect to realtime.
- `useInboxRealtime` is called once at the page level, guaranteeing exactly one
  live subscription to `presence-admin-account-${accountId}`.

**Deliberate tradeoff:** hoisting means inbox-enabled users hold a live Pusher
connection for the whole builder session (previously only while the inbox was
open). This is required for an always-visible badge. It is gated on
`isInboxEnabled && accountId`, so users without the feature open no connection.

## Data flow

```
page.tsx (DevelopPageContent)
  ├─ useInboxAccount(appId) → { brandId, accountId }     [exists, line 264]
  ├─ isInboxEnabled = useSwitchboard('app-builder-inbox-button')  [exists, line 274]
  └─ useInboxRealtime({ accountId: isInboxEnabled ? accountId : undefined })   [NEW]
         └─ usePusher({ accountId, onAutoupdate })
               └─ on 'autoupdate_version' → debounce 400ms → invalidateQueries(['reamaze'])

Header.tsx
  └─ useInboxUnreadCount(brandId)   [NEW]  → badge on inbox ButtonGroup.Item
         └─ GET /api/inbox/conversations/counts?brandId=…
               → Reamaze /api/v2/conversations?counts_only=true&filter=unread
```

### Key mechanics

- `useInboxUnreadCount` uses a new query key `queryKeys.inboxUnreadCount(brandId)`
  rooted under `['reamaze']` (see `app/src/lib/inbox/constants/queryKeys.ts`), so
  the existing `autoupdate` invalidation sweeps it automatically — no special
  wiring.
- Freshness: `enabled: !!brandId` (initial fetch); `refetchOnWindowFocus: true`
  (focus safety net); Pusher `autoupdate` invalidation (real-time).
  `staleTime: 60_000` to match sibling inbox hooks and avoid focus-refetch thrash.
- Gating: `useInboxRealtime` receives `accountId` only when `isInboxEnabled`. The
  badge query is gated on `brandId` (same condition that renders the button).
- Response handling: the hook reads `data.total_count`, coerces to a number, and
  defaults to `0` on missing/malformed so the badge fails closed (no badge)
  rather than throwing.

## Error handling

- **Route:** mirror `app/src/app/api/inbox/conversations/route.ts` exactly —
  `withCustomerAuth`, 401 when no `authContext.jwt`, 400 on invalid/missing
  `brandId` UUID, `null`-safe upstream `fetch` → 502, non-`ok` upstream → pass
  through status, parse failure → 502. Log
  `inbox.unread_count.fetch.{start,success,error}`.
- **Hook:** `retry: failureCount < 3` like siblings. On error the result is
  unused → no badge; never block or toast for a passive badge. `total_count`
  missing or non-numeric → `0`.
- **Realtime:** `usePusher` swallows auth/subscription errors internally and
  exposes them via return state; `useInboxRealtime` ignores them. If the socket
  never connects, the badge degrades to initial + focus refetch.

## Testing

- **Route test** (`node` env, alongside existing inbox route tests): auth-required
  401, bad-brandId 400, happy path returns `{ total_count }`, upstream 5xx/parse
  failures → 502/passthrough. Mock `fetch`.
- **`useInboxUnreadCount` test:** returns count on success; coerces missing/garbage
  `total_count` to 0; disabled when `brandId` falsy.
- **`useInboxRealtime` test:** wires `usePusher`; an `autoupdate` callback triggers
  a debounced `invalidateQueries(['reamaze'])` (mock `usePusher` + `queryClient`).
- **Header test / E2E:** badge renders when count > 0, shows `99+` above the cap,
  hidden at 0. Add `data-testid="inbox-unread-badge"`; update matching specs in
  `tests/e2e-v2/` and `tests/regression/` if they touch the inbox button.
- **Regression:** confirm `Inbox.tsx` still refetches on `autoupdate` after its own
  `usePusher` call is removed (now driven by the hoisted hook) — verify the
  invalidation still reaches the mounted inbox queries.

## Out of scope

- Marking conversations read upstream (no mark-read endpoint changes).
- Optimistic clearing on inbox open.
- Interval polling.
- Per-message or client-side read tracking.
