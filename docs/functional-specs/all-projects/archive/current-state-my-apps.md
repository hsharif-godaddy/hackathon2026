# My Apps Page — Current State

**Author:** Rahul Rahate - Director, User Experience  
**Date last updated:** 2026-05-21  
**Version:** Archive (pre-All Projects redesign)

## Overview

The My Apps page displays all apps owned by the authenticated user in a paginated grid. It serves as the central hub for app management, discovery, and navigation.

**Route:** `/[market]/apps`

**Component:** `app/src/app/[market]/apps/page.tsx`

**Related Components:**
- `AppCard.tsx` — Individual app card with actions
- `AppThumbnail.tsx` — Screenshot thumbnail component
- `AcceptTransferDialog.tsx` — Accept incoming transfer
- `TransferInitiateDialog.tsx` — Start outgoing transfer

**Feature Flags:**
- `appbuilder-transfer-ownership` — Transfer feature (initiate, accept, cancel)
- `appbuilder-unpublish` — Unpublish menu item
- `appbuilder-suspended-compliance-banner` — Suspended status tag display

## Wireframe

### Page Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Header with AppSelector dropdown]                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  My Apps                              [Tag: 12 apps]                         │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │                 │  │                 │  │                 │              │
│  │    [+] icon     │  │    [→] icon     │  │  ┌───────────┐  │              │
│  │                 │  │                 │  │  │ thumbnail │  │              │
│  │  Create new app │  │ Accept Transfer │  │  └───────────┘  │              │
│  │                 │  │                 │  │  App Name    [⋮]│              │
│  │                 │  │                 │  │  Created Mar 15 │              │
│  │                 │  │                 │  │  Initial prompt..│              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │  [thumbnail]    │  │  [thumbnail]    │  │  [thumbnail]    │              │
│  │  App Name    [⋮]│  │  App Name    [⋮]│  │  App Name    [⋮]│              │
│  │  Created date   │  │  Created date   │  │  Created date   │              │
│  │  Initial prompt │  │  Initial prompt │  │  Initial prompt │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
│                                                                              │
│                        [  <  1  2  3  >  ]                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### App Card (Standard)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌──────────────────────┐   [SUSPENDED] [PUBLISHED]       [⋮]   │
│  │                      │   App Name                             │
│  │      thumbnail       │   Created Mar 15, 2026                 │
│  │      (screenshot)    │                                        │
│  │                      │   Initial prompt text that             │
│  │                      │   describes what the app does...       │
│  └──────────────────────┘                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
    Desktop: horizontal layout (thumbnail left, content right)
    Mobile: vertical layout (thumbnail top, content bottom)
```

### App Card (Transfer Pending)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                    [TRANSFER PENDING]                            │
│                                                                  │
│                       App Name                                   │
│                                                                  │
│                    Expires May 28, 2026                          │
│                                                                  │
│         [Cancel Transfer]      [Copy Code]                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Kebab Menu (⋮)

```
┌─────────────────────────────┐
│  [✏️] Edit                   │
│  [🌐] Visit Published Site   │  ← Only if published
│  [🔗] Unpublish              │  ← Only if published + flag
│  [👁] Preview                │  ← Only if running
│  ─────────────────────────  │
│  [⚙️] Settings               │
│  [✏️] Rename                 │
│  [↗️] Transfer               │  ← Only if no active transfer
│  ─────────────────────────  │
│  [🗑️] Delete                 │  ← Critical style
└─────────────────────────────┘
```

### Delete Confirmation (Inline)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│            Are you sure you want to delete "App Name"?           │
│                                                                  │
│                   [Delete]     [Cancel]                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
    Overlays entire card content
```

## Card Types

| Card Type | Condition | Position | Contents |
| --------- | --------- | -------- | -------- |
| **Create New** | Always | First | Plus icon + "Create a new app" |
| **Accept Transfer** | `appbuilder-transfer-ownership` flag on | Second | Arrow icon + "Accept Transfer" |
| **App Card** | User has apps | After special cards | Thumbnail + metadata + menu |
| **Transfer Pending** | App has active outgoing transfer | Replaces normal card | Transfer status + actions |

## States

### Page States

| State | Condition | Display |
| ----- | --------- | ------- |
| **Loading** | `isLoading && !isAcceptTransferOpen` | Full-page spinner |
| **Error** | `error` truthy | Error message + "Try Again" button |
| **Empty** | `sites.length === 0` | Create card only |
| **Normal** | Sites loaded | Grid with cards |

### App Card States

| State | Visual Indicator | Source |
| ----- | ---------------- | ------ |
| **Suspended** | Red "SUSPENDED" tag | Compliance check via `shouldShowAppNonCompliantOrAccountComplianceTag` |
| **Published** | Blue "PUBLISHED" tag | `hasBeenPublished(site)` |
| **Error** | Red "ERROR" tag | `SiteStatus.Error` or `SiteStatus.Failed` |
| **Running** | Preview menu item enabled | `SiteStatus.Running` |
| **Transfer Pending** | Special card layout | Active transfer exists |

### Thumbnail States

| State | Condition | Display |
| ----- | --------- | ------- |
| **Loading** | Fetching screenshot | Skeleton |
| **Success** | URL available | Screenshot image |
| **Error/Fallback** | Fetch failed or no URL | Code icon on gray background |

## Interactions

| Action | Result |
| ------ | ------ |
| Click Create card | Navigate to `/` (homepage) |
| Click Accept Transfer card | Open `AcceptTransferDialog` |
| Click App card body | Navigate to `/develop/{id}?siteId={id}` |
| Click kebab menu | Open action menu |
| Click Edit | Navigate to `/develop/{id}` |
| Click Visit Published | Open `published_url` in new tab |
| Click Preview | Open `preview_url` in new tab |
| Click Settings | Navigate to `/develop/{id}?settings=domain&tab=settings` |
| Click Rename | Open rename modal |
| Click Transfer | Validate eligibility → open `TransferInitiateDialog` |
| Click Delete | Show inline confirmation |
| Click Cancel Transfer | Show inline confirmation → cancel transfer |
| Click Copy Code | Copy transfer token to clipboard |
| Change page | Update `appsPage` state → re-slice sites array |

## Data Dependencies

| Data | Source | Update Trigger |
| ---- | ------ | -------------- |
| `sites` | `useSitesStore.allSites` | Page load, `refreshSites()` |
| `isLoading` | `useSitesStore.isLoadingAll` | Sites fetch |
| `error` | `useSitesStore.error` | Sites fetch failure |
| `authState` | `useAuth` | Auth state change |
| `subscription` | `useSubscription` | Subscription fetch |
| Transfer status | `GET /api/apps/{id}/transfer` | Card mount, transfer actions |
| Thumbnail URL | `useAppThumbnail` hook | Card mount |

## Sorting Logic

Apps are sorted in this order:
1. **Running apps first** — `SiteStatus.Running` at top
2. **Then by `updated_at`** — most recently updated first

```typescript
const sortedSites = [...sites].sort((a, b) => {
  const aIsRunning = a.status === SiteStatus.Running;
  const bIsRunning = b.status === SiteStatus.Running;
  if (aIsRunning && !bIsRunning) return -1;
  if (!aIsRunning && bIsRunning) return 1;
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
});
```

## Pagination

| Attribute | Value |
| --------- | ----- |
| **Page Size** | 11 (`APPS_GRID_PAGE_SIZE`) |
| **Rationale** | 11 apps + 1 Create card = 12 total; fits 3×4 (xl), 2×6 (md), 1×12 (sm) |
| **Component** | `@ux/pagination` |
| **Visibility** | Only when `totalSites > APPS_GRID_PAGE_SIZE` |

## Responsive Behavior

| Breakpoint | Grid Columns | Card Layout | Thumbnail Height | Gap |
| ---------- | ------------ | ----------- | ---------------- | --- |
| Default (sm) | 1 | Vertical | 144px | 8px |
| md | 2 | Horizontal | 192px | 12px |
| xl | 3 | Horizontal | 192px | 12px |

```
Grid classes: grid gap-2 md:gap-3 md:grid-cols-2 xl:grid-cols-3
```

## Dialogs

### Rename Dialog

| Attribute | Value |
| --------- | ----- |
| **Component** | `@ux/modal` |
| **Input** | `@ux/text-input` for new name |
| **Validation** | Empty: error, >100 chars: error |
| **Actions** | Cancel, Save (uses `useAppRename` mutation) |

### Transfer Initiate Dialog

| Step | Contents |
| ---- | -------- |
| **Input** | Email input + bullet list of consequences + "Generate Code" button |
| **Token** | 6-char code display + Copy button + "Done" button |

### Accept Transfer Dialog

| Step | Contents |
| ---- | -------- |
| **Input** | 6-char code input + "Accept Transfer" button |
| **Processing** | Spinner + "Transfer in progress" + "Dismiss" button |
| **Error** | Error message + "Try Again" / "Close" buttons |

**Polling:** 3s interval, max 40 attempts (2 min timeout), max 5 consecutive errors

### Unpublish Confirmation Modal

| Attribute | Value |
| --------- | ----- |
| **Component** | `UnpublishConfirmationModal` |
| **Shows** | App name, published URL, domain disconnect option |
| **Actions** | Cancel, Confirm (uses `useUnpublishApp` mutation) |

## Analytics Events

### Impression Events

| Event | Trigger |
| ----- | ------- |
| `apps.page.view` | Page load |
| `apps.transfer.accept_dialog` | Accept dialog opened |
| `apps.transfer.initiate_dialog` | Initiate dialog opened |

### Click Events

| Event | Trigger |
| ----- | ------- |
| `apps.app_list.new_app` | Create card clicked |
| `apps.emptystate.accept_transfer` | Accept Transfer card clicked |
| `apps.app.edit` | App card clicked |
| `apps.app.menu_edit` | Edit menu item clicked |
| `apps.app.view` | Preview menu item clicked |
| `apps.app.visit_published` | Visit Published menu item clicked |
| `apps.app.delete` | Delete menu item clicked |
| `apps.app.rename` | Rename menu item clicked |
| `apps.app.transfer` | Transfer menu item clicked |
| `apps.app.unpublish` | Unpublish menu item clicked |
| `apps.app.cancel_transfer` | Cancel Transfer button clicked |
| `apps.app.copy_transfer_code` | Copy Code button clicked |
| `apps.transfer.initiate_success` | Transfer initiated successfully |
| `apps.transfer.initiate_error` | Transfer initiation failed |
| `apps.transfer.accept_success` | Transfer accepted successfully |
| `apps.transfer.accept_error` | Transfer acceptance failed |
| `apps.transfer.cancel_success` | Transfer cancelled successfully |
| `apps.transfer.cancel_error` | Transfer cancellation failed |

## Accessibility

| Element | Requirement |
| ------- | ----------- |
| App card | `as="button"`, `aria-label` with app name |
| Kebab menu button | `aria-label="Actions"` |
| Delete button | `aria-label` includes app name |
| External links | `target="_blank"` with `rel="noopener noreferrer"` |
| Inline confirmation | Focus management on appear |

## Test Scenarios

### Page Load

- [ ] Shows loading spinner while fetching sites
- [ ] Displays error message with "Try Again" if fetch fails
- [ ] Shows Create card when no apps exist
- [ ] Shows Accept Transfer card when flag enabled
- [ ] Displays apps in correct sort order (running first, then by updated_at)

### App Card

- [ ] Displays thumbnail (screenshot or fallback)
- [ ] Shows status tags (Suspended, Published, Error) when applicable
- [ ] Shows app name (truncated with line-clamp-1)
- [ ] Shows created date formatted
- [ ] Shows initial prompt (truncated with line-clamp-2/3)
- [ ] Navigates to develop page on card click
- [ ] Menu doesn't trigger card navigation

### Kebab Menu

- [ ] Edit navigates to develop page
- [ ] Visit Published opens URL in new tab (only when published)
- [ ] Preview opens URL in new tab (only when running)
- [ ] Unpublish opens confirmation (only when published + flag)
- [ ] Settings navigates to develop page with settings open
- [ ] Rename opens modal
- [ ] Transfer validates then opens dialog (when enabled, no active transfer)
- [ ] Delete shows inline confirmation

### Transfer Flow

- [ ] Transfer Pending card shows for apps with active transfer
- [ ] Cancel Transfer shows confirmation → cancels on confirm
- [ ] Copy Code copies token → shows "Copied!" feedback
- [ ] Accept Transfer dialog validates token format
- [ ] Accept Transfer polls for completion
- [ ] Accept Transfer handles timeout gracefully

### Pagination

- [ ] Hidden when ≤11 apps
- [ ] Shows when >11 apps
- [ ] Page navigation updates displayed cards
- [ ] Resets to valid page when apps deleted

## Edge Cases

### TLA (Three-Letter Account) Handling

- Transfer feature blocked by default while flag loads
- `isTransferEnabled` check: flag value if loaded, otherwise `!isTLA`
- Prevents TLAs from using transfer before flag resolves

### Menu Click Race Condition

- `menuClosedRef` prevents card navigation when menu just closed
- 300ms timeout resets the ref

### Optimistic Unpublish

- `optimisticUnpublished` state hides published URL immediately
- Resets after `fetchAllSites()` completes

### Transfer Validation

- Pre-validates transfer eligibility via `/api/apps/{id}/transfer/validate`
- Blocks commerce-integrated apps with user-facing message

## i18n Keys

| Key | Value |
| --- | ----- |
| `builder_apps_title` | "My Apps" |
| `builder_apps_count` | "{count} apps" |
| `builder_apps_empty_create` | "Create a new app" |
| `builder_apps_created` | "Created {date}" |
| `builder_apps_alert_delete` | "Are you sure you want to delete {siteName}?" |
| `builder_apps_alert_delete_untitled` | "Untitled" |
| `builder_apps_menu_actions` | "Actions" |
| `builder_apps_menu_visit` | "Visit Published Site" |
| `builder_apps_menu_preview` | "Preview" |
| `builder_apps_menu_settings` | "Settings" |
| `builder_apps_menu_delete` | "Delete" |
| `builder_apps_menu_unpublish` | "Unpublish" |
| `builder_apps_rename_title` | "Rename App" |
| `builder_apps_rename_description` | (description text) |
| `builder_apps_rename_label` | "App Name" |
| `builder_apps_rename_placeholder` | (placeholder text) |
| `builder_apps_rename_error_empty` | (empty error) |
| `builder_apps_rename_error_too_long` | (too long error) |
| `builder_apps_rename_error_failed` | (failed error) |
| `builder_apps_rename_saving` | "Saving..." |
| `builder_status_suspended` | "SUSPENDED" |
| `builder_status_published` | "PUBLISHED" |
| `builder_status_error` | "ERROR" |
| `builder_transfer_*` | (transfer-related keys) |
| `builder_common_edit` | "Edit" |
| `builder_common_rename` | "Rename" |
| `builder_common_delete` | "Delete" |
| `builder_common_deleting` | "Deleting..." |
| `builder_common_confirm` | "Confirm" |
| `builder_common_cancel` | "Cancel" |
| `builder_common_try_again` | "Try Again" |

## Data Test IDs

| Test ID | Element |
| ------- | ------- |
| `apps-page-title` | Title row container |
| `create-app-card` | Create new app card |
| `transfer-app-card` | Accept transfer card |
| `app-card-edit-button` | App card (clickable) |
| `app-card-menu-button` | Kebab menu button |
| `app-card-view-button` | Preview menu item |
| `app-card-delete-button` | Delete menu item |
| `app-card-transfer-button` | Transfer menu item |
| `app-card-unpublish-button` | Unpublish menu item |
| `app-card-cancel-transfer-button` | Cancel transfer button |
| `app-card-copy-code-button` | Copy code button |
| `inline-confirmation` | Delete/cancel confirmation overlay |
| `confirm-button` | Confirmation button |
| `transfer-blocked-reason` | Transfer blocked error message |
| `app-thumbnail` | Thumbnail with screenshot |
| `app-thumbnail-loading` | Thumbnail skeleton |
| `app-thumbnail-fallback` | Thumbnail fallback icon |

## Files

```
app/src/app/[market]/apps/
├── page.tsx                    # Main page component
├── page.test.tsx               # Page tests
├── layout.tsx                  # Layout wrapper
├── AppCard.tsx                 # App card + empty states + transfer pending
├── AppCard.test.tsx            # Card tests
├── AppThumbnail.tsx            # Thumbnail component
├── AppThumbnail.test.tsx       # Thumbnail tests
├── constants.ts                # APPS_GRID_PAGE_SIZE = 11
└── components/
    ├── AcceptTransferDialog.tsx
    ├── TransferInitiateDialog.tsx
    ├── PendingTransfers.tsx
    ├── transfer-constants.ts   # TRANSFER_TOKEN_LENGTH, TRANSFER_TOKEN_PATTERN
    └── __tests__/
```

## Related Components

| Component | Location | Purpose |
| --------- | -------- | ------- |
| `AppSelector` | `components/layout/AppSelector.tsx` | Header dropdown showing recent 5 apps |
| `AppItem` | `components/layout/AppItem.tsx` | Dropdown list items |
| `UnpublishConfirmationModal` | `components/layout/UnpublishConfirmationModal.tsx` | Unpublish confirmation |
| `DevelopmentAdminSection` | `components/development/` | Dev-only bulk actions (Stop All, Delete All) |
