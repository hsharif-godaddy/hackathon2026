# SSE Observability Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-message request ID threading, Elastic APM transaction parity, and client trace ID extraction to the SSE transport so observability matches WebSocket.

**Architecture:** Thread the existing `req.requestId` (nanoid 8) from the route handler into `MessageExecutionService.execute()`. Start an APM transaction at the route handler level covering precheck + execution. On the client, extract `traceId`/`observationId`/`requestId` from SSE terminal events and store in `useDevelopPageStore`.

**Tech Stack:** TypeScript, Express, elastic-apm-node, Vitest, Zustand (useDevelopPageStore)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `agents/src/server/sse/MessageExecutionService.ts` | Accept `requestId` + APM transaction; include `requestId` in all logs and terminal events; label + end transaction at terminal |
| `agents/src/server/sse/routes.ts` | Start APM transaction, pass `requestId` + transaction into `execute()` |
| `app/src/stores/useDevelopPageStore.ts` | Extend `TraceIds` interface with optional `requestId` |
| `app/src/hooks/useSSEChat.ts` | Extract trace IDs + requestId from complete/error/user_stopped, store in develop page store |
| `agents/src/server/sse/__tests__/MessageExecutionService.test.ts` | Test requestId in logs/terminal events, APM transaction lifecycle |
| `agents/src/server/sse/__tests__/routes.test.ts` | Test requestId passed to execute, APM transaction started |
| `app/src/hooks/__tests__/useSSEChat.test.ts` | Test trace ID extraction from terminal events |

---

### Task 1: Extend TraceIds type with requestId

**Files:**
- Modify: `app/src/stores/useDevelopPageStore.ts:26-30`

- [ ] **Step 1: Add `requestId` to the `TraceIds` interface**

```typescript
export interface TraceIds {
  traceId: string
  observationId: string
  agentName?: string
  requestId?: string
}
```

- [ ] **Step 2: Run typecheck to verify no breakage**

Run: `pnpm --filter website typecheck`
Expected: PASS (field is optional, no consumers break)

- [ ] **Step 3: Commit**

```bash
git add app/src/stores/useDevelopPageStore.ts
git commit -m "feat(sse): extend TraceIds with optional requestId field"
```

---

### Task 2: Thread requestId into MessageExecutionService

**Files:**
- Modify: `agents/src/server/sse/MessageExecutionService.ts:149-179` (ExecuteParams interface)
- Modify: `agents/src/server/sse/MessageExecutionService.ts:1016-1050` (execute + executeUnderTrace)
- Test: `agents/src/server/sse/__tests__/MessageExecutionService.test.ts`

- [ ] **Step 1: Write the failing test — requestId appears in terminal complete event**

Add to `agents/src/server/sse/__tests__/MessageExecutionService.test.ts`:

```typescript
it('includes requestId in the complete event data', async () => {
  deps = createMockDeps([{ type: 'text-delta', text: 'hi' }])
  service = new MessageExecutionService(deps as any)

  await service.execute({ ...DEFAULT_PARAMS, requestId: 'req_abc1' })

  const completeCall = deps.eventChannel.publish.mock.calls.find(
    ([, evt]) => evt.type === 'complete'
  )
  expect(completeCall).toBeDefined()
  expect(completeCall![1].data).toMatchObject({ requestId: 'req_abc1' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "MessageExecutionService.test"`
Expected: FAIL — `requestId` not present in complete event data

- [ ] **Step 3: Add `requestId` to ExecuteParams interface**

In `agents/src/server/sse/MessageExecutionService.ts`, add to the `ExecuteParams` interface:

```typescript
interface ExecuteParams {
  appId: string
  conversationId: string
  content: string
  siteId: string
  agentId: string
  // ... existing fields ...
  market?: string
  /** Per-request correlation ID from the HTTP request-logger middleware. */
  requestId?: string
}
```

- [ ] **Step 4: Destructure requestId in executeUnderTrace and include in all terminal events**

In the `executeUnderTrace` method, destructure `requestId` from params alongside the other fields:

```typescript
private async executeUnderTrace(params: ExecuteParams): Promise<void> {
  const {
    appId, conversationId, content, siteId, agentId, agentProfile,
    templateId, modelOverride,
    visualContext, aiEditContext, aiEditContexts, selectedAssets,
    todoListContext, isActionRequest, customContext, buildErrorContext,
    bmsBudgetId, budgetSessionId, subscriptionId, authType,
    lifecycleContext, uploadedFileName, market, requestId,
  } = params
```

Then include `requestId` in each terminal event's `data` object. There are three publish sites for `complete` events (success ~line 1531, aborted ~line 1616, error ~line 1644) and one `error` event (~line 1634). Add `...(requestId && { requestId })` to each `data` spread:

Success complete (~line 1531):
```typescript
data: {
  source: 'ai_response',
  agentId: finalAgentName,
  finishReason,
  totalSteps: lastTurnResult?.currentStep ?? 1,
  commitHash,
  usedFreeGrants,
  ...(activeAgentMessageId && { messageId: activeAgentMessageId }),
  ...getCurrentTraceIds(),
  ...(requestId && { requestId }),
},
```

Aborted complete (~line 1616):
```typescript
data: {
  source: 'ai_response',
  finishReason: 'aborted',
  ...(activeAgentMessageId && { messageId: activeAgentMessageId }),
  ...getCurrentTraceIds(),
  ...(requestId && { requestId }),
},
```

Error event (~line 1634):
```typescript
data: {
  source: 'ai_response',
  error: clientMessage,
  timestamp: new Date().toISOString(),
  ...(activeAgentMessageId && { messageId: activeAgentMessageId }),
  ...(requestId && { requestId }),
},
```

Error complete (~line 1644):
```typescript
data: {
  source: 'ai_response',
  finishReason: 'error',
  ...(activeAgentMessageId && { messageId: activeAgentMessageId }),
  ...getCurrentTraceIds(),
  ...(requestId && { requestId }),
},
```

Also add `requestId` to the `user_stopped` terminal in the `stop()` method (~line 308):
```typescript
data: { finishReason: 'user_stopped', ...getCurrentTraceIds(), ...(requestId && { requestId }) },
```

Note: The `stop()` method doesn't receive requestId from the original execute call. The user_stopped event is published in `stop()` which only has `conversationId`. To include requestId there, store it on the `ActiveStream` interface:

```typescript
interface ActiveStream {
  appId: string
  convId: string
  subscriberIds: Set<string>
  requestId?: string
}
```

Set it when creating the stream state in `executeUnderTrace`:
```typescript
const streamState: ActiveStream = { appId, convId: conversationId, subscriberIds: new Set(), requestId }
```

Then in `stop()`:
```typescript
data: { finishReason: 'user_stopped', ...getCurrentTraceIds(), ...(active.requestId && { requestId: active.requestId }) },
```

- [ ] **Step 5: Include requestId in structured logs**

Add `requestId` to the key log calls in `executeUnderTrace`. Find and update these log calls:
- `sse.execution.complete` (~line 1547)
- `sse.execution.error` (~line 1633)
- `sse.execution.aborted` (~line 1615)
- `sse.execution.stopped` in `stop()` (~line 285)

Example for the complete log:
```typescript
logger.info('sse.execution.complete', { appId, conversationId, requestId, agentId: finalAgentName, finishReason, iterations: loopResult.iterations })
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "MessageExecutionService.test"`
Expected: PASS

- [ ] **Step 7: Write additional tests — requestId in error and aborted paths**

```typescript
it('includes requestId in error terminal events', async () => {
  deps = createMockDeps([])
  deps.getAgent.mockReturnValue({
    streamGenerate: vi.fn().mockRejectedValue(new Error('provider down')),
    getName: vi.fn().mockReturnValue('AI Developer'),
  })
  service = new MessageExecutionService(deps as any)

  await service.execute({ ...DEFAULT_PARAMS, requestId: 'req_err1' })

  const errorCall = deps.eventChannel.publish.mock.calls.find(
    ([, evt]) => evt.type === 'error'
  )
  expect(errorCall).toBeDefined()
  expect(errorCall![1].data).toMatchObject({ requestId: 'req_err1' })

  const completeCall = deps.eventChannel.publish.mock.calls.find(
    ([, evt]) => evt.type === 'complete' && evt.data?.finishReason === 'error'
  )
  expect(completeCall).toBeDefined()
  expect(completeCall![1].data).toMatchObject({ requestId: 'req_err1' })
})

it('includes requestId in user_stopped terminal event', async () => {
  deps = createMockDeps([
    { type: 'text-delta', text: 'streaming...' },
    // Simulate a long stream by using a never-resolving promise approach
  ])
  service = new MessageExecutionService(deps as any)

  // Start execution and stop it mid-stream
  const executePromise = service.execute({ ...DEFAULT_PARAMS, requestId: 'req_stop1' })
  // Give execute time to register the abort controller
  await new Promise(r => setTimeout(r, 10))
  service.stop('conv_1')
  await executePromise

  const completeCall = deps.eventChannel.publish.mock.calls.find(
    ([, evt]) => evt.type === 'complete' && evt.data?.finishReason === 'user_stopped'
  )
  expect(completeCall).toBeDefined()
  expect(completeCall![1].data).toMatchObject({ requestId: 'req_stop1' })
})
```

- [ ] **Step 8: Run tests to verify all pass**

Run: `pnpm --filter @airo/agents test:unit "MessageExecutionService.test"`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts agents/src/server/sse/__tests__/MessageExecutionService.test.ts
git commit -m "feat(sse): thread requestId into execution and terminal events"
```

---

### Task 3: Pass requestId from route handler to execute

**Files:**
- Modify: `agents/src/server/sse/routes.ts:547-599`
- Test: `agents/src/server/sse/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test — requestId passed to execute**

Add to `agents/src/server/sse/__tests__/routes.test.ts` inside the `POST /api/conversations/:appId/:conversationId/messages` describe block:

```typescript
it('passes requestId from request-logger middleware to execute()', async () => {
  const mockExecute = vi.fn().mockResolvedValue(undefined)
  const depsWithService = {
    ...deps,
    executionService: { execute: mockExecute, hasActiveStream: vi.fn().mockReturnValue(false) },
  }
  const appWithService = express()
  appWithService.use(express.json())
  // Simulate request-logger middleware attaching requestId
  appWithService.use((req: any, _res: any, next: any) => {
    req.requestId = 'test-req-id'
    next()
  })
  appWithService.use('/api/conversations', createSSERoutes(depsWithService as any))

  await request(appWithService)
    .post('/api/conversations/abcdefghij/conv_1/messages')
    .send({ content: 'Hello' })

  // Poll until execute is called
  for (let i = 0; i < 50 && mockExecute.mock.calls.length === 0; i++) {
    await new Promise(r => setTimeout(r, 5))
  }
  expect(mockExecute).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: 'test-req-id' })
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "routes.test" -t "passes requestId"`
Expected: FAIL — `requestId` not in execute call

- [ ] **Step 3: Add requestId to the execute call in routes.ts**

In `agents/src/server/sse/routes.ts`, in the POST messages handler (~line 547), add `requestId` to the execute call:

```typescript
deps.executionService.execute({
  appId,
  conversationId,
  content: effectiveContent,
  siteId,
  agentId: resolvedAgentId,
  // ... existing fields ...
  requestHeaders: req.headers as Record<string, string | string[] | undefined>,
  requestId: (req as any).requestId,
  lifecycleContext: {
    // ... existing ...
  },
}).catch(err => {
  logger.error('sse.chat.execution_failed', { appId, conversationId, ...errorFields(err) })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "routes.test" -t "passes requestId"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/src/server/sse/routes.ts agents/src/server/sse/__tests__/routes.test.ts
git commit -m "feat(sse): pass requestId from route handler to execute()"
```

---

### Task 4: Add Elastic APM transaction to SSE message route

**Files:**
- Modify: `agents/src/server/sse/routes.ts:438-600`
- Modify: `agents/src/server/sse/MessageExecutionService.ts:149-179, 1016-1050`
- Test: `agents/src/server/sse/__tests__/routes.test.ts`
- Test: `agents/src/server/sse/__tests__/MessageExecutionService.test.ts`

- [ ] **Step 1: Write the failing test — APM transaction starts and labels at route level**

Add to `agents/src/server/sse/__tests__/routes.test.ts`:

```typescript
it('starts an APM transaction with initial labels on POST /messages', async () => {
  const mockTransaction = {
    setLabel: vi.fn(),
    setOutcome: vi.fn(),
    end: vi.fn(),
    result: undefined as string | undefined,
  }
  const mockApm = await import('elastic-apm-node')
  vi.spyOn(mockApm.default, 'startTransaction').mockReturnValue(mockTransaction as any)

  const mockExecute = vi.fn().mockResolvedValue(undefined)
  const depsWithService = {
    ...deps,
    executionService: { execute: mockExecute, hasActiveStream: vi.fn().mockReturnValue(false) },
  }
  const appWithService = express()
  appWithService.use(express.json())
  appWithService.use((req: any, _res: any, next: any) => {
    req.requestId = 'apm-req-id'
    req.agentContext = { customerId: 'cust-123' }
    next()
  })
  appWithService.use('/api/conversations', createSSERoutes(depsWithService as any))

  await request(appWithService)
    .post('/api/conversations/abcdefghij/conv_1/messages')
    .send({ content: 'Hello agent' })

  expect(mockApm.default.startTransaction).toHaveBeenCalledWith('SSE Message', 'request')
  expect(mockTransaction.setLabel).toHaveBeenCalledWith('requestId', 'apm-req-id')
  expect(mockTransaction.setLabel).toHaveBeenCalledWith('conversationId', 'conv_1')
  expect(mockTransaction.setLabel).toHaveBeenCalledWith('customerId', 'cust-123')
  expect(mockTransaction.setLabel).toHaveBeenCalledWith('messageLength', 11)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "routes.test" -t "starts an APM transaction"`
Expected: FAIL

- [ ] **Step 3: Add APM transaction start in the route handler**

At the top of the POST messages handler in `routes.ts`, after validation and before budget precheck:

```typescript
import apm from 'elastic-apm-node'

// Inside the handler, after content validation passes:
const apmTransaction = apm.startTransaction('SSE Message', 'request')
if (apmTransaction) {
  apmTransaction.setLabel('requestId', (req as any).requestId ?? 'unknown')
  apmTransaction.setLabel('conversationId', conversationId)
  apmTransaction.setLabel('messageLength', content.length)
  apmTransaction.setLabel('isInitialPrompt', 'false') // updated after DB check
  if (agentContext?.customerId) {
    apmTransaction.setLabel('customerId', agentContext.customerId)
  }
  if (agentContext?.trafficSessionId) {
    apmTransaction.setLabel('sessionId', agentContext.trafficSessionId)
  }
}
```

After `isInitialPrompt` is computed (~line 542), update the label:
```typescript
if (apmTransaction) {
  apmTransaction.setLabel('isInitialPrompt', String(isInitialPrompt))
}
```

On budget 402 early return, end the transaction:
```typescript
if (BudgetExceededError.isInstance(err)) {
  if (apmTransaction) {
    apmTransaction.setLabel('finishReason', 'budget_exceeded')
    apmTransaction.result = 'error'
    apmTransaction.setOutcome('failure')
    apmTransaction.end()
  }
  res.status(402).json({ error: (err as Error).message })
  return
}
```

- [ ] **Step 4: Add `apmTransaction` to ExecuteParams and pass it from route**

Add to `ExecuteParams` in `MessageExecutionService.ts`:
```typescript
/** Elastic APM transaction reference — labeled and ended by the execution service at terminal. */
apmTransaction?: import('elastic-apm-node').Transaction | null
```

Pass from the route handler:
```typescript
deps.executionService.execute({
  // ... existing fields ...
  requestId: (req as any).requestId,
  apmTransaction,
  lifecycleContext: { /* ... */ },
})
```

- [ ] **Step 5: Label and end APM transaction at terminal in MessageExecutionService**

In `executeUnderTrace`, destructure `apmTransaction` and label it after agent resolution:

```typescript
const { /* existing destructuring */, requestId, apmTransaction } = params

// After agent name is resolved:
if (apmTransaction) {
  apmTransaction.setLabel('agent_name', resolvedAgentId)
}
```

At the success terminal (~after line 1547):
```typescript
if (apmTransaction) {
  apmTransaction.setLabel('finishReason', finishReason)
  apmTransaction.setLabel('agent_id', finalAgentName)
  if (lastTurnResult?.currentStep) apmTransaction.setLabel('steps', lastTurnResult.currentStep)
  apmTransaction.result = 'success'
  apmTransaction.setOutcome('success')
  apmTransaction.end()
}
```

At the aborted path (~line 1615):
```typescript
if (apmTransaction) {
  apmTransaction.setLabel('finishReason', 'aborted')
  apmTransaction.result = 'aborted'
  apmTransaction.setOutcome('unknown')
  apmTransaction.end()
}
```

At the error path (~line 1633):
```typescript
if (apmTransaction) {
  apmTransaction.setLabel('finishReason', 'error')
  apmTransaction.setLabel('error_message', clientMessage)
  apmTransaction.setLabel('error_type', err.name || 'Error')
  apmTransaction.result = 'error'
  apmTransaction.setOutcome('failure')
  apm.captureError(err, { custom: { requestId, conversationId } })
  apmTransaction.end()
}
```

In the `stop()` method — the APM transaction is stored on `ActiveStream` (which Task 2 already extended with `requestId`), so add `apmTransaction`:
```typescript
interface ActiveStream {
  appId: string
  convId: string
  subscriberIds: Set<string>
  requestId?: string
  apmTransaction?: import('elastic-apm-node').Transaction | null
}
```

In `stop()`, end the transaction:
```typescript
if (active.apmTransaction) {
  active.apmTransaction.setLabel('finishReason', 'user_stopped')
  active.apmTransaction.result = 'aborted'
  active.apmTransaction.setOutcome('unknown')
  active.apmTransaction.end()
}
```

Store it when creating the stream state:
```typescript
const streamState: ActiveStream = { appId, convId: conversationId, subscriberIds: new Set(), requestId, apmTransaction }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "routes.test" -t "starts an APM transaction"`
Expected: PASS

Run: `pnpm --filter @airo/agents test:unit "MessageExecutionService.test"`
Expected: PASS

- [ ] **Step 7: Write test — APM transaction ends on budget 402**

```typescript
it('ends APM transaction with budget_exceeded on 402', async () => {
  const mockTransaction = {
    setLabel: vi.fn(),
    setOutcome: vi.fn(),
    end: vi.fn(),
    result: undefined as string | undefined,
  }
  const mockApm = await import('elastic-apm-node')
  vi.spyOn(mockApm.default, 'startTransaction').mockReturnValue(mockTransaction as any)

  const depsWithBudget = {
    ...deps,
    executionService: { execute: vi.fn(), hasActiveStream: vi.fn().mockReturnValue(false) },
    performBudgetPreCheck: vi.fn().mockRejectedValue(
      Object.assign(new Error('Budget exceeded'), { isBudgetExceeded: true })
    ),
  }
  // ... set up app and make request expecting 402 ...

  expect(mockTransaction.setLabel).toHaveBeenCalledWith('finishReason', 'budget_exceeded')
  expect(mockTransaction.result).toBe('error')
  expect(mockTransaction.end).toHaveBeenCalled()
})
```

Note: The budget precheck is imported directly in the route, not injected via deps. The test may need to mock the `performBudgetPreCheck` import. Adjust the mock approach to match the existing pattern in `routes.test.ts` for budget testing.

- [ ] **Step 8: Run all tests**

Run: `pnpm --filter @airo/agents test:unit "routes.test"`
Run: `pnpm --filter @airo/agents test:unit "MessageExecutionService.test"`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add agents/src/server/sse/routes.ts agents/src/server/sse/MessageExecutionService.ts agents/src/server/sse/__tests__/routes.test.ts agents/src/server/sse/__tests__/MessageExecutionService.test.ts
git commit -m "feat(sse): add Elastic APM transaction parity for message execution"
```

---

### Task 5: Extract trace IDs from SSE terminal events on the client

**Files:**
- Modify: `app/src/hooks/useSSEChat.ts:448-500`
- Test: `app/src/hooks/__tests__/useSSEChat.test.ts`

- [ ] **Step 1: Write the failing test — complete event stores trace IDs**

Add to `app/src/hooks/__tests__/useSSEChat.test.ts`:

```typescript
it('complete event extracts traceId, observationId, and requestId into develop page store', async () => {
  const { result } = renderHook(() => useSSEChat())

  const transport = getLastCreatedTransport()
  await act(async () => {
    transport.simulateEvent({
      type: 'complete',
      content: '',
      data: {
        source: 'ai_response',
        finishReason: 'end_turn',
        traceId: 'trace-abc',
        observationId: 'obs-xyz',
        requestId: 'req-123',
        commitHash: null,
      },
    })
  })

  const storeState = useDevelopPageStore.getState()
  expect(storeState.lastCompleteTraceIds).toEqual({
    traceId: 'trace-abc',
    observationId: 'obs-xyz',
    requestId: 'req-123',
  })
})
```

Note: Adapt to the existing test setup patterns (transport mock, event simulation) used in the test file. The above is the assertion shape; the test harness setup should match what's already in the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test "useSSEChat" -- -t "complete event extracts traceId"`
Expected: FAIL — store not updated with trace IDs

- [ ] **Step 3: Add trace ID extraction to the complete handler in useSSEChat**

In `app/src/hooks/useSSEChat.ts`, in the `complete` branch (~line 448), after `store.finalizeStream(event.data)`:

```typescript
} else if (type === 'complete') {
  flushStoreUpdateBufferImmediate()
  store.finalizeStream(event.data)

  const completeData = event.data as any
  // Extract trace IDs for feedback correlation (mirrors WS CompleteHandler)
  const traceId = typeof completeData?.traceId === 'string' && completeData.traceId ? completeData.traceId : undefined
  const observationId = typeof completeData?.observationId === 'string' && completeData.observationId ? completeData.observationId : undefined
  const requestId = typeof completeData?.requestId === 'string' && completeData.requestId ? completeData.requestId : undefined
  if (traceId && observationId) {
    const agentName = typeof completeData?.agentId === 'string' && completeData.agentId ? completeData.agentId : undefined
    useDevelopPageStore.getState().setLastCompleteTraceIds({
      traceId,
      observationId,
      ...(agentName && { agentName }),
      ...(requestId && { requestId }),
    })
  }

  const commitHash = typeof completeData?.commitHash === 'string' && completeData.commitHash.length > 0
    ? completeData.commitHash : undefined
  // ... rest of existing complete handler ...
```

Add the `useDevelopPageStore` import at the top of the file if not already present:
```typescript
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
```

- [ ] **Step 4: Add trace ID extraction to error terminal events**

In the error handler branch (~line 486), after the budget/APP_NOT_FOUND handling and before the generic error path, add extraction for errors that also carry trace data (the server sends a follow-up `complete` with `finishReason: 'error'` after the error event, so the trace IDs come on that follow-up complete). The existing complete handler will catch this since the server publishes `error` then `complete` — no separate extraction needed for the `error` event type itself.

However, for `user_stopped`: the client finalizes locally in the `stop` callback without receiving a server event. The server does publish a `complete` with `finishReason: 'user_stopped'`, but the client's `finalizeStream` early-returns when `activeStream` is null (already finalized). So we need to handle this case.

In the `stop` callback (~line 974), extract trace IDs from the server's user_stopped complete when it arrives. Since the stream is already finalized locally, we should still process trace IDs even when the stream is null. Add a special case: if type is `complete` and `finishReason` is `user_stopped` and the stream is already null, still extract trace IDs:

Actually, looking at the code flow more carefully: the `complete` event with `finishReason: 'user_stopped'` from the server will still arrive via the SSE stream and hit the `type === 'complete'` branch. The `store.finalizeStream()` call will early-return (no-op since active stream is already null), but our trace ID extraction code runs before/after that call, so it will still work. No special handling needed.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter website test "useSSEChat" -- -t "complete event extracts traceId"`
Expected: PASS

- [ ] **Step 6: Write additional test — complete without trace IDs doesn't overwrite**

```typescript
it('complete event without traceId does not overwrite existing trace IDs in store', async () => {
  // Pre-set trace IDs
  useDevelopPageStore.getState().setLastCompleteTraceIds({
    traceId: 'existing-trace',
    observationId: 'existing-obs',
  })

  const { result } = renderHook(() => useSSEChat())
  const transport = getLastCreatedTransport()
  await act(async () => {
    transport.simulateEvent({
      type: 'complete',
      content: '',
      data: { source: 'ai_response', finishReason: 'end_turn' },
    })
  })

  const storeState = useDevelopPageStore.getState()
  expect(storeState.lastCompleteTraceIds).toEqual({
    traceId: 'existing-trace',
    observationId: 'existing-obs',
  })
})
```

- [ ] **Step 7: Run all useSSEChat tests**

Run: `pnpm --filter website test "useSSEChat"`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/src/hooks/useSSEChat.ts app/src/hooks/__tests__/useSSEChat.test.ts
git commit -m "feat(sse): extract trace IDs from terminal events into develop page store"
```

---

### Task 6: Run full verification

**Files:** None (verification only)

- [ ] **Step 1: Run agents typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS

- [ ] **Step 2: Run app typecheck**

Run: `pnpm --filter website typecheck`
Expected: PASS

- [ ] **Step 3: Run agents lint**

Run: `pnpm --filter @airo/agents lint`
Expected: PASS (fix any issues with `lint:fix`)

- [ ] **Step 4: Run app lint**

Run: `pnpm --filter website lint`
Expected: PASS (fix any issues with `lint:fix`)

- [ ] **Step 5: Run full agents unit test suite**

Run: `pnpm --filter @airo/agents test:unit`
Expected: PASS

- [ ] **Step 6: Run full app test suite**

Run: `pnpm --filter website test`
Expected: PASS

- [ ] **Step 7: Commit any lint fixes**

```bash
git add -u
git commit -m "chore: lint fixes for SSE observability parity"
```
