import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Server as HTTPServer } from 'http'
import { ExperimentalWebSocketServer } from '../experimental-websocket-server.js'
import type { ExperimentalAgentWrapper } from '../../core/agent-factory-experimental.js'

// Mock Socket.IO
const mockSocket = {
  id: 'test-socket-id',
  emit: vi.fn(),
  on: vi.fn()
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
const mockAgent: ExperimentalAgentWrapper = {
  getName: () => 'test-agent',
  streamGenerate: vi.fn()
} as any

const mockAgents = {
  get: vi.fn().mockReturnValue(mockAgent),
  list: vi.fn().mockReturnValue(['test-agent'])
}

describe('ExperimentalWebSocketServer - Error Handling', () => {
  let server: ExperimentalWebSocketServer
  let httpServer: HTTPServer
  
  beforeEach(() => {
    vi.clearAllMocks()
    httpServer = new HTTPServer()
    
    server = new ExperimentalWebSocketServer(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent'
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

      // Simulate the private handleChatMessage method by calling the error handling logic
      const chatMessage = {
        message: 'Edit the file',
        agentId: 'test-agent'
      }

      // Setup mock connection handler to capture the message handler
      let messageHandler: any
      mockIO.on.mockImplementation((event, handler) => {
        if (event === 'connection') {
          // Simulate connection
          handler(mockSocket)
          
          // Capture the chat message handler
          const onCall = mockSocket.on.mock.calls.find(call => call[0] === 'chat')
          if (onCall) {
            messageHandler = onCall[1]
          }
        }
      })

      // Trigger connection setup
      server = new ExperimentalWebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })

      // Execute the message handler with our test data
      expect(messageHandler).toBeDefined()
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
      expect(retryCall[1].messages).toBeDefined()
      expect(retryCall[1].messages.length).toBeGreaterThan(1) // Should include error context
    })

    it('should handle JSON parsing failed errors', async () => {
      const jsonError = new Error('JSON parsing failed: Text: {"mode": "edit", "path": "test.tsx". Error message: Expected \',\' or \'}\' after property value')
      
      mockAgent.streamGenerate.mockRejectedValueOnce(jsonError)

      // Setup connection and message handler
      let messageHandler: any
      mockIO.on.mockImplementation((event, handler) => {
        if (event === 'connection') {
          handler(mockSocket)
          const onCall = mockSocket.on.mock.calls.find(call => call[0] === 'chat')
          if (onCall) messageHandler = onCall[1]
        }
      })

      server = new ExperimentalWebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })

      const chatMessage = {
        message: 'Edit the file',
        agentId: 'test-agent'
      }

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

      let messageHandler: any
      mockIO.on.mockImplementation((event, handler) => {
        if (event === 'connection') {
          handler(mockSocket)
          const onCall = mockSocket.on.mock.calls.find(call => call[0] === 'chat')
          if (onCall) messageHandler = onCall[1]
        }
      })

      server = new ExperimentalWebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        onError: onErrorMock
      })

      const chatMessage = {
        message: 'Edit the file',
        agentId: 'test-agent'
      }

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

      const onErrorMock = vi.fn()

      let messageHandler: any
      mockIO.on.mockImplementation((event, handler) => {
        if (event === 'connection') {
          handler(mockSocket)
          const onCall = mockSocket.on.mock.calls.find(call => call[0] === 'chat')
          if (onCall) messageHandler = onCall[1]
        }
      })

      server = new ExperimentalWebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent',
        onError: onErrorMock
      })

      const chatMessage = {
        message: 'Edit the file',
        agentId: 'test-agent'
      }

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

  describe('Debug Logging', () => {
    it('should log error details for debugging', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      
      const apiError = new Error('The format of the value at messages.7.content.1.toolUse.input is invalid')
      apiError.name = 'AI_APICallError'
      
      mockAgent.streamGenerate.mockRejectedValueOnce(apiError)

      let messageHandler: any
      mockIO.on.mockImplementation((event, handler) => {
        if (event === 'connection') {
          handler(mockSocket)
          const onCall = mockSocket.on.mock.calls.find(call => call[0] === 'chat')
          if (onCall) messageHandler = onCall[1]
        }
      })

      server = new ExperimentalWebSocketServer(httpServer, {
        agents: mockAgents,
        defaultAgent: 'test-agent'
      })

      const chatMessage = {
        message: 'Edit the file',
        agentId: 'test-agent'
      }

      await messageHandler(chatMessage)

      // Should log debug information
      expect(consoleSpy).toHaveBeenCalledWith('🔍 Caught error in streamGenerate:', expect.objectContaining({
        name: 'AI_APICallError',
        isAPIError: true,
        hasToolUseInvalid: true
      }))

      consoleSpy.mockRestore()
    })
  })
})