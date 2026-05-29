# MCP Integration Plan

**Status:** Proposal  
**Primary target:** Commerce MCP (`mcp.commerce.api.{env}-godaddy.com/mcp`)  
**Goal:** define the standard MCP integration pattern for AAB interactive sessions.

---

## Recommendation

For **AAB interactive sessions**, use a **same-origin BFF MCP proxy**.

### High-level flow

1. User is already logged in to AAB.
2. Agent uses generic MCP tools such as:
   - `commerce_search_tools`
   - `commerce_execute_tool`
3. Browser sends those requests to an AAB BFF route, e.g. `POST /api/mcp/proxy`.
4. BFF authenticates the current AAB session.
5. BFF exchanges the logged-in customer JWT for a **short-lived OAuth token**.
6. BFF forwards the MCP JSON-RPC request to the external MCP server with:
   - `Authorization: Bearer <oauth token>`
7. BFF streams the response back to the browser, which returns it to the agent.

### Key design choices

- **Use JWT -> OAuth exchange in the BFF** for interactive AAB flows.
- **Preserve MCP discovery** instead of flattening every MCP tool into a bespoke AAB tool.
- **Do not forward `auth_idp` cookies** to external MCP servers.
- **Do not require an extra popup/consent loop** when the user is already logged in and we can exchange their JWT.
- **Request the smallest allowed scope set per request**, not one broad scope bundle up front.

---

## Why this is the best fit for AAB

### 1. Best UX

The user is already logged in. Requiring an additional popup-driven OAuth flow is unnecessary friction if we can exchange the existing authenticated customer JWT for the right OAuth token.

### 2. Preserves the main value of MCP

The biggest gain of MCP is that the agent can:

- discover tools dynamically
- inspect schemas/descriptions
- execute only the tools needed for the task

That argues for a **generic discovery + execution model**, not a static one-wrapper-per-tool model by default.

### 3. Centralized policy and audit

Putting the bridge in the BFF gives AAB one place to control:

- which MCP servers are reachable
- which scopes are allowed
- whether specific tools/domains are blocked
- how calls are logged and audited

### 4. Correct auth boundary

Commerce MCP expects **OAuth bearer tokens**, not cookies. The BFF can convert the AAB session into the correct token shape without exposing the raw AAB session cookie to the external MCP server.

---

## What we confirmed in `commerce-admin-api`

Looking at `~/GoDaddy/gdcorp-commerce/workspace/commerce-admin-api/apis/mcp/`:

- `/mcp` is protected by:
  - `authenticate`
  - `authorizeToolCall`
- So **all MCP requests require authentication**.
- `search_tools` declares:
  - `scopesRequired: []`
- So discovery is **authenticated**, but it does **not** require extra commerce scopes.
- `execute_tool` also exists specifically to support clients that:
  - discover tools first
  - then execute them without needing to dynamically register every discovered tool in the client

This is important because it means:

- we **should not block discovery behind broad commerce scopes**
- but we **do still need an authenticated bearer token** for `search_tools`

---

## Recommended auth behavior

### Discovery phase

For `search_tools`, the BFF should exchange the customer JWT for a **minimal authenticated token**.

- exact baseline scope set is still to be confirmed with Identity / OAuth config
- but it should **not** be the full commerce scope bundle

### Execution phase

After discovery, when the agent chooses a tool to execute:

1. read that tool's `scopesRequired` from the `search_tools` result
2. compute the **smallest allowed scope set** needed for execution
3. reuse a cached token for that exact scope set, or re-exchange if needed
4. call MCP with that narrower token

### Token cache key

Cache proxied OAuth tokens by:

- `customerId`
- `serverId`
- normalized `scopeSet`

That avoids repeated exchanges while still keeping scope use tight.

---

## Agent integration model

### Default model: generic MCP tools

For Commerce MCP, expose a small generic adapter surface to the agent:

- `commerce_search_tools({ query, limit? })`
- `commerce_execute_tool({ name, arguments })`

These map to MCP's built-in:

- `search_tools`
- `execute_tool`

This keeps AAB aligned with how the Commerce MCP server is meant to be used.

### When to add custom AAB wrappers

Create bespoke AAB tools only when needed for:

- custom UI/tool renderers
- human approval flows
- richer formatting in the builder UI
- orchestration across multiple MCP calls plus local AAB state

Examples:

- guided store setup
- custom confirmation for sensitive writes
- polished catalog/product result renderers

So the default should be:

- **generic discovery + execution first**
- **custom wrappers only where UX/safety clearly benefits**

---

## Security model

The main concern is:

> If the agent can reach an MCP server, could it call sensitive tools we didn't intend to expose?

The BFF proxy should enforce these controls.

### 1. Server allowlist

Only allow known MCP servers.

```ts
const MCP_SERVERS = {
  commerce: {
    url: 'https://mcp.commerce.api.dev-godaddy.com/mcp',
  },
} as const;
```

No arbitrary URLs from agent input.

### 2. Scope ceiling per server

Define the **maximum** scopes AAB is allowed to request for each server.

Example for commerce interactive use:

```ts
const COMMERCE_ALLOWED_SCOPES = [
  'commerce.product:read',
  'commerce.product:write',
  'commerce.store:read',
  'commerce.store:create',
  'commerce.onboarding-application:read',
  'commerce.onboarding-application:write',
] as const;
```

Not included unless explicitly approved:

- `commerce.order:*`
- future `commerce.transaction:*`
- unrelated admin scopes

Important: this is a **ceiling**, not the default scope set for every call.

### 3. Least-privilege per request

- `search_tools` -> minimal authenticated token
- direct named tools -> smallest allowed scope set when the proxy has local metadata for that tool
- `execute_tool` dispatches -> currently use the server scope ceiling because the proxy only sees the inner tool name, not the MCP server's `scopesRequired`; per-tool scope narrowing requires caching/reading discovery metadata at the BFF seam

This directly addresses the concern that discovery should not automatically grant broad write access. The remaining deepening opportunity is to move discovered `scopesRequired` behind the BFF policy module so `execute_tool` calls do not need the full ceiling.

### 4. Optional tool policy filter

Scopes are the primary control plane, but the proxy can also enforce policy such as:

- block specific tool names
- filter `search_tools` results by domain/category
- disable write tools for certain product surfaces

This is useful when multiple tools share one scope.

### 5. Audit logging

Log every proxied MCP call with at least:

- appId
- customerId
- serverId
- MCP method
- target tool name if present
- scope set used
- allow/deny policy decision
- latency
- upstream error/status

---

## Proposed implementation

### 1. Harden `mcpCallAction`

Repurpose `app/src/hooks/websocket/actions/mcpCallAction.ts` into a **same-origin MCP bridge**.

It should:

- call the AAB BFF, not the external MCP host directly
- stop forwarding cookies to external MCP servers
- support:
  - `search_tools`
  - `execute_tool`
  - direct `tools/call` if needed
- normalize streamed MCP results for the agent

### 2. Add a BFF MCP proxy route

Example:

```text
POST /api/mcp/proxy
```

Input:

```json
{
  "serverId": "commerce",
  "request": {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": { ... },
    "id": 123
  }
}
```

Responsibilities:

- authenticate current user session
- resolve `serverId` -> server config
- determine the smallest allowed scope set for the request
- exchange customer JWT -> OAuth token
- enforce host/tool policy
- forward the MCP request
- stream the response back
- log/audit the call

### 3. Add MCP server policy/config

Suggested config shape:

- `app/src/lib/mcp/servers.ts`
- `app/src/lib/mcp/policy.ts`

Example:

```ts
{
  commerce: {
    url: 'https://mcp.commerce.api.dev-godaddy.com/mcp',
    allowedScopes: [...],
    blockedTools: ['transactions_create', 'orders_create'],
    allowedDomains: ['catalog', 'store', 'onboarding'],
  }
}
```

### 4. Add generic commerce MCP tools in agents

Prefer a small generic layer rather than dozens of static wrappers:

- `commerce_search_tools`
- `commerce_execute_tool`

Then add custom wrappers later only where needed.

---

## AAB vs PaaS

This repo supports both AAB and PaaS-style flows, so the pattern should be explicit.

### AAB interactive

Use the **browser/BFF proxy**.

Why:

- user is already logged in
- we want to avoid extra popup-driven auth
- discovery is valuable during interactive sessions
- the BFF can enforce policy centrally

### PaaS / headless

Do **not** depend on the browser bridge.

Instead:

- caller provides an OAuth token directly, or
- caller acquires its own OAuth token and calls the MCP server directly

The current `commerce` skill implementation is explicitly **AAB interactive only** because its adapter requires an active browser/WebSocket session and calls the same-origin BFF proxy. A PaaS/headless adapter is a separate seam: it should accept caller-owned OAuth credentials and call Commerce MCP directly, rather than trying to reuse the browser bridge.

The AAB interactive pattern is the preferred default for builder sessions, not a universal requirement for all callers.

---

## Rollout

### Phase 1 — infrastructure

1. refactor `mcpCallAction` into a same-origin MCP proxy caller
2. add `/api/mcp/proxy`
3. add server config + policy module
4. implement JWT -> OAuth exchange + short-lived token cache in the BFF
5. smoke test Commerce MCP `search_tools`

### Phase 2 — generic commerce integration

1. add `commerce_search_tools`
2. add `commerce_execute_tool`
3. update agent guidance to search first, then execute
4. verify discovery + execution against the live commerce MCP server

### Phase 3 — targeted UX wrappers

Add custom wrappers/tool renderers only where justified by UX or safety.

### Phase 4 — cleanup (done on this branch)

1. ✅ removed the old PKCE/popup commerce OAuth stack:
   - `agents/src/skills/commerce/` (entire skill — `withCommerceAuth`, all `commerce__*` tools, tests, skill.md)
   - `agents/src/lib/godaddy-commerce.ts` (REST client) + its tests
   - `agents/src/tools/commerce-product-tool.ts` (dead)
   - `agents/src/tools/ai-lib-tools/oauth-tool.ts` (agent-facing `oauthConnect`) + test
   - `agents/src/services/auth-service.ts` (PKCE flow) + test
   - `agents/src/services/token-store.ts` + test
   - `agents/src/server/routes/oauth.ts` (popup callback) + test + `/oauth` mount in `app.ts`
   - App-side renderers: `OAuthToolRenderer`, `CommerceToolRenderer`, `CommerceInstallStorefrontToolRenderer`
2. ✅ updated prompts and dependent skills (`commerce-storefront`, `commerce-one-time-payment`, stripe, develop/core, initial/core x2, secrets.md, skill-loader-tool doc, actionToolGrouping) to route through `commerceSearchTools` / `commerceExecuteTool` instead of the deleted `commerce` skill.
3. retained intentionally:
   - `OAuthTokenRepository` + `oauth_tokens` table (still consumed by `/apps/:id/transfer/validate` — harmless legacy data check until we decide to drop transfer eligibility signal).
   - `gd-auth-service` (JWT validator for incoming customer tokens — unrelated to the deleted PKCE flow).
4. document this as the standard AAB interactive MCP pattern

---

## Open questions / prerequisites

1. **JWT -> OAuth exchange contract**  
   What is the exact supported exchange path from the logged-in customer JWT to a commerce MCP OAuth token?

2. **Minimal discovery token**  
   Since `search_tools` is authenticated but `scopesRequired: []`, what baseline scope set should we use for discovery?

3. **Approved commerce scopes**  
   Which commerce scopes are allowed for AAB interactive use on day one?

4. **Policy granularity**  
   Are scopes alone enough, or do we also want tool/domain filtering for commerce?

5. **Result normalization**  
   What exact response shape should the browser/BFF bridge return to the agent and UI layer?

6. **PaaS token ownership**  
   For headless PaaS callers, who owns OAuth token acquisition?

---

## Summary

The best MCP pattern for this app is:

- **AAB interactive:** same-origin BFF MCP proxy
- **Auth:** logged-in customer JWT -> short-lived OAuth bearer token
- **Discovery:** authenticated, but without broad upfront commerce scopes
- **Execution:** request the smallest allowed scope set needed for the selected tool
- **Agent model:** generic discovery + execution first; custom wrappers only where justified
- **Security:** host allowlist + scope ceiling + least-privilege per request + optional tool filtering + audit logging

That preserves the main value of MCP, avoids unnecessary popups, and gives AAB a clean control plane for future MCP integrations.
