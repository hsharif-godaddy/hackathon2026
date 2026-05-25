# SSE Runtime Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract transport-agnostic agent runtime (event channel, agent factory, action registry, lifecycle deps) out of `ai-lib-websocket-server.ts` into a new `agent-runtime.ts` module so SSE can boot without Socket.IO.

**Architecture:** New `agents/src/server/agent-runtime.ts` module owns shared singletons. `setupAILibWebSocketServer` becomes a consumer of those singletons rather than their creator. All existing consumers (`app.ts`, SSE routes, video routes) import from the new module directly — no re-exports.

**Tech Stack:** TypeScript, Vitest, Express (agents service)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `agents/src/server/agent-runtime.ts` | Transport-agnostic runtime: event channel, agent factory, action registry, lifecycle deps, summarizer init |
| Create | `agents/src/server/__tests__/agent-runtime.test.ts` | Unit tests for init/accessors/destroy/action-registry |
| Modify | `agents/src/server/ai-lib-websocket-server.ts` | Remove extracted state; consume `agent-runtime` accessors |
| Modify | `agents/src/server/app.ts` | Call `initAgentRuntime()` before WS setup; update imports |
| Modify | `agents/src/server/sse/routes.ts` | Update imports to `agent-runtime` |
| Modify | `agents/src/server/routes/video.ts` | Update imports to `agent-runtime` |
| Modify | `agents/src/server/sse/__tests__/routes.test.ts` | Update mock path |

---

### Task 1: Create `agent-runtime.ts` with tests

**Files:**
- Create: `agents/src/server/agent-runtime.ts`
- Create: `agents/src/server/__tests__/agent-runtime.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// agents/src/server/__tests__/agent-runtime.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock all heavy dependencies before importing
vi.mock('../../agents/ai-lib-agents/index.js', () => ({
  createWebSocketAgentFactory: vi.fn().mockResolvedValue({
    agents: new Map([['develop', { name: 'develop' }]]),
    stateManager: {
      setSelectedTodoList: vi.fn(),
      getSelectedTodoList: vi.fn(),
      getCurrentAgent: vi.fn(),
      getLastHandoffPrompt: vi.fn(),
      clearLastHandoffPrompt: vi.fn(),
      setSessionMetadata: vi.fn(),
    },
  }),
}))

vi.mock('../../services/initializeContextRegistry.js', () => ({
  initializeContextRegistry: vi.fn(),
}))

vi.mock('../../services/summarization/index.js', () => ({
  initializeBackgroundSummarization: vi.fn().mockResolvedValue({
    checkAndSummarize: vi.fn(),
    getMaxPromptTokens: vi.fn().mockReturnValue(100000),
  }),
}))

vi.mock('../../tools/todo-list-tool.js', () => ({
  todoListTool: { setOnSelectCallback: vi.fn() },
}))

vi.mock('../../agents/assessment-agent/index.js', () => ({
  getAssessmentAgent: vi.fn().mockReturnValue({}),
}))

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@airo/ai-transport', () => ({
  ConversationEventChannel: vi.fn().mockImplementation(() => ({
    cleanup: vi.fn().mockReturnValue(0),
    publish: vi.fn(),
    getEventsSince: vi.fn(),
  })),
}))

vi.mock('@airo/ai-lib', () => ({
  destroyLlmDispatcher: vi.fn().mockResolvedValue(undefined),
}))

describe('agent-runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    vi.useRealTimers()
    // Reset module state between tests
    const mod = await import('../agent-runtime.js')
    await mod.destroyAgentRuntime()
    vi.resetModules()
  })

  describe('initAgentRuntime', () => {
    it('initializes all shared state', async () => {
      const { initAgentRuntime, getEventChannel, getAgentFactory, getMessageLifecycleDeps } = await import('../agent-runtime.js')

      await initAgentRuntime()

      expect(getEventChannel()).not.toBeNull()
      expect(getAgentFactory()).not.toBeNull()
      expect(getMessageLifecycleDeps()).toBeDefined()
      expect(getMessageLifecycleDeps().gitHookService).toBeDefined()
      expect(getMessageLifecycleDeps().sessionStore).toBeDefined()
    })

    it('is idempotent — calling twice does not reinitialize', async () => {
      const { createWebSocketAgentFactory } = await import('../../agents/ai-lib-agents/index.js')
      const { initAgentRuntime } = await import('../agent-runtime.js')

      await initAgentRuntime()
      await initAgentRuntime()

      expect(createWebSocketAgentFactory).toHaveBeenCalledTimes(1)
    })
  })

  describe('destroyAgentRuntime', () => {
    it('nulls all accessors', async () => {
      const { initAgentRuntime, destroyAgentRuntime, getEventChannel, getAgentFactory } = await import('../agent-runtime.js')

      await initAgentRuntime()
      await destroyAgentRuntime()

      expect(getEventChannel()).toBeNull()
      expect(getAgentFactory()).toBeNull()
    })

    it('allows re-initialization after destroy', async () => {
      const { initAgentRuntime, destroyAgentRuntime, getEventChannel } = await import('../agent-runtime.js')

      await initAgentRuntime()
      await destroyAgentRuntime()
      await initAgentRuntime()

      expect(getEventChannel()).not.toBeNull()
    })
  })

  describe('action service registry', () => {
    it('registers and retrieves by key', async () => {
      const { initAgentRuntime, registerActionService, getActionService } = await import('../agent-runtime.js')
      await initAgentRuntime()

      const mockService = { dispatch: vi.fn(), cleanup: vi.fn() } as any
      registerActionService('sse:conv-123', mockService)

      expect(getActionService('sse:conv-123')).toBe(mockService)
    })

    it('returns null for unknown key', async () => {
      const { initAgentRuntime, getActionService } = await import('../agent-runtime.js')
      await initAgentRuntime()

      expect(getActionService('unknown')).toBeNull()
    })

    it('cleanup removes only targeted key', async () => {
      const { initAgentRuntime, registerActionService, getActionService, cleanupActionService } = await import('../agent-runtime.js')
      await initAgentRuntime()

      const svc1 = { dispatch: vi.fn(), cleanup: vi.fn() } as any
      const svc2 = { dispatch: vi.fn(), cleanup: vi.fn() } as any
      registerActionService('ws:socket-1', svc1)
      registerActionService('sse:conv-2', svc2)

      cleanupActionService('ws:socket-1')

      expect(getActionService('ws:socket-1')).toBeNull()
      expect(getActionService('sse:conv-2')).toBe(svc2)
      expect(svc1.cleanup).toHaveBeenCalled()
    })

    it('destroyAgentRuntime clears all action services', async () => {
      const { initAgentRuntime, destroyAgentRuntime, registerActionService, getActionService } = await import('../agent-runtime.js')
      await initAgentRuntime()

      const svc = { dispatch: vi.fn(), cleanup: vi.fn() } as any
      registerActionService('key', svc)

      await destroyAgentRuntime()

      expect(getActionService('key')).toBeNull()
    })
  })

  describe('boot-without-websocket', () => {
    it('SSE accessors work without setupAILibWebSocketServer ever being called', async () => {
      const { initAgentRuntime, getEventChannel, getAgentFactory } = await import('../agent-runtime.js')

      await initAgentRuntime()

      expect(getEventChannel()).not.toBeNull()
      expect(getAgentFactory()).not.toBeNull()
    })
  })
})
```

- [ ] **Step 2: Create the `agent-runtime.ts` module**

```typescript
// agents/src/server/agent-runtime.ts
import { ConversationEventChannel } from '@airo/ai-transport'
import { destroyLlmDispatcher } from '@airo/ai-lib'
import { createWebSocketAgentFactory } from '../agents/ai-lib-agents/index.js'
import { initializeContextRegistry } from '../services/initializeContextRegistry.js'
import { GitHookService } from '../services/git-hook-service.js'
import { LifecycleSessionStore, type MessageLifecycleDeps } from './message-lifecycle.js'
import { getAssessmentAgent } from '../agents/assessment-agent/index.js'
import type { IClientActionService } from '../services/ClientActionService.js'
import { logger } from '../logging/index.js'

type AgentFactory = Awaited<ReturnType<typeof createWebSocketAgentFactory>>

let eventChannelInstance: ConversationEventChannel | null = null
let eventChannelCleanupInterval: NodeJS.Timeout | null = null
let agentFactoryInstance: AgentFactory | null = null
let initialized = false

const actionServices = new Map<string, IClientActionService>()

const gitHookService = new GitHookService()
const lifecycleSessionStore = new LifecycleSessionStore()
const lifecycleDeps: MessageLifecycleDeps = {
  gitHookService,
  getAssessmentAgent,
  sessionStore: lifecycleSessionStore,
  logger,
}

export async function initAgentRuntime(): Promise<void> {
  if (initialized) return

  initializeContextRegistry()

  const agentFactory = await createWebSocketAgentFactory()
  agentFactoryInstance = agentFactory

  const { todoListTool } = await import('../tools/todo-list-tool.js')
  todoListTool.setOnSelectCallback((sessionId: string, listId: string) => {
    agentFactory.stateManager.setSelectedTodoList(sessionId, listId)
    logger.info('todo.list.selected', { sessionId, listId })
  })

  const { initializeBackgroundSummarization } = await import('../services/summarization/index.js')
  await initializeBackgroundSummarization()

  eventChannelInstance = new ConversationEventChannel()

  eventChannelCleanupInterval = setInterval(() => {
    const removed = eventChannelInstance?.cleanup() ?? 0
    if (removed > 0) {
      logger.debug('sse.event_channel.cleanup', { removedConversations: removed })
    }
  }, 60_000)
  eventChannelCleanupInterval.unref?.()

  initialized = true
  logger.info('agent_runtime.initialized')
}

export function getEventChannel(): ConversationEventChannel | null {
  return eventChannelInstance
}

export function getAgentFactory(): AgentFactory | null {
  return agentFactoryInstance
}

export function getMessageLifecycleDeps(): MessageLifecycleDeps {
  return lifecycleDeps
}

export function getGitHookService(): GitHookService {
  return gitHookService
}

export function registerActionService(key: string, service: IClientActionService): void {
  actionServices.set(key, service)
}

export function getActionService(key: string): IClientActionService | null {
  return actionServices.get(key) ?? null
}

export function cleanupActionService(key: string): void {
  const service = actionServices.get(key)
  if (service) {
    service.cleanup()
    actionServices.delete(key)
    logger.info('action_service.cleaned_up', { key })
  }
}

export async function destroyAgentRuntime(): Promise<void> {
  if (eventChannelCleanupInterval) {
    clearInterval(eventChannelCleanupInterval)
    eventChannelCleanupInterval = null
  }

  for (const [key, service] of actionServices) {
    service.cleanup()
    actionServices.delete(key)
  }

  await destroyLlmDispatcher()

  eventChannelInstance = null
  agentFactoryInstance = null
  initialized = false
  logger.info('agent_runtime.destroyed')
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "agent-runtime"`
Expected: All tests pass (init, idempotency, destroy, action registry, boot-without-WS).

- [ ] **Step 4: Commit**

```bash
git add agents/src/server/agent-runtime.ts agents/src/server/__tests__/agent-runtime.test.ts
git commit -m "feat(agents): add agent-runtime module with tests

Transport-agnostic runtime extracted: event channel, agent factory,
action registry, lifecycle deps, and summarizer initialization."
```

---

### Task 2: Refactor `ai-lib-websocket-server.ts` to consume `agent-runtime`

**Files:**
- Modify: `agents/src/server/ai-lib-websocket-server.ts`

This task removes extracted state from `ai-lib-websocket-server.ts` and makes it consume `agent-runtime` accessors instead.

- [ ] **Step 1: Remove module-level SSE state declarations (lines ~136–161)**

Delete these lines from the top of the file:

```typescript
// DELETE: sseEventChannelInstance, sseEventChannelCleanupInterval, sseAgentFactoryInstance
// DELETE: getSSEEventChannel(), getSSEAgentFactory()
```

Replace with an import from agent-runtime:

```typescript
import { getEventChannel, getAgentFactory, getMessageLifecycleDeps as getRuntimeLifecycleDeps, getGitHookService as getRuntimeGitHookService, registerActionService, getActionService, cleanupActionService, initAgentRuntime } from './agent-runtime.js'
```

- [ ] **Step 2: Remove the lifecycle deps and GitHookService declarations (lines ~166–182)**

Delete `gitHookService`, `lifecycleSessionStore`, `lifecycleDeps`, and `getMessageLifecycleDeps()` from the file. The WS code that uses `lifecycleDeps` will call `getRuntimeLifecycleDeps()` instead.

- [ ] **Step 3: Remove the client-action registry exports (lines ~297, 467–495)**

Delete `clientActionServices` map, `getClientActionService()`, `registerExternalActionService()`, `unregisterExternalActionService()`. The internal WS function `getOrCreateClientActionService` keeps its Socket.IO-specific creation logic but stores into the shared registry:

```typescript
function getOrCreateClientActionService(
  socketId: string,
  conversationId: string
): IClientActionService | null {
  let service = getActionService(socketId)
  if (service) return service

  if (!ioInstance) {
    logger.warn('client-action-service.no_io_instance', { socketId, conversationId })
    return null
  }

  const socket = ioInstance.sockets.sockets.get(socketId)
  if (!socket) {
    logger.warn('client-action-service.socket_not_found', { socketId, conversationId })
    return null
  }

  service = new ClientActionService(socket, conversationId)
  registerActionService(socketId, service)
  logger.info('client-action-service.created', { socketId, conversationId })
  return service
}
```

And `cleanupClientActionService` becomes:

```typescript
function cleanupClientActionService(socketId: string): void {
  cleanupActionService(socketId)
}
```

- [ ] **Step 4: Refactor `setupAILibWebSocketServer` to consume runtime**

Remove the extracted initialization block (lines ~548–592). Replace with:

```typescript
await initAgentRuntime()
const agentFactory = getAgentFactory()!
const stateManager = agentFactory.stateManager
```

The remaining setup code (context provider, message provider, WS server creation) stays as-is but references the shared instances via `getAgentFactory()` and `getEventChannel()`.

Also update the event channel references inside the function. The SSE channel init block (`sseEventChannelInstance = ...`) and the `sseAgentFactoryInstance = agentFactory` assignment are removed — they're now handled by `initAgentRuntime()`.

- [ ] **Step 5: Remove `getGitHookService` export**

Delete the function entirely:
```typescript
// DELETE this block:
export function getGitHookService() {
  return gitHookService;
}
```

Consumers import directly from `agent-runtime` (handled in Task 3).

- [ ] **Step 6: Update internal references to `lifecycleDeps`**

Any place in `ai-lib-websocket-server.ts` that references the local `lifecycleDeps` variable must now call `getRuntimeLifecycleDeps()`. Search for `lifecycleDeps` usage within the file and replace with the import.

- [ ] **Step 7: Update internal references to `getSSEEventChannel()`**

The `request_grant_refresh` handler at line ~2712 calls `getSSEEventChannel()`. Replace with `getEventChannel()`.

- [ ] **Step 8: Run unit tests**

Run: `pnpm --filter @airo/agents test:unit "ai-lib-websocket-server\|agent-runtime"`
Expected: All existing WS tests and new agent-runtime tests pass.

- [ ] **Step 9: Commit**

```bash
git add agents/src/server/ai-lib-websocket-server.ts
git commit -m "refactor(agents): remove extracted state from ai-lib-websocket-server

setupAILibWebSocketServer now consumes agent-runtime accessors instead
of creating shared infrastructure itself."
```

---

### Task 3: Update consumer imports in `app.ts`

**Files:**
- Modify: `agents/src/server/app.ts`

- [ ] **Step 1: Update the import statement**

Replace:
```typescript
import { setupAILibWebSocketServer, getWebSocketServerInfo, getGitHookService, getSSEEventChannel, getSSEAgentFactory, getMessageLifecycleDeps } from './ai-lib-websocket-server.js';
```

With:
```typescript
import { setupAILibWebSocketServer, getWebSocketServerInfo } from './ai-lib-websocket-server.js';
import { initAgentRuntime, getEventChannel, getAgentFactory, getMessageLifecycleDeps, getGitHookService } from './agent-runtime.js';
```

- [ ] **Step 2: Update `getOrCreateSSEExecutionService`**

Replace `getSSEEventChannel()` with `getEventChannel()` and `getSSEAgentFactory()` with `getAgentFactory()`:

```typescript
function getOrCreateSSEExecutionService(): MessageExecutionService | null {
  if (sseExecutionService) return sseExecutionService
  const eventChannel = getEventChannel()
  const agentFactory = getAgentFactory()
  if (!eventChannel || !agentFactory) return null
  // ... rest unchanged
}
```

- [ ] **Step 3: Update SSE route config object**

Replace:
```typescript
getEventChannel: () => getSSEEventChannel(),
```
With:
```typescript
getEventChannel: () => getEventChannel(),
```

And replace:
```typescript
getStateManager: () => {
  const factory = getSSEAgentFactory()
```
With:
```typescript
getStateManager: () => {
  const factory = getAgentFactory()
```

- [ ] **Step 4: Add `initAgentRuntime()` call before WS setup**

In the `initialize()` function, add the runtime init before the WebSocket setup call:

```typescript
// Initialize transport-agnostic agent runtime
await initAgentRuntime()
logger.info('server.agent_runtime.init.success')

// Phase 3: Setup AI-Lib WebSocket Server
logger.info('server.websocket.init.begin', { phase: 3 });
const websocketSetup = await setupAILibWebSocketServer(server);
```

- [ ] **Step 5: Add `destroyAgentRuntime()` to shutdown**

In the `shutdown()` function, after `destroyLlmDispatcher()` (or replacing it — `destroyAgentRuntime` already calls it):

Replace:
```typescript
await destroyLlmDispatcher();
```
With:
```typescript
const { destroyAgentRuntime } = await import('./agent-runtime.js')
await destroyAgentRuntime();
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add agents/src/server/app.ts
git commit -m "refactor(agents): update app.ts to consume agent-runtime

Calls initAgentRuntime() before WS setup. Imports event channel,
agent factory, lifecycle deps, and git hook service from agent-runtime."
```

---

### Task 4: Update SSE route imports

**Files:**
- Modify: `agents/src/server/sse/routes.ts`
- Modify: `agents/src/server/sse/__tests__/routes.test.ts`

- [ ] **Step 1: Update `routes.ts` imports**

Replace:
```typescript
import { getSSEAgentFactory, getClientActionService } from '../ai-lib-websocket-server.js'
```
With:
```typescript
import { getAgentFactory, getActionService } from '../agent-runtime.js'
```

- [ ] **Step 2: Update usages in `routes.ts`**

Find and replace all occurrences:
- `getSSEAgentFactory()` → `getAgentFactory()`
- `getClientActionService(` → `getActionService(`

- [ ] **Step 3: Update the test mock path**

In `agents/src/server/sse/__tests__/routes.test.ts`, replace:
```typescript
vi.mock('../../ai-lib-websocket-server.js', () => ({
  getSSEAgentFactory: vi.fn().mockReturnValue(null),
  getClientActionService: vi.fn((key: string) => mockClientActionServices.get(key) ?? null),
}))
```
With:
```typescript
vi.mock('../../agent-runtime.js', () => ({
  getAgentFactory: vi.fn().mockReturnValue(null),
  getActionService: vi.fn((key: string) => mockClientActionServices.get(key) ?? null),
}))
```

- [ ] **Step 4: Run SSE route tests**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/routes.test.ts"`
Expected: All 55+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add agents/src/server/sse/routes.ts agents/src/server/sse/__tests__/routes.test.ts
git commit -m "refactor(agents): update SSE routes to import from agent-runtime"
```

---

### Task 5: Update video route imports

**Files:**
- Modify: `agents/src/server/routes/video.ts`

- [ ] **Step 1: Update import**

Replace:
```typescript
import { getSSEEventChannel } from '../ai-lib-websocket-server.js'
```
With:
```typescript
import { getEventChannel } from '../agent-runtime.js'
```

- [ ] **Step 2: Update usage**

Replace all occurrences of `getSSEEventChannel()` with `getEventChannel()` in the file.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add agents/src/server/routes/video.ts
git commit -m "refactor(agents): update video route to import from agent-runtime"
```

---

### Task 6: Full verification

**Files:** None (validation only)

- [ ] **Step 1: Run all agent-runtime tests**

Run: `pnpm --filter @airo/agents test:unit "agent-runtime"`
Expected: All pass.

- [ ] **Step 2: Run all SSE route tests**

Run: `pnpm --filter @airo/agents test:unit "src/server/sse/__tests__/routes.test.ts"`
Expected: All 55+ pass.

- [ ] **Step 3: Run full agents unit test suite**

Run: `pnpm --filter @airo/agents test:unit`
Expected: All pass. No regressions.

- [ ] **Step 4: Run typecheck across workspace**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 5: Run lint**

Run: `pnpm --filter @airo/agents lint`
Expected: No lint errors (unused imports from old paths would flag here).

- [ ] **Step 6: Run build**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 7: Verify no remaining old imports**

Run: `grep -rn "getSSEEventChannel\|getSSEAgentFactory\|getClientActionService\|registerExternalActionService\|unregisterExternalActionService" agents/src/ --include="*.ts" | grep -v "__tests__" | grep -v ".test."`
Expected: Zero results (all old accessors removed from non-test code).

- [ ] **Step 8: Commit any remaining fixes**

If any failures were found and fixed, commit them:
```bash
git add -A
git commit -m "fix(agents): address runtime extraction verification issues"
```
