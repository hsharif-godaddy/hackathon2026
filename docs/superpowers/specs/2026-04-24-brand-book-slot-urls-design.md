# Brand Book Logo Display via Asset Slot URLs

**Date:** 2026-04-24
**Status:** Draft
**Scope:** Migrate the brand book LogoSection from `brand.logo` memory-based CDN URLs to the media slot system

## Problem

The brand book's `LogoSection` reads logo image URLs from the `brand.logo` memory key via the brand-data API. These are direct CDN URLs saved by the old AI-lib `generateLogo` tool (now removed). The media-logo skill saves logos to the media slot system (`logo/primary`, `logo/horizontal`, `logo/vertical`) instead.

When a user swaps logos via the LogoGridWidget, the media slots update but the brand book doesn't reflect the change because it reads from a separate data source (`brand.logo` memory).

## Goal

The brand book LogoSection should use slot URLs (`/airo-assets/images/logo/primary`, etc.) so that logo swaps in the LogoGridWidget immediately reflect in the brand book.

## Design

### 1. LogoSection Renders URLs from Media Manifest

Replace the current logic that reads `data.logo` CDN URLs (from brand.logo memory) with URLs from the media manifest slots.

The brand book runs in the main app frame, not behind the dev-supervisor proxy, so it cannot use `/airo-assets/images/logo/primary` slot proxy URLs directly. Instead, it reads the manifest's `currentUrl` (the actual CDN URL) for each logo slot:

| Panel                     | Current source                        | New source                                             |
| ------------------------- | ------------------------------------- | ------------------------------------------------------ |
| Light background (square) | `data.logo.square.transparent`        | `manifest['logo/primary'].currentUrl`                  |
| Dark background (square)  | `data.logo.square.transparent` (same) | `manifest['logo/primary'].solidUrlMap[currentUrl]`     |
| Vertical                  | `data.logo.vertical.transparent`      | `manifest['logo/vertical'].currentUrl`                 |
| Horizontal                | `data.logo.horizontal.transparent`    | `manifest['logo/horizontal'].currentUrl`               |

No cache-busting needed — when the manifest refetches after a slot swap, `currentUrl` changes to the new URL, React re-renders, and the browser fetches the new image.

### 2. Placeholder Detection via useMediaManifest

The LogoSection currently shows a placeholder when `!logo || !primarySrc`. Replace this with a check against the media manifest:

- The parent `BrandBookView` (index.tsx) calls `useMediaManifest({ appId })`
- It derives logo slot data and passes it to `LogoSection` as props
- LogoSection renders the placeholder when no logo slot exists, and manifest URLs when it does

### 3. Reactive Updates

When the user swaps a logo in LogoGridWidget:

1. LogoGridWidget calls `PUT /media/:appId/slots/:slotName` (updates the slot)
2. LogoGridWidget calls `queryClient.invalidateQueries({ queryKey: ['mediaManifest', appId] })` (already happens)
3. `useMediaManifest` in BrandBookView refetches the manifest
4. The `logo/primary` slot's `currentUrl` changes → LogoSection re-renders with new image URL

When the agent generates logos via `media-logo__generate_logo`:

1. Tool saves to slots
2. `CompleteHandler` invalidates `['mediaManifest', appId]` (already happens for `media-logo__` tools)
3. Same flow as above

### 4. Vertical/Horizontal Conditional Rendering

Currently, vertical and horizontal panels only render when the respective URL exists in `data.logo`. With the manifest approach, we check whether `logo/vertical` and `logo/horizontal` keys exist in the manifest. The parent derives this and passes the URLs (or undefined) to LogoSection.

### 5. Guidelines Text

`data.logo.guidelines` (a text string describing logo usage) is still sourced from `brand.logo` memory via `useBrandData`. This is non-image data, so it stays on the existing brand-data path. LogoSection continues to read `data?.logo?.guidelines` for this text field only.

### 6. Remove generateLogo/editLogo from BRAND_UPDATE_TOOLS

In `ToolResultHandler.ts`, `generateLogo` and `editLogo` are in the `BRAND_UPDATE_TOOLS` list which triggers `BRAND_DATA_UPDATED_EVENT` and refetches brand data. Since brand book logo display no longer depends on `brand.logo` memory, these tool names can be removed. The `media-logo__generate_logo` and `media-logo__edit_logo` tools already trigger media manifest invalidation via `CompleteHandler`.

## Files Changed

| File                                                                      | Change                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `app/src/app/[market]/develop/components/preview/brand-book/index.tsx`    | Add `useMediaManifest`, derive logo slot URLs, pass to LogoSection |
| `app/src/app/[market]/develop/components/preview/brand-book/sections.tsx` | LogoSection accepts manifest-derived URLs instead of reading data.logo for images |
| `app/src/hooks/websocket/handlers/ToolResultHandler.ts`                   | Remove `generateLogo`, `editLogo` from `BRAND_UPDATE_TOOLS`                                                        |

## Files Unchanged

- `app/src/hooks/useMediaManifest.ts` — already provides what we need
- `app/src/hooks/useBrandData.ts` — still used for palette, typography, personality, etc.
- `agents/src/server/routes/brand-data.ts` — still serves `brand.logo` for guidelines text
- `agents/src/services/MediaManifestService.ts` — no backend changes
- `LogoGridWidget` — already updates slots and invalidates manifest cache

## Data Flow (After Migration)

```
Agent: media-logo__generate_logo
  → Saves to media slots (airo-media.json)
  → CompleteHandler invalidates ['mediaManifest', appId]
  → useMediaManifest refetches
  → BrandBookView re-renders with new currentUrl from manifest
  → LogoSection images update to new URLs

User: Swaps logo in LogoGridWidget
  → PUT /media/:appId/slots/logo/primary
  → queryClient.invalidateQueries(['mediaManifest', appId])
  → useMediaManifest refetches
  → BrandBookView re-renders with new currentUrl from manifest
  → LogoSection images update to new URLs
```
