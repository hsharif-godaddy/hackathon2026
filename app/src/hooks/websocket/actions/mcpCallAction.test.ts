/**
 * MCP Call Action Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mcpCallAction } from './mcpCallAction'
import type { MessageContext } from '../handlers/types'

// Mock dependencies
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock @microsoft/fetch-event-source
const mockFetchEventSource = vi.fn()
vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: (...args: unknown[]) => mockFetchEventSource(...args),
}))

describe('mcpCallAction', () => {
  const mockContext = {} as MessageContext

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parameter validation', () => {
    it('should throw error if serverUrl is missing', async () => {
      await expect(
        mcpCallAction({ toolName: 'test_tool', input: {} }, mockContext)
      ).rejects.toThrow('serverUrl is required and must be a string')
    })

    it('should throw error if serverUrl is not a string', async () => {
      await expect(
        mcpCallAction({ serverUrl: 123, toolName: 'test_tool', input: {} }, mockContext)
      ).rejects.toThrow('serverUrl is required and must be a string')
    })

    it('should throw error if toolName is missing', async () => {
      await expect(
        mcpCallAction({ serverUrl: 'https://example.com/mcp', input: {} }, mockContext)
      ).rejects.toThrow('toolName is required and must be a string')
    })

    it('should throw error if toolName is not a string', async () => {
      await expect(
        mcpCallAction({ serverUrl: 'https://example.com/mcp', toolName: 123, input: {} }, mockContext)
      ).rejects.toThrow('toolName is required and must be a string')
    })
  })

  describe('successful MCP calls', () => {
    it('should call fetchEventSource with credentials and correct headers', async () => {
      const mockResult = { content: [{ type: 'text', text: 'Success' }] }

      mockFetchEventSource.mockImplementation((_url: string, options: { onmessage?: (event: { data: string }) => void; onclose?: () => void }) => {
        // Simulate receiving a message event with the result
        options.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: 1, result: mockResult }) })
        // Then close the stream
        options.onclose?.()
        return Promise.resolve()
      })

      await mcpCallAction(
        {
          serverUrl: 'https://example.com/mcp',
          toolName: 'test_tool',
          input: { foo: 'bar' },
        },
        mockContext
      )

      expect(mockFetchEventSource).toHaveBeenCalledWith(
        'https://example.com/mcp',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
        })
      )
    })

    it('should format MCP JSON-RPC request correctly', async () => {
      const mockResult = { content: [{ type: 'text', text: 'Success' }] }

      mockFetchEventSource.mockImplementation((_url: string, options: { body?: string; onmessage?: (event: { data: string }) => void; onclose?: () => void }) => {
        options.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: 1, result: mockResult }) })
        options.onclose?.()
        return Promise.resolve()
      })

      await mcpCallAction(
        {
          serverUrl: 'https://example.com/mcp',
          toolName: 'generate_logo',
          input: { businessName: 'Test Corp' },
        },
        mockContext
      )

      const callArgs = mockFetchEventSource.mock.calls[0]
      const body = JSON.parse(callArgs[1].body as string)

      expect(body).toMatchObject({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'generate_logo',
          arguments: { businessName: 'Test Corp' },
        },
      })
      expect(body.id).toBeDefined()
    })

    it('should return result from successful MCP SSE response', async () => {
      const mockResult = {
        content: [{ type: 'image', data: 'base64data' }],
      }

      mockFetchEventSource.mockImplementation((_url: string, options: { onmessage?: (event: { data: string }) => void; onclose?: () => void }) => {
        options.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: 1, result: mockResult }) })
        options.onclose?.()
        return Promise.resolve()
      })

      const result = await mcpCallAction(
        {
          serverUrl: 'https://example.com/mcp',
          toolName: 'generate_image',
          input: { prompt: 'A sunset' },
        },
        mockContext
      )

      expect(result).toEqual(mockResult)
    })

    it('should handle empty input', async () => {
      const mockResult = { content: [] }

      mockFetchEventSource.mockImplementation((_url: string, options: { body?: string; onmessage?: (event: { data: string }) => void; onclose?: () => void }) => {
        options.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: 1, result: mockResult }) })
        options.onclose?.()
        return Promise.resolve()
      })

      await mcpCallAction(
        {
          serverUrl: 'https://example.com/mcp',
          toolName: 'test_tool',
        },
        mockContext
      )

      const callArgs = mockFetchEventSource.mock.calls[0]
      const body = JSON.parse(callArgs[1].body as string)

      expect(body.params.arguments).toEqual({})
    })

    it('should handle multiple SSE messages and return the last result', async () => {
      const progressMessage = { method: 'notifications/progress', params: { progress: 50 } }
      const finalResult = { content: [{ type: 'text', text: 'Done' }] }

      mockFetchEventSource.mockImplementation((_url: string, options: { onmessage?: (event: { data: string }) => void; onclose?: () => void }) => {
        // Simulate progress notification (no result field)
        options.onmessage?.({ data: JSON.stringify(progressMessage) })
        // Then the final result
        options.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: 1, result: finalResult }) })
        options.onclose?.()
        return Promise.resolve()
      })

      const result = await mcpCallAction(
        {
          serverUrl: 'https://example.com/mcp',
          toolName: 'test_tool',
          input: {},
        },
        mockContext
      )

      expect(result).toEqual(finalResult)
    })
  })

  describe('error handling', () => {
    it('should throw on HTTP error', async () => {
      mockFetchEventSource.mockImplementation((_url: string, options: { onopen?: (response: Response) => Promise<void> }) => {
        const mockResponse = {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve('Server error'),
        } as Response

        return options.onopen?.(mockResponse)
      })

      await expect(
        mcpCallAction(
          {
            serverUrl: 'https://example.com/mcp',
            toolName: 'test_tool',
            input: {},
          },
          mockContext
        )
      ).rejects.toThrow('MCP call failed: 500 Internal Server Error')
    })

    it('should throw on MCP error response', async () => {
      mockFetchEventSource.mockImplementation((_url: string, options: { onmessage?: (event: { data: string }) => void }) => {
        options.onmessage?.({
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: {
              code: -32600,
              message: 'Invalid request',
            },
          }),
        })
        return Promise.resolve()
      })

      await expect(
        mcpCallAction(
          {
            serverUrl: 'https://example.com/mcp',
            toolName: 'test_tool',
            input: {},
          },
          mockContext
        )
      ).rejects.toThrow('MCP error: Invalid request')
    })

    it('should handle network errors via onerror callback', async () => {
      mockFetchEventSource.mockImplementation((_url: string, options: { onerror?: (error: Error) => void }) => {
        options.onerror?.(new Error('Network error'))
        return Promise.resolve()
      })

      await expect(
        mcpCallAction(
          {
            serverUrl: 'https://example.com/mcp',
            toolName: 'test_tool',
            input: {},
          },
          mockContext
        )
      ).rejects.toThrow('Failed to execute MCP tool test_tool: Network error')
    })

    it('should handle 401 unauthorized', async () => {
      mockFetchEventSource.mockImplementation((_url: string, options: { onopen?: (response: Response) => Promise<void> }) => {
        const mockResponse = {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('Authentication required'),
        } as Response

        return options.onopen?.(mockResponse)
      })

      await expect(
        mcpCallAction(
          {
            serverUrl: 'https://example.com/mcp',
            toolName: 'test_tool',
            input: {},
          },
          mockContext
        )
      ).rejects.toThrow('MCP call failed: 401 Unauthorized')
    })

    it('should throw error when stream closes without result', async () => {
      mockFetchEventSource.mockImplementation((_url: string, options: { onclose?: () => void }) => {
        // Close without sending any messages
        options.onclose?.()
        return Promise.resolve()
      })

      await expect(
        mcpCallAction(
          {
            serverUrl: 'https://example.com/mcp',
            toolName: 'test_tool',
            input: {},
          },
          mockContext
        )
      ).rejects.toThrow('MCP call completed but no result was received')
    })

    it('should handle fetchEventSource promise rejection', async () => {
      mockFetchEventSource.mockRejectedValue(new Error('Fetch failed'))

      await expect(
        mcpCallAction(
          {
            serverUrl: 'https://example.com/mcp',
            toolName: 'test_tool',
            input: {},
          },
          mockContext
        )
      ).rejects.toThrow('Failed to execute MCP tool test_tool: Fetch failed')
    })
  })
})
