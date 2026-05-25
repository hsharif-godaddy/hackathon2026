# SSE Request/Context Parity (PR 4)

Date: 2026-05-25

## Context

Part of the WebSocket-to-SSE replacement sequence (see `docs/websocket-to-sse-parity-analysis-2026-05-25.md`, Area 5). PRs 1-3 cover runtime extraction, client lifecycle, and recovery hardening. This PR addresses request/context gaps between the two transports.

## Changes

### 1. sessionId in executionContext metadata

**Problem:** WS sets `metadata.sessionId` (used for OTel transaction labels and budget correlation). SSE's `executionContext.metadata` has no `sessionId` field — observability tools get `undefined`.

**Fix:** Set `sessionId: sseSocketId` in the metadata object at `MessageExecutionService.ts:1157`. The value is `sse:${conversationId}` — already computed and used for state management. No client-side change needed; the server already knows the canonical identifier.

**Not changing:** The client still sends `sessionId` (appId) in the POST body. The server ignores it. Removing it is a cleanup task for a separate PR.

### 2. userTimezone

**Problem:** WS sends `Intl.DateTimeFormat().resolvedOptions().timeZone` via ChatMessageBuilder. SSE doesn't send it. The agent prompt (`buildDynamicDataMessage`) only includes "User's timezone: X" when `metadata.userTimezone` is present — so SSE users get no timezone context.

**Fix:**
- `SSETransport.ts`: Add `userTimezone` field to `sendMessage` payload. Cache the timezone value at module level (same pattern as ChatMessageBuilder).
- `routes.ts`: Destructure `userTimezone` from `req.body`. Validate type (`string` if present, else 400). Pass through to `executionService.execute()`.
- `MessageExecutionService.ts`: Accept `userTimezone` in params, spread into metadata: `...(userTimezone && { userTimezone })`.

### 3. market in APP_NOT_FOUND retry

**Problem:** Initial send includes `market: marketRef.current` (line 946). The APP_NOT_FOUND retry (line 531) omits it — the resent message arrives without market context.

**Fix:** Add `market: marketRef.current` to the retry `sendMessage` call in `useSSEChat.ts`.

### 4. Express body-size limit for SSE routes

**Problem:** Global Express limit is 10MB. The SSE `/messages` POST carries only text/metadata (no binary — screenshots upload via separate multipart endpoints, selectedAssets carries URLs only). 10MB is excessive for this payload.

**Fix:** Add `express.json({ limit: '1mb' })` middleware scoped to the SSE conversation router. This provides a hard ceiling without per-field validation complexity. 1MB is generous — typical payloads are well under 100KB even with multiple `aiEditContexts` containing HTML element snapshots.

## Files Changed

| File | Change |
|------|--------|
| `agents/src/server/sse/MessageExecutionService.ts` | Add `sessionId: sseSocketId` and `userTimezone` to metadata |
| `agents/src/server/sse/routes.ts` | Destructure/validate `userTimezone`, add 1MB body limit |
| `app/src/services/transport/SSETransport.ts` | Add `userTimezone` to sendMessage payload |
| `app/src/hooks/useSSEChat.ts` | Add `market` to APP_NOT_FOUND retry |

## Not Included (deferred)

- **Conversation creation with templateId** — server re-resolves agent on first `/messages` POST with templateId anyway; no functional gap.
- **Removing dead client fields** (sessionId, budgetServiceEnabled, subscriptionId from POST body) — cleanup, separate PR.
- **Per-field size validation** — 1MB express limit is sufficient; actionable per-field errors are nice-to-have.
- **userId field** — WS sends hardcoded `'current-user'`; no real value. Intentionally not porting.

## Tests

| Test | Assertion |
|------|-----------|
| `MessageExecutionService` unit | metadata includes `sessionId` = `sse:${conversationId}` |
| `MessageExecutionService` unit | metadata includes `userTimezone` when provided |
| `MessageExecutionService` unit | metadata omits `userTimezone` when not provided |
| SSE routes unit | `userTimezone` non-string type → 400 |
| SSE routes unit | payload > 1MB → 413 |
| `useSSEChat` unit | APP_NOT_FOUND retry payload includes `market` |
| `SSETransport` unit | sendMessage body includes `userTimezone` field |
