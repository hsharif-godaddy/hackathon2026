# Inbox Notification Settings — Design

**Date:** 2026-06-11
**Status:** Approved (pending spec review)

## Problem

`InboxNotificationSettings` currently seeds its two server-backed values from
hardcoded local state:

```ts
const [notificationEmail, setNotificationEmail] = useState('test'); // TODO: Set it based on API request
const [emailNotifications, setEmailNotifications] = useState(true);
```

The toggle handler and the email Save button are `// TODO: Make API call`
placeholders. We need to fetch the real values to seed the panel and wire the
toggle + email edit to persist through Reamaze.

## Reamaze contracts

Host resolution reuses `getReamazeHost()`; base is `https://{brandId}.{host}`.

| Operation | Method / Path | Request body | Response |
| --- | --- | --- | --- |
| Read staff | `GET /api/v2/staff/self` | — | `RemoteStaff` (`{ id, notification_email }`), run through `convertStaff` → `Staff { id: number, notificationEmail }` |
| Update email | `PUT /api/v2/staff/{id}` | `{ notification_email: string }` | updated `RemoteStaff` |
| Read toggle | `GET /api/v2/email_notifications` | — | `{ email_notifications: boolean }` |
| Update toggle | `PUT /api/v2/email_notifications` | `{ email_notifications: boolean }` | `{ email_notifications: boolean }` |

**Assumption to confirm at implementation:** `GET /api/v2/staff/self` is parsed
as `RemoteStaff` (the shape `convertStaff` consumes). If `self` returns the
broader `RemoteUser` without `notification_email`, the transform must be
adjusted.

## Architecture

Mirror the existing inbox pattern: thin BFF proxy routes → React Query hooks in
`useInbox.ts` → component consumes hooks. Two Reamaze resources → two route
folders, matching the existing one-resource-per-folder layout (`conversations/`,
`conversation/`, `messages/`).

*Rejected alternative:* a single combined `notification-settings/` route — the
two endpoints are independent resources with independent cache lifetimes;
combining couples unrelated fetches and muddies invalidation.

### 1. BFF routes (new)

`app/src/app/api/inbox/staff/route.ts`
- `GET ?brandId=` → proxy `GET .../api/v2/staff/self`, return raw `RemoteStaff`.
- `PUT` body `{ brandId, staffId, notificationEmail }` → proxy
  `PUT .../api/v2/staff/{staffId}` with `{ notification_email: notificationEmail }`.

`app/src/app/api/inbox/email-notifications/route.ts`
- `GET ?brandId=` → proxy `GET .../api/v2/email_notifications`, return
  `{ email_notifications }`.
- `PUT` body `{ brandId, emailNotifications }` → proxy
  `PUT .../api/v2/email_notifications` with `{ email_notifications: emailNotifications }`.

Both reuse `withCustomerAuth` (level 1, matching the other inbox routes —
not level-3 operations), `sso-jwt ${authContext.jwt}`, `getReamazeHost()`,
`UUID_RE` brandId validation, `INT_ID_RE` staffId validation, and the same
`.start`/`.success`/`.error`/`.exception` logging + 400/502/passthrough error
handling as `conversations/route.ts`.

*Decision — staff id for the PUT:* the client passes `staffId` (it already holds
the `Staff` from the GET), so the route does not re-fetch `self`.

### 2. Transforms & types

- GET transforms happen client-side in the hook (mirrors `getInboxConversations`
  calling `convertConversation`). `useInboxStaff`'s `queryFn` runs the existing
  `convertStaff`. `email_notifications` → `{ emailNotifications }` is converted
  inline (single boolean, no new transform file).
- Add to `types/inbox/remote/reamaze.ts`: `StaffRequest { brandId }`,
  `UpdateStaffNotificationEmailRequest { brandId, staffId, notificationEmail }`,
  `EmailNotificationsResponse { emailNotifications }`,
  `UpdateEmailNotificationsRequest { brandId, emailNotifications }`.
- Add `RemoteEmailNotifications { email_notifications: boolean }` to remote types.

### 3. React Query hooks (`useInbox.ts`)

- `useInboxStaff(brandId, { enabled })` — GET, `staleTime: 60_000`,
  `enabled: !!brandId && enabled`.
- `useInboxEmailNotifications(brandId, { enabled })` — GET, same options.
- `useUpdateStaffNotificationEmail(brandId)` — `useMutation`, `onSuccess`
  invalidates `inboxStaff`.
- `useUpdateEmailNotifications(brandId)` — `useMutation` with optimistic update
  (flip cached boolean immediately, roll back on error), `onSettled` invalidates.

*Decision — write UX:* toggle is optimistic (a lagging toggle feels broken);
email Save is invalidate-only + success Growl (matches the commented-out
`handleSaveEmail`).

New query keys in `lib/inbox/constants/queryKeys.ts`: `inboxStaff(brandId)`,
`inboxEmailNotifications(brandId)`.

### 4. Component changes

`InboxNotificationSettings.tsx`
- Accept a new `brandId: UuidString` prop; `InboxConversationList` passes its
  `brandId` down.
- Delete the two seeded `useState` (`notificationEmail`, `emailNotifications`).
  Derive both from the query hooks with `enabled: open` (only fetch when the
  popover opens). Cache is the source of truth.
- Keep local UI state only: `view`, `direction`, `panelHeight`, `animateHeight`,
  and a new `draftEmail` (seeded from `staff.notificationEmail` when the edit
  view opens — genuine in-progress-edit state).
- `handleEmailNotificationsToggle` → `updateEmailNotifications.mutate(!emailNotifications)`.
- Email Save → `updateStaffNotificationEmail.mutate({ staffId: staff.id, notificationEmail: draftEmail })`,
  then `navigate('list', -1)` + success Growl.
- **Save button disabled when:** `draftEmail` is unchanged from the current
  `notificationEmail`, OR empty/whitespace, OR the mutation is pending.
- While loading: disable the toggle and show a neutral subtitle; on error the
  toggle stays disabled (no full error view — keep minimal).

### 5. Testing

- Route tests for both files following the existing `route.test.ts` pattern:
  auth-required, `brandId` validation, upstream error → 502 mapping, success
  passthrough, PUT payload shaping.
- Update the inbox settings component test (if present) for the new `brandId`
  prop, hook-driven state, and the Save-disabled-when-unchanged behavior.

## Out of scope

- Real-time sync of settings across tabs/sessions.
- Notification types beyond the single email on/off toggle.
