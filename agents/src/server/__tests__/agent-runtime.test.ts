import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  Logger: {
    create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@airo/ai-transport', () => ({
  ConversationEventChannel: vi.fn().mockImplementation(function () { return {
    cleanup: vi.fn().mockReturnValue(0),
    publish: vi.fn(),
    getEventsSince: vi.fn(),
  }; }),
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

    it('creates event channel with capacity 10000', async () => {
      const { ConversationEventChannel } = await import('@airo/ai-transport')
      const { initAgentRuntime } = await import('../agent-runtime.js')

      await initAgentRuntime()

      expect(ConversationEventChannel).toHaveBeenCalledWith(
        expect.objectContaining({ capacity: 10_000 })
      )
    })

    it('is idempotent — calling twice does not reinitialize', async () => {
      const { initAgentRuntime } = await import('../agent-runtime.js')
      const { createWebSocketAgentFactory } = await import('../../agents/ai-lib-agents/index.js')
      vi.mocked(createWebSocketAgentFactory).mockClear()

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
