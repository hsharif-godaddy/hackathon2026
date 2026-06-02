import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

let nanoidCounter = 0
vi.mock('nanoid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nanoid')>()
  return {
    ...actual,
    nanoid: vi.fn().mockImplementation(function () { return `id-${++nanoidCounter}`; })
  }
})

const mockUpdateMessage = vi.fn().mockResolvedValue(undefined)
const mockUpdateMessageMetadata = vi.fn().mockResolvedValue(undefined)
const mockAddMessage = vi.fn().mockResolvedValue({ id: 'new-msg-id' })
const mockGetMessageById = vi.fn()

vi.mock('../../database/repositories/index.js', () => ({
  appRepository: { findById: vi.fn().mockReturnValue(null) },
}))

vi.mock('../../memory/adapters/index.js', () => ({
  getConversationLifecycleStore: () => ({
    getById: vi.fn(),
    getOrCreateForApp: vi.fn(),
    create: vi.fn(),
    updateAgentId: vi.fn(),
  }),
  getMessageStore: () => ({
    addMessage: mockAddMessage,
    updateMessage: mockUpdateMessage,
    updateMessageMetadata: mockUpdateMessageMetadata,
    getMessageById: mockGetMessageById,
  }),
}))

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

const mockLoggerModule = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

vi.mock('../../logging/index.js', () => ({
  logger: mockLoggerModule,
  log: {
    withContext: vi.fn().mockReturnValue(mockLogger),
    forApp: vi.fn().mockReturnValue(mockLogger),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('elastic-apm-node', () => ({
  default: { startTransaction: vi.fn().mockReturnValue(null) },
}))

vi.mock('@godaddy/agent-otel-sdk', () => ({
  emitConversationStart: vi.fn(),
  emitHandoff: vi.fn(),
}))

vi.mock('@airo/ai-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@airo/ai-lib')>()
  return {
    ...actual,
    calculateCostEstimate: vi.fn().mockReturnValue({ totalCost: 0 }),
  }
})

vi.mock('../../tools/git-tool.js', () => ({
  GitTool: vi.fn().mockImplementation(function () { return {
    executeGitOperation: vi.fn().mockResolvedValue({ success: false }),
  }; }),
}))

vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(function () { return {
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    getStatus: vi.fn().mockResolvedValue({ stagedFiles: 0, modifiedFiles: 0, untrackedFiles: 0 }),
    getCommitHistory: vi.fn().mockResolvedValue([]),
  }; }),
}))

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: { createForApp: vi.fn().mockReturnValue(null) },
}))

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: () => ({ tasks: {} }),
}))

vi.mock('../../agents/ai-lib-agents/index.js', () => ({
  aiLibAgentMetadata: {},
}))

vi.mock('../errors/app-not-found-error.js', () => ({
  AppNotFoundError: class AppNotFoundError extends Error {
    constructor(id: string) { super(`App not found: ${id}`) }
  },
}))

vi.mock('../../services/features.js', () => ({
  MAX_PROMPT_LENGTH: 10000,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a minimal ConversationContext that skips all git/token codepaths
 * (appId is undefined, so those branches are never entered).
 */
function makeContext(socketId = 'test-socket') {
  return {
    socketId,
    agentName: 'initial',
    appId: undefined as string | undefined,
    userId: 'user-1',
    sessionId: 'session-1',
  }
}

/** Helper to build a chunk event */
function chunk(content: string, timestamp = new Date()): any {
  return { type: 'chunk', content, timestamp }
}

/** Helper to build a step_complete event (signals end of a reasoning step) */
function stepComplete(timestamp = new Date()): any {
  return { type: 'step_complete', timestamp }
}

/** Helper to build a step_start event */
function stepStart(timestamp = new Date()): any {
  return { type: 'step_start', timestamp }
}

/** Helper to build a tool_start + tool_result pair */
function toolPair(id: string, name: string, ts = new Date()): any[] {
  return [
    { type: 'tool_start', data: { tool: { id, name, input: { file: 'index.ts' } } }, timestamp: ts },
    { type: 'tool_result', data: { tool: { id, name, output: 'ok' } }, timestamp: ts },
  ]
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentsMessagePersistence', function packageTests() {
  let persistence: any

  beforeEach(async () => {
    vi.clearAllMocks()
    nanoidCounter = 0

    const { AgentsMessagePersistence } = await import('../conversation-persistence.js')
    persistence = new AgentsMessagePersistence()
  })

  /**
   * Sets up activeConversations so completeConversation will call
   * updateMessage (not addMessage) with the given agentMessageId.
   */
  function seedActiveConversation(socketId: string, agentMessageId: string) {
    ;(persistence as any).activeConversations.set(socketId, {
      conversationId: 'conv-123',
      userMessageId: 'user-msg-id',
      agentMessageId,
      context: makeContext(socketId),
      message: 'test prompt',
    })
  }

  /** Runs completeConversation and returns the segments passed to updateMessage */
  async function getSegmentsFromEvents(events: any[]): Promise<any[]> {
    seedActiveConversation('test-socket', 'agent-msg-id')
    await persistence.completeConversation('conv-123', events, {}, makeContext())
    const [, updates] = mockUpdateMessage.mock.calls[0]
    return updates.segments as any[]
  }

  describe('#continueConversation – context attachments', function contextAttachmentTests() {
    it('persists only save-worthy context attachments on user messages', async function persistsSaveAttachments() {
      const saveAttachment = {
        type: 'ai_edit_contexts',
        data: [{ id: 'ctx-1' }],
        persistence: 'save',
      }
      const ephemeralAttachment = {
        type: 'selected_assets',
        data: [{ imageUrl: 'https://img.example.com/a.png' }],
        persistence: 'ephemeral',
      }

      await persistence.continueConversation('conv-123', 'hello', {
        ...makeContext(),
        contextAttachments: [saveAttachment, ephemeralAttachment],
      })

      expect(mockAddMessage).toHaveBeenCalledWith('conv-123', 'user', 'hello', expect.objectContaining({
        contextAttachments: [saveAttachment],
      }))
    })

    it('omits contextAttachments when no save-worthy attachments are present', async function omitsEphemeralOnlyAttachments() {
      await persistence.continueConversation('conv-123', 'hello', {
        ...makeContext(),
        contextAttachments: [
          {
            type: 'selected_assets',
            data: [{ imageUrl: 'https://img.example.com/a.png' }],
            persistence: 'ephemeral',
          },
        ],
      })

      const [, , options] = mockAddMessage.mock.calls[0]
      expect(options).not.toHaveProperty('contextAttachments')
    })
  })

  describe('#completeConversation – optimizeStreamingEvents', function optimizeTests() {
    it('should merge consecutive chunk events into a single content segment', async function mergeChunks() {
      const events = [
        chunk('Hello '),
        chunk('world'),
        chunk('!'),
      ]

      const segments = await getSegmentsFromEvents(events)

      expect(segments).toHaveLength(1)
      expect(segments[0].type).toBe('content')
      expect(segments[0].content).toBe('Hello world!')
    })

    it('should flush text and create separate content segments when a tool interrupts', async function flushOnTool() {
      const events = [
        chunk('Before tool'),
        ...toolPair('t1', 'textEditor'),
        chunk('After tool'),
      ]

      const segments = await getSegmentsFromEvents(events)

      const contentSegments = segments.filter(s => s.type === 'content')
      const toolSegments = segments.filter(s => s.type === 'tool_call')

      expect(contentSegments).toHaveLength(2)
      expect(contentSegments[0].content).toBe('Before tool')
      expect(contentSegments[1].content).toBe('After tool')
      expect(toolSegments).toHaveLength(1)
    })

    it('should flush text when a step event interrupts consecutive chunks', async function flushOnStep() {
      const events = [
        chunk('Block A'),
        stepComplete(),
        chunk('Block B'),
      ]

      const segments = await getSegmentsFromEvents(events)

      // step_complete flushes the text group, producing two content segments
      const contentSegments = segments.filter(s => s.type === 'content')
      expect(contentSegments).toHaveLength(2)
    })
  })

  describe('#completeConversation – paragraph separator', function paragraphTests() {
    it('should not add separator to the first and only content segment', async function noSeparatorFirstSegment() {
      const events = [chunk('Only text block')]

      const segments = await getSegmentsFromEvents(events)

      expect(segments[0].content).toBe('Only text block')
      expect(segments[0].content).not.toMatch(/^\n\n/)
    })

    it('should add \\n\\n before a content segment that follows another content segment', async function separatorOnConsecutive() {
      const events = [
        chunk('Let me start:'),
        stepComplete(),
        chunk('Now let me continue:'),
      ]

      const segments = await getSegmentsFromEvents(events)

      const contentSegments = segments.filter(s => s.type === 'content')
      expect(contentSegments).toHaveLength(2)
      expect(contentSegments[0].content).toBe('Let me start:')
      expect(contentSegments[1].content).toBe('\n\nNow let me continue:')
    })

    it('should add \\n\\n to every block after the first in a long consecutive sequence', async function separatorOnAll() {
      const events = [
        chunk('Block 1'),
        stepComplete(),
        chunk('Block 2'),
        stepStart(),
        stepComplete(),
        chunk('Block 3'),
      ]

      const segments = await getSegmentsFromEvents(events)

      const contentSegments = segments.filter(s => s.type === 'content')
      expect(contentSegments).toHaveLength(3)
      expect(contentSegments[0].content).toBe('Block 1')
      expect(contentSegments[1].content).toBe('\n\nBlock 2')
      expect(contentSegments[2].content).toBe('\n\nBlock 3')
    })

    it('should NOT add separator after a duplicate tool_start for the same tool ID', async function noSeparatorAfterDuplicateToolStart() {
      const events = [
        chunk('Before tool'),
        { type: 'tool_start', data: { tool: { id: 't1', name: 'textEditor', input: {} } }, timestamp: new Date() },
        { type: 'tool_start', data: { tool: { id: 't1', name: 'textEditor', input: {} } }, timestamp: new Date() },
        chunk('After duplicate tool'),
      ]

      const segments = await getSegmentsFromEvents(events)

      const contentSegments = segments.filter(s => s.type === 'content')
      expect(contentSegments[0].content).toBe('Before tool')
      // Duplicate tool_start must still advance lastSegmentType to 'tool_call',
      // so the following content does not pick up a paragraph separator.
      expect(contentSegments[1].content).toBe('After duplicate tool')
      expect(contentSegments[1].content).not.toMatch(/^\n\n/)
    })

    it('should NOT add separator when a tool_call segment separates two content segments', async function noSeparatorAfterTool() {
      const events = [
        chunk('Before tool'),
        ...toolPair('t1', 'textEditor'),
        chunk('After tool'),
      ]

      const segments = await getSegmentsFromEvents(events)

      const contentSegments = segments.filter(s => s.type === 'content')
      expect(contentSegments[0].content).toBe('Before tool')
      // After a real tool_call, lastSegmentType resets to 'tool_call',
      // so the next content segment should NOT get a separator
      expect(contentSegments[1].content).toBe('After tool')
      expect(contentSegments[1].content).not.toMatch(/^\n\n/)
    })

    it('should reflect the separator in accumulatedContent saved to the message', async function separatorInAccumulatedContent() {
      const events = [
        chunk('First sentence:'),
        stepComplete(),
        chunk('Second sentence:'),
      ]

      seedActiveConversation('test-socket', 'agent-msg-id')
      await persistence.completeConversation('conv-123', events, {}, makeContext())
      const [, updates] = mockUpdateMessage.mock.calls[0]

      expect(updates.content).toBe('First sentence:\n\nSecond sentence:')
    })

    it('should skip empty content chunks without creating segments or adding separators', async function emptyChunks() {
      const events = [
        chunk('First'),
        stepComplete(),
        chunk(''),
        stepComplete(),
        chunk('Third'),
      ]

      const segments = await getSegmentsFromEvents(events)

      const contentSegments = segments.filter(s => s.type === 'content')
      expect(contentSegments).toHaveLength(2)
      expect(contentSegments[0].content).toBe('First')
      expect(contentSegments[1].content).toBe('\n\nThird')
    })

    it('should produce a mix of separated text and tool segments in correct order', async function mixedOrder() {
      const events = [
        chunk('Plan text'),
        stepComplete(),
        chunk('Narration continued:'),
        ...toolPair('t1', 'setProjectName'),
      ]

      const segments = await getSegmentsFromEvents(events)

      expect(segments[0].type).toBe('content')
      expect(segments[0].content).toBe('Plan text')
      expect(segments[1].type).toBe('content')
      expect(segments[1].content).toBe('\n\nNarration continued:')
      expect(segments[2].type).toBe('tool_call')
      expect(segments[2].toolCall.toolName).toBe('setProjectName')
    })
  })

  describe('#completeConversation – tool segments', function toolSegmentTests() {
    it('should combine tool_start and tool_result into a single completed tool_call segment', async function combineToolEvents() {
      const events = [
        ...toolPair('t1', 'textEditor'),
      ]

      const segments = await getSegmentsFromEvents(events)

      const toolSegments = segments.filter(s => s.type === 'tool_call')
      expect(toolSegments).toHaveLength(1)
      expect(toolSegments[0].toolCall.status).toBe('success')
      expect(toolSegments[0].toolCall.toolName).toBe('textEditor')
    })

    it('should save all tool results to the toolCalls array on the message', async function toolCallsArray() {
      const events = [
        ...toolPair('t1', 'textEditor'),
        ...toolPair('t2', 'setProjectName'),
      ]

      seedActiveConversation('test-socket', 'agent-msg-id')
      await persistence.completeConversation('conv-123', events, {}, makeContext())
      const [, updates] = mockUpdateMessage.mock.calls[0]

      expect(updates.toolCalls).toHaveLength(2)
      expect(updates.toolCalls.map((t: any) => t.toolName)).toEqual(
        expect.arrayContaining(['textEditor', 'setProjectName'])
      )
    })

    it('should mark tool as error when tool_result contains an error', async function errorTool() {
      const events = [
        { type: 'tool_start', data: { tool: { id: 'bad-tool', name: 'bash', input: {} } }, timestamp: new Date() },
        { type: 'tool_result', data: { tool: { id: 'bad-tool', name: 'bash', error: 'Command failed', is_error: true } }, timestamp: new Date() },
      ]

      const segments = await getSegmentsFromEvents(events)

      const toolSegment = segments.find(s => s.type === 'tool_call')
      expect(toolSegment?.toolCall.status).toBe('error')
      expect(toolSegment?.toolCall.error).toBe('Command failed')
    })
  })

  describe('#completeConversation – persistence', function persistenceTests() {
    it('should call updateMessage when an agentMessageId exists', async function callsUpdate() {
      seedActiveConversation('test-socket', 'agent-msg-id')
      await persistence.completeConversation('conv-123', [chunk('hi')], {}, makeContext())

      expect(mockUpdateMessage).toHaveBeenCalledTimes(1)
      expect(mockUpdateMessage).toHaveBeenCalledWith('agent-msg-id', expect.objectContaining({
        content: 'hi',
        metadata: expect.objectContaining({ inProgress: false }),
      }))
    })

    it('should call addMessage as fallback when no agentMessageId exists', async function callsAddAsFallback() {
      // Do NOT seed activeConversations — no agentMessageId
      await persistence.completeConversation('conv-123', [chunk('hi')], {}, makeContext())

      expect(mockUpdateMessage).not.toHaveBeenCalled()
      expect(mockAddMessage).toHaveBeenCalledWith('conv-123', 'agent', 'hi', expect.any(Object))
    })

    it('should include commitHash in metadata when present on context', async function includesCommitHash() {
      seedActiveConversation('test-socket', 'agent-msg-id')
      const contextWithHash = { ...makeContext(), commitHash: 'abc123def456' }
      await persistence.completeConversation('conv-123', [chunk('hi')], {}, contextWithHash)

      expect(mockUpdateMessage).toHaveBeenCalledWith('agent-msg-id', expect.objectContaining({
        metadata: expect.objectContaining({ commitHash: 'abc123def456' }),
      }))
    })

    it('should omit commitHash from metadata when not on context', async function omitsCommitHashWhenAbsent() {
      seedActiveConversation('test-socket', 'agent-msg-id')
      await persistence.completeConversation('conv-123', [chunk('hi')], {}, makeContext())

      const [, updates] = mockUpdateMessage.mock.calls[0]
      expect(updates.metadata).not.toHaveProperty('commitHash')
    })

    it('should patch commitHash on message when fallback commit runs after save', async function patchCommitAfterFallback() {
      const { AgentsMessagePersistence } = await import('../conversation-persistence.js')
      const spy = vi
        .spyOn(AgentsMessagePersistence.prototype as any, 'checkAndCommitChanges')
        .mockResolvedValue('aba7aba7aba7aba7aba7aba7aba7aba7aba7')

      const p = new AgentsMessagePersistence()
      ;(p as any).activeConversations.set('test-socket', {
        conversationId: 'conv-123',
        userMessageId: 'user-msg-id',
        agentMessageId: 'agent-msg-id',
        context: {
          ...makeContext('test-socket'),
          appId: 'app-1',
        },
        message: 'create about page',
        origin: 'customer',
      })

      try {
        await p.completeConversation(
          'conv-123',
          [chunk('hi')],
          {},
          { ...makeContext('test-socket'), appId: 'app-1' }
        )

        const [, updates] = mockUpdateMessage.mock.calls[0]
        expect(updates.metadata).not.toHaveProperty('commitHash')

        expect(mockUpdateMessageMetadata).toHaveBeenCalledWith('agent-msg-id', {
          commitHash: 'aba7aba7aba7aba7aba7aba7aba7aba7aba7',
        })
      } finally {
        spy.mockRestore()
      }
    })

    it('should include commitHash in addMessage fallback metadata when present on context', async function includesCommitHashInFallback() {
      // Do NOT seed activeConversations — no agentMessageId
      const contextWithHash = { ...makeContext(), commitHash: 'abc123def456' }
      await persistence.completeConversation('conv-123', [chunk('hi')], {}, contextWithHash)

      expect(mockAddMessage).toHaveBeenCalledWith('conv-123', 'agent', 'hi',
        expect.objectContaining({
          metadata: expect.objectContaining({ commitHash: 'abc123def456' }),
        })
      )
    })
  })

  describe('#handleDisconnection – cleanup', function disconnectionCleanupTests() {
    it('should clear inProgress flag when agent message is in progress', async function clearsInProgress() {
      seedActiveConversation('test-socket', 'agent-msg-123')
      
      mockGetMessageById.mockResolvedValueOnce({
        id: 'agent-msg-123',
        sender: 'agent',
        content: 'Partial response...',
        metadata: { inProgress: true }
      })

      await persistence.handleDisconnection('test-socket', ['conv-123'])

      expect(mockGetMessageById).toHaveBeenCalledWith('agent-msg-123')
      expect(mockUpdateMessageMetadata).toHaveBeenCalledWith('agent-msg-123', {
        inProgress: false
      })
      expect(mockLoggerModule.info).toHaveBeenCalledWith(
        'websocket.disconnection.clearing_inprogress',
        expect.objectContaining({
          conversationId: 'conv-123',
          messageId: 'agent-msg-123',
          socketId: 'test-socket'
        })
      )
    })

    it('should not update when message has inProgress: false', async function skipWhenNotInProgress() {
      seedActiveConversation('test-socket', 'agent-msg-123')
      
      mockGetMessageById.mockResolvedValueOnce({
        id: 'agent-msg-123',
        sender: 'agent',
        content: 'Complete response',
        metadata: { inProgress: false }
      })

      await persistence.handleDisconnection('test-socket', ['conv-123'])

      expect(mockGetMessageById).toHaveBeenCalledWith('agent-msg-123')
      expect(mockUpdateMessageMetadata).not.toHaveBeenCalled()
    })

    it('should not update when message has no inProgress metadata', async function skipWhenNoMetadata() {
      seedActiveConversation('test-socket', 'agent-msg-123')
      
      mockGetMessageById.mockResolvedValueOnce({
        id: 'agent-msg-123',
        sender: 'agent',
        content: 'Response',
        metadata: {}
      })

      await persistence.handleDisconnection('test-socket', ['conv-123'])

      expect(mockUpdateMessageMetadata).not.toHaveBeenCalled()
    })

    it('should not update when no active conversation exists', async function skipWhenNoActiveConversation() {
      // Don't seed activeConversations - socket has no tracked message

      await persistence.handleDisconnection('test-socket', ['conv-123'])

      expect(mockGetMessageById).not.toHaveBeenCalled()
      expect(mockUpdateMessageMetadata).not.toHaveBeenCalled()
    })

    it('should handle errors gracefully and log them', async function handleErrors() {
      seedActiveConversation('test-socket', 'agent-msg-123')
      
      mockGetMessageById.mockRejectedValueOnce(new Error('Database unavailable'))

      await persistence.handleDisconnection('test-socket', ['conv-123'])

      expect(mockLoggerModule.error).toHaveBeenCalledWith(
        'websocket.disconnection.clear_inprogress_failed',
        expect.objectContaining({
          conversationId: 'conv-123',
          socketId: 'test-socket',
          error: 'Database unavailable'
        })
      )
    })

    it('should clean up activeConversations after processing', async function cleansUpTracking() {
      seedActiveConversation('test-socket', 'agent-msg-123')

      mockGetMessageById.mockResolvedValueOnce({
        id: 'agent-msg-123',
        sender: 'agent',
        metadata: { inProgress: true }
      })

      await persistence.handleDisconnection('test-socket', ['conv-123'])

      const activeConversations = (persistence as any).activeConversations
      expect(activeConversations.has('test-socket')).toBe(false)
    })
  })

  describe('#completeConversation - handoff token tracking', () => {
    it('should track handoff usage with correct targetAgent from toolArgs', async () => {
      // Mock aiLibAgentMetadata with agent model names
      const { aiLibAgentMetadata } = await import('../../agents/ai-lib-agents/index.js')
      ;(aiLibAgentMetadata as any).develop = { modelName: 'claude-sonnet-4-6' }
      ;(aiLibAgentMetadata as any).marketing = { modelName: 'claude-sonnet-4-5' }

      const mockTrackTokenUsageInAPM = vi.spyOn(persistence as any, 'trackTokenUsageInAPM')

      seedActiveConversation('test-socket', 'agent-msg-handoff')

      const context = {
        socketId: 'test-socket',
        appId: 'test-app-handoff',
        conversationId: 'conv-handoff-123',
        agentName: 'develop',
        userId: 'user-1',
        metadata: {
          conversationId: 'conv-handoff-123',
        },
      }

      const handoffToolOutput = {
        success: true,
        result: {
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150
          }
        }
      }

      const events = [
        { type: 'tool_start', data: { tool: { id: 'tool-1', name: 'handoff', input: { targetAgent: 'marketing', prompt: 'Need SEO help' } } }, timestamp: new Date() },
        { type: 'tool_result', data: { tool: { id: 'tool-1', name: 'handoff', output: handoffToolOutput } }, timestamp: new Date() },
      ]

      const result = {}

      await persistence.completeConversation('conv-handoff-123', events, result, context)

      // Verify trackTokenUsageInAPM was called with correct targetAgent and modelName
      expect(mockTrackTokenUsageInAPM).toHaveBeenCalledWith(
        'handoff',
        expect.objectContaining({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        }),
        expect.objectContaining({
          conversationId: 'conv-handoff-123',
          appId: 'test-app-handoff',
          agentName: 'develop',
          targetAgent: 'marketing',
          modelName: 'claude-sonnet-4-5', // From marketing agent metadata
        })
      )

      // Verify logging includes correct fields
      expect(mockLoggerModule.info).toHaveBeenCalledWith(
        'conversation.handoff_usage.recorded',
        expect.objectContaining({
          conversationId: 'conv-handoff-123',
          appId: 'test-app-handoff',
          sourceAgent: 'develop',
          targetAgent: 'marketing',
          modelName: 'claude-sonnet-4-5',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        })
      )
    })

    it('should fallback to unknown and default model when toolArgs has no targetAgent', async () => {
      const mockTrackTokenUsageInAPM = vi.spyOn(persistence as any, 'trackTokenUsageInAPM')

      seedActiveConversation('test-socket-2', 'agent-msg-handoff-2')

      const context = {
        socketId: 'test-socket-2',
        appId: 'test-app-handoff-2',
        conversationId: 'conv-handoff-456',
        agentName: 'develop',
        userId: 'user-1',
        metadata: {
          conversationId: 'conv-handoff-456',
        },
      }

      const handoffToolOutput = {
        success: true,
        result: {
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150
          }
        }
      }

      const events = [
        { type: 'tool_start', data: { tool: { id: 'tool-2', name: 'handoff', input: {} } }, timestamp: new Date() },
        { type: 'tool_result', data: { tool: { id: 'tool-2', name: 'handoff', output: handoffToolOutput } }, timestamp: new Date() },
      ]

      const result = {}

      await persistence.completeConversation('conv-handoff-456', events, result, context)

      // Verify it falls back to 'unknown' and default model name
      expect(mockTrackTokenUsageInAPM).toHaveBeenCalledWith(
        'handoff',
        expect.anything(),
        expect.objectContaining({
          targetAgent: 'unknown',
          modelName: 'claude-sonnet-4-6', // Fallback model
        })
      )
    })
  })
})
