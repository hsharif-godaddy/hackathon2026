# View & Share Link

## Overview

A menu button (window icon) that consolidates all ways to access the app into three link types: a private session preview (available to anyone whilst the session is active), the published production URL, and a publicly shareable link.

**Component:** `app/src/app/[market]/develop/components/layout/DomainMenu.tsx`

**Changes:**

- Extend `DomainMenu.tsx` to include share link functionality
- Deprecate/remove `ShareMenu.tsx` after migration

**Feature Flag:** `appbuilder-share-links` (for shareable link feature)

## Wireframe

### Header Icon

```
                                              ┌─────────┐
                                              │   [⧉]   │  ← Window icon (single button)
                                              │  View & │
                                              │  Share  │
                                              └────┬────┘
                                                   │
                                                   ▼
```

### Popover

```
┌───────────────────────────────────────────────┐
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │  View Preview                        ⧉  │  │  ← Session-authenticated preview
│  │  Includes your recent edits             │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │  View Published Site                 ⧉  │  │  ← Production URL (active)
│  │  Up to date                             │  │     OR "3 changes since last publish"
│  └─────────────────────────────────────────┘  │
│                                               │
│  ─── OR when not published ──────────────────│
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │  View Published Site                 ⧉  │  │  ← Inactive (opacity-50)
│  │  Publish to activate                    │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  ─────────────────────────────────────────────│  ← Separator
│                                               │
│  Share Preview              [VALID 7 DAYS]   │  ← Title + Tag (tag hidden when token exists)
│  Create a link so anyone can view your       │  ← Helper text (before token)
│  project                                     │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │ [🔗] Create share link                  │  │  ← Secondary button (before token)
│  └─────────────────────────────────────────┘  │
│                                               │
│  ─────────── When share link exists ─────────│
│                                               │
│  Share Preview                               │  ← Title (no tag)
│  Anyone with a link can view                 │  ← Helper text (after token)
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │ [📋] Copy link                          │  │  ← Secondary button
│  └─────────────────────────────────────────┘  │
│  Expires: May 11, 10:30 AM                   │  ← Caption, light gray
│                                               │
└───────────────────────────────────────────────┘
    Width: 300px
```

## Link Types

| Link Type      | Icon | Visibility             | TTL              | Auth Required | Purpose                             |
| -------------- | ---- | ---------------------- | ---------------- | ------------- | ----------------------------------- |
| **Preview**    | 🔒   | Always (if URL exists) | Session duration | Yes           | Private preview for logged-in owner |
| **Published**  | 🌐   | Only if published      | Permanent        | No            | Public production site              |
| **Share Link** | 🔗   | On-demand              | 7 days           | No            | Public preview for anyone           |

### 1. Preview Link

The owner's private preview, authenticated via their login session.

| Attribute            | Value                                 |
| -------------------- | ------------------------------------- |
| **Label**            | "View preview"                        |
| **Helper text**      | "Includes your recent edits"          |
| **Source**           | `site.preview_url` from control plane |
| **Auth**             | Requires active SSO session           |
| **TTL**              | Valid as long as user is logged in    |
| **Behavior**         | Opens in new tab                      |
| **When unavailable** | Row hidden                            |

### 2. Published Link

The public production URL after the app has been published.

| Attribute                  | Value                                                      |
| -------------------------- | ---------------------------------------------------------- |
| **Label**                  | "Visit published app"                                      |
| **Helper text (in sync)**  | "Up to date"                                               |
| **Helper text (stale)**    | "X changes since last publish"                             |
| **Helper text (inactive)** | "Publish app to activate"                                  |
| **Source**                 | `site.published_url` from control plane                    |
| **Auth**                   | Public (no auth required)                                  |
| **TTL**                    | Permanent (until unpublished)                              |
| **Visibility**             | Always visible (disabled if not published)                 |
| **When not published**     | Show disabled with helper text + optional [Publish] button |

**Visibility logic:**

```typescript
// From app/src/utils/site.ts
hasBeenPublished(site) checks:
1. variantsWithLifecycle has variant === 'publish' with status 'active' or 'provisioning'
2. Fallback: variants.includes('publish')
```

### 3. Share Link

A publicly accessible preview link for sharing with others (stakeholders, clients, etc.).

| Attribute        | Value                                          |
| ---------------- | ---------------------------------------------- |
| **Label**        | "Share preview link"                           |
| **Helper text**  | "Anyone with link can view"                    |
| **Source**       | `POST /api/apps/[id]/share` → `token.shareUrl` |
| **Fallback URL** | `${origin}?airoShareToken=${token.token}`      |
| **Auth**         | Public (anyone with link can view)             |
| **TTL**          | 7 days (fixed)                                 |
| **Limit**        | One active token per app                       |

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

### Share Link Button States

The share link button uses a state machine with six states:

| State           | Condition                        | Text                | Icon          | Disabled | Loading |
| --------------- | -------------------------------- | ------------------- | ------------- | -------- | ------- |
| **unavailable** | No `appId` OR tokens fetch error | "Create share link" | LinkIcon      | Yes      | No      |
| **loading**     | Tokens fetching                  | "Loading…"          | —             | Yes      | Yes     |
| **creating**    | Token creation in progress       | "Creating link…"    | —             | Yes      | Yes     |
| **create**      | No active token, ready           | "Create share link" | LinkIcon      | No       | No      |
| **copy**        | Active token exists              | "Copy link"         | CopyIcon      | No       | No      |
| **copied**      | Just copied (2s)                 | "Copied"            | CheckmarkIcon | No       | No      |

State priority (evaluated in order): `unavailable` → `loading` → `creating` → `copied`/`copy` → `create`

**Error states** are shown separately below the button (not as button states):

- `builder_view_share_error_load` — Token fetch failed
- `builder_view_share_error_create` — Token creation failed
- `builder_view_share_error_copy` — Clipboard write failed

**Published site sync state** shows one of:

- "..." — Loading
- "Status unavailable" — Query error (`isError: true`)
- "Up to date" — `changesSincePublish === 0 && !hasNeverBeenPublished`
- "{count} changes since last publish" — Out of sync

## Interactions

| Action                     | Result                                   |
| -------------------------- | ---------------------------------------- |
| Click icon                 | Opens popover                            |
| Click "Preview"            | Opens `previewUrl` in new tab            |
| Click "Published"          | Opens `publishedUrl` in new tab          |
| Click "Share preview link" | Creates token, shows copy UI             |
| Click "Copy share link"    | Copies URL to clipboard, shows "Copied!" |
| Click outside popover      | Closes popover                           |
| Press Escape               | Closes popover                           |

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

### Share Link

- [x] Share section hidden when `appbuilder-share-links` flag is off
- [x] "Create share link" shown when no active token
- [x] "Copy link" shown when active token exists
- [x] Token created successfully on create click
- [x] Link copied to clipboard on copy click
- [x] "Copied" feedback shown for 2 seconds (button remains clickable)
- [x] Expiration date displayed in user's locale
- [x] Expiration is 7 days from creation
- [x] "Loading…" state shown while fetching tokens
- [x] "Creating link…" state shown while creating token
- [x] Button disabled in unavailable/loading/creating states
- [x] Error message shown when token fetch fails
- [x] Error message shown when token creation fails
- [ ] 409 (token exists) handled gracefully

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

| Key                                 | Usage                        |
| ----------------------------------- | ---------------------------- |
| `builder_view_share_title`          | Popover title "View & Share" |
| `builder_view_share_preview`        | "Preview" row label          |
| `builder_view_share_preview_desc`   | "Valid while logged in"      |
| `builder_view_share_published`      | "Published" row label        |
| `builder_view_share_published_desc` | "Your live site"             |
| `builder_view_share_create`         | "Share preview link" button  |
| `builder_view_share_create_desc`    | "Anyone with link can view"  |
| `builder_view_share_copy`           | "Copy share link" button     |
| `builder_common_copied`             | "Copied!" feedback           |
| `builder_view_share_expires`        | "Expires:" label             |
| `builder_view_share_error`          | Error message                |

## Data Test IDs

| Test ID                       | Element                  |
| ----------------------------- | ------------------------ |
| `header-view-share-button`    | Icon button              |
| `header-view-share-popover`   | Popover container        |
| `header-view-share-preview`   | Preview link row         |
| `header-view-share-published` | Published link row       |
| `header-view-share-create`    | Create share link button |
| `header-view-share-copy`      | Copy share link button   |
| `header-view-share-expiry`    | Expiration timestamp     |
| `header-view-share-error`     | Error message            |

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
