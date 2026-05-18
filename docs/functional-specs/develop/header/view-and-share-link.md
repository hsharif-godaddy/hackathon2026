# View & Share Link

**Author:** Rahul Rahate - Director, User Experience  
**Date last updated:** 2026-05-11  
**Version:** Current (v2)

## Overview

A menu button (window icon) that consolidates all ways to access the app. The popover is organized into two sections separated by a divider: **Preview** (private view + public share) and **Published Site**.

**Tooltip:** "See and share"

**Component:** `app/src/app/[market]/develop/components/layout/DomainMenu.tsx`

**Changes:**

- Extend `DomainMenu.tsx` to include share link functionality
- Deprecate/remove `ShareMenu.tsx` after migration
- Group Preview and Share publicly in same section
- Move Published Site below separator

**Feature Flag:** `appbuilder-share-links` (for shareable link feature)

## Wireframe

### Header Icon

```
                                              ┌─────────┐
                                              │   [⧉]   │  ← Window icon (single button)
                                              └────┬────┘     Tooltip: "See and share"
                                                   │
                                                   ▼
```

### Popover (Before Publish)

```
┌───────────────────────────────────────────────┐
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │  Preview Site                        ⧉  │  │  ← Session-authenticated preview
│  │  See your recent edits before publish   │  │     (always available)
│  └─────────────────────────────────────────┘  │
│                                               │
│  Share this link for 7 days                   │  ← Label with countdown
│  ┌───────────────────────────────────────┬─┐  │
│  │ https://preview.app.com/...           │📋│  │  ← Text input + Copy inside
│  └───────────────────────────────────────┴─┘  │
│                                               │
└───────────────────────────────────────────────┘
    Width: 300px
```

### Popover (After Publish)

```
┌───────────────────────────────────────────────┐
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │  Preview Site                        ⧉  │  │  ← Session-authenticated preview
│  │  See your recent edits before publish   │  │     (always available)
│  └─────────────────────────────────────────┘  │
│                                               │
│  Share this link for 7 days                   │  ← Label with countdown
│  ┌───────────────────────────────────────┬─┐  │
│  │ https://preview.app.com/...           │📋│  │  ← Text input + Copy inside
│  └───────────────────────────────────────┴─┘  │
│                                               │
│  ─────────────────────────────────────────────│  ← Separator (only when published)
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │  See Published Site                 ⧉  │  │  ← Production URL
│  │  3 changes since last publish           │  │     (only when published)
│  └─────────────────────────────────────────┘  │
│                                               │
└───────────────────────────────────────────────┘
    Width: 300px
```

### Share Publicly States

The label dynamically shows time remaining: "Share this link for X days/hours/mins"

**Initial state (no token exists):**

```
Share this link for 7 days
┌─────────────────────────────────┬───────┐
│ https://preview.app.com/...     │  📋   │  ← Cosmetic URL preview, Copy icon
└─────────────────────────────────┴───────┘
```

**Creating token (user clicked Copy):**

```
Share this link for 7 days
┌─────────────────────────────────┬───────┐
│ https://preview.app.com/...     │  ⏳   │  ← Spinner while creating
└─────────────────────────────────┴───────┘
```

**Success (token created + copied):**

```
Share this link for 7 days
┌─────────────────────────────────┬───────┐
│ https://preview.app.com?tok=xyz │  ✓    │  ← Real URL, Checkmark
└─────────────────────────────────┴───────┘
```

**After 2 seconds (ready for re-copy):**

```
Share this link for 7 days
┌─────────────────────────────────┬───────┐
│ https://preview.app.com?tok=xyz │  📋   │  ← Copy icon restored
└─────────────────────────────────┴───────┘
```

**Subsequent popover opens (token exists, time elapsed):**

```
Share this link for 6 days
┌─────────────────────────────────┬───────┐
│ https://preview.app.com?tok=xyz │  📋   │  ← Shows remaining time
└─────────────────────────────────┴───────┘
```

**Countdown format logic:**
| Time Remaining | Label Display |
| -------------- | -------------------------------- |
| ≥ 24 hours | "Share this link for X days" |
| < 24 hours | "Share this link for X hours" |
| < 1 hour | "Share this link for X mins" |
| No token yet | "Share this link for 7 days" |

## Link Types

| Link Type          | Icon | Visibility             | TTL              | Auth Required | Purpose                                                  |
| ------------------ | ---- | ---------------------- | ---------------- | ------------- | -------------------------------------------------------- |
| **Preview Site**   | 🔒   | Always (if URL exists) | Session duration | Yes           | Private preview for logged-in owner                      |
| **Share publicly** | 🔗   | Always                 | 7 days           | No            | Public preview for anyone (same content as Preview Site) |
| **Published**      | 🌐   | Only if published      | Permanent        | No            | Public production site                                   |

### 1. Preview Link

The owner's private preview, authenticated via their login session.

| Attribute            | Value                                            |
| -------------------- | ------------------------------------------------ |
| **Label**            | "Preview Site"                                   |
| **Helper text**      | "See your recent edits before they're published" |
| **Source**           | `site.preview_url` from control plane            |
| **Auth**             | Requires active SSO session                      |
| **TTL**              | Valid as long as user is logged in               |
| **Behavior**         | Opens in new tab                                 |
| **When unavailable** | Row hidden                                       |

### 2. Published Link

The public production URL after the app has been published.

| Attribute              | Value                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| **Label**              | "See Published Site"                                                              |
| **Helper text**        | "{X} changes since last publish" (when X=0, show "No changes since last publish") |
| **Source**             | `site.published_url` from control plane                                           |
| **Auth**               | Public (no auth required)                                                         |
| **TTL**                | Permanent (until unpublished)                                                     |
| **Visibility**         | Only visible when published                                                       |
| **When not published** | Hidden (section not shown)                                                        |

**Visibility logic:**

```typescript
// From app/src/utils/site.ts
hasBeenPublished(site) checks:
1. variantsWithLifecycle has variant === 'publish' with status 'active' or 'provisioning'
2. Fallback: variants.includes('publish')
```

### 3. Share Publicly

A publicly accessible preview link for sharing with others (stakeholders, clients, etc.). Points to the same live preview as "Preview Site" but with a token that bypasses authentication.

| Attribute        | Value                                              |
| ---------------- | -------------------------------------------------- |
| **Label**        | "Share publicly"                                   |
| **UI**           | Text input with attached Copy button               |
| **Source**       | `POST /api/apps/[id]/share` → `token.shareUrl`     |
| **Fallback URL** | `${origin}?airoShareToken=${token.token}`          |
| **Auth**         | Public (anyone with link can view)                 |
| **TTL**          | 7 days (fixed)                                     |
| **Limit**        | One active token per app                           |
| **Countdown**    | Shows "X days" to right of label when token exists |

**Token creation:** Lazy — token is created on first Copy click, not on popover open. Subsequent opens fetch existing token.

**Same content as Preview Site:** Both links point to the same live preview container. Share link just appends `?airoShareToken={token}` to bypass SSO. No sync delay — changes are reflected immediately in both.

**TTL & Hibernation:**

- Share link has a fixed 7-day TTL, independent of app lifecycle
- Link remains accessible even when app is in warm hibernation
- Visitors with share link can still view the app during hibernation
- Only expires after 7 days from creation

## States

### Icon States

| State        | Condition                             | When it happens                                                                              |
| ------------ | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Disabled** | No `previewUrl` AND no `publishedUrl` | Initial app creation, provisioning in progress, failed provisioning, or site data incomplete |
| **Enabled**  | Has `previewUrl` OR `publishedUrl`    | Normal operation after app is provisioned                                                    |

### Popover States

| State                | Condition                            | Popover Content                 |
| -------------------- | ------------------------------------ | ------------------------------- |
| **Preview Only**     | Has preview, not published, no share | Preview row only                |
| **Published**        | Has preview + published              | Preview + Published rows        |
| **With Share Token** | Has active share token               | All rows + Copy button + expiry |
| **Creating Token**   | Token creation in progress           | Spinner on share row            |
| **Token Error**      | Failed to create/fetch token         | Error message                   |

### Share Publicly Copy Button States

The Copy button (attached to text input) uses a state machine:

| State        | Condition                   | Icon          | Disabled | Text Input Shows     | Label Shows              |
| ------------ | --------------------------- | ------------- | -------- | -------------------- | ------------------------ |
| **ready**    | No token exists yet         | CopyIcon      | No       | Cosmetic URL preview | "...for 7 days"          |
| **creating** | Token creation in progress  | Spinner       | Yes      | Cosmetic URL preview | "...for 7 days"          |
| **copied**   | Just copied (2s duration)   | CheckmarkIcon | No       | Real URL with token  | "...for X days/hrs/mins" |
| **idle**     | Token exists, ready to copy | CopyIcon      | No       | Real URL with token  | "...for X days/hrs/mins" |
| **error**    | Token fetch/create failed   | CopyIcon      | Yes      | Cosmetic URL preview | "...for 7 days"          |

**State transitions:**

1. `ready` → (click Copy) → `creating` → (success) → `copied` → (2s) → `idle`
2. `idle` → (click Copy) → `copied` → (2s) → `idle`
3. `creating` → (error) → `error`

**Countdown in label:** The label text dynamically shows time remaining:

- No token: "Share this link for 7 days"
- Token exists: "Share this link for X days/hours/mins" (based on expiry)

| Time Remaining | Format                   |
| -------------- | ------------------------ |
| ≥ 24 hours     | "X days" (rounded down)  |
| < 24 hours     | "X hours" (rounded down) |
| < 1 hour       | "X mins" (rounded down)  |

**Error handling:** Errors display via TextInput's `errorMessage` prop (appears as helper text below the input):

| Error                  | i18n Key                          | Message                      |
| ---------------------- | --------------------------------- | ---------------------------- |
| Token creation failed  | `builder_view_share_error_create` | "Couldn't create share link" |
| Clipboard write failed | `builder_view_share_error_copy`   | "Couldn't copy to clipboard" |

```
Share this link for 7 days
┌─────────────────────────────────┬───────┐
│ https://preview.app.com/...     │  📋   │
└─────────────────────────────────┴───────┘
Couldn't create share link                    ← errorMessage prop
```

**Published site sync state** shows one of:

- "..." — Loading
- "Status unavailable" — Query error (`isError: true`)
- "Up to date" — `changesSincePublish === 0 && !hasNeverBeenPublished`
- "{count} changes since last publish" — Out of sync

## Interactions

| Action                     | Result                                                                  |
| -------------------------- | ----------------------------------------------------------------------- |
| Click icon                 | Opens popover                                                           |
| Click "Preview Site"       | Opens `previewUrl` in new tab                                           |
| Click "See Published Site" | Opens `publishedUrl` in new tab                                         |
| Click Copy (no token)      | Creates token → copies to clipboard → shows checkmark → shows countdown |
| Click Copy (token exists)  | Copies to clipboard → shows checkmark (2s) → reverts to copy icon       |
| Click outside popover      | Closes popover                                                          |
| Press Escape               | Closes popover                                                          |

## Data Dependencies

| Data                     | Source                                | Update Trigger             |
| ------------------------ | ------------------------------------- | -------------------------- |
| `site.preview_url`       | Control plane → `useDevelopPageStore` | Page load, site refresh    |
| `site.published_url`     | Control plane → `useDevelopPageStore` | Page load, publish action  |
| `hasBeenPublished(site)` | `app/src/utils/site.ts`               | Derived from site data     |
| Publish sync state       | `useDeploymentsQuery` + git commits   | After publish, after edits |
| Share tokens             | `GET /api/apps/[id]/share`            | Popover open, token create |

**Publish sync state implementation:**
Extract logic from `VersionHistory.tsx` into a shared hook (e.g., `usePublishSyncState`):

- Fetches deployments via `useDeploymentsQuery`
- Finds most recent `DEPLOYED` deployment's `gitHash`
- Compares against current commit list to calculate changes count
- Returns `{ isInSync: boolean, changesSincePublish: number }`

## Analytics Events

| Event                                 | Trigger            | Payload                    |
| ------------------------------------- | ------------------ | -------------------------- |
| `develop.header.view_share.open`      | Popover opened     | `{ appId }`                |
| `develop.header.view_share.preview`   | Preview clicked    | `{ appId }`                |
| `develop.header.view_share.published` | Published clicked  | `{ appId }`                |
| `develop.header.view_share.create`    | Share link created | `{ appId, expiresInDays }` |
| `develop.header.view_share.copy`      | Share link copied  | `{ appId }`                |

## Accessibility

| Element        | Requirement                                             |
| -------------- | ------------------------------------------------------- |
| Icon button    | `aria-label`, `aria-expanded`, `aria-haspopup="dialog"` |
| Popover        | Focus trapped, keyboard dismissible (Escape)            |
| Link rows      | Focusable, Enter to activate                            |
| Copy button    | Focus visible, announces "Copied" to screen readers     |
| External links | `target="_blank"` with `rel="noopener noreferrer"`      |

## Test Scenarios

### Icon & Popover

- [ ] Icon shows window icon (⧉)
- [ ] Popover opens on icon click
- [ ] Popover closes on outside click
- [ ] Popover closes on Escape key
- [ ] Icon disabled when no `previewUrl`

### Preview Link

- [ ] Preview row shows when `previewUrl` exists
- [ ] Preview row hidden when no `previewUrl`
- [ ] Preview click opens correct URL in new tab
- [ ] Preview row shows lock icon indicating auth required

### Published Link

- [ ] Published row shows only when `hasBeenPublished(site)` is true
- [ ] Published row hidden for unpublished apps
- [ ] Published click opens correct URL in new tab
- [ ] Published row shows globe icon indicating public

### Share Publicly

- [ ] Share section hidden when `appbuilder-share-links` flag is off
- [ ] Text input shows cosmetic URL preview when no token exists
- [ ] Copy button shows Copy icon in ready state
- [ ] Click Copy creates token (lazy creation)
- [ ] Spinner shown while creating token
- [ ] Checkmark shown after successful copy (2s duration)
- [ ] Real URL with token populates text input after creation
- [ ] Countdown ("X days") appears to right of label after token exists
- [ ] Checkmark reverts to Copy icon after 2 seconds
- [ ] Subsequent popover opens show real URL + countdown immediately
- [ ] Copy button disabled during token creation
- [ ] Error message shown when token creation fails
- [ ] Error message shown when clipboard write fails
- [ ] 409 (token exists) handled gracefully — fetch and display existing token

### Integration

- [ ] All three link types can coexist
- [ ] State updates reflect across UI immediately
- [ ] Mobile layout maintains functionality
- [ ] Popover positions correctly (align end)

## Edge Cases

### Hibernated App (Warm Hibernation)

Share link continues to work during warm hibernation:

- Share link remains valid (7-day TTL independent of app state)
- Visitors can still access the app via share link
- App stays accessible for share link visitors

### Token Already Exists

- Server returns 409 if active token exists
- UI should fetch and display existing token
- Prevents duplicate token creation

### Clipboard Errors

- `navigator.clipboard.writeText` may fail (permissions, non-HTTPS)
- Log error, don't show "Copied!" feedback
- Consider fallback UI for copy failure

### Session Expiry

- Preview link becomes invalid when session expires
- No special handling needed (standard auth redirect)

## i18n Keys

### New keys (v2)

| Key                                       | Value                                            |
| ----------------------------------------- | ------------------------------------------------ |
| `builder_view_share_tooltip`              | "See and share"                                  |
| `builder_view_share_preview`              | "Preview Site"                                   |
| `builder_view_share_preview_desc`         | "See your recent edits before they're published" |
| `builder_view_share_published`            | "See Published Site"                             |
| `builder_view_share_published_stale`      | "{count} changes since last publish"             |
| `builder_view_share_published_no_changes` | "No changes since last publish"                  |
| `builder_view_share_published_status_unavailable` | "Status unavailable"                     |
| `builder_view_share_link_label_days`      | "Share this link for {count} days"               |
| `builder_view_share_link_label_day`       | "Share this link for 1 day"                      |
| `builder_view_share_link_label_hours`     | "Share this link for {count} hours"              |
| `builder_view_share_link_label_hour`      | "Share this link for 1 hour"                     |
| `builder_view_share_link_label_mins`      | "Share this link for {count} mins"               |
| `builder_view_share_link_label_min`       | "Share this link for 1 min"                      |
| `builder_view_share_error_load`           | "Couldn't load share link"                       |
| `builder_view_share_error_create`         | "Couldn't create share link"                     |
| `builder_view_share_error_copy`           | "Couldn't copy to clipboard"                     |

### Keys to remove (from v1)

| Key                                 | Reason                                      |
| ----------------------------------- | ------------------------------------------- |
| `builder_view_share_title`          | No popover title in v2                      |
| `builder_view_share_published_desc` | Replaced by `_changes` / `_no_changes` keys |
| `builder_view_share_create`         | No "Create share link" button in v2         |
| `builder_view_share_create_desc`    | No helper text for create button in v2      |
| `builder_view_share_copy`           | No "Copy link" button text in v2            |
| `builder_common_copied`             | Checkmark icon used instead of text         |
| `builder_view_share_expires`        | Expiry now in label, not separate           |
| `builder_view_share_error`          | Split into `_error_load` / `_error_create` / `_error_copy` |

## Data Test IDs

| Test ID                       | Element                   |
| ----------------------------- | ------------------------- |
| `header-view-share-button`    | Icon button (trigger)     |
| `header-view-share-popover`   | Popover container         |
| `header-view-share-preview`   | Preview Site row          |
| `header-view-share-published` | See Published Site row    |
| `header-view-share-input`     | Share publicly text input |
| `header-view-share-copy`      | Copy button               |
| `header-view-share-countdown` | Days/hours/mins countdown |
| `header-view-share-error`     | Error message             |

## Migration Notes

Extend `DomainMenu.tsx` to absorb share link functionality from `ShareMenu.tsx`:

| Current                        | New                              |
| ------------------------------ | -------------------------------- |
| Two separate icons in header   | Single window icon (DomainMenu)  |
| Share logic in `ShareMenu.tsx` | Moved into `DomainMenu.tsx`      |
| Domain settings in DomainMenu  | Moved to Settings panel only     |
| Separate analytics events      | Unified `view_share.*` namespace |

**Implementation steps:**

1. Add share link hooks (`useShareTokens`, `useCreateShareToken`) to `DomainMenu.tsx`
2. Add share link UI section to popover
3. Update analytics events to new namespace
4. Remove `ShareMenu.tsx` from Header
5. Delete `ShareMenu.tsx` after verification

**Breaking changes:**

- Removes domain settings shortcut from header
- New analytics event names
