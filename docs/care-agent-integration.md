# Airo Care Support Agent Integration

## Status

Auth flow: **implemented** — full client + server infrastructure is in place; the `REQUEST_IDP_TOKEN` SSE listener is wired in `SSETransport`
Server-side trigger: **not yet implemented** — no agent-side code emits `REQUEST_IDP_TOKEN` yet
Proxy / streaming: **not yet implemented**

---

## Overview

Airo Care is an external service (AIRO_CARE_URL) that handles customer support conversations. The integration requires the user's GoDaddy SSO token (IDP token) to authenticate against the Care Agent API on the user's behalf.

Because the agents service has no direct access to the user's SSO session, the BFF pushes the IDP token to the agents service whenever the server requests it over the SSE stream.

---

## Auth Flow

### Goal

Make the user's GD SSO JWT available inside the agents service, keyed by `conversationId`, so it can be forwarded to the Airo Care Agent API when needed.

### Token key

Tokens are cached under `idpTokenCacheKey(conversationId)` = `"<conversationId>:auth_idp"`. The key derivation is internal to `agents/src/utils/idp-token-cache.ts` — callers pass `conversationId` directly to `cacheIdpToken` / `getIdpToken`.

### TTL

5 minutes (`IDP_TOKEN_MAX_AGE_MS = 5 * 60 * 1000` in `agents/src/utils/idp-token-cache.ts`).

### Flow

The server emits a `request_idp_token` SSE event when it needs the user's IDP token (e.g. at turn start when the cache is empty or expired). `SSETransport` listens for that event and fires `pushIdpToken` fire-and-forget:

```
Agents service  (server-side producer — not yet implemented)
  │ emits SSE event: request_idp_token
  │
  ▼
SSETransport  (app/src/services/transport/SSETransport.ts)
  │ addEventListener(REQUEST_IDP_TOKEN) → prefetchIdpToken()
  │
  ▼
pushIdpToken(appId, conversationId)  (app/src/lib/push-idp-token.ts)
  │ guard: getSwitchboardFlag('airo-builder-care-agent-enabled') !== true → no-op
  │ fires POST /api/auth/idp-token  { appId, conversationId }  (fire-and-forget)
  │
  ▼
BFF route  (app/src/app/api/auth/idp-token/route.ts)
  │ withCustomerAuth → reads GD SSO JWT as idpToken
  │ resolves agent URL: getControlPlaneAdapter().getSite(appId, jwt) → site.agent_url
  │   → 404 if site not found, 502 if site has no agent_url or lookup throws
  │ calls getJWTService().getToken({ siteId: appId, customerId, ... }) → agent token (cached)
  │ POST <agent_url>/api/conversations/:appId/:conversationId/idp-token
  │   Authorization: Bearer <agentToken>
  │   body: { token: idpToken }
  │
  ▼
Agents route  (agents/src/server/routes/conversations.ts)
  │ validateAppOwnershipFromParam('appId') + validateConversationOwnership('conversationId')
  │ cacheIdpToken(conversationId, token) → returns { accepted: true } if cached, { accepted: false } if already expired
  │
  ▼
In-memory cache  (agents/src/utils/idp-token-cache.ts)
  cachedIdpTokens: Map<"<conversationId>:auth_idp", { token, cachedAt }>
```

---

## Files Changed (Auth Only)

| File | Change |
|------|--------|
| `packages/shared/src/chat/idp-token.ts` | New — exports `REQUEST_IDP_TOKEN = 'request_idp_token' as const` |
| `packages/shared/src/chat/index.ts` | Re-exports `REQUEST_IDP_TOKEN` from the new `idp-token` module |
| `app/src/app/api/auth/idp-token/route.ts` | New BFF route — resolves `site.agent_url` via control plane adapter, mints cached agent token via `getToken`, pushes IDP token to agents |
| `app/src/lib/push-idp-token.ts` | New helper — fires `POST /api/auth/idp-token` fire-and-forget, gated on `airo-builder-care-agent-enabled` switchboard flag |
| `app/src/services/transport/SSETransport.ts` | Adds `REQUEST_IDP_TOKEN` SSE event listener in `openEventSource()` → calls `prefetchIdpToken()` → `pushIdpToken` |
| `agents/src/server/routes/conversations.ts` | New `POST /api/conversations/:appId/:conversationId/idp-token` route — transport-agnostic, calls `cacheIdpToken(conversationId, token)` |
| `agents/src/utils/idp-token-cache.ts` | New — owns `idpTokenCacheKey`, `cacheIdpToken(conversationId, token)`, `getIdpToken(conversationId)`, TTL constant |

---

## Not Yet Implemented

- **Server-side `REQUEST_IDP_TOKEN` producer**: no agent-side code emits `request_idp_token` over the SSE stream yet. The client listener in `SSETransport` is ready — the event just never fires until the server side is added.
- **Proxy / streaming**: forwarding user messages to the Airo Care Agent API and streaming NDJSON responses back through the event channel.
