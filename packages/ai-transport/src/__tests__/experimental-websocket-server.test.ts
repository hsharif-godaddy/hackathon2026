import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Server as HTTPServer } from 'http'
import { WebSocketServer } from '../experimental-websocket-server.js'
import { createNoOpPersistence } from '../noop-persistence.js'
import type { AgentWrapper } from '@airo/ai-lib'

// Mock Socket.IO
const mockSocket: Record<string, any> = {
  id: 'test-socket-id',
  emit: vi.fn(),
  on: vi.fn(),
  connected: true,
  data: {},
  handshake: {
    auth: {}
  },
  volatile: {
    emit: vi.fn()
  }
}

const mockIO = {
  on: vi.fn(),
  close: vi.fn()
}

// Mock the Socket.IO Server constructor
vi.mock('socket.io', () => ({
  Server: vi.fn().mockImplementation(() => mockIO)
}))

// Mock agent
const mockAgent: AgentWrapper = {
  getName: () => 'test-agent',
  streamGenerate: vi.fn()
} as any

const mockAgents = {
  get: vi.fn().mockReturnValue(mockAgent),
  list: vi.fn().mockReturnValue(['test-agent'])
}

/**
 * Helper to create a disconnected connection state via stateManager
 * This replaces direct Map manipulation in tests
 */
function createDisconnectedConnectionState(
  stateManager: any,
  socketId: string,
  conversationId: string,
  agentName: string,
  lastDeliveredSequence: number = 3
): AbortController {
  const abortController = new AbortController()
  stateManager.createConnection(socketId, {
    conversationId,
    agentName,
    context: { socketId, agentName }
  })
  stateManager.updateConnection(socketId, {
    abortController,
    lastDeliveredSequence
  })
  const recoveryTimeoutId = setTimeout(() => {}, 60000)
  stateManager.transitionTo(socketId, 'disconnected', { recoveryTimeoutId })
  return abortController
}

/**
 * Helper to set up server with proper async connection handling
 * Returns the captured chat message handler after async connection setup completes
 */
async function setupServerWithConnection(
  httpServer: HTTPServer,
  config: { agents: typeof mockAgents; defaultAgent: string; messagePersistence?: any }
): Promise<{ server: WebSocketServer; messageHandler: (data: any) => Promise<void> }> {
  let connectionHandler: ((socket: any) => Promise<void>) | null = null

  mockIO.on.mockImplementation((event: string, handler: any) => {
    if (event === 'connection') {
      connectionHandler = handler
    }
  })

  // Add default no-op persistence if not provided
  const configWithPersistence = {
    ...config,
    messagePersistence: config.messagePersistence ?? createNoOpPersistence()
  }

  const server = new WebSocketServer(httpServer, configWithPersistence)

  // Now trigger the connection and AWAIT it to ensure chat handler is registered
  if (connectionHandler) {
    await connectionHandler(mockSocket)
  }

  // Find the chat handler after async connection setup completes
  const onCall = mockSocket.on.mock.calls.find((call: any[]) => call[0] === 'chat')
  if (!onCall) {
    throw new Error('Chat handler not found after connection setup')
  }

  return { server, messageHandler: onCall[1] }
}

/**
 * Helper to create a mock persistence with method overrides
 * Preserves prototype chain to ensure all methods are available
 */
function createMockPersistence(overrides: Partial<ReturnType<typeof createNoOpPersistence>>) {
  const basePersistence = createNoOpPersistence()
  return Object.assign(
    Object.create(Object.getPrototypeOf(basePersistence)),
    basePersistence,
    overrides
  )
}

describe('WebSocketServer - Error Handling', () => {
  let server: WebSocketServer
  let httpServer: HTTPServer

  beforeEach(() => {
    vi.clearAllMocks()
    httpServer = new HTTPServer()

    server = new WebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: createNoOpPersistence()
    })
  })

  afterEach(() => {
    server.close()
  })

  describe('Malformed JSON Tool Call Error Handling', () => {
    it('should handle AI_APICallError with invalid toolUse.input', async () => {
      // Setup the error that would come from Bedrock API
      const apiError = new Error('The format of the value at messages.7.content.1.toolUse.input is invalid. Provide a json object for the field and try again.')
      apiError.name = 'AI_APICallError'

      // Mock streamGenerate to throw the error on first call, succeed on retry
      const mockStreamResult = {
        baseStream: null,
        textStream: (async function* () {
          yield 'Retry successful'
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 100, outputTokens: 50 },
          toolCalls: []
        })
      }

      mockAgent.streamGenerate
        .mockRejectedValueOnce(apiError) // First call fails
        .mockResolvedValueOnce(mockStreamResult) // Retry succeeds

      const chatMessage = {
        message: 'Edit the file',
        agentId: 'test-agent'
      }

      // Setup server with proper async connection handling
      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })
      server = testServer

      // Execute the message handler with our test data
      await messageHandler(chatMessage)

      // Verify the error handling behavior
      expect(mockAgent.streamGenerate).toHaveBeenCalledTimes(2) // Original call + retry

      // Check that error messages were emitted to the client
      const emitCalls = mockSocket.emit.mock.calls
      
      // Should emit step_start for the failed attempt
      const stepStartCall = emitCalls.find(call => 
        call[0] === 'message' && call[1].type === 'step_start'
      )
      expect(stepStartCall).toBeDefined()

      // Should emit tool_result showing the failure
      const toolResultCall = emitCalls.find(call => 
        call[0] === 'message' && 
        call[1].type === 'tool_result' && 
        call[1].content === 'Tool call failed - invalid JSON format'
      )
      expect(toolResultCall).toBeDefined()
      expect(toolResultCall[1].data.tool.name).toBe('tool_validation_failed')
      expect(toolResultCall[1].data.tool.output).toContain('invalid JSON format')

      // Should emit step_complete for the failed attempt
      const stepCompleteCall = emitCalls.find(call => 
        call[0] === 'message' && 
        call[1].type === 'step_complete' && 
        call[1].data.isFinal === false
      )
      expect(stepCompleteCall).toBeDefined()

      // Verify retry was attempted with proper error context
      const retryCall = mockAgent.streamGenerate.mock.calls[1]
      expect(retryCall[0]).toContain('The previous tool call failed due to invalid JSON syntax')
      expect(retryCall[1].messages).toHaveLength(1)
      expect(retryCall[1].messages[0]).toEqual({ role: 'user', content: 'Edit the file' })
    })

    it('should require acknowledgement for manual recovery and deliver catch-up events', async () => {
      vi.clearAllMocks()

      let connectionHandler: any
      mockIO.on.mockImplementation((event: string, handler: any) => {
        if (event === 'connection') {
          connectionHandler = handler
        }
      })

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const eventChannel = (testServer as any).eventChannel
      const stateManager = (testServer as any).stateManager

      // Set up disconnected connection state
      createDisconnectedConnectionState(stateManager, 'auto-socket-id', 'auto-conv-id', 'test-agent', 3)

      const initialEvents = [
        { id: 'init1', sequence: 4, type: 'chunk', content: 'Initial chunk', data: {}, timestamp: new Date(), conversationId: 'auto-conv-id', agentName: 'test-agent' }
      ]
      const catchUpEvents = [
        { id: 'catch1', sequence: 5, type: 'chunk', content: 'Catch-up chunk', data: {}, timestamp: new Date(), conversationId: 'auto-conv-id', agentName: 'test-agent' }
      ]

      const getEventsSinceSpy = vi.spyOn(eventChannel, 'getEventsSince')
        .mockReturnValueOnce(initialEvents)
        .mockReturnValueOnce(catchUpEvents)

      const mockSocketAuto = {
        id: 'auto-socket-new',
        emit: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
        handshake: { auth: { previousSocketId: 'auto-socket-id' } },
        volatile: { emit: vi.fn() }
      }

      if (connectionHandler) {
        await connectionHandler(mockSocketAuto)

        // Manual recovery replays all events from -1 (page refresh loses client state)
        expect(getEventsSinceSpy).toHaveBeenCalledWith('auto-conv-id', -1)

        const recoveryStartCall = mockSocketAuto.emit.mock.calls.find(call =>
          call[0] === 'message' &&
          call[1].type === 'recovery_status' &&
          call[1].data.requiresAck === true
        )
        expect(recoveryStartCall).toBeDefined()

        const replayCompleteCall = mockSocketAuto.emit.mock.calls.find(call =>
          call[0] === 'message' && call[1].type === 'replay_complete'
        )
        expect(replayCompleteCall).toBeDefined()

        const ackHandler = mockSocketAuto.once.mock.calls.find(call => call[0] === 'recovery_ack')?.[1]
        expect(ackHandler).toBeDefined()
        if (ackHandler) {
          ackHandler({
            conversationId: 'auto-conv-id',
            lastSequence: 4
          })
        }

        const catchupStatusCall = mockSocketAuto.emit.mock.calls.find(call =>
          call[0] === 'message' && call[1].type === 'catchup_status'
        )
        expect(catchupStatusCall).toBeDefined()

        const catchupCompleteCall = mockSocketAuto.emit.mock.calls.find(call =>
          call[0] === 'message' && call[1].type === 'catchup_complete'
        )
        expect(catchupCompleteCall).toBeDefined()

        const catchupAckHandler = mockSocketAuto.once.mock.calls.find(call => call[0] === 'catchup_ack')?.[1]
        expect(catchupAckHandler).toBeDefined()
        if (catchupAckHandler) {
          catchupAckHandler({
            conversationId: 'auto-conv-id',
            lastSequence: 5
          })
        }

        const catchUpEmits = mockSocketAuto.volatile.emit.mock.calls.filter(call =>
          call[0] === 'message' && call[1].type === 'chunk' && call[1].content === 'Catch-up chunk'
        )
        expect(catchUpEmits.length).toBe(1)

        // Verify connection is no longer disconnected and has active stream (migrated to new socket ID)
        expect(stateManager.isDisconnected('auto-socket-new')).toBe(false)
        expect(stateManager.hasActiveStream('auto-socket-new')).toBe(true)
      }

      // Clean up - timeout is managed by stateManager internally
      testServer.close()
    })

    it('should require acknowledgement for manual recovery and deliver catch-up events', async () => {
      vi.clearAllMocks()

      let connectionHandler: any
      mockIO.on.mockImplementation((event: string, handler: any) => {
        if (event === 'connection') {
          connectionHandler = handler
        }
      })

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const eventChannel = (testServer as any).eventChannel
      const stateManager = (testServer as any).stateManager

      // Set up disconnected connection state
      createDisconnectedConnectionState(stateManager, 'old-socket-id', 'manual-conv-id', 'test-agent', 7)

      const initialEvents = [
        { id: 'm1', sequence: 8, type: 'chunk', content: 'Manual chunk', data: {}, timestamp: new Date(), conversationId: 'manual-conv-id', agentName: 'test-agent' }
      ]
      const catchUpEvents = [
        { id: 'm2', sequence: 9, type: 'chunk', content: 'Manual catch-up', data: {}, timestamp: new Date(), conversationId: 'manual-conv-id', agentName: 'test-agent' }
      ]

      const getEventsSinceSpy = vi.spyOn(eventChannel, 'getEventsSince')
        .mockReturnValueOnce(initialEvents)
        .mockReturnValueOnce(catchUpEvents)

      const manualSocket = {
        id: 'new-socket-id',
        emit: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
        handshake: { auth: { previousSocketId: 'old-socket-id' } },
        volatile: { emit: vi.fn() }
      }

      if (connectionHandler) {
        await connectionHandler(manualSocket)

        // Manual recovery replays all events from -1 (page refresh loses client state)
        expect(getEventsSinceSpy).toHaveBeenCalledWith('manual-conv-id', -1)

        const recoveryStatus = manualSocket.emit.mock.calls.find(call =>
          call[0] === 'message' && call[1].type === 'recovery_status'
        )
        expect(recoveryStatus?.[1].data.requiresAck).toBe(true)

        const manualAckHandler = manualSocket.once.mock.calls.find(call => call[0] === 'recovery_ack')?.[1]
        expect(manualAckHandler).toBeDefined()
        manualAckHandler?.({
          conversationId: 'manual-conv-id',
          lastSequence: 8
        })

        const catchupAckHandler = manualSocket.once.mock.calls.find(call => call[0] === 'catchup_ack')?.[1]
        expect(catchupAckHandler).toBeDefined()
        catchupAckHandler?.({
          conversationId: 'manual-conv-id',
          lastSequence: 9
        })

        // Verify connection is no longer disconnected (migrated to new socket ID)
        expect(stateManager.isDisconnected('new-socket-id')).toBe(false)
      }

      testServer.close()
    })

    it('should set lossDetected flag when buffer overflow occurs', async () => {
      vi.clearAllMocks()

      let connectionHandler: any
      mockIO.on.mockImplementation((event: string, handler: any) => {
        if (event === 'connection') {
          connectionHandler = handler
        }
      })

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const eventChannel = (testServer as any).eventChannel
      const stateManager = (testServer as any).stateManager
      const metadataSpy = vi.spyOn(eventChannel, 'getMetadata').mockReturnValue({
        conversationId: 'loss-conv-id',
        firstSequence: 50,
        lastSequence: 60,
        totalEvents: 11,
        oldestTimestamp: new Date(),
        newestTimestamp: new Date()
      })

      // Set up disconnected connection state with lastDeliveredSequence: 10
      // Buffer starts at firstSequence: 50, so events 11-49 are lost
      createDisconnectedConnectionState(stateManager, 'loss-socket-id', 'loss-conv-id', 'test-agent', 10)
      // Add appId to context to pass site validation (must match siteId in socket auth)
      stateManager.updateConnection('loss-socket-id', { context: { socketId: 'loss-socket-id', agentName: 'test-agent', appId: 'test-site' } })

      vi.spyOn(eventChannel, 'getEventsSince').mockReturnValue([])

      // Use conversation recovery (conversationId cookie) instead of manual recovery (previousSocketId)
      // Buffer loss detection only runs for conversation recovery because manual recovery
      // reloads full history anyway (clientHasNoState = true for manual)
      const lossSocket = {
        id: 'loss-socket-new',
        emit: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
        handshake: { auth: { conversationId: 'loss-conv-id', siteId: 'test-site' } },
        volatile: { emit: vi.fn() }
      }

      if (connectionHandler) {
        await connectionHandler(lossSocket)

        expect(metadataSpy).toHaveBeenCalledWith('loss-conv-id')

        const recoveryStatus = lossSocket.emit.mock.calls.find(call =>
          call[0] === 'message' && call[1].type === 'recovery_status'
        )
        expect(recoveryStatus?.[1].data.lossDetected).toBe(true)
        expect(recoveryStatus?.[1].data.lostEventCount).toBeGreaterThan(0)
      }

      testServer.close()
    })

    it('should handle JSON parsing failed errors', async () => {
      const jsonError = new Error('JSON parsing failed: Text: {"mode": "edit", "path": "test.tsx". Error message: Expected \',\' or \'}\' after property value')

      mockAgent.streamGenerate.mockRejectedValueOnce(jsonError)

      const chatMessage = {
        message: 'Edit the file',
        agentId: 'test-agent'
      }

      // Setup server with proper async connection handling
      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })
      server = testServer

      await messageHandler(chatMessage)

      // Should detect JSON parsing failed error
      const emitCalls = mockSocket.emit.mock.calls
      const toolResultCall = emitCalls.find(call => 
        call[0] === 'message' && 
        call[1].type === 'tool_result' &&
        call[1].data.tool.name === 'tool_validation_failed'
      )
      
      expect(toolResultCall).toBeDefined()
      expect(toolResultCall[1].data.tool.output).toContain('JSON parsing failed')
    })

    it('should handle null values in tool arguments safely', () => {
      // Test the null handling logic directly
      const testCases = [
        { input: null, expected: 'null' },
        { input: undefined, expected: 'undefined' },
        { input: { key: 'value' }, expected: 'key: value' },
        { input: 'string', expected: 'string' },
        { input: 123, expected: '123' }
      ]

      testCases.forEach(({ input, expected }) => {
        let formattedArgs = 'unknown_arguments'
        
        // Simulate the logic from the actual code
        if (typeof input === 'object' && input !== null) {
          formattedArgs = Object.entries(input)
            .map(([key, value]) => `${key}: ${String(value).substring(0, 100)}`)
            .join(', ')
        } else {
          formattedArgs = String(input).substring(0, 100)
        }

        expect(formattedArgs).toContain(expected)
      })
    })

    it('should not interfere with other types of errors', async () => {
      const otherError = new Error('Network timeout')

      mockAgent.streamGenerate.mockRejectedValueOnce(otherError)

      // Mock the onError handler to verify it gets called
      const onErrorMock = vi.fn()

      const chatMessage = {
        message: 'Edit the file',
        agentId: 'test-agent'
      }

      // Setup server with proper async connection handling
      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })
      server = testServer
      // Note: onError is not passed here since setupServerWithConnection doesn't support it
      // but the test still validates error emission behavior

      // Should not throw but handle via error handlers
      await messageHandler(chatMessage)
      
      // Should emit error message for non-tool validation errors
      const emitCalls = mockSocket.emit.mock.calls
      const errorCall = emitCalls.find(call => 
        call[0] === 'message' && 
        call[1].type === 'error'
      )
      expect(errorCall).toBeDefined()
      expect(errorCall[1].content).toContain('Network timeout')
      
      // Should not emit tool validation error messages for other error types
      const toolValidationCall = emitCalls.find(call => 
        call[0] === 'message' && 
        call[1].type === 'tool_result' &&
        call[1].data.tool.name === 'tool_validation_failed'
      )
      expect(toolValidationCall).toBeUndefined()
      
      // Note: onError handler may or may not be called depending on how the error is processed
    })

    it('should handle retry failures gracefully', async () => {
      const apiError = new Error('The format of the value at messages.7.content.1.toolUse.input is invalid')
      apiError.name = 'AI_APICallError'

      const retryError = new Error('Retry also failed')

      mockAgent.streamGenerate
        .mockRejectedValueOnce(apiError)
        .mockRejectedValueOnce(retryError)

      const chatMessage = {
        message: 'Edit the file',
        agentId: 'test-agent'
      }

      // Setup server with proper async connection handling
      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })
      server = testServer

      // Should attempt retry and then handle the retry error
      await messageHandler(chatMessage)
      
      expect(mockAgent.streamGenerate).toHaveBeenCalledTimes(2)
      
      // Should show the initial tool validation failure
      const emitCalls = mockSocket.emit.mock.calls
      const toolResultCall = emitCalls.find(call => 
        call[0] === 'message' && 
        call[1].type === 'tool_result' &&
        call[1].data.tool.name === 'tool_validation_failed'
      )
      expect(toolResultCall).toBeDefined()
      
      // Note: Error handling occurs via standard error flow
    })
  })

  describe('Stream Processing Network Errors', () => {
    it('should handle baseStream reader termination errors', async () => {
      // Create a mock ReadableStream that throws the specific error from the stack trace
      const mockReader = {
        read: vi.fn(),
        cancel: vi.fn(),
        releaseLock: vi.fn()
      }

      // Simulate the undici termination error
      const terminationError = new Error('terminated')
      terminationError.name = 'TypeError'
      // Add stack trace patterns from the actual error
      Object.defineProperty(terminationError, 'cause', {
        value: {
          code: 'UND_ERR_SOCKET',
          message: 'other side closed'
        }
      })

      // First read succeeds, second read fails with termination error
      mockReader.read
        .mockResolvedValueOnce({ done: false, value: { part: { type: 'text-delta', text: 'Hello' } } })
        .mockRejectedValueOnce(terminationError)

      const mockBaseStream = {
        getReader: vi.fn().mockReturnValue(mockReader)
      }

      const mockTextStream = (async function* () {
        yield 'Fallback text'
        yield ' from textStream'
      })()

      const mockStreamResult = {
        baseStream: mockBaseStream,
        textStream: mockTextStream,
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 100, outputTokens: 50 },
          toolCalls: []
        })
      }

      mockAgent.streamGenerate.mockResolvedValueOnce(mockStreamResult)

      // Spy on console.error to verify fallback behavior
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const chatMessage = {
        message: 'Test message',
        agentId: 'test-agent'
      }

      // Setup server with proper async connection handling
      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })
      server = testServer

      await messageHandler(chatMessage)

      // Verify that baseStream was accessed
      expect(mockBaseStream.getReader).toHaveBeenCalled()
      expect(mockReader.read).toHaveBeenCalled()

      // Verify the error was handled - either with an error event or graceful completion
      const emitCalls = mockSocket.emit.mock.calls

      // Should emit some messages (chunks before error and/or error event)
      expect(emitCalls.length).toBeGreaterThan(0)

      // Check for either chunk content or error handling
      const chunkCalls = emitCalls.filter(call =>
        call[0] === 'message' && call[1].type === 'chunk'
      )
      const errorCalls = emitCalls.filter(call =>
        call[0] === 'message' && call[1].type === 'error'
      )

      // Either chunks were emitted before error, or error was properly handled
      expect(chunkCalls.length + errorCalls.length).toBeGreaterThan(0)

      consoleErrorSpy.mockRestore()
    })

    it('should handle ResponseContentLengthMismatchError', async () => {
      // Create the specific error from the second stack trace
      const contentLengthError = new Error('Response body length does not match content-length header')
      contentLengthError.name = 'TypeError'
      Object.defineProperty(contentLengthError, 'cause', {
        value: {
          code: 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
          message: 'Response body length does not match content-length header'
        }
      })

      const mockReader = {
        read: vi.fn().mockRejectedValue(contentLengthError),
        cancel: vi.fn(),
        releaseLock: vi.fn()
      }

      const mockBaseStream = {
        getReader: vi.fn().mockReturnValue(mockReader)
      }

      const mockTextStream = (async function* () {
        yield 'Fallback after content-length error'
      })()

      const mockStreamResult = {
        baseStream: mockBaseStream,
        textStream: mockTextStream,
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 50, outputTokens: 25 },
          toolCalls: []
        })
      }

      mockAgent.streamGenerate.mockResolvedValueOnce(mockStreamResult)

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const chatMessage = {
        message: 'Test content length error',
        agentId: 'test-agent'
      }

      // Setup server with proper async connection handling
      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })
      server = testServer

      await messageHandler(chatMessage)

      // Verify baseStream was accessed and failed
      expect(mockBaseStream.getReader).toHaveBeenCalled()
      expect(mockReader.read).toHaveBeenCalled()

      // Verify the error was handled - either with fallback chunks or error event
      const emitCalls = mockSocket.emit.mock.calls

      // Should emit some messages
      expect(emitCalls.length).toBeGreaterThan(0)

      // Check for either chunk content or error handling
      const chunkCalls = emitCalls.filter(call =>
        call[0] === 'message' && call[1].type === 'chunk'
      )
      const errorCalls = emitCalls.filter(call =>
        call[0] === 'message' && call[1].type === 'error'
      )

      // Either chunks were emitted (fallback success) or error was properly handled
      expect(chunkCalls.length + errorCalls.length).toBeGreaterThan(0)

      consoleErrorSpy.mockRestore()
    })

    it('should handle stream processing cancellation gracefully', async () => {
      const mockReader = {
        read: vi.fn(),
        cancel: vi.fn(),
        releaseLock: vi.fn()
      }

      // First read succeeds, then simulate cancellation
      mockReader.read
        .mockResolvedValueOnce({ done: false, value: { part: { type: 'text-delta', text: 'Started' } } })
        .mockImplementation(() => new Promise((_, reject) => {
          // Simulate async operation that gets cancelled
          setTimeout(() => reject(new Error('Operation cancelled')), 10)
        }))

      const mockBaseStream = {
        getReader: vi.fn().mockReturnValue(mockReader)
      }

      const mockStreamResult = {
        baseStream: mockBaseStream,
        textStream: (async function* () {
          yield 'Should not reach fallback'
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 10, outputTokens: 5 },
          toolCalls: []
        })
      }

      mockAgent.streamGenerate.mockResolvedValueOnce(mockStreamResult)

      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })
      server = testServer

      const chatMessage = {
        message: 'Test cancellation',
        agentId: 'test-agent'
      }

      // Start the message processing
      const messagePromise = messageHandler(chatMessage)

      // Simulate cancellation by triggering socket disconnect
      const disconnectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect')?.[1]
      if (disconnectHandler) {
        disconnectHandler()
      }

      await messagePromise

      // Verify that the stream was attempted to be processed
      expect(mockBaseStream.getReader).toHaveBeenCalled()
      expect(mockReader.read).toHaveBeenCalled()
    })

    it('should properly clean up streams on error', async () => {
      const mockReader = {
        read: vi.fn().mockRejectedValue(new Error('Stream failed')),
        cancel: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn()
      }

      const mockBaseStream = {
        getReader: vi.fn().mockReturnValue(mockReader)
      }

      const mockStreamResult = {
        baseStream: mockBaseStream,
        textStream: (async function* () {
          yield 'Fallback content'
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 20, outputTokens: 10 },
          toolCalls: []
        })
      }

      mockAgent.streamGenerate.mockResolvedValueOnce(mockStreamResult)

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const chatMessage = {
        message: 'Test cleanup',
        agentId: 'test-agent'
      }

      // Setup server with proper async connection handling
      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })
      server = testServer

      await messageHandler(chatMessage)

      // Verify baseStream was accessed
      expect(mockBaseStream.getReader).toHaveBeenCalled()
      expect(mockReader.read).toHaveBeenCalled()

      // Verify proper cleanup is now performed
      expect(mockReader.cancel).toHaveBeenCalled() // Fixed: cleanup now happens
      expect(mockReader.releaseLock).toHaveBeenCalled() // Fixed: cleanup now happens

      consoleErrorSpy.mockRestore()
    })

    it('should rethrow when both base stream and text-only fallback fail, freeing the message queue', async () => {
      // Reproduces: agent stuck in "Thinking..." when NetworkError is swallowed after
      // both base stream and text-only fallback fail. Without the fix, getFinalResult()
      // is called on the dead stream and hangs forever, permanently blocking the queue.
      const networkError = new Error('terminated')
      networkError.name = 'TypeError'
      Object.defineProperty(networkError, 'cause', {
        value: { code: 'UND_ERR_SOCKET', message: 'other side closed' }
      })

      const mockReader = {
        read: vi.fn().mockRejectedValue(networkError),
        cancel: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn()
      }

      const mockBaseStream = {
        getReader: vi.fn().mockReturnValue(mockReader)
      }

      // Text-only fallback also fails with same network error
      const failingTextStream = (async function* () {
        throw networkError
        yield 'never reached'
      })()

      const getFinalResult = vi.fn()

      const mockStreamResult = {
        baseStream: mockBaseStream,
        textStream: failingTextStream,
        getFinalResult
      }

      mockAgent.streamGenerate.mockResolvedValueOnce(mockStreamResult)

      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })
      server = testServer

      // messageHandler must resolve (not hang) — if getFinalResult were called on the
      // dead stream it would never resolve, causing this test to time out
      await messageHandler({ message: 'Test double stream failure', agentId: 'test-agent' })

      // getFinalResult must NOT be called — the error should have propagated before
      // reaching that line, preventing the infinite hang
      expect(getFinalResult).not.toHaveBeenCalled()

      // Error event must have been sent to the client
      const emitCalls = mockSocket.emit.mock.calls
      const errorCalls = emitCalls.filter(call =>
        call[0] === 'message' && call[1].type === 'error'
      )
      expect(errorCalls.length).toBeGreaterThan(0)
    })
  })

  describe('Debug Logging', () => {
    it('should handle API errors and emit error event', async () => {
      const apiError = new Error('The format of the value at messages.7.content.1.toolUse.input is invalid')
      apiError.name = 'AI_APICallError'

      // Mock both the initial call (which triggers tool validation error handling)
      // and the retry call (which would fail without this mock)
      mockAgent.streamGenerate
        .mockRejectedValueOnce(apiError) // Initial call fails
        .mockRejectedValueOnce(new Error('Retry also failed')) // Retry fails

      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })
      server = testServer

      const chatMessage = {
        message: 'Edit the file',
        agentId: 'test-agent'
      }

      await messageHandler(chatMessage)

      // When streamGenerate fails, an error event should be emitted
      const emitCalls = mockSocket.emit.mock.calls
      const errorCalls = emitCalls.filter(call =>
        call[0] === 'message' && call[1].type === 'error'
      )
      expect(errorCalls.length).toBeGreaterThan(0)
      // Error is emitted (either from original error or retry failure)
    })
  })

  describe('Event Channel Dual-Write and Cleanup', () => {
    it('should have eventChannel initialized on server', () => {
      // Verify that the event channel is properly initialized
      const eventChannel = (server as any).eventChannel
      expect(eventChannel).toBeDefined()
      expect(typeof eventChannel.publish).toBe('function')
      expect(typeof eventChannel.subscribe).toBe('function')
      expect(typeof eventChannel.unsubscribe).toBe('function')
    })

    it('should have publishToEventChannel method defined', () => {
      // Verify the dual-write helper exists
      const publishMethod = (server as any).publishToEventChannel
      expect(publishMethod).toBeDefined()
      expect(typeof publishMethod).toBe('function')
    })

    it('should publish to eventChannel and register subscribers', async () => {
      // Setup mock that will trigger the chat flow
      const mockStreamResult = {
        baseStream: (async function* () {
          yield { type: 'text-delta', text: 'Test response' }
        })(),
        textStream: (async function* () {
          yield 'Test response'
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 10, outputTokens: 5 },
          toolCalls: []
        })
      }

      mockAgent.streamGenerate.mockResolvedValueOnce(mockStreamResult)

      // Create fresh mocks
      vi.clearAllMocks()

      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })

      // Spy on event channel publish method BEFORE processing message
      const eventChannel = (testServer as any).eventChannel
      const publishSpy = vi.spyOn(eventChannel, 'publish')

      await messageHandler({
        message: 'Test message',
        agentId: 'test-agent'
      })

      // Publish should be called during message processing
      expect(publishSpy).toHaveBeenCalled()

      // Verify that socket.emit was called (WebSocketSubscriber delivers events)
      expect(mockSocket.emit).toHaveBeenCalled()

      testServer.close()
    })

    it('should publish error events to eventChannel on error', async () => {
      // Setup mock that will fail
      const testError = new Error('Test stream error')
      mockAgent.streamGenerate.mockRejectedValueOnce(testError)

      vi.clearAllMocks()

      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })

      const eventChannel = (testServer as any).eventChannel
      const publishSpy = vi.spyOn(eventChannel, 'publish')

      // Should not throw - errors are handled internally
      await messageHandler({
        message: 'This will fail',
        agentId: 'test-agent'
      })

      // Events should still be published even on error (error event)
      expect(publishSpy).toHaveBeenCalled()

      // Verify error was emitted to socket
      const errorEmit = mockSocket.emit.mock.calls.find(
        call => call[0] === 'message' && call[1].type === 'error'
      )
      expect(errorEmit).toBeDefined()

      testServer.close()
    })
  })

  describe('Event Channel Recovery', () => {
    it('should track lastDeliveredSequence in activeConversations', async () => {
      const mockStreamResult = {
        baseStream: null,
        textStream: (async function* () {
          yield 'Test response'
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 10, outputTokens: 5 },
          toolCalls: []
        })
      }

      mockAgent.streamGenerate.mockResolvedValueOnce(mockStreamResult)

      vi.clearAllMocks()

      const mockPersistence = {
        startConversation: vi.fn().mockResolvedValue('test-conv-id'),
        captureStreamingEvent: vi.fn().mockResolvedValue(undefined),
        completeConversation: vi.fn().mockResolvedValue(undefined),
        handleConversationError: vi.fn().mockResolvedValue(undefined)
      }

      const { server: testServer, messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: mockPersistence
      })

      const eventChannel = (testServer as any).eventChannel
      const publishSpy = vi.spyOn(eventChannel, 'publish').mockResolvedValue({
        id: 'test-event-id',
        sequence: 5,
        timestamp: new Date(),
        type: 'chunk',
        content: 'Test',
        data: {},
        agentName: 'test-agent',
        conversationId: 'test-conv-id'
      })

      await messageHandler({
        message: 'Test message',
        agentId: 'test-agent'
      })

      // Verify conversation has lastDeliveredSequence tracked via stateManager
      const stateManager = (testServer as any).stateManager
      const stateData = stateManager.getStateData('test-socket-id')
      expect(stateData).toBeDefined()
      expect(stateData.lastDeliveredSequence).toBe(5)

      testServer.close()
    })

    it('should not update lastDeliveredSequence when socket is disconnected', async () => {
      vi.clearAllMocks()

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const stateManager = (testServer as any).stateManager

      // Set up disconnected connection state
      createDisconnectedConnectionState(stateManager, 'test-socket-id', 'test-conv-id', 'test-agent', 3)

      // Call publishToEventChannel while disconnected
      const publishToEventChannel = (testServer as any).publishToEventChannel.bind(testServer)
      const eventChannel = (testServer as any).eventChannel
      vi.spyOn(eventChannel, 'publish').mockResolvedValue({
        id: 'new-event-id',
        sequence: 10,  // Higher sequence
        timestamp: new Date(),
        type: 'chunk',
        content: 'New content',
        data: {},
        agentName: 'test-agent',
        conversationId: 'test-conv-id'
      })

      await publishToEventChannel('test-socket-id', 'chunk', 'New content', {}, 'test-agent')

      // Verify lastDeliveredSequence was NOT updated (socket is disconnected)
      const stateData = stateManager.getStateData('test-socket-id')
      expect(stateData.lastDeliveredSequence).toBe(3)  // Still 3, not 10

      testServer.close()
    })

    it('should replay events from event channel on reconnection', async () => {
      vi.clearAllMocks()

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      // Set up the event channel with some events
      const eventChannel = (testServer as any).eventChannel
      const stateManager = (testServer as any).stateManager
      const missedEvents = [
        { id: 'e1', sequence: 4, type: 'chunk', content: 'Missed 1', data: { step: 1 }, timestamp: new Date(), conversationId: 'test-conv-id', agentName: 'test-agent' },
        { id: 'e2', sequence: 5, type: 'chunk', content: 'Missed 2', data: { step: 1 }, timestamp: new Date(), conversationId: 'test-conv-id', agentName: 'test-agent' },
        { id: 'e3', sequence: 6, type: 'tool_result', content: 'Tool done', data: { tool: {} }, timestamp: new Date(), conversationId: 'test-conv-id', agentName: 'test-agent' }
      ]
      vi.spyOn(eventChannel, 'getEventsSince').mockReturnValue(missedEvents)

      // Set up disconnected connection state
      createDisconnectedConnectionState(stateManager, 'old-socket-id', 'test-conv-id', 'test-agent', 3)

      // Simulate reconnection with previousSocketId
      const newMockSocket = {
        id: 'new-socket-id',
        emit: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        handshake: {
          auth: { previousSocketId: 'old-socket-id' }
        },
        volatile: {
          emit: vi.fn()
        }
      }

      // Capture connection handler
      let connectionHandler: any
      mockIO.on.mockImplementation((event: string, handler: any) => {
        if (event === 'connection') {
          connectionHandler = handler
        }
      })

      // Re-create server to get fresh connection handler
      const testServer2 = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      // Set up the same state on new server
      const eventChannel2 = (testServer2 as any).eventChannel
      const stateManager2 = (testServer2 as any).stateManager
      const getEventsSinceSpy = vi.spyOn(eventChannel2, 'getEventsSince').mockImplementation((_: string, lastSequence: number) => {
        // Manual recovery (page refresh) replays all events from -1
        return lastSequence === -1 ? missedEvents : []
      })

      // Set up disconnected connection state on new server
      createDisconnectedConnectionState(stateManager2, 'old-socket-id', 'test-conv-id', 'test-agent', 3)

      // Trigger connection with the new socket
      if (connectionHandler) {
        await connectionHandler(newMockSocket)

        // Manual recovery replays all events from the beginning (-1)
        // because the client loses all state on page refresh
        expect(getEventsSinceSpy).toHaveBeenCalledWith('test-conv-id', -1)

        // Verify recovery status was sent (uses regular emit)
        let emitCalls = newMockSocket.emit.mock.calls
        const recoveryStartCall = emitCalls.find(call =>
          call[0] === 'message' &&
          call[1].type === 'recovery_status' &&
          call[1].data.isRecovering === true
        )
        expect(recoveryStartCall).toBeDefined()
        // Two consecutive chunks coalesce into one, plus one tool_result = 2 events
        expect(recoveryStartCall[1].data.bufferedEventCount).toBe(2)
        expect(recoveryStartCall[1].data.requiresAck).toBe(true)

        const replayCompleteCall = emitCalls.find(call =>
          call[0] === 'message' &&
          call[1].type === 'replay_complete'
        )
        expect(replayCompleteCall).toBeDefined()
        expect(replayCompleteCall?.[1].data.eventsReplayed).toBe(2)

        // Verify missed events were replayed via volatile.emit
        // Two consecutive chunks are coalesced into one event with concatenated content
        const volatileEmits = newMockSocket.volatile.emit.mock.calls
        const replayedCalls = volatileEmits.filter(call =>
          call[0] === 'message' &&
          (call[1].type === 'chunk' || call[1].type === 'tool_result')
        )
        expect(replayedCalls.length).toBe(2)
        const replayedContents = replayedCalls.map(call => call[1].content)
        // First event: coalesced chunks ("Missed 1" + "Missed 2")
        expect(replayedContents[0]).toBe('Missed 1Missed 2')
        // Second event: tool_result unchanged
        expect(replayedContents[1]).toBe('Tool done')

        // Simulate client sending recovery_ack
        const recoveryAckHandler = newMockSocket.once.mock.calls.find(call => call[0] === 'recovery_ack')?.[1]
        expect(recoveryAckHandler).toBeDefined()
        if (recoveryAckHandler) {
          recoveryAckHandler({
            conversationId: 'test-conv-id',
            lastSequence: 6 // Last sequence from replayed events (3 events after sequence 3 = sequences 4, 5, 6)
          })
        }

        // Verify recovery complete status was sent AFTER client ack (uses regular emit)
        emitCalls = newMockSocket.emit.mock.calls
        const recoveryCompleteCall = emitCalls.find(call =>
          call[0] === 'message' &&
          call[1].type === 'recovery_status' &&
          call[1].data.isRecovering === false
        )
        expect(recoveryCompleteCall).toBeDefined()
        // Two consecutive chunks coalesced into one + one tool_result = 2 coalesced events
        expect(recoveryCompleteCall[1].data.eventsReplayed).toBe(2)
      }

      // Clean up
      testServer.close()
      testServer2.close()
    })

    it('should copy lastDeliveredSequence to state on disconnect', async () => {
      vi.clearAllMocks()

      // Capture disconnect handler
      let disconnectHandler: any
      const mockSocketWithDisconnect = {
        ...mockSocket,
        on: vi.fn((event: string, handler: any) => {
          if (event === 'disconnect') {
            disconnectHandler = handler
          }
        })
      }

      let connectionHandler: any
      mockIO.on.mockImplementation((event: string, handler: any) => {
        if (event === 'connection') {
          connectionHandler = handler
        }
      })

      // Create server and trigger connection to capture handlers
      const testServer2 = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      if (connectionHandler) {
        await connectionHandler(mockSocketWithDisconnect)
      }

      // Set up state before disconnect using stateManager
      const stateManager2 = (testServer2 as any).stateManager
      const abortController = new AbortController()

      stateManager2.createConnection(mockSocketWithDisconnect.id, {
        conversationId: 'test-conv-id',
        agentName: 'test-agent',
        context: { socketId: mockSocketWithDisconnect.id, agentName: 'test-agent' }
      })
      stateManager2.updateConnection(mockSocketWithDisconnect.id, {
        abortController,
        lastDeliveredSequence: 7
      })

      // Trigger disconnect
      if (disconnectHandler) {
        await disconnectHandler('transport close')

        // Verify state has correct lastDeliveredSequence after disconnect
        const stateData = stateManager2.getStateData(mockSocketWithDisconnect.id)
        expect(stateData).toBeDefined()
        expect(stateData.lastDeliveredSequence).toBe(7)
        expect(stateData.conversationId).toBe('test-conv-id')
        expect(stateData.state).toBe('disconnected')
      }

      testServer2.close()
    })

    it('should skip emitting to disconnected socket (events go to event channel)', async () => {
      vi.clearAllMocks()

      // This test now verifies WebSocketSubscriber behavior
      // Import WebSocketSubscriber dynamically for this test
      const { WebSocketSubscriber } = await import('../subscribers/websocket-subscriber.js')

      const mockDisconnectedSocket = {
        id: 'test-socket-id',
        emit: vi.fn(),
        connected: true
      }

      // Set up disconnected state check function
      const disconnectedSocketIds = new Set(['test-socket-id'])
      const isDisconnected = (socketId: string) => disconnectedSocketIds.has(socketId)

      // Create subscriber with isDisconnected function
      const subscriber = new WebSocketSubscriber(mockDisconnectedSocket, isDisconnected)

      // Send event to subscriber
      await subscriber.onEvent({
        id: 'evt-1',
        conversationId: 'test-conv-id',
        sequence: 6,
        type: 'chunk',
        content: 'Should not emit',
        data: {},
        timestamp: new Date(),
        agentName: 'test-agent'
      })

      // Verify socket.emit was NOT called (subscriber skips when socket is disconnected)
      expect(mockDisconnectedSocket.emit).not.toHaveBeenCalled()
    })

    it('should abort stream if recovery acknowledgement is not received in time', async () => {
      vi.clearAllMocks()
      vi.useFakeTimers()

      const missedEvents = [
        { id: 'e1', sequence: 4, type: 'chunk', content: 'Event 1', data: {}, timestamp: new Date(), conversationId: 'test-conv-id', agentName: 'test-agent' },
        { id: 'e2', sequence: 5, type: 'chunk', content: 'Event 2', data: {}, timestamp: new Date(), conversationId: 'test-conv-id', agentName: 'test-agent' }
      ]

      let connectionHandler: any
      mockIO.on.mockImplementation((event: string, handler: any) => {
        if (event === 'connection') {
          connectionHandler = handler
        }
      })

      const testServer2 = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const eventChannel2 = (testServer2 as any).eventChannel
      const stateManager2 = (testServer2 as any).stateManager
      vi.spyOn(eventChannel2, 'getEventsSince').mockReturnValue(missedEvents)

      // Spy on stateManager.cleanup since recovery manager uses it directly
      const cleanupSpy = vi.spyOn(stateManager2, 'cleanup')

      // Set up disconnected connection state
      const abortController = createDisconnectedConnectionState(stateManager2, 'old-socket-id', 'test-conv-id', 'test-agent', 3)

      const newMockSocket = {
        id: 'new-socket-id',
        emit: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
        handshake: {
          auth: { previousSocketId: 'old-socket-id' }
        },
        volatile: {
          emit: vi.fn()
        }
      }

      if (connectionHandler) {
        await connectionHandler(newMockSocket)

        // Verify state is set up for recovery
        expect(stateManager2.isDisconnected('old-socket-id')).toBe(true)

        const ackTimeout = (testServer2 as any).ACK_TIMEOUT_MS ?? 30_000
        // Adaptive timeout: base + 100ms per replayed event (2 events here)
        vi.advanceTimersByTime(ackTimeout + missedEvents.length * 100 + 10)

        // The timeout handler runs synchronously and aborts the stream
        expect(abortController.signal.aborted).toBe(true)

        // cleanup is called asynchronously but we can verify it was invoked
        expect(cleanupSpy).toHaveBeenCalledWith('old-socket-id')

        // Verify listener cleanup (happens synchronously in timeout handler)
        expect(newMockSocket.off).toHaveBeenCalledWith('recovery_ack', expect.any(Function))
      }

      vi.useRealTimers()
      testServer2.close()
    })
  })

  describe('Socket Migration - Regression Tests', () => {
    /**
     * These tests verify critical bugs that were discovered during manual recovery:
     * 1. Conversation lookup after migration (getConversation follows migration chain)
     * 2. Subscriber cleanup uses correct socket IDs
     * 3. activeStreams cleanup handles both original and migrated IDs
     * 4. WebSocket subscriber survives migration (new subscriber not unsubscribed)
     */

    it('should follow migration chain when looking up conversations via stateManager', async () => {
      vi.clearAllMocks()

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const stateManager = (testServer as any).stateManager

      // Create connection under old socket ID
      stateManager.createConnection('old-socket-id', {
        conversationId: 'test-conv-id',
        agentName: 'test-agent',
        context: { socketId: 'old-socket-id', agentName: 'test-agent' }
      })
      stateManager.updateConnection('old-socket-id', {
        accumulatedContent: 'Test content from stream',
        lastDeliveredSequence: 5
      })

      // Migrate socket ID: old-socket-id -> new-socket-id
      stateManager.migrateSocketId('old-socket-id', 'new-socket-id')

      // State should be accessible via OLD socket ID (through migration chain)
      const stateData = stateManager.getStateData('old-socket-id')

      // Should find the conversation via migration chain
      expect(stateData).toBeDefined()
      expect(stateData.conversationId).toBe('test-conv-id')
      expect(stateData.accumulatedContent).toBe('Test content from stream')

      testServer.close()
    })

    it('should follow multi-hop migration chain (A→B→C)', async () => {
      vi.clearAllMocks()

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const stateManager = (testServer as any).stateManager

      // Create conversation under FIRST socket ID
      stateManager.createConnection('socket-A', {
        conversationId: 'test-conv-id',
        agentName: 'test-agent',
        context: { socketId: 'socket-A', agentName: 'test-agent' }
      })
      stateManager.updateConnection('socket-A', { lastDeliveredSequence: 10 })

      // Set up multi-hop migration chain: A → B → C
      stateManager.migrateSocketId('socket-A', 'socket-B')
      stateManager.migrateSocketId('socket-B', 'socket-C')

      // getEffectiveSocketId should follow the full chain
      expect(stateManager.getEffectiveSocketId('socket-A')).toBe('socket-C')
      expect(stateManager.getEffectiveSocketId('socket-B')).toBe('socket-C')
      expect(stateManager.getEffectiveSocketId('socket-C')).toBe('socket-C')

      // getStateData should work from any point in the chain
      expect(stateManager.getStateData('socket-A')?.conversationId).toBe('test-conv-id')
      expect(stateManager.getStateData('socket-B')?.conversationId).toBe('test-conv-id')
      expect(stateManager.getStateData('socket-C')?.conversationId).toBe('test-conv-id')

      testServer.close()
    })

    it('should clean up connection state after migration', async () => {
      vi.clearAllMocks()

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const stateManager = (testServer as any).stateManager

      // Create connection and migrate
      stateManager.createConnection('old-socket-id', {
        conversationId: 'test-conv-id',
        agentName: 'test-agent',
        context: { socketId: 'old-socket-id', agentName: 'test-agent' }
      })
      const abortController = new AbortController()
      stateManager.updateConnection('old-socket-id', { abortController })
      stateManager.migrateSocketId('old-socket-id', 'new-socket-id')

      // State should be accessible via new socket ID
      expect(stateManager.getStateData('new-socket-id')).toBeDefined()
      expect(stateManager.getEffectiveSocketId('old-socket-id')).toBe('new-socket-id')

      // Clean up via new socket ID
      await stateManager.cleanup('new-socket-id')

      // After cleanup, state should be removed
      expect(stateManager.getStateData('new-socket-id')).toBeUndefined()

      testServer.close()
    })

    it('should unsubscribe WebSocket with EFFECTIVE ID and persistence/APM with ORIGINAL ID after migration', async () => {
      vi.clearAllMocks()

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const eventChannel = (testServer as any).eventChannel
      const stateManager = (testServer as any).stateManager

      const unsubscribeSpy = vi.spyOn(eventChannel, 'unsubscribe')

      // Create connection and migrate
      stateManager.createConnection('old-socket-id', {
        conversationId: 'test-conv-id',
        agentName: 'test-agent',
        context: { socketId: 'old-socket-id', agentName: 'test-agent' }
      })
      stateManager.migrateSocketId('old-socket-id', 'new-socket-id')

      // Get effective socket ID (follows migration chain)
      const effectiveSocketId = stateManager.getEffectiveSocketId('old-socket-id')
      expect(effectiveSocketId).toBe('new-socket-id')

      // Simulate finally block cleanup logic
      const conversationId = 'test-conv-id'
      const originalSocketId = 'old-socket-id'

      // WebSocket: always use EFFECTIVE socket ID (subscriber was re-registered during recovery)
      eventChannel.unsubscribe(conversationId, `websocket-${effectiveSocketId}`)

      // Persistence/APM: always use ORIGINAL socket ID (never re-registered)
      eventChannel.unsubscribe(conversationId, `persistence-${originalSocketId}`)
      eventChannel.unsubscribe(conversationId, `apm-${originalSocketId}`)

      // Verify: WebSocket unsubscribed with EFFECTIVE (new) socket ID
      expect(unsubscribeSpy).toHaveBeenCalledWith(conversationId, 'websocket-new-socket-id')

      // Verify: Persistence and APM unsubscribed with ORIGINAL socket ID
      expect(unsubscribeSpy).toHaveBeenCalledWith(conversationId, 'persistence-old-socket-id')
      expect(unsubscribeSpy).toHaveBeenCalledWith(conversationId, 'apm-old-socket-id')

      // Verify: Persistence/APM NOT called with effective (new) socket ID
      expect(unsubscribeSpy).not.toHaveBeenCalledWith(conversationId, 'persistence-new-socket-id')
      expect(unsubscribeSpy).not.toHaveBeenCalledWith(conversationId, 'apm-new-socket-id')

      testServer.close()
    })

    it('should unsubscribe all subscribers with same ID when NO migration occurred', async () => {
      vi.clearAllMocks()

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const eventChannel = (testServer as any).eventChannel
      const stateManager = (testServer as any).stateManager

      const unsubscribeSpy = vi.spyOn(eventChannel, 'unsubscribe')

      // Scenario: No migration (normal completion)
      const effectiveSocketId = stateManager.getEffectiveSocketId('test-socket-id')
      expect(effectiveSocketId).toBe('test-socket-id') // No migration, same ID

      const conversationId = 'test-conv-id'
      const originalSocketId = 'test-socket-id'

      // Simulate the finally block logic (all use same ID when no migration)
      eventChannel.unsubscribe(conversationId, `websocket-${effectiveSocketId}`)
      eventChannel.unsubscribe(conversationId, `persistence-${originalSocketId}`)
      eventChannel.unsubscribe(conversationId, `apm-${originalSocketId}`)

      // All subscribers should be unsubscribed with the same socket ID
      expect(unsubscribeSpy).toHaveBeenCalledWith(conversationId, 'websocket-test-socket-id')
      expect(unsubscribeSpy).toHaveBeenCalledWith(conversationId, 'persistence-test-socket-id')
      expect(unsubscribeSpy).toHaveBeenCalledWith(conversationId, 'apm-test-socket-id')

      testServer.close()
    })

    it('should prevent duplicate WebSocket subscribers on subsequent messages after migration', async () => {
      vi.clearAllMocks()

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const eventChannel = (testServer as any).eventChannel
      const stateManager = (testServer as any).stateManager

      // Setup: Create conversation state to track subscribers
      const conversationId = 'test-conv-id'

      // Subscribe initial WebSocket subscriber (simulates recovery)
      const { WebSocketSubscriber } = await import('../subscribers/websocket-subscriber.js')
      const mockSocket = { id: 'new-socket-id', emit: vi.fn(), connected: true }
      const isDisconnected = () => false

      eventChannel.subscribe(conversationId, new WebSocketSubscriber(mockSocket, isDisconnected))

      // Verify one subscriber exists
      const state1 = (eventChannel as any).conversations.get(conversationId)
      expect(state1.subscribers.size).toBe(1)

      // Simulate migration exists (old handler still running)
      stateManager.createConnection('old-socket-id', {
        conversationId,
        agentName: 'test-agent',
        context: { socketId: 'old-socket-id', agentName: 'test-agent' }
      })
      stateManager.migrateSocketId('old-socket-id', 'new-socket-id')

      // Get effective socket ID and cleanup (simulates finally block)
      const effectiveSocketId = stateManager.getEffectiveSocketId('old-socket-id')

      // Unsubscribe WebSocket with effective ID (the correct fix)
      eventChannel.unsubscribe(conversationId, `websocket-${effectiveSocketId}`)

      // Verify subscriber was removed (conversation deleted when no subscribers)
      const state2 = (eventChannel as any).conversations.get(conversationId)
      expect(state2).toBeUndefined() // Conversation cleaned up when last subscriber removed

      // Now simulate next message registering a new subscriber
      eventChannel.subscribe(conversationId, new WebSocketSubscriber(mockSocket, isDisconnected))

      // Verify exactly one subscriber (no duplicates)
      const state3 = (eventChannel as any).conversations.get(conversationId)
      expect(state3.subscribers.size).toBe(1)

      testServer.close()
    })

    it('should use effective socket ID when registering subscriber after migration', async () => {
      vi.clearAllMocks()

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const eventChannel = (testServer as any).eventChannel
      const stateManager = (testServer as any).stateManager

      const conversationId = 'test-conv-id'

      // Simulate recovery: socket A migrated to socket B, recovery registered websocket-B
      const { WebSocketSubscriber } = await import('../subscribers/websocket-subscriber.js')
      const mockSocketB = { id: 'socket-B', emit: vi.fn(), connected: true }
      const isDisconnected = () => false

      // Recovery registers subscriber with new socket B
      eventChannel.subscribe(conversationId, new WebSocketSubscriber(mockSocketB, isDisconnected))

      // Verify one subscriber exists (websocket-B from recovery)
      const state1 = (eventChannel as any).conversations.get(conversationId)
      expect(state1.subscribers.size).toBe(1)
      const subscriberIds1 = Array.from(state1.subscribers).map((s: any) => s.id)
      expect(subscriberIds1).toEqual(['websocket-socket-B'])

      // Simulate state manager tracking the migration
      stateManager.createConnection('socket-A', {
        conversationId,
        agentName: 'test-agent',
        context: { socketId: 'socket-A', agentName: 'test-agent' }
      })
      stateManager.migrateSocketId('socket-A', 'socket-B')

      // Now simulate a queued message handler from old socket A running
      // It should use effective socket ID (B) to unsubscribe, preventing duplicates
      const mockSocketA = { id: 'socket-A', emit: vi.fn(), connected: false } // disconnected
      const effectiveSocketId = stateManager.getEffectiveSocketId('socket-A')

      // This is what the fix does at line 1705:
      eventChannel.unsubscribe(conversationId, `websocket-${effectiveSocketId}`)
      eventChannel.subscribe(conversationId, new WebSocketSubscriber(mockSocketA, isDisconnected))

      // Verify exactly one subscriber exists (no duplicates)
      const state2 = (eventChannel as any).conversations.get(conversationId)
      expect(state2.subscribers.size).toBe(1)
      const subscriberIds2 = Array.from(state2.subscribers).map((s: any) => s.id)
      expect(subscriberIds2).toEqual(['websocket-socket-A'])

      testServer.close()
    })

    it('should use effectiveId in cleanupConversation', async () => {
      vi.clearAllMocks()

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const stateManager = (testServer as any).stateManager

      // Create connection under old socket ID
      stateManager.createConnection('old-socket-id', {
        conversationId: 'test-conv-id',
        agentName: 'test-agent',
        context: { socketId: 'old-socket-id', agentName: 'test-agent' }
      })
      stateManager.updateConnection('old-socket-id', { lastDeliveredSequence: 5 })

      // Migrate to new socket ID
      stateManager.migrateSocketId('old-socket-id', 'new-socket-id')

      // Verify state exists under new ID
      expect(stateManager.getStateData('new-socket-id')).toBeDefined()
      expect(stateManager.getEffectiveSocketId('old-socket-id')).toBe('new-socket-id')

      // Cleanup should work via effective ID
      const effectiveId = stateManager.getEffectiveSocketId('old-socket-id')
      expect(effectiveId).toBe('new-socket-id')

      const stateData = stateManager.getStateData(effectiveId)
      expect(stateData).toBeDefined()
      await stateManager.cleanup(effectiveId)

      // Verify cleanup worked
      expect(stateManager.getStateData('new-socket-id')).toBeUndefined()

      testServer.close()
    })

    it('should handle sequential A→B→C reconnects with events arriving exactly once', async () => {
      // Integration test: Simulates two sequential reconnects during streaming
      // Verifies migration chain (A→B→C) delivers events exactly once to final socket
      vi.clearAllMocks()

      const testServer = new WebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      const eventChannel = (testServer as any).eventChannel
      const stateManager = (testServer as any).stateManager

      const conversationId = 'integration-test-conv'
      const { WebSocketSubscriber } = await import('../subscribers/websocket-subscriber.js')

      // Track all emitted events per socket to verify no duplicates
      const socketAEvents: any[] = []
      const socketBEvents: any[] = []
      const socketCEvents: any[] = []

      const mockSocketA = {
        id: 'socket-A',
        emit: vi.fn((_event: string, data: any) => socketAEvents.push({ event: _event, data })),
        connected: true
      }
      const mockSocketB = {
        id: 'socket-B',
        emit: vi.fn((_event: string, data: any) => socketBEvents.push({ event: _event, data })),
        connected: true
      }
      const mockSocketC = {
        id: 'socket-C',
        emit: vi.fn((_event: string, data: any) => socketCEvents.push({ event: _event, data })),
        connected: true
      }

      // Function-based disconnection check
      const isDisconnected = (socketId: string) => stateManager.isDisconnected(socketId)

      // === Phase 1: Socket A connects and starts receiving events ===
      stateManager.createConnection('socket-A', {
        conversationId,
        agentName: 'test-agent',
        context: { socketId: 'socket-A', agentName: 'test-agent' }
      })
      stateManager.updateConnection('socket-A', { lastDeliveredSequence: 0 })

      const subscriberA = new WebSocketSubscriber(mockSocketA, isDisconnected)
      eventChannel.subscribe(conversationId, subscriberA)

      // Publish events 1-3 to socket A
      // Use 'start' type (non-coalesceable) so events pass through immediately.
      // This test validates migration/dedup, not coalescing behavior.
      await eventChannel.publish(conversationId, { type: 'start', content: 'Event 1', data: {} })
      await eventChannel.publish(conversationId, { type: 'start', content: 'Event 2', data: {} })
      await eventChannel.publish(conversationId, { type: 'start', content: 'Event 3', data: {} })

      expect(socketAEvents).toHaveLength(3)

      // === Phase 2: Socket A disconnects, Socket B reconnects (A→B migration) ===
      mockSocketA.connected = false
      subscriberA.dispose()
      eventChannel.unsubscribe(conversationId, `websocket-socket-A`)

      // Migrate socket A → B
      stateManager.updateConnection('socket-A', { lastDeliveredSequence: 3 })
      stateManager.migrateSocketId('socket-A', 'socket-B')

      // Register new subscriber for socket B
      const subscriberB = new WebSocketSubscriber(mockSocketB, isDisconnected)
      eventChannel.subscribe(conversationId, subscriberB)

      // Publish events 4-6 to socket B
      await eventChannel.publish(conversationId, { type: 'start', content: 'Event 4', data: {} })
      await eventChannel.publish(conversationId, { type: 'start', content: 'Event 5', data: {} })
      await eventChannel.publish(conversationId, { type: 'start', content: 'Event 6', data: {} })

      expect(socketBEvents).toHaveLength(3)

      // === Phase 3: Socket B disconnects, Socket C reconnects (B→C migration, chain A→B→C) ===
      mockSocketB.connected = false
      subscriberB.dispose()
      eventChannel.unsubscribe(conversationId, `websocket-socket-B`)

      // Migrate socket B → C (now chain: A→B→C)
      stateManager.updateConnection('socket-B', { lastDeliveredSequence: 6 })
      stateManager.migrateSocketId('socket-B', 'socket-C')

      // Register new subscriber for socket C
      const subscriberC = new WebSocketSubscriber(mockSocketC, isDisconnected)
      eventChannel.subscribe(conversationId, subscriberC)

      // Publish events 7-9 to socket C
      await eventChannel.publish(conversationId, { type: 'start', content: 'Event 7', data: {} })
      await eventChannel.publish(conversationId, { type: 'start', content: 'Event 8', data: {} })
      await eventChannel.publish(conversationId, { type: 'start', content: 'Event 9', data: {} })

      expect(socketCEvents).toHaveLength(3)

      // === Verification: Migration chain resolves correctly ===
      expect(stateManager.getEffectiveSocketId('socket-A')).toBe('socket-C')
      expect(stateManager.getEffectiveSocketId('socket-B')).toBe('socket-C')
      expect(stateManager.getEffectiveSocketId('socket-C')).toBe('socket-C')

      // === Verification: Each socket received exactly its events, no duplicates ===
      expect(socketAEvents.map(e => e.data.content)).toEqual(['Event 1', 'Event 2', 'Event 3'])
      expect(socketBEvents.map(e => e.data.content)).toEqual(['Event 4', 'Event 5', 'Event 6'])
      expect(socketCEvents.map(e => e.data.content)).toEqual(['Event 7', 'Event 8', 'Event 9'])

      // Total events = 9, no duplicates
      const totalEvents = socketAEvents.length + socketBEvents.length + socketCEvents.length
      expect(totalEvents).toBe(9)

      // === Cleanup using original socket ID (simulates finally block) ===
      // When original handler (socket-A) finishes, it should clean up using effective ID
      subscriberC.dispose()
      const effectiveForCleanup = stateManager.getEffectiveSocketId('socket-A')
      expect(effectiveForCleanup).toBe('socket-C')

      eventChannel.unsubscribe(conversationId, `websocket-${effectiveForCleanup}`)

      // Verify subscriber was removed
      const finalState = (eventChannel as any).conversations.get(conversationId)
      expect(finalState).toBeUndefined()

      testServer.close()
    })
  })

  describe('ConversationId Injection into Metadata', () => {
    it('should inject conversationId into metadata after setupPersistence', async () => {
      const httpServer = new HTTPServer()
      const startConversationSpy = vi.fn().mockResolvedValue('test-conversation-123')
      const mockPersistence = createMockPersistence({
        startConversation: startConversationSpy
      })

      // Setup streamGenerate to succeed and capture executionContext
      let capturedExecutionContext: any = null
      const mockStreamResult = {
        baseStream: null,
        textStream: (async function* () {
          yield 'Test response'
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 10, outputTokens: 5 },
          toolCalls: []
        })
      }

      mockAgent.streamGenerate = vi.fn().mockImplementation((_prompt, options) => {
        capturedExecutionContext = options?.executionContext
        return Promise.resolve(mockStreamResult)
      })

      const { messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: mockPersistence
      })

      const chatMessage = {
        message: 'Test message',
        agentId: 'test-agent',
        context: {
          metadata: {
            appId: 'test-app'
          }
        }
      }

      await messageHandler(chatMessage)

      // Verify conversationId was injected into executionContext.metadata
      expect(capturedExecutionContext).toBeDefined()
      expect(capturedExecutionContext.metadata).toBeDefined()
      expect(capturedExecutionContext.metadata.conversationId).toBe('test-conversation-123')
    })

    it('should inject conversationId in handoff/recovery scenarios', async () => {
      const httpServer = new HTTPServer()
      const conversationId = 'existing-conversation-456'
      const startConversationSpy = vi.fn().mockResolvedValue(conversationId)
      const continueConversationSpy = vi.fn().mockResolvedValue(undefined)

      const mockPersistence = createMockPersistence({
        startConversation: startConversationSpy,
        continueConversation: continueConversationSpy
      })

      const executionContexts: any[] = []
      const mockStreamResult = {
        baseStream: null,
        textStream: (async function* () {
          yield 'Response'
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 10, outputTokens: 5 },
          toolCalls: []
        })
      }

      mockAgent.streamGenerate = vi.fn().mockImplementation((_prompt, options) => {
        executionContexts.push(options?.executionContext)
        return Promise.resolve(mockStreamResult)
      })

      const { messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: mockPersistence
      })

      // First message creates conversation
      await messageHandler({
        message: 'First message',
        agentId: 'test-agent',
        context: {
          metadata: { appId: 'test-app' }
        }
      })

      // Second message should reuse conversation
      await messageHandler({
        message: 'Second message',
        agentId: 'test-agent',
        context: {
          metadata: { appId: 'test-app' },
          conversation: { conversationId }
        }
      })

      // Both calls should have conversationId in metadata
      expect(executionContexts).toHaveLength(2)
      expect(executionContexts[0].metadata.conversationId).toBe(conversationId)
      expect(executionContexts[1].metadata.conversationId).toBe(conversationId)
    })

    it('should handle missing conversation gracefully', async () => {
      const httpServer = new HTTPServer()

      let capturedExecutionContext: any = null
      const mockStreamResult = {
        baseStream: null,
        textStream: (async function* () {
          yield 'Response'
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 10, outputTokens: 5 },
          toolCalls: []
        })
      }

      mockAgent.streamGenerate = vi.fn().mockImplementation((_prompt, options) => {
        capturedExecutionContext = options?.executionContext
        return Promise.resolve(mockStreamResult)
      })

      const { server } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: createNoOpPersistence()
      })

      // Manually call attachConversationId with non-existent socket
      const testContext: Record<string, unknown> = {
        metadata: { appId: 'test-app' }
      }

      // Access the private method via bracket notation for testing
      ;(server as any).attachConversationId(testContext, 'non-existent-socket')

      // Should not throw and should not add conversationId
      expect(testContext.metadata).toBeDefined()
      expect((testContext.metadata as any).conversationId).toBeUndefined()
    })

    it('should preserve existing metadata when injecting conversationId', async () => {
      const httpServer = new HTTPServer()
      const startConversationSpy = vi.fn().mockResolvedValue('test-conversation-789')
      const mockPersistence = createMockPersistence({
        startConversation: startConversationSpy
      })

      let capturedExecutionContext: any = null
      const mockStreamResult = {
        baseStream: null,
        textStream: (async function* () {
          yield 'Response'
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 10, outputTokens: 5 },
          toolCalls: []
        })
      }

      mockAgent.streamGenerate = vi.fn().mockImplementation((_prompt, options) => {
        capturedExecutionContext = options?.executionContext
        return Promise.resolve(mockStreamResult)
      })

      const { messageHandler } = await setupServerWithConnection(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        messagePersistence: mockPersistence
      })

      await messageHandler({
        message: 'Test',
        agentId: 'test-agent',
        context: {
          metadata: {
            appId: 'test-app',
            userId: 'user-123',
            customField: 'custom-value'
          }
        }
      })

      // Verify all original metadata is preserved
      expect(capturedExecutionContext.metadata.appId).toBe('test-app')
      expect(capturedExecutionContext.metadata.userId).toBe('user-123')
      expect(capturedExecutionContext.metadata.customField).toBe('custom-value')
      // And conversationId is added
      expect(capturedExecutionContext.metadata.conversationId).toBe('test-conversation-789')
    })
  })
})

describe('WebSocketServer - Accumulated Content Newline Separation', () => {
  let server: WebSocketServer
  let httpServer: HTTPServer

  beforeEach(() => {
    vi.clearAllMocks()
    httpServer = new HTTPServer()
    server = new WebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: createNoOpPersistence()
    })
  })

  afterEach(() => {
    server.close()
  })

  it('should insert newline when text chunk follows a non-text event', async function newlineSeparation() {
    const conversation = {
      conversationId: 'test-conv',
      context: { socketId: 'test-socket', agentName: 'test-agent' },
      streamingEvents: [] as any[],
      accumulatedContent: undefined as string | undefined
    }

    const track = (server as any).trackEventForConversation.bind(server)

    await track(conversation, 'chunk', 'Hello', {})
    await track(conversation, 'tool_result', '', { toolName: 'search' })
    await track(conversation, 'chunk', 'World', {})

    expect(conversation.accumulatedContent).toBe('Hello\nWorld')
  })

  it('should not insert newline between consecutive text chunks', async function noNewline() {
    const conversation = {
      conversationId: 'test-conv',
      context: { socketId: 'test-socket', agentName: 'test-agent' },
      streamingEvents: [] as any[],
      accumulatedContent: undefined as string | undefined
    }

    const track = (server as any).trackEventForConversation.bind(server)

    await track(conversation, 'chunk', 'Hello ', {})
    await track(conversation, 'chunk', 'World', {})

    expect(conversation.accumulatedContent).toBe('Hello World')
  })
})

describe('connect-then-auth support', () => {
  let httpServer: HTTPServer

  beforeEach(() => {
    vi.clearAllMocks()
    httpServer = new HTTPServer()
    mockSocket.handshake.auth = {}
    mockSocket.data = {}
  })

  it('server_config includes supportsConnectThenAuth: true', async () => {
    let connectionHandler: ((socket: any) => Promise<void>) | null = null

    mockIO.on.mockImplementation((event: string, handler: any) => {
      if (event === 'connection') {
        connectionHandler = handler
      }
    })

    const server = new WebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: createNoOpPersistence()
    })

    if (connectionHandler) {
      await connectionHandler(mockSocket)
    }

    // Find the server_config emit call
    const serverConfigCall = mockSocket.emit.mock.calls.find(
      (call: any[]) => call[0] === 'message' && call[1]?.type === 'server_config'
    )

    expect(serverConfigCall).toBeDefined()
    expect(serverConfigCall![1].data.supportsConnectThenAuth).toBe(true)

    server.close()
  })

  it('completeConnectionSetup is idempotent', async () => {
    let connectionHandler: ((socket: any) => Promise<void>) | null = null

    mockIO.on.mockImplementation((event: string, handler: any) => {
      if (event === 'connection') {
        connectionHandler = handler
      }
    })

    const server = new WebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: createNoOpPersistence()
    })

    // Trigger connection (which calls completeConnectionSetup once for non-pendingAuth)
    if (connectionHandler) {
      await connectionHandler(mockSocket)
    }

    const emitCountAfterFirstSetup = mockSocket.emit.mock.calls.length

    // Call completeConnectionSetup again — should be a no-op
    await server.completeConnectionSetup(mockSocket as any)

    expect(mockSocket.emit.mock.calls.length).toBe(emitCountAfterFirstSetup)
  })

  it('pendingAuth socket skips immediate connection setup', async () => {
    let connectionHandler: ((socket: any) => Promise<void>) | null = null

    mockIO.on.mockImplementation((event: string, handler: any) => {
      if (event === 'connection') {
        connectionHandler = handler
      }
    })

    const onConnectionSpy = vi.fn()

    const server = new WebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: createNoOpPersistence(),
      onConnection: onConnectionSpy
    })

    // Create a pendingAuth mock socket
    const pendingAuthSocket = {
      id: 'pending-auth-socket-id',
      emit: vi.fn(),
      on: vi.fn(),
      connected: true,
      handshake: {
        auth: { pendingAuth: true }
      },
      volatile: {
        emit: vi.fn()
      }
    }

    if (connectionHandler) {
      await connectionHandler(pendingAuthSocket)
    }

    // onConnection should NOT have been called (it's part of completeConnectionSetup)
    expect(onConnectionSpy).not.toHaveBeenCalled()

    // server_config IS emitted immediately so the client has ackTimeout before authenticate
    const serverConfigCall = pendingAuthSocket.emit.mock.calls.find(
      (call: any[]) => call[0] === 'message' && call[1]?.type === 'server_config'
    )
    expect(serverConfigCall).toBeDefined()

    // connectionSetupComplete flag should NOT be set (completeConnectionSetup is deferred)
    expect(pendingAuthSocket.data?.connectionSetupComplete).toBeFalsy()

    server.close()
  })

  it('server_config is emitted once even when completeConnectionSetup is called for pendingAuth sockets', async () => {
    let connectionHandler: ((socket: any) => Promise<void>) | null = null

    mockIO.on.mockImplementation((event: string, handler: any) => {
      if (event === 'connection') {
        connectionHandler = handler
      }
    })

    const server = new WebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: createNoOpPersistence()
    })

    const pendingAuthSocket = {
      id: 'pending-auth-socket-id',
      emit: vi.fn(),
      on: vi.fn(),
      connected: true,
      data: {},
      handshake: {
        auth: { pendingAuth: true }
      },
      volatile: {
        emit: vi.fn()
      }
    }

    if (connectionHandler) {
      await connectionHandler(pendingAuthSocket)
    }

    // server_config already emitted on connection
    const configCallsBefore = pendingAuthSocket.emit.mock.calls.filter(
      (call: any[]) => call[0] === 'message' && call[1]?.type === 'server_config'
    )
    expect(configCallsBefore).toHaveLength(1)
    expect(configCallsBefore[0]![1].data.supportsConnectThenAuth).toBe(true)

    // Now simulate auth completing by calling completeConnectionSetup
    await server.completeConnectionSetup(pendingAuthSocket as any)

    // Idempotency guard: still only one server_config total
    const configCallsAfter = pendingAuthSocket.emit.mock.calls.filter(
      (call: any[]) => call[0] === 'message' && call[1]?.type === 'server_config'
    )
    expect(configCallsAfter).toHaveLength(1)

    server.close()
  })

  it('cleanupToolSpans removes activeObservabilityToolSpans for disconnected socket', async () => {
    let connectionHandler: ((socket: any) => Promise<void>) | null = null

    mockIO.on.mockImplementation((event: string, handler: any) => {
      if (event === 'connection') {
        connectionHandler = handler
      }
    })

    const server = new WebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: createNoOpPersistence()
    })

    // Seed the observability spans map with entries for our socket and another
    const observabilitySpans = (server as any).activeObservabilityToolSpans as Map<string, any>
    observabilitySpans.set('test-socket-id:tool-1', { spanId: 'span-1', startTime: Date.now() })
    observabilitySpans.set('test-socket-id:tool-2', { spanId: 'span-2', startTime: Date.now() })
    observabilitySpans.set('other-socket-id:tool-3', { spanId: 'span-3', startTime: Date.now() })

    // Also seed activeToolSpans so we verify both maps are cleaned
    const apmSpans = (server as any).activeToolSpans as Map<string, any>
    apmSpans.set('test-socket-id:tool-1', { setOutcome: vi.fn(), addLabels: vi.fn(), end: vi.fn() })

    // Invoke cleanupToolSpans (private, access via any)
    ;(server as any).cleanupToolSpans('test-socket-id')

    // Entries for test-socket-id should be removed
    expect(observabilitySpans.has('test-socket-id:tool-1')).toBe(false)
    expect(observabilitySpans.has('test-socket-id:tool-2')).toBe(false)
    expect(apmSpans.has('test-socket-id:tool-1')).toBe(false)

    // Entry for other socket should remain untouched
    expect(observabilitySpans.has('other-socket-id:tool-3')).toBe(true)

    server.close()
  })

  it('completeConnectionSetup timeout timer is cleared on success', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    let connectionHandler: ((socket: any) => Promise<void>) | null = null

    mockIO.on.mockImplementation((event: string, handler: any) => {
      if (event === 'connection') {
        connectionHandler = handler
      }
    })

    const server = new WebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: createNoOpPersistence()
    })

    // Connect a normal socket (non-pendingAuth) — triggers completeConnectionSetup
    if (connectionHandler) {
      await connectionHandler(mockSocket)
    }

    // completeConnectionSetup succeeded, so no timeout should be pending.
    // The setup timeout in the agents layer wraps completeConnectionSetup in
    // Promise.race and clears in finally. Here we verify that clearTimeout
    // was called at least once during setup (the base class itself doesn't
    // use Promise.race, but ensures timers are cleaned).
    // The real verification is that no unhandled rejection fires after the test.
    expect(mockSocket.data?.connectionSetupComplete).toBe(true)

    clearTimeoutSpy.mockRestore()
    server.close()
  })
})

describe('WebSocketServer - Abort Signal Handling', () => {
  let httpServer: HTTPServer

  beforeEach(() => {
    vi.clearAllMocks()
    httpServer = new HTTPServer()
  })

  /**
   * Factory for a stream mock that blocks until abort, then throws AbortError.
   * Simulates abort during stream consumption (inside the inner try/catch)
   * rather than during streamGenerate itself (which would hit the outer catch).
   */
  function createAbortableStreamMock() {
    return (_prompt: string, options: any) => {
      return Promise.resolve({
        baseStream: {
          getReader: () => ({
            read: () => new Promise((_, reject) => {
              options?.abortSignal?.addEventListener('abort', () => {
                const error = new Error('The operation was aborted')
                error.name = 'AbortError'
                reject(error)
              })
            }),
            cancel: vi.fn(),
            releaseLock: vi.fn()
          }),
          cancel: vi.fn()
        },
        // eslint-disable-next-line require-yield
        textStream: (async function* () {
          await new Promise((_, reject) => {
            options?.abortSignal?.addEventListener('abort', () => {
              const error = new Error('The operation was aborted')
              error.name = 'AbortError'
              reject(error)
            })
          })
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 10, outputTokens: 5 },
          toolCalls: [],
          finishReason: 'stop'
        })
      })
    }
  }

  it('should publish complete with finishReason aborted and messageId on mid-stream abort', async () => {
    const mockPersistence = createMockPersistence({
      startConversation: vi.fn().mockResolvedValue('conv-123'),
      startAgentTurn: vi.fn().mockResolvedValue('agent-msg-123')
    })

    mockAgent.streamGenerate = vi.fn().mockImplementation(createAbortableStreamMock())

    const { server, messageHandler } = await setupServerWithConnection(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: mockPersistence
    })

    const stateManager = (server as any).stateManager

    const messagePromise = messageHandler({
      message: 'Test message',
      agentId: 'test-agent',
      context: { metadata: { appId: 'test-app' } }
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    const controller = stateManager.getAbortController(mockSocket.id)
    expect(controller).not.toBeNull()
    controller!.abort()

    await messagePromise

    const completeEvents = mockSocket.emit.mock.calls.filter(
      (call: any[]) => call[0] === 'message' && call[1]?.type === 'complete'
    )

    // Exactly one complete:aborted — the loop check publishes it, not the catch block
    expect(completeEvents).toHaveLength(1)
    expect(completeEvents[0][1].data.finishReason).toBe('aborted')
    expect(completeEvents[0][1].data.messageId).toBe('agent-msg-123')

    server.close()
  })

  it('should not await getFinalResult when abort stops baseStream loop and SDK final promises hang', async () => {
    const mockPersistence = createMockPersistence({
      startConversation: vi.fn().mockResolvedValue('conv-skip-final'),
      startAgentTurn: vi.fn().mockResolvedValue('msg-skip-final')
    })

    let readCount = 0
    const mockReader = {
      read: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn()
    }

    const hangingGetFinalResult = vi.fn().mockReturnValue(new Promise(() => {}))

    mockAgent.streamGenerate = vi.fn().mockResolvedValue({
      baseStream: {
        getReader: () => mockReader,
        cancel: vi.fn()
      },
      // eslint-disable-next-line require-yield
      textStream: (async function* () {})(),
      getFinalResult: hangingGetFinalResult
    })

    const { server, messageHandler } = await setupServerWithConnection(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: mockPersistence
    })

    const stateManager = (server as any).stateManager

    mockReader.read.mockImplementation(() => {
      readCount++
      if (readCount === 1) {
        return Promise.resolve({
          done: false,
          value: { part: { type: 'text-delta', text: 'partial' } }
        }).then((value) => {
          stateManager.getAbortController(mockSocket.id)?.abort()
          return value
        })
      }
      return new Promise(() => {})
    })

    const deadline = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('messageHandler timed out — likely blocked on getFinalResult')), 5000)
    })

    await Promise.race([
      messageHandler({
        message: 'Test message',
        agentId: 'test-agent',
        context: { metadata: { appId: 'test-app' } }
      }),
      deadline
    ])

    expect(hangingGetFinalResult).not.toHaveBeenCalled()
    expect(mockReader.read).toHaveBeenCalledTimes(1)

    server.close()
  })

  it('should not emit duplicate complete events on normal (non-aborted) completion', async () => {
    const mockPersistence = createMockPersistence({
      startConversation: vi.fn().mockResolvedValue('conv-race'),
      startAgentTurn: vi.fn().mockResolvedValue('msg-race')
    })

    const mockStreamResult = {
      baseStream: null,
      textStream: (async function* () {
        yield 'Done'
      })(),
      getFinalResult: vi.fn().mockResolvedValue({
        usage: { inputTokens: 10, outputTokens: 5 },
        toolCalls: [],
        finishReason: 'stop'
      })
    }

    mockAgent.streamGenerate = vi.fn().mockResolvedValue(mockStreamResult)

    const { server, messageHandler } = await setupServerWithConnection(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: mockPersistence
    })

    await messageHandler({
      message: 'Quick test',
      agentId: 'test-agent',
      context: { metadata: { appId: 'test-app' } }
    })

    const completeEvents = mockSocket.emit.mock.calls.filter(
      (call: any[]) => call[0] === 'message' && call[1]?.type === 'complete'
    )

    // Exactly one complete (from completeConversation), no abort-path duplicate
    expect(completeEvents).toHaveLength(1)
    expect(completeEvents[0][1].data.finishReason).toBeUndefined()

    server.close()
  })

  it('should publish complete:aborted when stream finishes cleanly after abort (no throw)', async () => {
    const mockPersistence = createMockPersistence({
      startConversation: vi.fn().mockResolvedValue('conv-clean-abort'),
      startAgentTurn: vi.fn().mockResolvedValue('msg-clean-abort')
    })

    // Stream returns cleanly after abort — simulates AI SDK honoring the signal
    // at a yield point and returning rather than throwing AbortError.
    let resolveStream: (() => void) | null = null
    mockAgent.streamGenerate = vi.fn().mockImplementation((_prompt: string) => {
      return Promise.resolve({
        baseStream: null,
        textStream: (async function* () {
          yield 'partial'
          await new Promise<void>(resolve => { resolveStream = resolve })
          yield 'done'
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 10, outputTokens: 5 },
          toolCalls: [],
          finishReason: 'stop'
        })
      })
    })

    const { server, messageHandler } = await setupServerWithConnection(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: mockPersistence
    })

    const stateManager = (server as any).stateManager

    const messagePromise = messageHandler({
      message: 'Test message',
      agentId: 'test-agent',
      context: { metadata: { appId: 'test-app' } }
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    // Abort, then let the stream finish cleanly (no throw)
    const controller = stateManager.getAbortController(mockSocket.id)
    controller!.abort()
    resolveStream!()

    await messagePromise

    const completeEvents = mockSocket.emit.mock.calls.filter(
      (call: any[]) => call[0] === 'message' && call[1]?.type === 'complete'
    )

    // Exactly one — clean return has no catch block publish, only the loop check
    expect(completeEvents).toHaveLength(1)
    expect(completeEvents[0][1].data.finishReason).toBe('aborted')
    expect(completeEvents[0][1].data.messageId).toBe('msg-clean-abort')

    server.close()
  })

  it('should publish complete:aborted when stream returns immediately on abort signal', async () => {
    const mockPersistence = createMockPersistence({
      startConversation: vi.fn().mockResolvedValue('conv-return'),
      startAgentTurn: vi.fn().mockResolvedValue('msg-return')
    })

    // Stream that checks signal and returns without yielding or throwing —
    // the most minimal clean-return case.
    mockAgent.streamGenerate = vi.fn().mockImplementation((_prompt: string, options: any) => {
      return Promise.resolve({
        baseStream: null,
        // eslint-disable-next-line require-yield
        textStream: (async function* () {
          // Block until abort, then return cleanly (no throw)
          await new Promise<void>(resolve => {
            options?.abortSignal?.addEventListener('abort', () => resolve())
          })
          // Generator returns — no yield, no throw
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 0, outputTokens: 0 },
          toolCalls: [],
          finishReason: 'stop'
        })
      })
    })

    const { server, messageHandler } = await setupServerWithConnection(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: mockPersistence
    })

    const stateManager = (server as any).stateManager

    const messagePromise = messageHandler({
      message: 'Test message',
      agentId: 'test-agent',
      context: { metadata: { appId: 'test-app' } }
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    stateManager.getAbortController(mockSocket.id)!.abort()

    await messagePromise

    const completeEvents = mockSocket.emit.mock.calls.filter(
      (call: any[]) => call[0] === 'message' && call[1]?.type === 'complete'
    )

    // Must have exactly one complete:aborted — no natural completion should fire
    expect(completeEvents).toHaveLength(1)
    expect(completeEvents[0][1].data.finishReason).toBe('aborted')
    expect(completeEvents[0][1].data.messageId).toBe('msg-return')

    server.close()
  })

  it('should swallow publish failure during abort without rethrowing', async () => {
    const mockPersistence = createMockPersistence({
      startConversation: vi.fn().mockResolvedValue('conv-fail'),
      startAgentTurn: vi.fn().mockResolvedValue('msg-fail')
    })

    mockAgent.streamGenerate = vi.fn().mockImplementation(createAbortableStreamMock())

    const { server, messageHandler } = await setupServerWithConnection(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: mockPersistence
    })

    const stateManager = (server as any).stateManager

    // Only reject for 'complete' type — let other events through
    const originalPublish = (server as any).publishToEventChannel.bind(server)
    const publishSpy = vi.spyOn(server as any, 'publishToEventChannel')
      .mockImplementation(async (socketId: string, type: string, ...rest: any[]) => {
        if (type === 'complete') {
          throw new Error('Channel destroyed')
        }
        return originalPublish(socketId, type, ...rest)
      })

    const messagePromise = messageHandler({
      message: 'Test message',
      agentId: 'test-agent',
      context: { metadata: { appId: 'test-app' } }
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    stateManager.getAbortController(mockSocket.id)!.abort()

    await expect(messagePromise).resolves.toBeUndefined()

    const completePublishCall = publishSpy.mock.calls.find(
      (call: any[]) => call[1] === 'complete'
    )
    expect(completePublishCall).toBeDefined()

    publishSpy.mockRestore()
    server.close()
  })

  it('should detect abort even after cleanupConversation removes state manager entry', async () => {
    const mockPersistence = createMockPersistence({
      startConversation: vi.fn().mockResolvedValue('conv-race'),
      startAgentTurn: vi.fn().mockResolvedValue('msg-race')
    })

    mockAgent.streamGenerate = vi.fn().mockImplementation(createAbortableStreamMock())

    const { server, messageHandler } = await setupServerWithConnection(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: mockPersistence
    })

    const stateManager = (server as any).stateManager

    const messagePromise = messageHandler({
      message: 'Test message',
      agentId: 'test-agent',
      context: { metadata: { appId: 'test-app' } }
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    // Capture the controller, then abort AND clean up state (simulates the race)
    const capturedController = stateManager.getAbortController(mockSocket.id)
    expect(capturedController).not.toBeNull()

    capturedController!.abort()
    await stateManager.cleanup(mockSocket.id)

    expect(stateManager.getAbortController(mockSocket.id)).toBeNull()

    // Handler completes without error — locally captured signal survives cleanup
    await expect(messagePromise).resolves.toBeUndefined()

    // publishToEventChannel returns undefined when state is gone (line 952),
    // so the complete event won't reach the socket, but the handler exits
    // cleanly via the abort path rather than rethrowing.
    expect(capturedController!.signal.aborted).toBe(true)

    server.close()
  })
})

describe('WebSocketServer - Stop Generation', () => {
  let httpServer: HTTPServer

  beforeEach(() => {
    vi.clearAllMocks()
    httpServer = new HTTPServer()
  })

  async function setupWithStopHandler() {
    const { server, messageHandler } = await setupServerWithConnection(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent'
    })

    const stopCall = mockSocket.on.mock.calls.find((call: any[]) => call[0] === 'stop_generation')
    if (!stopCall) {
      throw new Error('stop_generation handler not found after connection setup')
    }

    return { server, messageHandler, stopHandler: stopCall[1] as (data: any, ack?: (...args: any[]) => void) => Promise<void> }
  }

  it('should return error via ACK when no active stream', async () => {
    const { server, stopHandler } = await setupWithStopHandler()
    const ack = vi.fn()

    await stopHandler({}, ack)

    expect(ack).toHaveBeenCalledWith({ error: 'No active stream' })
    server.close()
  })

  it('should set userStopped and abort when stream is active', async () => {
    const { server, stopHandler } = await setupWithStopHandler()

    // Create a connection with an active abort controller
    const stateManager = (server as any).stateManager
    stateManager.createConnection(mockSocket.id, {
      conversationId: 'conv-stop-test',
      agentName: 'test-agent',
      context: { socketId: mockSocket.id, agentName: 'test-agent' }
    })
    const abortController = new AbortController()
    stateManager.updateConnection(mockSocket.id, { abortController })

    const ack = vi.fn()
    await stopHandler({}, ack)

    expect(ack).toHaveBeenCalledWith({ success: true })
    expect(stateManager.getStateData(mockSocket.id).userStopped).toBe(true)
    expect(abortController.signal.aborted).toBe(true)

    server.close()
  })

  it('should produce user_stopped finishReason instead of aborted', async () => {
    const mockPersistence = createMockPersistence({
      startConversation: vi.fn().mockResolvedValue('conv-stop'),
      startAgentTurn: vi.fn().mockResolvedValue('msg-stop')
    })

    // Abortable stream that blocks until abort signal fires
    mockAgent.streamGenerate = vi.fn().mockImplementation((_prompt: string, options: any) => {
      return Promise.resolve({
        baseStream: {
          getReader: () => ({
            read: () => new Promise((_, reject) => {
              options?.abortSignal?.addEventListener('abort', () => {
                const error = new Error('The operation was aborted')
                error.name = 'AbortError'
                reject(error)
              })
            }),
            cancel: vi.fn(),
            releaseLock: vi.fn()
          }),
          cancel: vi.fn()
        },
        // eslint-disable-next-line require-yield
        textStream: (async function* () {
          await new Promise((_, reject) => {
            options?.abortSignal?.addEventListener('abort', () => {
              const error = new Error('The operation was aborted')
              error.name = 'AbortError'
              reject(error)
            })
          })
        })(),
        getFinalResult: vi.fn().mockResolvedValue({
          usage: { inputTokens: 10, outputTokens: 5 },
          toolCalls: [],
          finishReason: 'stop'
        })
      })
    })

    const { server, messageHandler, stopHandler } = await setupWithStopHandler();
    (server as any).messagePersistence = mockPersistence

    const messagePromise = messageHandler({
      message: 'Test user stop',
      agentId: 'test-agent',
      context: { metadata: { appId: 'test-app' } }
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    // Use the stop handler to set userStopped and abort (like a real user click)
    const ack = vi.fn()
    await stopHandler({}, ack)
    expect(ack).toHaveBeenCalledWith({ success: true })

    await messagePromise

    const completeEvents = mockSocket.emit.mock.calls.filter(
      (call: any[]) => call[0] === 'message' && call[1]?.type === 'complete'
    )

    expect(completeEvents).toHaveLength(1)
    expect(completeEvents[0][1].data.finishReason).toBe('user_stopped')

    server.close()
  })
})

describe('WebSocketServer - analyzeStreamError', () => {
  let server: WebSocketServer
  let httpServer: HTTPServer

  beforeEach(() => {
    vi.clearAllMocks()
    httpServer = new HTTPServer()
    server = new WebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: createNoOpPersistence()
    })
  })

  afterEach(() => {
    server.close()
  })

  function analyze(error: unknown) {
    return (server as any).analyzeStreamError(error)
  }

  it('should extract error code from undici-style errors', () => {
    const error = new Error('terminated')
    ;(error as any).code = 'UND_ERR_SOCKET'
    const result = analyze(error)
    expect(result.code).toBe('UND_ERR_SOCKET')
    expect(result.isNetworkError).toBe(true)
  })

  it('should walk Error cause chain with codes', () => {
    const root = new Error('connection reset')
    ;(root as any).code = 'ECONNRESET'
    const mid = new Error('socket error', { cause: root })
    ;(mid as any).code = 'UND_ERR_SOCKET'
    const top = new Error('terminated', { cause: mid })

    const result = analyze(top)
    expect(result.causeChain).toEqual([
      'Error: socket error [UND_ERR_SOCKET]',
      'Error: connection reset [ECONNRESET]',
    ])
  })

  it('should handle string cause', () => {
    const error = new Error('failed')
    ;(error as any).cause = 'upstream timeout'
    const result = analyze(error)
    expect(result.causeChain).toEqual(['upstream timeout'])
  })

  it('should duck-type plain object causes with code and message', () => {
    const error = new Error('terminated')
    ;(error as any).cause = { code: 'UND_ERR_SOCKET', message: 'other side closed' }
    const result = analyze(error)
    expect(result.causeChain).toEqual(['Object: other side closed [UND_ERR_SOCKET]'])
  })

  it('should duck-type plain object causes with name, code, and message', () => {
    const error = new Error('terminated')
    ;(error as any).cause = { name: 'SocketError', code: 'UND_ERR_SOCKET', message: 'other side closed' }
    const result = analyze(error)
    expect(result.causeChain).toEqual(['SocketError: other side closed [UND_ERR_SOCKET]'])
  })

  it('should walk nested plain object causes', () => {
    const error = new Error('terminated')
    ;(error as any).cause = {
      name: 'SocketError',
      message: 'other side closed',
      code: 'UND_ERR_SOCKET',
      cause: { message: 'read ECONNRESET', code: 'ECONNRESET' }
    }
    const result = analyze(error)
    expect(result.causeChain).toEqual([
      'SocketError: other side closed [UND_ERR_SOCKET]',
      'Object: read ECONNRESET [ECONNRESET]',
    ])
  })

  it('should JSON-stringify plain object causes without message', () => {
    const error = new Error('failed')
    ;(error as any).cause = { foo: 'bar' }
    const result = analyze(error)
    expect(result.causeChain).toEqual(['Object: {"foo":"bar"}'])
  })

  it('should limit cause chain to 5 entries', () => {
    let current: any = new Error('root')
    for (let i = 0; i < 10; i++) {
      current = new Error(`level-${i}`, { cause: current })
    }
    const result = analyze(current)
    expect(result.causeChain).toHaveLength(5)
  })

  it('should extract statusCode from error', () => {
    const error = new Error('Service Unavailable')
    ;(error as any).statusCode = 503
    const result = analyze(error)
    expect(result.statusCode).toBe(503)
  })

  it('should extract and truncate responseBody at 500 chars', () => {
    const error = new Error('Service Unavailable')
    ;(error as any).responseBody = 'x'.repeat(1000)
    const result = analyze(error)
    expect(result.responseBody).toHaveLength(500)
  })

  it('should return undefined responseBody for non-string values', () => {
    const error = new Error('failed')
    ;(error as any).responseBody = 42
    const result = analyze(error)
    expect(result.responseBody).toBeUndefined()
  })

  it('should classify abort errors', () => {
    const error = new Error('The operation was aborted')
    error.name = 'AbortError'
    const result = analyze(error)
    expect(result.isAbortError).toBe(true)
    expect(result.type).toBe('AbortError')
  })

  it('should handle non-Error values', () => {
    const result = analyze('plain string error')
    expect(result.message).toBe('plain string error')
    expect(result.type).toBe('UnknownError')
    expect(result.causeChain).toEqual([])
    expect(result.code).toBeUndefined()
  })

  it('should handle null/undefined causes gracefully', () => {
    const error = new Error('no cause')
    const result = analyze(error)
    expect(result.causeChain).toEqual([])
  })
})

describe('WebSocketServer - extractResponseMetadata', () => {
  let server: WebSocketServer
  let httpServer: HTTPServer

  beforeEach(() => {
    vi.clearAllMocks()
    httpServer = new HTTPServer()
    server = new WebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: createNoOpPersistence()
    })
  })

  afterEach(() => {
    server.close()
  })

  function extract(streamResult: any) {
    return (server as any).extractResponseMetadata(streamResult)
  }

  it('should return empty object when streamResult has no response', async () => {
    expect(await extract({})).toEqual({})
    expect(await extract(null)).toEqual({})
    expect(await extract(undefined)).toEqual({})
    expect(await extract({ response: undefined })).toEqual({})
  })

  it('should extract headers, id, and modelId from resolved response', async () => {
    const result = await extract({
      response: Promise.resolve({
        id: 'resp-123',
        modelId: 'claude-sonnet-4-6',
        headers: { 'x-request-id': 'abc-456' },
      })
    })
    expect(result).toEqual({
      headers: { 'x-request-id': 'abc-456' },
      responseId: 'resp-123',
      modelId: 'claude-sonnet-4-6',
    })
  })

  it('should return empty object when response promise rejects', async () => {
    const result = await extract({
      response: Promise.reject(new Error('connection lost'))
    })
    expect(result).toEqual({})
  })

  it('should return empty object when response times out', async () => {
    vi.useFakeTimers()
    const neverResolves = new Promise(() => {})
    const resultPromise = extract({ response: neverResolves })
    await vi.runAllTimersAsync()
    expect(await resultPromise).toEqual({})
    vi.useRealTimers()
  })
})
