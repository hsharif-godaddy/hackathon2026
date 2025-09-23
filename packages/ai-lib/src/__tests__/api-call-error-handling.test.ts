import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Agent } from '../core/agent.js'
import { ExperimentalAgentWrapper } from '../core/agent-factory-experimental.js'
import { SimpleStreamingAgenticRunner } from '../core/simple-streaming-agentic-runner.js'
import { generateText, streamText } from 'ai'

// Mock the AI SDK
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  tool: vi.fn(),
  stepCountIs: vi.fn((count: number) => ({ type: 'stepCount', count })),
  hasToolCall: vi.fn((toolName: string) => ({ type: 'hasToolCall', toolName }))
}))

describe('APICallError Handling', () => {
  let mockModel: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockModel = {
      modelId: 'test-model',
      provider: 'test'
    }
  })

  describe('Agent.generate', () => {
    it('should handle APICallError with tool input validation', async () => {
      // Mock generateText to throw an APICallError
      const apiError = new Error('The format of the value at messages.7.content.1.toolUse.input is invalid. Provide a json object for the field and try again.')
      apiError.name = 'AI_APICallError'
      
      vi.mocked(generateText).mockRejectedValue(apiError)

      const agent = new Agent({
        name: 'Test Agent',
        systemPrompt: 'You are a test agent.',
        model: mockModel,
        tools: {}
      })

      const result = await agent.generate('Test message')

      expect(result.content).toContain('Tool call failed due to invalid input format')
      expect(result.content).toContain('Please ensure all tool arguments are properly formatted')
      expect(result.content).toContain('Please retry your tool call with corrected input formatting')
      expect(result.finishReason).toBe('error')
      expect(result.toolCalls).toEqual([])
    })

    it('should re-throw non-APICallError errors', async () => {
      // Mock generateText to throw a different error
      const otherError = new Error('Some other error')
      vi.mocked(generateText).mockRejectedValue(otherError)

      const agent = new Agent({
        name: 'Test Agent',
        systemPrompt: 'You are a test agent.',
        model: mockModel,
        tools: {}
      })

      await expect(agent.generate('Test message')).rejects.toThrow('Some other error')
    })
  })

  describe('Agent.generateStream', () => {
    it('should handle APICallError during stream initialization', async () => {
      // Mock streamText to throw an APICallError
      const apiError = new Error('The format of the value at messages.7.content.1.toolUse.input is invalid. Provide a json object for the field and try again.')
      apiError.name = 'AI_APICallError'
      
      vi.mocked(streamText).mockImplementation(() => {
        throw apiError
      })

      const agent = new Agent({
        name: 'Test Agent',
        systemPrompt: 'You are a test agent.',
        model: mockModel,
        tools: {}
      })

      const generator = agent.generateStream('Test message')
      const chunks: string[] = []
      
      // Collect all chunks from the generator
      try {
        for await (const chunk of generator) {
          chunks.push(chunk)
        }
      } catch (error) {
        // The generator might throw, but we should have gotten some chunks
      }

      const fullContent = chunks.join('')
      expect(fullContent).toContain('Tool call failed due to invalid input format')
      expect(fullContent).toContain('Please ensure all tool arguments are properly formatted')
    })
  })

  describe('SimpleStreamingAgenticRunner', () => {
    it('should handle APICallError during streamText initialization', async () => {
      // Mock streamText to throw an APICallError
      const apiError = new Error('The format of the value at messages.7.content.1.toolUse.input is invalid.')
      apiError.name = 'AI_APICallError'
      
      vi.mocked(streamText).mockImplementation(() => {
        throw apiError
      })

      const runner = new SimpleStreamingAgenticRunner({
        model: mockModel,
        tools: {},
        maxSteps: 5
      })

      const events: any[] = []
      const generator = runner.runStream('Test message')
      
      for await (const event of generator) {
        events.push(event)
      }

      // Should have step_start event and error completion event
      expect(events).toHaveLength(2)
      expect(events[0].type).toBe('step_start')
      expect(events[1].type).toBe('complete')
      expect(events[1].data.error).toContain('Tool call failed due to invalid input format')
      expect(events[1].data.content).toContain('Please ensure all tool arguments are properly formatted')
    })

    it('should handle APICallError during streaming', async () => {
      // Mock streamText to return a stream that throws during iteration
      const mockTextStream = {
        async *[Symbol.asyncIterator]() {
          yield 'Some text'
          const apiError = new Error('The format of the value at messages.7.content.1.toolUse.input is invalid.')
          apiError.name = 'AI_APICallError'
          throw apiError
        }
      }

      const mockStreamResult = {
        textStream: mockTextStream,
        then: vi.fn().mockResolvedValue({
          text: 'Some text',
          toolCalls: [],
          usage: { totalTokens: 0 },
          finishReason: 'error'
        })
      }

      vi.mocked(streamText).mockReturnValue(mockStreamResult as any)

      const runner = new SimpleStreamingAgenticRunner({
        model: mockModel,
        tools: {},
        maxSteps: 5
      })

      const events: any[] = []
      const generator = runner.runStream('Test message')
      
      for await (const event of generator) {
        events.push(event)
      }

      // Should have step_start, text, error text, and error completion events
      expect(events.length).toBeGreaterThanOrEqual(3)
      expect(events[0].type).toBe('step_start')
      expect(events[1].type).toBe('text')
      expect(events[1].content).toBe('Some text')
      
      // Find the error text event
      const errorTextEvent = events.find(e => e.type === 'text' && e.content.includes('Tool call failed'))
      expect(errorTextEvent).toBeDefined()
      expect(errorTextEvent.content).toContain('Tool call failed due to invalid input format')
      
      // Find the completion event
      const completeEvent = events.find(e => e.type === 'complete')
      expect(completeEvent).toBeDefined()
      expect(completeEvent.data.error).toContain('The format of the value at messages.7.content.1.toolUse.input is invalid.')
    })
  })

  describe('Error message content validation', () => {
    it('should provide helpful error messages with formatting guidelines', async () => {
      const apiError = new Error('The format of the value at messages.7.content.1.toolUse.input is invalid. Provide a json object for the field and try again.')
      apiError.name = 'AI_APICallError'
      
      vi.mocked(generateText).mockRejectedValue(apiError)

      const agent = new Agent({
        name: 'Test Agent',
        systemPrompt: 'You are a test agent.',
        model: mockModel,
        tools: {}
      })

      const result = await agent.generate('Test message')

      // Check that the error message contains helpful formatting guidelines
      expect(result.content).toContain('All string values are properly quoted')
      expect(result.content).toContain('All object properties use valid JSON syntax')
      expect(result.content).toContain('No undefined or null values are passed as tool arguments')
      expect(result.content).toContain('Arrays and objects are properly structured')
      expect(result.content).toContain('Please retry your tool call with corrected input formatting')
    })
  })
})
