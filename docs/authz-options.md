# PaaS AuthZ Options Analysis

## Problem Statement

The agents service has strong **AuthN** (JWT validation) and **tenant isolation** (siteId ownership checks), but **no product-level AuthZ**. A PaaS caller with a valid JWT can access all 60+ agent endpoints — including AAB-only features like social management, visual editing, share tokens, database CRUD, debug/diagnostics, etc.

We need a mechanism to restrict which API endpoints a PaaS consumer can call, without affecting AAB access.

---

## Option A: Route-Level Allowlist Middleware (Recommended)

**Concept:** A single new middleware (`require-product-access.ts`) that checks a `product` claim from the JWT against a static route allowlist. PaaS callers are denied at routes not in their allowlist.

### How it works

1. **Add `product` field to `AgentContext`** (extracted from JWT claims in `jwt-auth.ts`)
   - Values: `'aab'` | `'paas'` — defaults to `'aab'` if absent (backward compatible)

2. **Create route access registry** — a config object mapping product types to allowed route patterns:
   ```typescript
   // product-access.ts
   const PAAS_ALLOWED_ROUTES: RoutePattern[] = [
     { method: '*', path: '/health' },
     { method: '*', path: '/airo/health' },
     { method: 'POST', path: '/apps/:id/publish' },
     { method: 'POST', path: '/apps/:id/unpublish' },
     { method: '*', path: '/apps/:id/git/*' },
     { method: '*', path: '/apps/:id/zip/*' },
     { method: '*', path: '/apps/:id/files/*' },
     { method: '*', path: '/agent/conversations*' },
     { method: '*', path: '/agent/*/chat*' },
   ];
   ```

3. **Gate WebSocket connections** — The Socket.IO server authenticates via a connection middleware in `ai-lib-websocket-server.ts` (lines 2068-2201), which validates the JWT and stores `agentContext` on `socket.handshake.auth`. Add a product check in that same middleware after `agentContext` is created:
   ```typescript
   // In the Socket.IO auth middleware (ai-lib-websocket-server.ts)
   const agentContext = await validateAndCreateAgentContext(token);
   if (agentContext.product === 'paas') {
     return next(new Error('WebSocket not available for this product'));
   }
   socket.handshake.auth.agentContext = agentContext;
   ```
   If PaaS should be allowed WebSocket access in the future, this can be changed to an event-level allowlist (e.g., allow `chat` events but deny `grant_context`).

4. **Create `validateProductAccess` middleware** — applied globally after JWT auth, before route handlers:
   ```typescript
   function validateProductAccess(req, res, next) {
     const { product } = req.agentContext;
     if (product === 'aab') return next(); // AAB: unrestricted
     if (isRouteAllowed(product, req.method, req.path)) return next();
     return res.status(403).json({ error: 'Route not available for this product' });
   }
   ```

4. **Mount in `app.ts`** as a single global middleware after JWT auth, or per-router group.

### Files to modify
- `agents/src/server/middleware/jwt-auth.ts` — add `product` to `AgentContext`
- `agents/src/server/middleware/product-access.ts` — **new file**, route allowlist + middleware
- `agents/src/server/app.ts` — apply middleware globally after JWT auth
- `agents/src/server/ai-lib-websocket-server.ts` — add product check in Socket.IO auth middleware (line ~2165)
- `agents/src/server/middleware/index.ts` — export new middleware
- Tests: new unit test for product-access middleware, WebSocket connection rejection test, update auth integration tests

### Pros
- **Single enforcement point** — one middleware, one config, easy to audit
- **Backward compatible** — missing `product` claim defaults to `'aab'`, zero impact on existing callers
- **Allowlist approach** — new routes are denied by default for PaaS (secure by default)
- **Easy to extend** — adding a new product or adjusting access is a config change
- **Low touch** — no changes to individual route files

### Cons
- **Coarse-grained** — all-or-nothing per route (can't restrict specific operations within a route)
- **Route matching complexity** — need to handle Express path patterns correctly (`/apps/:id/git/*` etc.)
- **JWT change required** — the token issuer (app BFF / control plane) must start including the `product` claim

---

## Option B: Scope-Based Middleware (Fine-Grained Capabilities)

**Concept:** Instead of a product type, the JWT carries an array of **scopes/capabilities** (e.g., `['publish', 'git:push', 'git:pull', 'chat', 'files:read']`). Each route declares its required scope. The middleware checks if the caller's scopes include the required one.

### How it works

1. **Add `scopes` field to `AgentContext`** — array of strings extracted from JWT:
   ```typescript
   interface AgentContext {
     // ... existing fields
     scopes: string[]; // e.g., ['publish', 'git:push', 'files:read', 'chat']
   }
   ```

2. **Create `requireScope(scope: string)` middleware factory** — applied per-route:
   ```typescript
   function requireScope(scope: string) {
     return (req, res, next) => {
       if (req.agentContext.scopes.includes(scope) || req.agentContext.scopes.includes('*')) {
         return next();
       }
       res.status(403).json({ error: `Missing required scope: ${scope}` });
     };
   }
   ```

3. **Annotate each route** with its required scope:
   ```typescript
   router.post('/apps/:id/publish', requireScope('publish'), ...);
   router.post('/apps/:id/git/push', requireScope('git:push'), ...);
   router.get('/apps/:id/database/tables', requireScope('database:read'), ...);
   ```

4. **AAB tokens** get `scopes: ['*']` (wildcard = all access). **PaaS tokens** get a specific set.

5. **Gate WebSocket connections** — The Socket.IO auth middleware (`ai-lib-websocket-server.ts`, line 2068) already extracts `agentContext` from the JWT. Add a scope check after context creation:
   ```typescript
   if (!agentContext.scopes.includes('websocket') && !agentContext.scopes.includes('*')) {
     return next(new Error('Missing required scope: websocket'));
   }
   ```
   For finer control, individual Socket.IO event handlers (e.g., `chat`, `grant_context`) could also check scopes, but this adds complexity to the event dispatch layer in `experimental-websocket-server.ts`.

### Files to modify
- `agents/src/server/middleware/jwt-auth.ts` — add `scopes` to `AgentContext`
- `agents/src/server/middleware/require-scope.ts` — **new file**, scope check middleware
- **Every route file** (~15 files) — add `requireScope()` to each route definition
- `agents/src/server/ai-lib-websocket-server.ts` — add scope check in Socket.IO auth middleware
- `agents/src/server/middleware/index.ts` — export
- Tests: per-route scope tests, WebSocket scope rejection test

### Pros
- **Fine-grained** — can restrict at individual operation level (e.g., allow `files:read` but not `files:write`)
- **Industry standard** — follows OAuth2 scopes pattern, familiar to API consumers
- **Self-documenting** — each route declares exactly what it requires
- **Flexible for future products** — different PaaS tiers can get different scope sets

### Cons
- **High touch** — must modify every route file (15+ files, 60+ routes)
- **Scope explosion** — need to define and maintain a scope taxonomy
- **Harder to audit** — authorization logic is spread across all route files instead of one central config
- **JWT bloat** — large scope arrays increase token size
- **Not secure-by-default** — if you forget to add `requireScope()` to a new route, it's open

---

## Option C: Router-Level Product Gating (Grouped by Product)

**Concept:** Split protected routes into two groups in `app.ts` — **shared routes** (accessible to both) and **AAB-only routes**. Use a `denyPaaS` middleware on the AAB-only group.

### How it works

1. **Add `product` field to `AgentContext`** (same as Option A)

2. **Create simple `denyPaaS` middleware:**
   ```typescript
   function denyPaaS(req, res, next) {
     if (req.agentContext.product === 'paas') {
       return res.status(403).json({ error: 'Not available for PaaS' });
     }
     next();
   }
   ```

3. **Gate WebSocket connections** — Add `denyPaaS` logic in the Socket.IO auth middleware (`ai-lib-websocket-server.ts`, line 2068):
   ```typescript
   if (agentContext.product === 'paas') {
     return next(new Error('WebSocket not available for PaaS'));
   }
   ```

4. **Reorganize route mounting in `app.ts`:**
   ```typescript
   // Shared routes (AAB + PaaS)
   app.use('/', jwtAuth, publishRouter);
   app.use('/', jwtAuth, gitRemoteRouter);
   app.use('/', jwtAuth, zipImportRouter);
   app.use('/agent', jwtAuth, chatRouter);
   app.use('/apps', jwtAuth, appsRouter); // filtered subset
   app.use('/apps', jwtAuth, filesRouter); // file ops

   // AAB-only routes
   app.use('/', jwtAuth, denyPaaS, socialRouter);
   app.use('/', jwtAuth, denyPaaS, dbRouter);
   app.use('/', jwtAuth, denyPaaS, shareRouter);
   app.use('/', jwtAuth, denyPaaS, goLiveRouter);
   app.use('/', jwtAuth, denyPaaS, mediaRouter);
   app.use('/debug', jwtAuth, denyPaaS, debugRouter);
   // ... etc
   ```

### Files to modify
- `agents/src/server/middleware/jwt-auth.ts` — add `product` to `AgentContext`
- `agents/src/server/middleware/deny-paas.ts` — **new file**, simple deny middleware
- `agents/src/server/app.ts` — reorganize route mounting with `denyPaaS` on AAB-only groups
- `agents/src/server/ai-lib-websocket-server.ts` — add product check in Socket.IO auth middleware
- Tests: update integration tests, WebSocket connection rejection test

### Pros
- **Minimal code** — just a 10-line middleware + reorganize `app.ts`
- **Easy to understand** — look at `app.ts` to see what's shared vs AAB-only
- **No route-file changes** — individual route files stay untouched
- **Secure by default** — new routes added without thinking go to the default (denied) group

### Cons
- **Binary granularity** — entire routers are either allowed or denied (can't allow git push but deny git configure within the same router)
- **Fragile ordering** — route organization in `app.ts` becomes the security boundary
- **Mixed routers** — some routers (e.g., `appsRouter`) have both shared and AAB-only routes, requiring further splitting or sub-router extraction
- **Scales poorly** — adding a third product type (e.g., "PaaS-Pro") would require more middleware layers

---

## Comparison Matrix

| Criteria | Option A (Allowlist) | Option B (Scopes) | Option C (Router Groups) |
|---|---|---|---|
| **Granularity** | Per-route pattern | Per-route + per-operation | Per-router |
| **Files changed** | 4-5 | 15-20 | 4-5 |
| **Secure by default** | Yes (allowlist) | No (opt-in per route) | Depends on grouping |
| **Backward compat** | High | High | High |
| **Auditability** | Single config file | Spread across routes | Single file (app.ts) |
| **Future extensibility** | Good (add product configs) | Excellent (fine scope control) | Limited |
| **Complexity** | Medium | High | Low |
| **Risk of gaps** | Low | Medium (forgotten routes) | Medium (mixed routers) |
| **WebSocket gating** | Connection-level deny in Socket.IO middleware | Scope check at connection or per-event | Connection-level deny in Socket.IO middleware |

---

## Recommendation

**Option A (Route-Level Allowlist)** is the best fit because:

1. The immediate need is binary: PaaS should/shouldn't access certain routes — not fine-grained operation control within routes
2. Allowlist is secure by default — new endpoints are automatically blocked for PaaS
3. Single enforcement point is easy to audit and maintain
4. Low touch — doesn't require modifying 15+ route files
5. Can evolve toward Option B later if fine-grained scopes are needed

**Option C** is the simplest but breaks down for routers that mix shared and AAB-only routes (e.g., `appsRouter` has both `GET /apps` which PaaS needs and `DELETE /apps/:id` which it may not).

**Option B** is the most powerful but over-engineered for the current binary PaaS/AAB requirement.

---

## Pre-Requisite (All Options)

The JWT token issuer (app BFF or control plane) must include a `product` claim (or `scopes` array for Option B) when minting tokens. This is an upstream change outside the agents service.

For local dev / mock auth, the middleware should default to `'aab'` (full access) to avoid breaking existing development workflows.

---

## Verification

- Run existing authorization tests: `pnpm --filter @airo/agents test:unit "authorization"`
- Run existing middleware tests: `pnpm --filter @airo/agents test:unit "app-ownership"`
- Add new product-access middleware tests
- Manual test: Send requests with `product: 'paas'` JWT to blocked routes, verify 403
- Manual test: Send requests with `product: 'aab'` (or missing claim) to all routes, verify no regression
- Manual test: Attempt WebSocket connection with `product: 'paas'` JWT, verify connection is rejected
- Manual test: Verify WebSocket connection with `product: 'aab'` (or missing claim) still works
- `pnpm typecheck` and `pnpm lint` pass
