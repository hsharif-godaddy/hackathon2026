# Inbox `embeddableId` & `categoryId` Read Pass-Through — Design

**Date:** 2026-06-24
**Status:** Approved

## Problem

The inbox empty-state page (in the inbox list view) will soon render different
variations depending on the app's Reamaze provisioning state — specifically
whether a chat **embeddable** and a contact-form **category** have been created.
Those two values are already written to agents memory by the inbox skill
(`agents/src/skills/inbox/tools/index.ts`) under:

- `integrations.inbox.embeddableId`
- `integrations.inbox.contactFormCategoryId`

but they are **not** surfaced through the read path that the builder UI uses.
Today the GET `/apps/:id/inbox-account` endpoint and the `useInboxAccount` hook
return only `brandId` and `accountId`.

## Goal

Surface `embeddableId` and `categoryId` through the existing read path so they
arrive at the inbox list view (`InboxConversationList`), ready for the future
empty-state variations. **Nothing consumes them yet** — this change is purely
additive plumbing. The variations themselves are out of scope.

## Non-Goals

- No empty-state variation rendering (future work).
- No change to the POST `/apps/:id/inbox-account` backfill — it heals only the
  brand/account pointers and stays as-is.
- No change to discovery/polling/persist logic in `useInboxAccount`.

## Changes

### 1. Endpoint — `agents/src/server/routes/inbox-account.ts` (GET only)

- Add constants mirroring the inbox skill's keys:
  - `MEM_EMBEDDABLE_ID = 'integrations.inbox.embeddableId'`
  - `MEM_CATEGORY_ID = 'integrations.inbox.contactFormCategoryId'`
- Extend the `InboxAccountData` interface with
  `embeddableId: string | null` and `categoryId: string | null`.
- Read both keys via `memory.get`, applying the **same**
  `success` / `exists` / `typeof === 'string'` validation and warn-logging
  pattern already used for `brandId`/`accountId`.
- Add both to the `inboxAccount.route.success` log fields and to the JSON
  response. The 500 error path returns them as `null` as well.

### 2. Hook — `app/src/hooks/useInboxAccount.ts`

- Add `embeddableId` / `categoryId` (`string | null`) to the `InboxAccountData`
  and `UseInboxAccountResult` interfaces.
- Return `null` for both in the no-`appId` branch.
- Derive them from `query.data` (default `null`) and return them alongside
  `brandId`/`accountId`. Discovery query, poll backoff, and persist mutation are
  untouched.

### 3. Store — `app/src/stores/useDevelopPageStore.ts`

- Add state `inboxEmbeddableId: string | null` and
  `inboxCategoryId: string | null` (default `null`), beside `inboxBrandId` /
  `inboxAccountId`.
- Add setters `setInboxEmbeddableId` / `setInboxCategoryId`, mirroring
  `setInboxBrandId` / `setInboxAccountId`.

### 4. Develop page — `app/src/app/[market]/develop/[id]/page.tsx`

- Pull `embeddableId` / `categoryId` from `useInboxAccount`.
- Sync them into the store within the existing inbox sync `useEffect`.

### 5. Props plumbing (mirror the `brandId` path)

`PreviewPane → Inbox → InboxConversationList`

- **PreviewPane** reads `inboxEmbeddableId` / `inboxCategoryId` from the store and
  passes them to **both** `<Inbox>` render sites (the standalone render and the
  canvas-tabs overlay render).
- **Inbox** accepts the two props and forwards them to `InboxConversationList`
  only (the list/empty-state component — **not** the conversation detail view).
- **InboxConversationList** declares `embeddableId` / `categoryId`
  (`string | null`) in `InboxConversationListProps` and receives them via JSX,
  but **does not destructure or use them yet**. This delivers the values to the
  empty-state component while keeping lint clean (no unused-variable error) and
  causing zero behavior change.

## Data Flow

```
memory (agents)
  └─ integrations.inbox.embeddableId / .contactFormCategoryId
       │  GET /apps/:id/inbox-account
       ▼
useInboxAccount  →  { brandId, accountId, embeddableId, categoryId, ... }
       │
       ▼
develop/[id]/page.tsx  →  store.setInboxEmbeddableId / setInboxCategoryId
       │
       ▼
useDevelopPageStore  →  inboxEmbeddableId / inboxCategoryId
       │
       ▼
PreviewPane  →  <Inbox embeddableId categoryId>  →  <InboxConversationList embeddableId categoryId>
                                                       (declared, not yet used)
```

## Types

`embeddableId` and `categoryId` are persisted as strings in memory. They are
modeled as `string | null` throughout (endpoint response, hook, store, props),
matching how `brandId`/`accountId` are typed in the hook and store. The
component props use `string | null` (not the non-null `UuidString` used for
`brandId`) because either value may be absent even when `brandId` is present.

## Testing

- **Endpoint** (`agents/.../__tests__/inbox-account.test.ts`): extend the GET
  cases to assert `embeddableId`/`categoryId` are returned when present, `null`
  when absent or invalid-typed, and `null` on the 500 error path. Add memory
  mock branches for the two new keys.
- **Hook** (`app/src/hooks/useInboxAccount.test.tsx`): update the
  `mockAgentFetch` payload shape to include the new fields; assert the hook
  surfaces them. Existing backfill tests stay valid (they exercise only
  brand/account pointers).

## Backward Compatibility

Additive only. The GET response gains two fields; existing consumers
(`brandId`/`accountId`) are unchanged. Older clients ignore the new fields.
This endpoint is consumed by the agents service via `agentFetch` from the
builder UI; it is not part of the `/api/airo/v1/*` paas contract surface.
