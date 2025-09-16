import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Agent, createTool, createStreamingAgenticRunner } from '../index.js'
import { z } from 'zod'

// Mock the AI SDK to avoid actual API calls
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  tool: vi.fn()
}))

import { generateText, streamText, tool } from 'ai'

describe('Tool Integration', () => {
  let mockModel: any
  let testTool: any
  let weatherTool: any

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Mock model
    mockModel = { modelId: 'test-model' }
    
    // Create test tools
    testTool = createTool(
      'Test tool for integration testing',
      z.object({
        message: z.string().describe('Message to process')
      }),
      async ({ message }) => {
        return { 
          processed: message.toUpperCase(), 
          success: true,
          timestamp: new Date().toISOString()
        }
      }
    )

    weatherTool = createTool(
      'Get weather information',
      z.object({
        location: z.string().describe('Location to get weather for')
      }),
      async ({ location }) => {
        return {
          location,
          temperature: 22,
          condition: 'Sunny',
          humidity: 65,
          success: true
        }
      }
    )

    // Mock tool function to return the tools we create
    vi.mocked(tool).mockImplementation((config) => config as any)
  })

  describe('Agent Tool Integration', () => {
    it('should properly format tool results from AI SDK response', async () => {
      // Mock AI SDK response with toolCalls and toolResults
      const mockAIResponse = {
        text: 'I processed your message using the test tool.',
        toolCalls: [
          {
            toolCallId: 'call_123',
            toolName: 'test',
            input: { message: 'hello world' }
          }
        ],
        toolResults: [
          {
            toolCallId: 'call_123',
            toolName: 'test',
            output: { 
              processed: 'HELLO WORLD', 
              success: true,
              timestamp: '2025-09-16T00:00:00.000Z'
            }
          }
        ],
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30
        }
      }

      vi.mocked(generateText).mockResolvedValue(mockAIResponse)

      const agent = new Agent({
        name: 'Test Agent',
        systemPrompt: 'You are a test agent.',
        model: mockModel,
        tools: {
          test: testTool
        }
      })

      const result = await agent.generate('Process the message "hello world"')

      expect(result.content).toBe('I processed your message using the test tool.')
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls?.[0]).toEqual({
        id: 'call_123',
        name: 'test',
        input: { message: 'hello world' },
        result: { 
          processed: 'HELLO WORLD', 
          success: true,
          timestamp: '2025-09-16T00:00:00.000Z'
        }
      })
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cachedInputTokens: undefined
      })
      expect(result.metadata).toBeDefined()
    })

    it('should handle multiple tool calls and results', async () => {
      const mockAIResponse = {
        text: 'I used both tools to help you.',
        toolCalls: [
          {
            toolCallId: 'call_test_123',
            toolName: 'test',
            input: { message: 'hello' }
          },
          {
            toolCallId: 'call_weather_456',
            toolName: 'weather',
            input: { location: 'Tokyo' }
          }
        ],
        toolResults: [
          {
            toolCallId: 'call_test_123',
            toolName: 'test',
            output: { processed: 'HELLO', success: true }
          },
          {
            toolCallId: 'call_weather_456',
            toolName: 'weather',
            output: { location: 'Tokyo', temperature: 22, condition: 'Sunny' }
          }
        ]
      }

      vi.mocked(generateText).mockResolvedValue(mockAIResponse)

      const agent = new Agent({
        name: 'Multi-Tool Agent',
        systemPrompt: 'You can use multiple tools.',
        model: mockModel,
        tools: {
          test: testTool,
          weather: weatherTool
        }
      })

      const result = await agent.generate('Process "hello" and get weather for Tokyo')

      expect(result.toolCalls).toHaveLength(2)
      expect(result.toolCalls?.[0]).toEqual({
        id: 'call_test_123',
        name: 'test',
        input: { message: 'hello' },
        result: { processed: 'HELLO', success: true }
      })
      expect(result.toolCalls?.[1]).toEqual({
        id: 'call_weather_456',
        name: 'weather',
        input: { location: 'Tokyo' },
        result: { location: 'Tokyo', temperature: 22, condition: 'Sunny' }
      })
    })

    it('should handle responses with no tool calls', async () => {
      const mockAIResponse = {
        text: 'This is a simple response without tools.',
        toolCalls: undefined,
        toolResults: undefined
      }

      vi.mocked(generateText).mockResolvedValue(mockAIResponse)

      const agent = new Agent({
        name: 'Simple Agent',
        systemPrompt: 'You are a simple agent.',
        model: mockModel
      })

      const result = await agent.generate('Just say hello')

      expect(result).toEqual({
        content: 'This is a simple response without tools.',
        toolCalls: [],
        usage: undefined,
        metadata: expect.any(Object),
        caching: undefined,
        finishReason: undefined
      })
    })

    it('should handle mismatched tool calls and results gracefully', async () => {
      // Simulate a case where toolResults has different IDs than toolCalls
      const mockAIResponse = {
        text: 'Response with mismatched tool data.',
        toolCalls: [
          {
            toolCallId: 'call_123',
            toolName: 'test',
            input: { message: 'hello' }
          }
        ],
        toolResults: [
          {
            toolCallId: 'call_456', // Different ID
            toolName: 'test',
            output: { processed: 'HELLO', success: true }
          }
        ]
      }

      vi.mocked(generateText).mockResolvedValue(mockAIResponse)

      const agent = new Agent({
        name: 'Test Agent',
        systemPrompt: 'You are a test agent.',
        model: mockModel,
        tools: { test: testTool }
      })

      const result = await agent.generate('Test message')

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls?.[0]).toEqual({
        id: 'call_123',
        name: 'test',
        input: { message: 'hello' },
        result: undefined // No matching result found
      })
    })
  })

  describe('Agent Stream Integration', () => {
    it('should handle tool execution errors gracefully', async () => {
      // Create a tool that throws an error
      const errorTool = createTool(
        'Tool that throws errors',
        z.object({
          input: z.string()
        }),
        async ({ input }) => {
          throw new Error('Tool execution failed')
        }
      )

      // Mock generateText to return a response that triggers tool execution
      const mockAIResponse = {
        text: 'I will try to use the error tool.',
        toolCalls: [
          {
            toolCallId: 'call_error_1',
            toolName: 'error_tool',
            input: { input: 'test' }
          }
        ],
        // Don't provide toolResults - let the agent execute the tools itself
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'tool_calls'
      }

      vi.mocked(generateText).mockResolvedValue(mockAIResponse)

      const agent = new Agent({
        name: 'Error Test Agent',
        systemPrompt: 'You handle errors gracefully.',
        model: mockModel,
        tools: { error_tool: errorTool }
      })

      const result = await agent.generate('Test error handling')

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls?.[0].name).toBe('error_tool')
      // The result should be undefined since the tool execution failed
      // but the agent should still include the tool call in the response
      expect(result.toolCalls?.[0].result).toBeUndefined()
    })
  })

  describe('Tool Structure Validation', () => {
    it('should create tools with correct AI SDK structure', () => {
      expect(testTool).toHaveProperty('description')
      expect(testTool).toHaveProperty('inputSchema')
      expect(testTool).toHaveProperty('execute')
      expect(typeof testTool.execute).toBe('function')
    })

    it('should execute tools correctly', async () => {
      const result = await testTool.execute({ message: 'test input' })
      
      expect(result).toEqual({
        processed: 'TEST INPUT',
        success: true,
        timestamp: expect.any(String)
      })
    })

    it('should validate tool input schemas', () => {
      expect(() => {
        testTool.inputSchema.parse({ message: 'valid input' })
      }).not.toThrow()

      expect(() => {
        testTool.inputSchema.parse({ invalid: 'input' })
      }).toThrow()
    })
  })
})
