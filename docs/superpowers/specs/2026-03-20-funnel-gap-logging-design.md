# Funnel Gap Logging: Homepage to Agent Response

**Date:** 2026-03-20
**Status:** Approved
**Problem:** Users drop off between homepage prompt submission and first agent response, and the rate has increased. Existing funnel events have gaps that make it impossible to determine where or why drop-offs occur.

## Context

The create-to-response flow spans three layers (client, BFF, agents) and involves: prompt submission, app creation via control plane, redirect to develop page, WebSocket token acquisition, WebSocket connection, initial prompt auto-send, agent processing, and first response rendering.

Six funnel events already exist but leave two critical gaps:

1. **Between `funnel.create_app.initiated` and `funnel.chat_loader.hidden`** — redirect, page load, token fetch, and WebSocket connection are invisible
2. **No "first build complete" event** — `funnel.first_response.rendered` fires on first streaming chunk, not build completion

## Existing Funnel Events

| #   | Event                              | Location                                                          | Fields                                                                           |
| --- | ---------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | `funnel.create_app.initiated`      | BFF: `app/src/app/api/sites/quick-create/route.ts`                | jobId OR appId (see note), customerId, promptLength                              |
| 2   | `funnel.chat_loader.hidden`        | Client: `app/src/app/develop/[id]/page.tsx`                       | appId, phase, subPhase                                                           |
| 3   | `funnel.initial_prompt.sent`       | Client: `app/src/app/develop/[id]/page.tsx`                       | appId, promptLength                                                              |
| 4   | `funnel.initial_prompt.processing` | Agents: `agents/src/server/ai-lib-websocket-server.ts`            | appId, customerId, timeSinceCreationMs, messageLength, sessionId, conversationId |
| 5   | `funnel.first_response.rendered`   | Client: `app/src/app/develop/components/StreamingMessageList.tsx` | appId, messageId, hasContent, hasSegments, hasToolCalls                          |
| 6   | `funnel.user_first_message.sent`   | Client: `app/src/app/develop/components/chat/ChatPane.tsx`        | appId, promptLength                                                              |

## New Events (7 additions)

### Client-Side Events

All client-side events use `shipAnalyticsLog()`. The `/api/client-logs` endpoint automatically enriches with `customerId` from the SSO JWT — no explicit passing needed. Events arrive in ES prefixed with `client.` (e.g., `client.funnel.develop_page.loaded`).

#### 1. `funnel.develop_page.loaded`

**Location:** `app/src/app/develop/[id]/page.tsx` — on component mount
**Purpose:** Confirms user reached the develop page after quick-create redirect
**Fields:**

- `appId` — the app/site ID from the URL
- `source` — `'quick-create'` if initial prompt exists in session storage (use `checkHasInitialPrompt()` from `useInitialization.ts` which handles both jobId and appId key variants), `'direct-nav'` otherwise

#### 2. `funnel.ws.token_acquired`

**Location:** `app/src/services/websocket/ConnectionManager.ts` — after successful token fetch
**Purpose:** Confirms WebSocket authentication token was obtained
**Fields:**

- `appId` — site ID
- `durationMs` — time to fetch token

#### 3. `funnel.ws.token_failed`

**Location:** `app/src/services/websocket/ConnectionManager.ts` — on token fetch failure
**Purpose:** Captures why WebSocket setup failed at the token stage
**Fields:**

- `appId` — site ID
- `error` — error message
- `status` — HTTP status code (if available)

**Implementation note:** The current `defaultFetchAgentToken` returns `null` on failure, discarding error details. The function (or its call site) needs to be modified to propagate error information. Options: (a) change return type to `{ token, error?, status? }`, (b) emit the funnel event inside `defaultFetchAgentToken` before returning null, or (c) wrap the fetch call at the call site to capture the error. Option (b) is simplest — emit the event at the point where the error is known (lines 138 and 158 of ConnectionManager.ts).

#### 4. `funnel.ws.connected`

**Location:** `app/src/services/websocket/ConnectionManager.ts` — after WebSocket authentication succeeds
**Purpose:** Confirms real-time connection is established and authenticated
**Fields:**

- `appId` — site ID
- `durationMs` — time from connection attempt to authenticated state

#### 5. `funnel.ws.connect_failed`

**Location:** `app/src/services/websocket/ConnectionManager.ts` — on WebSocket connection or authentication failure
**Purpose:** Captures why real-time connection failed
**Fields:**

- `appId` — site ID
- `error` — error message
- `reason` — failure category (e.g., `'connection_timeout'`, `'auth_rejected'`, `'transport_error'`)

### Agents-Side Events

Agents-side events use the existing `logger.info()` infrastructure. These go directly to stdout as JSON and are collected by FluentBit.

#### 6. `funnel.initial_prompt.complete`

**Location:** `agents/src/server/ai-lib-websocket-server.ts` — in `onMessageComplete` callback, only when the message is the initial prompt (first message for the app)
**Purpose:** Marks successful completion of the initial build
**Fields:**

- `appId` — site ID
- `customerId` — from per-socket metadata map (populated in onMessageStart)
- `durationMs` — total processing time (parsed from `result.duration` or separate timer)
- `agentName` — which agent handled the build (from `result.agentName`)

#### 7. `funnel.initial_prompt.error`

**Location:** `agents/src/server/ai-lib-websocket-server.ts` — in `onMessageError` callback, only when the message is the initial prompt
**Purpose:** Captures why the initial build failed
**Fields:**

- `appId` — site ID
- `customerId` — from per-socket metadata map
- `error` — error message
- `agentName` — which agent was running

## Complete Funnel (Ordered)

```
 #  Event                              Layer    Existing?
 1  funnel.create_app.initiated        BFF      existing
 2  funnel.develop_page.loaded         Client   NEW
 3  funnel.ws.token_acquired           Client   NEW
 4  funnel.chat_loader.hidden          Client   existing
 5  funnel.ws.connected                Client   NEW
 6  funnel.initial_prompt.sent         Client   existing
 7  funnel.initial_prompt.processing   Agents   existing
 8  funnel.first_response.rendered     Client   existing
 9  funnel.initial_prompt.complete     Agents   NEW

Error events (branch off the happy path):
 -  funnel.ws.token_failed             Client   NEW
 -  funnel.ws.connect_failed           Client   NEW
 -  funnel.initial_prompt.error        Agents   NEW
```

## Correlation Strategy

**Primary key:** `appId` — present in every funnel event, unique per app creation.

**V2 control plane note:** `funnel.create_app.initiated` logs `jobId` (not `appId`) for V2 deployments. The `appId` is only known after the job resolves. All subsequent funnel events use the resolved `appId`. To correlate the creation event with the rest of the funnel, use the `jobId → appId` mapping from the initialization machine (the develop page URL contains the resolved `appId`). In ES queries, join on `customerId` + time window to bridge the `jobId` gap, or query `funnel.create_app.initiated` separately.

**Customer attribution:** `customerId` is:

- Explicitly logged in `funnel.create_app.initiated` (BFF) and `funnel.initial_prompt.processing/complete/error` (agents)
- Automatically added by `/api/client-logs` endpoint for all client-side events (extracted from SSO JWT)

**ES query pattern:** Filter on `event` matching `funnel.*` or `client.funnel.*`, group by `appId` to reconstruct the journey from stage 2 onward. For stage 1, use `customerId` + time window to join with `funnel.create_app.initiated` (which may have `jobId` instead of `appId`).

## Detecting Initial Prompt

The new agents-side events (`funnel.initial_prompt.complete`, `funnel.initial_prompt.error`) must only fire for the initial prompt, not subsequent messages. The existing code already determines this — `isInitialPrompt` is set to `true` when `messageCount === 1` in `onMessageStart`. This flag (or equivalent check) needs to be available in `onMessageComplete` and `onMessageError`.

**Approach:** Add a `Map<string, { isInitialPrompt: boolean; customerId?: string }>` keyed by `socketId` in the agents service's WebSocket server setup. Populate it in `onMessageStart` (where `isInitialPrompt` and `customerId` are already computed). Read and clean up in `onMessageComplete`/`onMessageError`. This is necessary because ai-transport's callback interface does not pass per-message metadata between start and complete/error callbacks.

**Note on `result` fields in `onMessageComplete`:** The ai-transport `result` object contains `agentName` (not `agentId`) and does not include `steps`. The `duration` field is a formatted string (e.g., `"5.2s"`), not milliseconds. Implementation should:

- Use `result.agentName` for the agent identifier
- Parse `result.duration` string to milliseconds, or use a separate timer started in `onMessageStart`
- Omit `steps` from `funnel.initial_prompt.complete` (not available from ai-transport)

## Files Changed

| File                                              | Change                                                                                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/src/app/develop/[id]/page.tsx`               | Add `funnel.develop_page.loaded` on mount                                                                                                                                                                                          |
| `app/src/services/websocket/ConnectionManager.ts` | Add 4 events: token acquired/failed, ws connected/failed. Emit `funnel.ws.token_failed` inside `defaultFetchAgentToken` where error details are available.                                                                         |
| `agents/src/server/ai-lib-websocket-server.ts`    | Add per-socket metadata Map for `isInitialPrompt`/`customerId`. Populate in onMessageStart, read in onMessageComplete/onMessageError. Add `funnel.initial_prompt.complete` and `funnel.initial_prompt.error` (initial prompt only) |

## ES Query Examples

```
# Full funnel conversion rates
# Count unique appIds at each stage
event: /funnel\..*/ OR event: /client\.funnel\..*/
| stats dc(data.appId) as apps by event

# Drop-off between stages for a time range
# Compare count at stage N vs stage N+1

# Specific user journey
data.appId: "abc123" AND (event: /funnel\..*/ OR event: /client\.funnel\..*/)
| sort @timestamp asc

# Error analysis
event: "client.funnel.ws.token_failed" OR event: "client.funnel.ws.connect_failed" OR event: "funnel.initial_prompt.error"
| stats count by event, data.error

# Time-to-first-response (from create to first response rendered)
# Join funnel.create_app.initiated timestamp with client.funnel.first_response.rendered timestamp per appId
```

## Non-Goals

- No new correlation ID (funnelId) — `appId` is sufficient since it's unique per creation
- No dashboards — ES queries are the consumption layer for now
- No changes to existing funnel events — they remain as-is
- No client-side timing spans — `durationMs` fields on individual events are sufficient
