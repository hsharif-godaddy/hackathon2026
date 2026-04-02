/**
 * AgentsAvailableHandler Tests
 *
 * The client drives history loading: on agents_available, the handler emits
 * load_history if the client has a conversationId cookie AND history has not
 * been loaded yet for this session (historyLoadingComplete === false).
 *
 * Reconnect guard: if historyLoadingComplete is already true, no load_history
 * is emitted — the store already has the messages.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockMessageContext } from './testUtils'
import { AgentsAvailableHandler } from '../AgentsAvailableHandler'
import type { WebSocketMessage } from '../types'

vi.mock('@/stores/useStreamingConversationStore', async () => {
  const actual = await vi.importActual('@/stores/useStreamingConversationStore')
  const getState = vi.fn()
  const setState = vi.fn()
  return {
    ...actual,
    useStreamingConversationStore: {
      getState,
      setState,
    },
  }
})

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

const mockStore = useStreamingConversationStore as unknown as {
  getState: ReturnType<typeof vi.fn>
  setState: ReturnType<typeof vi.fn>
}

const agentsPayload: WebSocketMessage = {
  type: 'agents_available',
  content: '',
  data: {
    agents: [
      { id: 'agent-1', name: 'Builder', description: 'Builds apps' },
      { id: 'agent-2', name: 'Reviewer' },
    ],
    defaultAgent: 'agent-1',
  },
}

describe('AgentsAvailableHandler', function packageTests() {
  const handler = new AgentsAvailableHandler()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('#handle — agent catalog', function catalogTests() {
    it('should set agent catalog with sanitized agents and default agent id', async function setsAgentCatalog() {
      const setAgentCatalog = vi.fn()
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue(null),
        },
      })

      mockStore.getState.mockReturnValue({
        setAgentCatalog,
        setHistoryLoadingComplete: vi.fn(),
        historyLoadingComplete: false,
        messages: [],
        activeStream: null,
        clearMessages: vi.fn(),
      })

      await handler.handle(agentsPayload, context)

      expect(setAgentCatalog).toHaveBeenCalledWith(
        [
          { id: 'agent-1', name: 'Builder', description: 'Builds apps' },
          { id: 'agent-2', name: 'Reviewer', description: undefined },
        ],
        'agent-1'
      )
    })

    it('should filter out agents with no resolvable id', async function filtersInvalidAgents() {
      const setAgentCatalog = vi.fn()
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue(null),
        },
      })

      mockStore.getState.mockReturnValue({
        setAgentCatalog,
        setHistoryLoadingComplete: vi.fn(),
        historyLoadingComplete: false,
        messages: [],
        activeStream: null,
        clearMessages: vi.fn(),
      })

      await handler.handle(
        {
          type: 'agents_available',
          content: '',
          data: {
            agents: [{ id: 'valid-agent' }, { name: null }],
            defaultAgent: 'valid-agent',
          },
        },
        context
      )

      expect(setAgentCatalog).toHaveBeenCalledWith(
        [{ id: 'valid-agent', name: 'valid-agent', description: undefined }],
        'valid-agent'
      )
    })

    it('should set empty catalog when agents array is absent', async function emptyAgents() {
      const setAgentCatalog = vi.fn()
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue(null),
        },
      })

      mockStore.getState.mockReturnValue({
        setAgentCatalog,
        setHistoryLoadingComplete: vi.fn(),
        historyLoadingComplete: false,
        messages: [],
        activeStream: null,
        clearMessages: vi.fn(),
      })

      await handler.handle(
        { type: 'agents_available', content: '', data: {} },
        context
      )

      expect(setAgentCatalog).toHaveBeenCalledWith([], null)
    })
  })

  describe('#handle — load_history emission', function loadHistoryTests() {
    it('should delegate to emitLoadHistoryIfNeeded and emit load_history when conditions are met', async function delegatesToHelper() {
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue('conv-abc'),
        },
      })

      mockStore.getState.mockReturnValue({
        setAgentCatalog: vi.fn(),
        historyLoadRequested: false,
        historyLoadingComplete: false,
        setHistoryLoadRequested: vi.fn(),
        messages: [],
        activeStream: null,
        clearMessages: vi.fn(),
      })

      await handler.handle(agentsPayload, context)

      expect(context.socket.emit).toHaveBeenCalledWith('load_history', {
        conversationId: 'conv-abc',
      })
    })
  })

  describe('#handle — message clearing before re-fetch', function messageClearingTests() {
    it('should clear messages before emitting load_history when partial messages exist and no activeStream', async function clearsPartialMessages() {
      const setAgentCatalog = vi.fn()
      const clearMessages = vi.fn()
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue('conv-abc'),
        },
      })

      mockStore.getState.mockReturnValue({
        setAgentCatalog,
        historyLoadRequested: false,
        historyLoadingComplete: false,
        setHistoryLoadRequested: vi.fn(),
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hey' },
          { id: 'msg-2', role: 'assistant', content: 'Hi' },
        ],
        activeStream: null,
        clearMessages,
      })

      await handler.handle(agentsPayload, context)

      expect(clearMessages).toHaveBeenCalled()
      expect(context.socket.emit).toHaveBeenCalledWith('load_history', {
        conversationId: 'conv-abc',
      })
    })

    it('should NOT clear messages when activeStream is set (live stream in progress)', async function keepsMessagesWhenStreaming() {
      const setAgentCatalog = vi.fn()
      const clearMessages = vi.fn()
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue('conv-abc'),
        },
      })

      mockStore.getState.mockReturnValue({
        setAgentCatalog,
        historyLoadRequested: false,
        historyLoadingComplete: false,
        setHistoryLoadRequested: vi.fn(),
        messages: [{ id: 'msg-1', role: 'user', content: 'Hey' }],
        activeStream: { id: 'stream-1', content: '', isComplete: false },
        clearMessages,
      })

      await handler.handle(agentsPayload, context)

      expect(clearMessages).not.toHaveBeenCalled()
      // load_history is still emitted — stream will merge with history
      expect(context.socket.emit).toHaveBeenCalledWith('load_history', {
        conversationId: 'conv-abc',
      })
    })

    it('should NOT clear messages when messages array is empty', async function noOpOnEmptyMessages() {
      const setAgentCatalog = vi.fn()
      const clearMessages = vi.fn()
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue('conv-abc'),
        },
      })

      mockStore.getState.mockReturnValue({
        setAgentCatalog,
        historyLoadRequested: false,
        historyLoadingComplete: false,
        setHistoryLoadRequested: vi.fn(),
        messages: [],
        activeStream: null,
        clearMessages,
      })

      await handler.handle(agentsPayload, context)

      expect(clearMessages).not.toHaveBeenCalled()
      expect(context.socket.emit).toHaveBeenCalledWith('load_history', {
        conversationId: 'conv-abc',
      })
    })

    it('should NOT clear messages when historyLoadingComplete is true (already loaded)', async function noOpWhenAlreadyLoaded() {
      const setAgentCatalog = vi.fn()
      const clearMessages = vi.fn()
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue('conv-abc'),
        },
      })

      mockStore.getState.mockReturnValue({
        setAgentCatalog,
        historyLoadingComplete: true,
        messages: [{ id: 'msg-1', role: 'user', content: 'Hey' }],
        activeStream: null,
        clearMessages,
      })

      await handler.handle(agentsPayload, context)

      expect(clearMessages).not.toHaveBeenCalled()
    })
  })
})
