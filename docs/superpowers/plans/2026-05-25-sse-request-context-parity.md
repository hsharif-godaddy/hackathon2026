# SSE Request/Context Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining request/context gaps between SSE and WebSocket transports so the agent receives identical metadata (sessionId, userTimezone, market) regardless of transport, and enforce a reasonable payload limit on SSE message requests.

**Architecture:** Four independent changes: server-side metadata enrichment (sessionId + userTimezone), client-side timezone sending, client-side market fix in retry, and Express body limit. All changes are additive — no existing behavior is altered.

**Tech Stack:** TypeScript, Express, Vitest, React hooks (testing-library)

---

### Task 1: Add sessionId to SSE executionContext metadata

**Files:**
- Modify: `agents/src/server/sse/MessageExecutionService.ts:1156-1178`
- Test: `agents/src/server/sse/__tests__/MessageExecutionService.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `MessageExecutionService` test file, inside the top-level `describe('MessageExecutionService', ...)` block:

```typescript
it('includes sessionId in executionContext metadata', async () => {
  const mockExecute = vi.fn().mockResolvedValue(undefined)
  deps = createMockDeps()
  deps.contextManager.loadContextMessages.mockResolvedValue({ contextMessages: [], formattedContexts: [] })
  service = new MessageExecutionService(deps as any)

  await service.execute(DEFAULT_PARAMS)

  // contextManager.loadContextMessages receives the full executionContext
  const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
  expect(executionContext.metadata.sessionId).toBe('sse:conv_1')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit -t "includes sessionId in executionContext metadata"`
Expected: FAIL — `metadata.sessionId` is `undefined`

- [ ] **Step 3: Implement the fix**

In `agents/src/server/sse/MessageExecutionService.ts`, add `sessionId: sseSocketId` to the metadata object at line 1157:

```typescript
const executionContext: Record<string, unknown> = {
  metadata: {
    sessionId: sseSocketId,
    appId, siteId, conversationId, templateId, modelOverride, agentProfile,
    agentId: resolvedAgentId,
    // ... rest unchanged
  },
  // ... rest unchanged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit -t "includes sessionId in executionContext metadata"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts agents/src/server/sse/__tests__/MessageExecutionService.test.ts
git commit -m "feat(sse): add sessionId to executionContext metadata

Enables OTel transaction labels and budget correlation for SSE
sessions, matching what WebSocket provides via metadata.sessionId."
```

---

### Task 2: Add userTimezone to SSE transport (client side)

**Files:**
- Modify: `app/src/services/transport/types.ts:17-35`
- Modify: `app/src/services/transport/SSETransport.ts:222-246`
- Test: `app/src/services/transport/__tests__/SSETransport.test.ts`

- [ ] **Step 1: Add userTimezone to SendMessageParams interface**

In `app/src/services/transport/types.ts`, add `userTimezone` to the `SendMessageParams` interface:

```typescript
export interface SendMessageParams {
  content: string
  sessionId: string
  userTimezone?: string
  visualContext?: unknown
  // ... rest unchanged
}
```

- [ ] **Step 2: Write the failing test**

Add to `app/src/services/transport/__tests__/SSETransport.test.ts`, near the existing `sendMessage` tests:

```typescript
it('includes userTimezone in POST body', async () => {
  transport.connect('app_1', 'token_123', 'conv_1')
  await vi.waitFor(() => {
    expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
  })

  await transport.sendMessage({
    content: 'Hello',
    sessionId: 'sess_1',
    userTimezone: 'America/New_York',
  })

  const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
    (c: any[]) => (c[0] as string).includes('/messages')
  )
  const body = JSON.parse(call[1].body)
  expect(body.userTimezone).toBe('America/New_York')
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter website test "SSETransport.test" -- -t "includes userTimezone in POST body"`
Expected: FAIL — `body.userTimezone` is `undefined`

- [ ] **Step 4: Implement the fix**

In `app/src/services/transport/SSETransport.ts`, add `userTimezone` to the JSON body in `sendMessage`:

```typescript
async sendMessage(params: SendMessageParams): Promise<void> {
  if (!this.appId || !this.conversationId) throw new Error('Not connected')

  const response = await this.authedFetch(`${this.convPath}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content: params.content,
      sessionId: params.sessionId,
      userTimezone: params.userTimezone,
      templateId: params.templateId,
      // ... rest unchanged
    })
  })
  // ... rest unchanged
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter website test "SSETransport.test" -- -t "includes userTimezone in POST body"`
Expected: PASS

- [ ] **Step 6: Wire userTimezone in useSSEChat sendMessage**

In `app/src/hooks/useSSEChat.ts`, add a module-level cached timezone constant near the top (after imports):

```typescript
const BROWSER_TIMEZONE: string = Intl.DateTimeFormat().resolvedOptions().timeZone
```

Then in the `sendMessage` callback (around line 932), add `userTimezone: BROWSER_TIMEZONE` to the `t.sendMessage(...)` call:

```typescript
await t.sendMessage({
  content: options.content,
  sessionId: activeAppId,
  userTimezone: BROWSER_TIMEZONE,
  templateId: options.templateId,
  // ... rest unchanged
})
```

- [ ] **Step 7: Commit**

```bash
git add app/src/services/transport/types.ts app/src/services/transport/SSETransport.ts app/src/services/transport/__tests__/SSETransport.test.ts app/src/hooks/useSSEChat.ts
git commit -m "feat(sse): send userTimezone in SSE message requests

Sends the browser's IANA timezone string so the agent prompt includes
timezone context, matching the WebSocket ChatMessageBuilder behavior."
```

---

### Task 3: Accept and forward userTimezone on the server

**Files:**
- Modify: `agents/src/server/sse/routes.ts:442-448,547-569`
- Modify: `agents/src/server/sse/MessageExecutionService.ts:149-178,1156-1178`
- Test: `agents/src/server/sse/__tests__/routes.test.ts`
- Test: `agents/src/server/sse/__tests__/MessageExecutionService.test.ts`

- [ ] **Step 1: Write the failing route validation test**

Add to `agents/src/server/sse/__tests__/routes.test.ts` inside the `POST /api/conversations/:appId/:conversationId/messages` describe block:

```typescript
it('returns 400 when userTimezone is not a string', async () => {
  const res = await request(app)
    .post('/api/conversations/abcdefghij/conv_1/messages')
    .send({ content: 'Hello agent', userTimezone: 123 })

  expect(res.status).toBe(400)
  expect(res.body.error).toBe('userTimezone must be a string')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "routes.test" -t "returns 400 when userTimezone is not a string"`
Expected: FAIL — returns 202 (or 503), not 400

- [ ] **Step 3: Add userTimezone validation in routes.ts**

In `agents/src/server/sse/routes.ts`, add `userTimezone` to the destructuring (line 442) and add validation after the existing `market` check (after line 463):

Destructuring change (line 442-449):
```typescript
const {
  content, agentId, agentProfile,
  templateId, modelOverride,
  visualContext, aiEditContext, aiEditContexts, selectedAssets,
  todoListContext, isActionRequest, customContext, buildErrorContext,
  uploadedFileName,
  market,
  userTimezone,
} = req.body
```

Validation (after the `market` validation block):
```typescript
if (userTimezone !== undefined && typeof userTimezone !== 'string') {
  res.status(400).json({ error: 'userTimezone must be a string' })
  return
}
```

- [ ] **Step 4: Run route validation test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "routes.test" -t "returns 400 when userTimezone is not a string"`
Expected: PASS

- [ ] **Step 5: Write the failing forwarding test**

Add to `agents/src/server/sse/__tests__/routes.test.ts`:

```typescript
it('forwards userTimezone to executionService', async () => {
  const mockExecute = vi.fn().mockResolvedValue(undefined)
  const depsWithService = {
    ...deps,
    executionService: { execute: mockExecute, hasActiveStream: vi.fn().mockReturnValue(false) }
  }
  const appWithService = express()
  appWithService.use(express.json())
  appWithService.use('/api/conversations', createSSERoutes(depsWithService as any))

  const res = await request(appWithService)
    .post('/api/conversations/abcdefghij/conv_1/messages')
    .send({ content: 'Hello', userTimezone: 'America/Denver' })

  expect(res.status).toBe(202)
  // Poll until execute() is called — it fires after the 202 response returns.
  for (let i = 0; i < 50 && mockExecute.mock.calls.length === 0; i++) {
    await new Promise(r => setTimeout(r, 5))
  }
  expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
    userTimezone: 'America/Denver',
  }))
})
```

- [ ] **Step 6: Forward userTimezone in the execute call**

In `agents/src/server/sse/routes.ts`, add `userTimezone` to the `deps.executionService.execute(...)` call (around line 547-569):

```typescript
deps.executionService.execute({
  appId,
  conversationId,
  content: effectiveContent,
  siteId,
  agentId: resolvedAgentId,
  agentProfile,
  templateId,
  modelOverride,
  visualContext,
  aiEditContext,
  aiEditContexts,
  selectedAssets,
  todoListContext,
  isActionRequest,
  customContext,
  buildErrorContext,
  uploadedFileName,
  userTimezone,
  bmsBudgetId,
  // ... rest unchanged
})
```

- [ ] **Step 7: Add userTimezone to ExecuteParams interface**

In `agents/src/server/sse/MessageExecutionService.ts`, add to the `ExecuteParams` interface (around line 178):

```typescript
interface ExecuteParams {
  // ... existing fields ...
  market?: string
  userTimezone?: string
}
```

- [ ] **Step 8: Destructure and spread userTimezone in executeUnderTrace**

In `MessageExecutionService.ts` at line 1041, add `userTimezone` to the destructuring:

```typescript
private async executeUnderTrace(params: ExecuteParams): Promise<void> {
  const {
    appId, conversationId, content, siteId, agentId, agentProfile,
    templateId, modelOverride,
    visualContext, aiEditContext, aiEditContexts, selectedAssets,
    todoListContext, isActionRequest, customContext, buildErrorContext,
    bmsBudgetId, budgetSessionId, subscriptionId, authType,
    lifecycleContext, uploadedFileName, market, userTimezone,
  } = params
```

Then in the metadata object (line 1157+), add the spread:

```typescript
const executionContext: Record<string, unknown> = {
  metadata: {
    sessionId: sseSocketId,
    appId, siteId, conversationId, templateId, modelOverride, agentProfile,
    agentId: resolvedAgentId,
    ...(userTimezone && { userTimezone }),
    // ... rest unchanged
  },
}
```

- [ ] **Step 9: Write the failing metadata test**

Add to `agents/src/server/sse/__tests__/MessageExecutionService.test.ts`:

```typescript
it('includes userTimezone in executionContext metadata when provided', async () => {
  deps = createMockDeps()
  service = new MessageExecutionService(deps as any)

  await service.execute({ ...DEFAULT_PARAMS, userTimezone: 'Europe/Berlin' })

  const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
  expect(executionContext.metadata.userTimezone).toBe('Europe/Berlin')
})

it('omits userTimezone from metadata when not provided', async () => {
  deps = createMockDeps()
  service = new MessageExecutionService(deps as any)

  await service.execute(DEFAULT_PARAMS)

  const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
  expect(executionContext.metadata.userTimezone).toBeUndefined()
})
```

- [ ] **Step 10: Run all tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "routes.test" && pnpm --filter @airo/agents test:unit "MessageExecutionService.test"`
Expected: All PASS

- [ ] **Step 11: Commit**

```bash
git add agents/src/server/sse/routes.ts agents/src/server/sse/MessageExecutionService.ts agents/src/server/sse/__tests__/routes.test.ts agents/src/server/sse/__tests__/MessageExecutionService.test.ts
git commit -m "feat(sse): accept and forward userTimezone to agent context

Server validates the field, passes it through to executionContext
metadata, where buildDynamicDataMessage uses it to inject timezone
info into the agent prompt."
```

---

### Task 4: Preserve market in APP_NOT_FOUND retry

**Files:**
- Modify: `app/src/hooks/useSSEChat.ts:529-546`
- Test: `app/src/hooks/__tests__/useSSEChat.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `app/src/hooks/__tests__/useSSEChat.test.ts`, near the existing `APP_NOT_FOUND resend forwards aiEditContexts` test:

```typescript
it('APP_NOT_FOUND resend preserves market', async () => {
  const hook = await setupHook({ market: 'es-ES' })

  await act(async () => {
    await hook.result.current.actions.send({ content: 'hola' })
  })

  lastTransport.sendMessage.mockClear()
  vi.useFakeTimers()

  act(() => {
    lastTransport.callbacks?.onEvent({
      type: 'stream_error',
      content: 'app not ready',
      data: { errorType: 'APP_NOT_FOUND', message: 'app not ready' },
    })
  })

  await act(async () => {
    vi.advanceTimersByTime(500)
    await Promise.resolve()
  })

  expect(lastTransport.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    content: 'hola',
    market: 'es-ES',
  }))
})
```

Note: Check how `setupHook` accepts `market`. If it doesn't, you'll need to set the market ref. Look at how `marketRef` is populated — it comes from the `market` prop of the hook's parent component or from a store. Match the existing test patterns for setting market state. If `setupHook` doesn't accept `market`, set it via the store or hook params before sending.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test "useSSEChat.test" -- -t "APP_NOT_FOUND resend preserves market"`
Expected: FAIL — `market` is `undefined` in the resend call

- [ ] **Step 3: Add market to the retry payload**

In `app/src/hooks/useSSEChat.ts`, at line 545 (just before the closing of the sendMessage call in the retry timer), add `market: marketRef.current`:

```typescript
transport.sendMessage({
  content: pending.content,
  sessionId: currentAppId ?? 'unknown',
  userTimezone: BROWSER_TIMEZONE,
  templateId: pending.templateId,
  modelOverride: pending.modelOverride,
  agentProfile: pending.agentProfile,
  visualContext: pending.visualContext,
  aiEditContext: pending.aiEditContext,
  aiEditContexts: pending.aiEditContexts,
  selectedAssets: pending.selectedAssets,
  todoListContext: pending.todoListContext,
  isActionRequest: pending.isActionRequest,
  customContext: pending.customContext,
  budgetServiceEnabled: isBudgetServiceEnabledRef.current || undefined,
  subscriptionId: subscriptionIdRef.current,
  buildErrorContext: undefined,
  uploadedFileName: pending.uploadedFileName,
  market: marketRef.current,
}).catch(err => {
  // ... existing error handler
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter website test "useSSEChat.test" -- -t "APP_NOT_FOUND resend preserves market"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useSSEChat.ts app/src/hooks/__tests__/useSSEChat.test.ts
git commit -m "fix(sse): preserve market in APP_NOT_FOUND retry

The retry payload was missing market, causing the agent to lose
locale context on retried messages during app provisioning."
```

---

### Task 5: Add Express body-size limit for SSE routes

**Files:**
- Modify: `agents/src/server/sse/routes.ts:79-81`
- Test: `agents/src/server/sse/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `agents/src/server/sse/__tests__/routes.test.ts` inside the messages describe block:

```typescript
it('returns 413 when request body exceeds 1MB', async () => {
  const mockExecute = vi.fn().mockResolvedValue(undefined)
  const depsWithService = {
    ...deps,
    executionService: { execute: mockExecute, hasActiveStream: vi.fn().mockReturnValue(false) }
  }
  const appWithLimit = express()
  appWithLimit.use('/api/conversations', createSSERoutes(depsWithService as any))

  const res = await request(appWithLimit)
    .post('/api/conversations/abcdefghij/conv_1/messages')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ content: 'x', customContext: { data: 'y'.repeat(1_100_000) } }))

  expect(res.status).toBe(413)
})
```

Note: This test intentionally does NOT add `express.json()` before the SSE routes — the router should provide its own body parser with the 1MB limit.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "routes.test" -t "returns 413 when request body exceeds 1MB"`
Expected: FAIL — currently either no body parsing (400/empty body) or uses the global 10MB limit (202)

- [ ] **Step 3: Add the body-size limit**

In `agents/src/server/sse/routes.ts`, inside `createSSERoutes` after `const router = Router()` (line 80), add:

```typescript
export function createSSERoutes(deps: SSERouteDeps): Router {
  const router = Router()

  router.use(express.json({ limit: '1mb' }))

  // ... rest unchanged
}
```

Add the import if not already present:

```typescript
import express from 'express'
```

Note: Check if `express` is already imported. If only `Router` and types are imported from `express`, add the default import.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "routes.test" -t "returns 413 when request body exceeds 1MB"`
Expected: PASS

- [ ] **Step 5: Update the existing test setup**

The existing route tests use `appWithService.use(express.json())` before mounting SSE routes. Since the router now has its own body parser, remove the explicit `express.json()` in the test `beforeEach` to verify the router is self-sufficient. Run the full routes test suite:

Run: `pnpm --filter @airo/agents test:unit "routes.test"`
Expected: All existing tests still PASS (the router's own `express.json({ limit: '1mb' })` handles parsing)

If tests fail because the top-level `beforeEach` `app` still needs json parsing for other routes in the test, keep `express.json()` in the test setup but ensure the 413 test does NOT include it (as written in step 1).

- [ ] **Step 6: Commit**

```bash
git add agents/src/server/sse/routes.ts agents/src/server/sse/__tests__/routes.test.ts
git commit -m "feat(sse): add 1MB body-size limit for SSE message routes

The SSE /messages POST carries text and metadata only (images upload
via separate multipart endpoints). The previous 10MB global limit was
excessive for this payload shape."
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full test suites for affected packages**

```bash
pnpm --filter @airo/agents test:unit "src/server/sse/"
pnpm --filter website test "SSETransport"
pnpm --filter website test "useSSEChat"
```

Expected: All PASS

- [ ] **Step 2: Type check**

```bash
pnpm typecheck
```

Expected: No errors

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

Expected: No errors (or only pre-existing ones unrelated to this PR)
