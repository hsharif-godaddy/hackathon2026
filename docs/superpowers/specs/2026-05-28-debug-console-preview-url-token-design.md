# Debug Console: Preview URL with Share Token

**Date:** 2026-05-28  
**Status:** Approved

## Problem

The debug-console shows preview URLs from mgmt-airo verbatim (bare, no auth token). Since preview apps require authentication — either via a third-party `preview_auth` cookie (blocked by Safari ITP, Firefox TCP, Chrome incognito) or a `?airoShareToken=<token>` query param — clicking the preview link in the debug-console often lands on an auth-error page.

`app/` already solves this via `injectShareTokenIntoPreviewUrl`, which calls agents `GET/POST /apps/:id/share` to get or mint a 7-day share token and appends `?airoShareToken=<token>` to the URL. The debug-console does not do this today.

## Affected surfaces

- `debug-console/src/components/AppDetailsPanel.tsx` — "preview" block in the status grid, line 975: `url={app.urls[name]}`
- `debug-console/src/components/LangfuseDeepDiveViews.tsx` — "Live URLs" card, line 823: `href={urls.preview}`

## Solution: Option B — new BFF route + lazy component fetch

### New route: `GET /api/agent/share-token/[appId]`

File: `debug-console/src/app/api/agent/share-token/[appId]/route.ts`

- Protected by `withAuth` (same as all other debug-console BFF routes).
- Calls `fetchAgentJson({ appId, path: `/apps/${appId}/share` })` to GET the active token list from agents. (`fetchAgentJson` is GET-only; used as-is for the list call.)
- Picks the freshest active token (`expiresAt > Date.now()`, highest `expiresAt` wins).
- If no active token found, mints one via a direct authenticated `fetch` (POST) using `mintAgentToken({ appId })` + `mgmtControlPlaneAdapter.getAgentUrl(appId)` — same pattern as `fetchAgentJson` but `method: 'POST'` with body `{ expiresIn: 604800 }` (7-day `user` purpose default).
- Response on success: `{ token: string }`.
- Response on any failure (agents down, 4xx, parse error): `{ token: null }` — never 500 to the client, so callers always fail open to the bare URL.

Auth compatibility confirmed: debug-console's `mintAgentToken` produces JWTs with `siteId: appId` and `product: 'AiroAppBuilder'`. The agents share route uses `jwtAuthMiddleware.authenticate` + `validateProductAccess` (AAB callers pass through) + `validateAppOwnership` (siteId === params.id). All three pass with the existing debug-console JWT shape.

### `AppDetailsPanel.tsx`

- After `app` state is set (app details fetch resolves), if `app.urls['preview']` is present, fire a fetch to `/api/agent/share-token/${appId}`.
- Store result in `previewShareToken: string | null` state (initially `null`).
- In `DetailedStatusBlock` for `name === 'preview'`, append `?airoShareToken=<token>` to the URL prop if token is available. Bare URL otherwise.

### `LangfuseDeepDiveViews.tsx`

- `MgmtAppDetailView` already has `data.id` (appId). Add a `useEffect` that fetches `/api/agent/share-token/${id}` when `urls.preview` is present.
- Store in `previewShareToken: string | null` state.
- Inject `?airoShareToken=<token>` into `urls.preview` before the `ExternalArrowLink` render. Bare URL as fallback.

## Failure behavior

Both surfaces fail open: if the token fetch fails or returns `{ token: null }`, the bare URL is shown/used — same UX as today. No loading spinners or error states needed; the link just works or degrades silently.

## What is NOT changing

- `mgmt-control-plane-adapter.ts` and the `/api/mgmt/apps/[appId]` route are unchanged.
- The `MgmtAppDetails` type is unchanged.
- No Switchboard flag needed — this is an internal debug tool, always-on is fine.
- No caching layer added in the new route — 7-day tokens mean repeat fetches are rare, and the debug-console's pragmatic SLA doesn't need it.
