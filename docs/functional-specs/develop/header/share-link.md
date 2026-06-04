# Share Link

**Author:** Rahul Rahate - Director, User Experience | Elena Nelmes - Lead UX Engineer
**Date last updated:** 2026-06-03
**Version:** Current (v3)

## Overview

A header button (link icon) that consolidates ways to access the app. Uses a segmented controller to switch between Published and Preview segments (when published), and an access-level dropdown within the Preview segment to control Public vs Private preview access.

**Tooltip:** `builder_share_link_tooltip`

**Component:** `app/src/app/[market]/develop/components/layout/ShareLink.tsx`

**Feature Flag:** `appbuilder-share-links` (gates the Public access-level option and share token creation)

## Segment Structure

Uses `SegmentedController` from `@airo-ux/pattern-library` for segment switching (Published / Preview). Only shown when the app has been published.

| Segment | Icon | Shown When | Description |
|---------|------|------------|-------------|
| **Published** | WorldIcon | Site has been published | Live production URL with sync status |
| **Preview** | ShowIcon | Always (default when not published) | Preview URL with optional public/private access |

**Default segment:** Published (if published), otherwise Preview only (no segmented controller shown)

**Segment order:** Published → Preview

## Access Level Dropdown (Preview segment)

Within the Preview segment, a dropdown (`PreviewLinkDropdown`) controls whether the preview link is private (session-only) or public (shareable 7-day token). Only shown when `appbuilder-share-links` flag is enabled.

| Option | Icon | Description |
|--------|------|-------------|
| **Private** | LockedIcon | Only you can access (requires GoDaddy SSO session) |
| **Public** | WorldIcon | Temporary link anyone can access — auto-creates 7-day token on selection |

**Default:** Private (resets each time the popover opens)

### Access Level Behavior

| Action | Result |
|--------|--------|
| Select "Public" | Token created (if none exists), URL switches to token URL |
| Select "Private" | URL switches to session URL, token NOT deleted |
| Token expires (popover closed) | Next time user selects "Public", auto-creates a new token |
| Token expires (popover open) | `TokenExpiryStatus` fires `onExpired` → `tokenExpired` flag set → spinner shown → new token auto-created |
| 409 conflict on create | Refetch tokens (another tab may have created one) |

**Note:** Switching to Private does NOT delete or invalidate the token. The token remains valid until expiry. This is intentional — the user may want to temporarily hide the link without invalidating URLs already shared.

### Token Expiry Auto-Recreation

When a public token expires while the popover is open with "Public" selected, the component automatically creates a replacement token. The flow is:

1. `TokenExpiryStatus` countdown reaches zero → calls `onExpired` callback
2. Parent sets `tokenExpired` state flag → `activeToken` becomes `undefined`
3. `shareUrl` clears, loading spinner appears
4. Auto-create effect detects no active token → mints new 7-day token
5. New token arrives in React Query cache → `tokenExpired` flag clears (via `useEffect` on `tokens`)
6. New token URL and countdown appear

The `tokenExpired` flag is reset when the `tokens` data changes (new token created) and when the popover opens.

### Dropdown Trigger vs Menu

The dropdown trigger shows only the selected option's **icon and label** (single line, compact). Descriptions are only shown inside the dropdown menu when it is open, providing clarification on what Private/Public means during selection.

### Token Expiry Countdown

When "Public" is selected and an active token exists, a separate `TokenExpiryStatus` info banner appears between the dropdown and the divider. Rendered as a subtle rounded container with a `ClockIcon` and the countdown text, visually distinct from the dropdown to make it clear this is a status about the link, not part of the access-level selector.

**Props:** `expiresAt` (timestamp), `onExpired` (callback when countdown reaches zero), `t` (translation function)

| State | Expiry status shown |
|-------|---------------------|
| Private selected | Hidden (component not rendered) |
| Public selected, no token yet | Hidden (spinner shown instead) |
| Public selected, active token | "Expires in X days/hours/mins" |
| Public selected, token expired | Component fires `onExpired`, returns null → auto-recreation begins |

**Countdown format:**

| Time Remaining | Format | i18n Key |
|----------------|--------|----------|
| >= 24 hours | "Expires in {count} days" | `builder_share_link_expires_days` (ICU plural) |
| >= 1 hour | "Expires in {count} hours" | `builder_share_link_expires_hours` (ICU plural) |
| < 1 hour | "Expires in {count} mins" | `builder_share_link_expires_mins` (ICU plural) |
| Expired | Fires `onExpired`, returns null | — |

**Update frequency:** Every hour when >= 1 day remaining, every minute otherwise.

**Expiry detection:** The interval tick checks `Date.now() >= expiresAt` and immediately calls `onExpired` + clears the interval. If the component mounts with an already-expired timestamp, `onExpired` fires on mount.

## Wireframes

### Before Publish (No Segments) - Private (Default)

```
┌─────────────────────────────────────────────┐
│                                             │
│  Preview                                    │
│  (preview status helper text)               │
│                                             │
│  Access level                               │
│  ┌────────────────────────────────────────┐ │
│  │ [lock] Private                     v   │ │
│  └────────────────────────────────────────┘ │
│  ─────────────────────────────────────────  │
│                                             │
│  ┌─────────────────────────────┬────┬────┐  │
│  │ https://preview.app.com/... │copy│open│  │
│  └─────────────────────────────┴────┴────┘  │
│                                             │
│  (QR code section)                          │
│                                             │
└─────────────────────────────────────────────┘
    Width: 320px
```

### Before Publish - Public Access Selected

```
┌─────────────────────────────────────────────┐
│                                             │
│  Preview                                    │
│  (preview status helper text)               │
│                                             │
│  Access level                               │
│  ┌────────────────────────────────────────┐ │
│  │ [world] Public                     v   │ │
│  └────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────┐ │
│  │ [clock] Public access expires in 6 d   │ │
│  └────────────────────────────────────────┘ │
│  ─────────────────────────────────────────  │
│  ┌─────────────────────────────┬────┬────┐  │
│  │ https://share.airo.../abc   │copy│open│  │
│  └─────────────────────────────┴────┴────┘  │
│                                             │
│  (QR code section)                          │
│                                             │
└─────────────────────────────────────────────┘
```

### Before Publish - Loading (Creating Token)

```
┌─────────────────────────────────────────────┐
│                                             │
│  Preview                                    │
│  (preview status helper text)               │
│                                             │
│  Access level                               │
│  ┌────────────────────────────────────────┐ │
│  │ [world] Public                     v   │ │
│  └────────────────────────────────────────┘ │
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
│  (published sync status helper text)        │
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
│  (preview status helper text)               │
│                                             │
│  Access level                               │
│  ┌────────────────────────────────────────┐ │
│  │ [lock] Private                     v   │ │
│  └────────────────────────────────────────┘ │
│  ─────────────────────────────────────────  │
│  ┌─────────────────────────────┬────┬────┐  │
│  │ https://preview.app.com/... │copy│open│  │
│  └─────────────────────────────┴────┴────┘  │
│                                             │
│  (QR code section)                          │
│                                             │
└─────────────────────────────────────────────┘
```

### Error State (Public Token Creation/Load Failed)

```
┌─────────────────────────────────────────────┐

│  (header / segments as appropriate)         │
│  (helper text)                              │
│                                             │
│  Access level                               │
│  ┌────────────────────────────────────────┐ │
│  │ [world] Public                     v   │ │
│  └────────────────────────────────────────┘ │
│  ─────────────────────────────────────────  │
│                                             │
│  [!] Failed to create link. Try again       │
│                                             │
└─────────────────────────────────────────────┘
```

## Behavior Summary

| State | Segmented Controller | Helper Text | Access Dropdown | URL in Input |
|-------|---------------------|-------------|-----------------|--------------|
| Before publish, private | Hidden | Latest preview | Shown (if flag) | Session URL |
| Before publish, public | Hidden | Latest preview | Shown (if flag) | Token URL |
| After publish, Published segment | Shown | Sync status | Hidden | Published URL |
| After publish, Preview segment, private | Shown | Sync-aware preview status | Shown (if flag) | Session URL |
| After publish, Preview segment, public | Shown | Sync-aware preview status | Shown (if flag) | Token URL |

## Helper Text Logic

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

## QR Code Section

- **Visible** on desktop only (hidden when `isMobile` is true)
- **Hidden** during loading and error states
- **Encodes the same URL** as the copy input, with `?ref=qr` appended
- **Library:** `qrcode.react` (`QRCodeSVG` component, size 128, level M)
- **Caption:** `builder_share_link_qr_text`

### Layout

```
┌─────────────────────────────────────┐
│                      ┌───────────┐  │  
│   Scan to view on a  │  QR Code  │  │
│     mobile device    │  128x128  │  │
│                      └───────────┘  │
└─────────────────────────────────────┘
```

- Caption text above QR code, centered
- QR code centered below caption

## Link Types

| Link Type | Access Level | Auth Required | TTL | Purpose |
|-----------|-------------|---------------|-----|---------|
| Session preview | Private | Yes (GoDaddy SSO) | SSO session (~12h JWT) | Only accessible by logged-in owner |
| Public preview | Public | No (token) | 7 days (auto-recreated on expiry) | Temporary shareable link for anyone |
| Published | N/A | No | Permanent | Public production site |

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
| Change access level | Switches URL, resets copied/error state, creates token if public + no active token |
| Click Copy button | Copies URL to clipboard, shows checkmark for 2s |
| Click Open button | Opens URL in new tab (appends `?airoPreview=1` for preview URLs when `appbuilder-preview-header` flag is on) |
| Click outside popover | Closes popover |
| Press Escape | Closes popover |
| Popover opens | Resets all state (copied, error, retry count, tokenExpired, access level → private, segment → published if published) |
| Token expires while open | Expiry banner disappears, spinner shows, new token auto-created, fresh URL and countdown appear |

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
| `{location}.share_link.tab_switch` | Segment or access level changed | `{ appId, tab }` |
| `{location}.share_link.copy` | URL copied | `{ appId, type: 'published' \| 'public' \| 'private' }` |
| `{location}.share_link.open_url` | Open in new tab clicked | `{ appId, type: 'published' \| 'public' \| 'private' }` |
| `{location}.share_link.retry` | Retry clicked after error | `{ appId }` |

`{location}` defaults to `'develop'`, passed as prop.

## Accessibility

| Element | Requirement |
|---------|-------------|
| Trigger button | `aria-label` (tooltip text), `aria-expanded`, `aria-haspopup="dialog"` |
| Popover | Focus trapped, keyboard dismissible (Escape) |
| Segmented controller | `aria-label` for the controller group |
| Access level dropdown | `aria-expanded` on trigger button |
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

### Access Level Dropdown

- [ ] Dropdown hidden when `appbuilder-share-links` flag is off
- [ ] Dropdown shown when flag is on
- [ ] Defaults to Private each time popover opens
- [ ] Selecting Public creates token if none active
- [ ] Selecting Private switches to session URL
- [ ] Token URL shown when Public is selected
- [ ] Session URL shown when Private is selected
- [ ] Loading spinner shown during token creation
- [ ] Error state shown with retry on token creation failure

### Token Expiry

- [ ] Countdown shows when Public selected and active token exists
- [ ] Countdown hidden when Private selected
- [ ] Countdown updates at correct frequency (hourly for days, minutely for hours/mins)
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

- [ ] Shows sync status helper text
- [ ] Shows published URL in input
- [ ] Handles sync error gracefully

### Error Handling

- [ ] Error state shown when token list fetch fails
- [ ] Error state shown when token creation fails
- [ ] Retry button refetches tokens or retries creation
- [ ] 409 conflict triggers token refetch instead of error

## i18n Keys

| Key | Purpose |
|-----|---------|
| `builder_share_link_tooltip` | Trigger button tooltip |
| `builder_common_preview` | Title shown before publish |
| `builder_share_link_segment_label` | Segmented controller aria-label |
| `builder_common_published` | Published segment label |
| `builder_common_preview` | Preview segment label |
| `builder_share_link_access_level` | Access level dropdown label |
| `builder_share_link_access_private` | Private option label |
| `builder_share_link_access_private_desc` | Private option description ("Only you can access") |
| `builder_share_link_access_public` | Public option label |
| `builder_share_link_access_public_desc` | Public option description ("Anyone with the link can access") |
| `builder_share_link_expires_days` | "Public access expires in {count, plural, one {# day} other {# days}}" |
| `builder_share_link_expires_hours` | "Public access expires in {count, plural, one {# hour} other {# hours}}" |
| `builder_share_link_expires_mins` | "Public access expires in {count, plural, one {# min} other {# mins}}" |
| `builder_share_link_published_last_version` | Sync error helper text |
| `builder_share_link_published_in_sync` | In sync helper text |
| `builder_share_link_published_stale` | Out of sync helper text (`{count}` changes) |
| `builder_share_link_preview_latest` | Preview helper when not published |
| `builder_share_link_preview_unpublished` | Preview helper when out of sync |
| `builder_share_link_preview_matches` | Preview helper when in sync |
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
| `share-link-access-level` | Access level dropdown wrapper |
| `share-link-access-level-trigger` | Access level dropdown trigger button |
| `share-link-access-level-private` | Private dropdown option |
| `share-link-access-level-public` | Public dropdown option |
| `share-link-token-expiry` | Token expiry countdown (separate element below dropdown) |
| `share-link-input` | URL input field frame |
| `share-link-copy` | Copy button |
| `share-link-open` | Open in new tab button |
| `share-link-qr` | QR code |
| `share-link-published-loading` | Published segment loading spinner |
| `share-link-preview-loading` | Preview segment loading spinner |
| `share-link-error-state` | Error state container |

## Key Changes from Original Spec

1. **Segmented controller replaces ButtonGroup** — uses `@airo-ux/pattern-library` `SegmentedController` instead of `ButtonGroup`
2. **Access level dropdown replaces "Make public/private" toggle** — dropdown with icon, label, and description per option instead of inline text link
3. **Trigger icon is link icon** — `LinkIcon` instead of window icon
4. **Helper text is sync-aware** — shows publish sync status instead of "Share while I'm online" / countdown
5. **Countdown is a separate status element** — `TokenExpiryStatus` renders "Expires in X days/hours/mins" between the dropdown and divider when a public token is active; dropdown trigger shows only icon + label
6. **QR code layout simplified** — caption text + QR code, no phone icon, no gray background
7. **i18n key namespace is `builder_share_link_*`** — not `builder_view_share_*`
8. **data-testid namespace is `share-link-*`** — not `header-view-share-*`
9. **Analytics event namespace is `{location}.share_link.*`** — parameterized location, not hardcoded `develop.header.view_share.*`
10. **QR hidden on mobile** — `isMobile` check hides QR code section
