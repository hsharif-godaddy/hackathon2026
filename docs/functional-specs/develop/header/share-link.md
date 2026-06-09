# Share Link

**Author:** Rahul Rahate - Director, User Experience | Elena Nelmes - Lead UX Engineer
**Date last updated:** 2026-06-08
**Version:** Current (v4.0)

## Overview

A header button (link icon) that consolidates ways to access the app. Uses a segmented controller to switch between Published and Preview segments (when published). The Preview segment always shows a shareable 7-day token link — no access-level dropdown.

**Tooltip:** `builder_share_link_tooltip`

**Component:** `app/src/app/[market]/develop/components/layout/ShareLink.tsx`

**Feature Flag:** `appbuilder-share-links` (gates share token creation)

## Segment Structure

Uses `SegmentedController` from `@airo-ux/pattern-library` for segment switching (Published / Preview). Only shown when the app has been published.

| Segment | Icon | Shown When | Description |
|---------|------|------------|-------------|
| **Published** | WorldIcon | Site has been published | Live production URL with sync status |
| **Preview** | ShowIcon | Always (default when not published) | Shareable preview link (7-day token) |

**Default segment:** Published (if published), otherwise Preview only (no segmented controller shown)

**Segment order:** Published → Preview

## Preview Link Behavior

The Preview segment always shows a token-based shareable link. A 7-day token is automatically created when the popover opens on the Preview segment. No access-level dropdown; the link is always shareable by anyone with the URL.

| Action | Result |
|--------|--------|
| Popover opens on Preview segment | Token auto-created (if none active) |
| Token expires (popover closed) | Next open triggers new token creation |
| Token expires (popover open) | `ShareAccessInfo` fires `onExpired` → spinner shown → new token auto-created |
| 409 conflict on create | Refetch tokens (another tab may have created one) |

### Token Expiry Auto-Recreation

When a token expires while the popover is open on the Preview segment, the component automatically creates a replacement token. The flow is:

1. `ShareAccessInfo` timer reaches zero → calls `onExpired` callback
2. Parent sets `tokenExpired` state flag → `activeToken` becomes `undefined`
3. `shareUrl` clears, loading spinner appears
4. Auto-create effect detects no active token → mints new 7-day token
5. New token arrives in React Query cache → `tokenExpired` flag clears (via `useEffect` on `tokens`)
6. New token URL and expiry label appear

The `tokenExpired` flag is reset when the `tokens` data changes (new token created) and when the popover opens.

### Share Access Info

When an active token exists, a `ShareAccessInfo` renders below the URL input showing "Anyone with the link can access · Link expires in N [days/hours/mins]". Returns `null` when there is no valid expiry to display.

| Time Remaining | Format | i18n Key |
|----------------|--------|----------|
| >= 24 hours | "{count} days" | `builder_share_link_expires_days` (ICU plural) |
| >= 1 hour | "{count} hours" | `builder_share_link_expires_hours` (ICU plural) |
| < 1 hour | "{count} mins" | `builder_share_link_expires_mins` (ICU plural) |
| Expired | Fires `onExpired`, returns null | — |

**Update frequency:** Every hour when >= 1 day remaining, every minute otherwise.

**Expiry detection:** The timer tick checks `Date.now() >= expiresAt` and immediately calls `onExpired` + clears the timeout. If the component mounts with an already-expired timestamp, `onExpired` fires on mount.

## Wireframes

### Before Publish (No Segments)

```
┌─────────────────────────────────────────────┐
│                                             │
│  Preview                                    │
│  (preview status text)                      │
│  ─────────────────────────────────────────  │
│  ┌─────────────────────────────┬────┬────┐  │
│  │ https://share.airo.../abc   │copy│open│  │
│  └─────────────────────────────┴────┴────┘  │
│  Anyone with the link can access ·          │
│  Link expires in 6 days                     │
│                                             │
│  (QR code section)                          │
│                                             │
└─────────────────────────────────────────────┘
    Width: 320px
```

### Before Publish - Loading (Creating Token)

```
┌─────────────────────────────────────────────┐
│                                             │
│  Preview                                    │
│  (preview status text)                      │
│  ─────────────────────────────────────────  │
│                                             │
│              (spinner)                      │
│                                             │
└─────────────────────────────────────────────┘
```

### After Publish - Published Segment (Default)

```
┌─────────────────────────────────────────────┐
│  ┌───────────────────┬──────────────────┐   │
│  │ [world] Published │ [eye] Preview    │   │
│  └───────────────────┴──────────────────┘   │
│                                             │
│       (published sync status text)          │
│  ─────────────────────────────────────────  │
│  ┌─────────────────────────────┬────┬────┐  │
│  │ https://myapp.example.com   │copy│open│  │
│  └─────────────────────────────┴────┴────┘  │
│                                             │
│  (QR code section)                          │
│                                             │
└─────────────────────────────────────────────┘
```

### After Publish - Preview Segment

```
┌─────────────────────────────────────────────┐
│  ┌───────────────────┬──────────────────┐   │
│  │ [world] Published │ [eye] Preview    │   │
│  └───────────────────┴──────────────────┘   │
│                                             │
│         (preview status text)               │
│  ─────────────────────────────────────────  │
│  ┌─────────────────────────────┬────┬────┐  │
│  │ https://share.airo.../abc   │copy│open│  │
│  └─────────────────────────────┴────┴────┘  │
│  Anyone with the link can access ·          │
│  Link expires in 6 days                     │
│                                             │
│  (QR code section)                          │
│                                             │
└─────────────────────────────────────────────┘
```

### Error State (Token Creation/Load Failed)

```
┌─────────────────────────────────────────────┐
│                                             │
│  (header / segments as appropriate)         │
│  (status text)                              │
│  ─────────────────────────────────────────  │
│                                             │
│  [!] Failed to create link. Try again       │
│                                             │
└─────────────────────────────────────────────┘
```

## Behavior Summary

| State | Segmented Controller | Status Text | URL in Input |
|-------|---------------------|-------------|--------------|
| Before publish | Hidden | Latest preview | Token URL |
| After publish, Published segment | Shown | Sync status (centered) | Published URL |
| After publish, Preview segment | Shown | Sync-aware preview status (centered) | Token URL |

## Status Text Logic

### Published Segment

| Condition | i18n Key |
|-----------|----------|
| Sync error | `builder_share_link_published_last_version` |
| In sync (0 changes) | `builder_share_link_published_in_sync` |
| Out of sync | `builder_share_link_published_stale` (`{count}` changes) |

### Preview Segment

| Condition | i18n Key |
|-----------|----------|
| Not published | `builder_share_link_preview_latest` |
| Published + out of sync or error | `builder_share_link_preview_unpublished` |
| Published + in sync | `builder_share_link_preview_matches` |

**Text alignment:** Centered when the app has been published (both segments show centered text), left-aligned before publish.

## QR Code Section

- **Visible** on desktop only (hidden when `isMobile` is true)
- **Hidden** during loading and error states
- **Encodes the same URL** as the copy input, with `?ref=qr` appended
- **Library:** `qrcode.react` (`QRCodeSVG` component, size 128, level M)
- **Caption:** `builder_share_link_qr_text`

### Layout

```
┌─────────────────────────────────┐
│          ┌───────────┐          │
│          │  QR Code  │          │
│          │  128x128  │          │
│          └───────────┘          │
│ Scan to view on a mobile device │
└─────────────────────────────────┘
```

- QR code, centered
- Caption text below QR code, centered

## Link Types

| Link Type | Auth Required | TTL | Purpose |
|-----------|---------------|-----|---------|
| Preview (token) | No (token in URL) | 7 days (auto-recreated on expiry) | Shareable preview link for anyone |
| Published | No | Permanent | Public production site |

## States

### Trigger Button States

| State | Condition |
|-------|-----------|
| Disabled | No `previewUrl` AND not published |
| Enabled | Has `previewUrl` OR has been published |

### Copy Button States

| State | Icon | Trigger |
|-------|------|---------|
| ready | CopyIcon | Default |
| copied | CheckmarkIcon | After successful copy (resets after 2s) |

## Interactions

| Action | Result |
|--------|--------|
| Click trigger icon | Opens/closes popover (logs `share_link.open` only on open) |
| Click segment | Switches segment content, resets copied state |
| Click Copy button | Copies URL to clipboard, shows checkmark for 2s |
| Click Open button | Opens URL in new tab (appends `?airoPreview=1` for preview URLs when `appbuilder-preview-header` flag is on) |
| Click outside popover | Closes popover |
| Press Escape | Closes popover |
| Popover opens | Resets all state (copied, error, retry count, tokenExpired, segment → published if published) |
| Token expires while open | Access info disappears, spinner shows, new token auto-created, fresh URL and access info reappear |

## Data Dependencies

| Data | Source |
|------|--------|
| `site.preview_url` | Control plane → `useDevelopPageStore` |
| `site.published_url` | Control plane → `useDevelopPageStore` |
| `hasBeenPublished(site)` | `@/utils/site` |
| `isMobile` | `useDevelopPageStore` |
| Publish sync state | `usePublishSyncState` (deployments + git history) |
| Share tokens | `useShareTokens` → `GET /api/apps/[id]/share` |
| Token creation | `useCreateShareToken` → `POST /api/apps/[id]/share` |

## Analytics Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `{location}.share_link.open` | Popover opened | `{ appId }` |
| `{location}.share_link.tab_switch` | Segment changed | `{ appId, tab }` |
| `{location}.share_link.copy` | URL copied | `{ appId, type: 'published' \| 'preview' }` |
| `{location}.share_link.open_url` | Open in new tab clicked | `{ appId, type: 'published' \| 'preview' }` |
| `{location}.share_link.retry` | Retry clicked after error | `{ appId }` |

`{location}` defaults to `'develop'`, passed as prop.

## Accessibility

| Element | Requirement |
|---------|-------------|
| Trigger button | `aria-label` (tooltip text), `aria-expanded`, `aria-haspopup="dialog"` |
| Popover | Focus trapped, keyboard dismissible (Escape) |
| Segmented controller | `aria-label` for the controller group |
| Copy button | Focus visible, tooltip label changes to "Copied" |
| Open in new tab | `target="_blank"` with `rel="noopener noreferrer"` |

## Test Scenarios

### Trigger & Popover

- [ ] Trigger shows link icon
- [ ] Popover opens on trigger click
- [ ] Popover closes on outside click
- [ ] Popover closes on Escape key
- [ ] Trigger disabled when no preview URL and not published
- [ ] Analytics event fires only on open, not on close

### Segments

- [ ] No segmented controller shown before publish
- [ ] Segmented controller shown after publish
- [ ] Published segment active by default when published
- [ ] Segment switching works correctly
- [ ] Copied state resets on segment switch

### Preview Content

- [ ] Token auto-created when popover opens on Preview segment
- [ ] Token URL shown when active token exists
- [ ] Loading spinner shown during token creation
- [ ] Error state shown with retry on token creation failure
- [ ] Error state shown when token list fetch fails
- [ ] Retry button refetches tokens or retries creation
- [ ] 409 conflict triggers token refetch instead of error

### Token Expiry

- [ ] Access info shows when active token exists
- [ ] Access info hidden during loading/error
- [ ] Timer updates at correct frequency (hourly for days, minutely for hours/mins)
- [ ] Token expiry while popover open triggers auto-recreation (spinner → new token)
- [ ] `tokenExpired` flag clears when new token data arrives
- [ ] `tokenExpired` flag resets on popover open

### Copy & Open

- [ ] Copy button copies URL to clipboard
- [ ] Checkmark shown after copy (2s)
- [ ] Works in both Published and Preview segments
- [ ] Open button opens URL in new tab
- [ ] Preview URLs append `?airoPreview=1` when `appbuilder-preview-header` flag is on

### QR Code

- [ ] QR code visible on desktop
- [ ] QR code hidden on mobile
- [ ] QR code hidden during loading/error
- [ ] QR code encodes correct URL with `?ref=qr`
- [ ] QR code updates when URL changes

### Published Segment

- [ ] Shows sync status text
- [ ] Shows published URL in input
- [ ] Handles sync error gracefully

## i18n Keys

| Key | Purpose |
|-----|---------|
| `builder_share_link_tooltip` | Trigger button tooltip |
| `builder_common_preview` | Title shown before publish |
| `builder_share_link_segment_label` | Segmented controller aria-label |
| `builder_common_published` | Published segment label |
| `builder_common_preview` | Preview segment label |
| `builder_share_link_expires_days` | "Link expires in {count, plural, one {# day} other {# days}}" |
| `builder_share_link_expires_hours` | "Link expires in {count, plural, one {# hour} other {# hours}}" |
| `builder_share_link_expires_mins` | "Link expires in {count, plural, one {# min} other {# mins}}" |
| `builder_share_link_published_last_version` | Sync error status text |
| `builder_share_link_published_in_sync` | In sync status text |
| `builder_share_link_published_stale` | Out of sync status text (`{count}` changes) |
| `builder_share_link_preview_latest` | Preview status when not published |
| `builder_share_link_preview_unpublished` | Preview status when out of sync |
| `builder_share_link_preview_matches` | Preview status when in sync |
| `builder_share_link_copy` | Copy button label |
| `builder_share_link_copied` | Copied button label |
| `builder_common_open_new_tab` | Open in new tab button label |
| `builder_share_link_qr_text` | QR code caption |
| `builder_share_link_error_load` | Token list load error |
| `builder_share_link_error_create` | Token creation error |
| `builder_common_try_again` | Retry button text |

## Data Test IDs

| Test ID | Element |
|---------|---------|
| `share-link-button` | Trigger button |
| `share-link-popover` | Popover container |
| `share-link-segment` | Segmented controller |
| `share-link-published-content` | Published segment content wrapper |
| `share-link-preview-content` | Preview segment content wrapper |
| `share-link-access-info` | Access scope and token expiry info |
| `share-link-input` | URL input field frame |
| `share-link-copy` | Copy button |
| `share-link-open` | Open in new tab button |
| `share-link-qr` | QR code |
| `share-link-published-loading` | Published segment loading spinner |
| `share-link-preview-loading` | Preview segment loading spinner |
| `share-link-error-state` | Error state container |

## Key Changes from v3.1

1. **Removed access-level dropdown** — no more Private/Public toggle; preview is always a shareable token link
2. **Removed `PreviewLinkDropdown` component** — along with `LockedIcon`, `ChevronDownIcon` imports
3. **Removed `TokenExpiryStatus` component** — replaced by `ShareAccessInfo` that renders access scope and expiry text
4. **Token auto-creates on popover open** — no longer gated behind selecting "Public"
5. **Analytics events simplified** — copy/open type is `'preview'` (not `'public'`/`'private'`)
6. **Status text alignment** — centered when published (both segments), left-aligned before publish
7. **Removed test IDs** — `share-link-access-level`, `share-link-access-level-trigger`, `share-link-access-level-private`, `share-link-access-level-public`, `share-link-token-expiry`
8. **New test ID** — `share-link-access-info` for the access/expiry info
9. **New i18n key** — `builder_share_link_anyone_can_access` for the access scope label in `ShareAccessInfo`
