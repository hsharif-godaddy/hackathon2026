import { describe, expect, it } from 'vitest'

import { normalizeConversationMessages } from '../useStreamingConversationStore'

describe('normalizeConversationMessages', () => {
  it('converts server payloads into chat messages with hydrated segments', () => {
    const rawMessages = [
      {
        id: 'assistant-message',
        sender: 'assistant',
        content: '**Hello** world',
        createdAt: '2024-01-01T00:00:00.000Z',
        segments: [
          {
            id: 'segment-1',
            type: 'text',
            content: '**Hello** world',
            timestamp: '2024-01-01T00:00:00.000Z'
          },
          {
            id: 'segment-2',
            type: 'tool_result',
            tool_call: {
              id: 'tool-1',
              name: 'TestTool',
              status: 'completed',
              result: { foo: 'bar' }
            }
          }
        ],
        tool_calls: [
          {
            id: 'tool-1',
            name: 'TestTool',
            status: 'completed',
            input: { prompt: 'value' },
            result: { foo: 'bar' }
          }
        ],
        metadata: { usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
        maxStepsReached: true
      }
    ]

    const [message] = normalizeConversationMessages(rawMessages)

    expect(message.role).toBe('assistant')
    expect(message.timestamp).toBeInstanceOf(Date)
    expect(message.segments).toHaveLength(2)
    expect(message.segments?.[0].timestamp).toBeInstanceOf(Date)
    expect(message.segments?.[1].toolCall?.name).toBe('TestTool')
    expect(message.toolCalls).toHaveLength(1)
    expect(message.toolCalls?.[0].name).toBe('TestTool')
    expect(message.metadata?.usage?.totalTokens).toBe(3)
    expect(message.maxStepsReached).toBe(true)
  })

  it('handles user messages and missing segment arrays', () => {
    const [message] = normalizeConversationMessages([
      {
        id: 'user-1',
        sender: 'user',
        content: 'hey',
        createdAt: 1700000000000
      }
    ])

    expect(message.role).toBe('user')
    expect(message.segments).toEqual([])
    expect(message.timestamp).toBeInstanceOf(Date)
  })

  it('normalizes mixed timestamp formats and fills missing ones with parent createdAt', () => {
    const createdAt = '2024-01-02T00:00:00.000Z'
    const [message] = normalizeConversationMessages([
      {
        id: 'assistant-1',
        sender: 'assistant',
        createdAt,
        segments: [
          { id: 's1', type: 'text', content: 'iso', timestamp: '2024-01-02T00:00:01.000Z' },
          { id: 's2', type: 'text', content: 'number', timestamp: 1704153602000 },
          { id: 's3', type: 'text', content: 'fallback' }
        ]
      }
    ])

    expect(message.segments?.map((segment) => segment.timestamp instanceof Date)).toEqual([true, true, true])
    expect(message.segments?.[2].timestamp?.getTime()).toBe(message.timestamp.getTime())
  })

  it('normalizes snake_case tool call data', () => {
    const [message] = normalizeConversationMessages([
      {
        id: 'assistant-2',
        sender: 'assistant',
        createdAt: '2024-01-03T00:00:00.000Z',
        segments: [
          {
            id: 'seg-tool',
            type: 'tool_result',
            tool_call: {
              id: 'tool-2',
              name: 'LegacyTool',
              partial_input: 'delta'
            }
          }
        ],
        tool_calls: [
          {
            id: 'tool-2',
            name: 'LegacyTool',
            partial_input: 'delta'
          }
        ]
      }
    ])

    expect(message.toolCalls?.[0].partialInput).toBe('delta')
    expect(message.segments?.[0].toolCall?.partialInput).toBe('delta')
  })

  it('normalizes camelCase internal format (toolArgs/toolResult/durationMs) from segments', () => {
    const [message] = normalizeConversationMessages([
      {
        id: 'assistant-3',
        sender: 'assistant',
        createdAt: '2024-01-04T00:00:00.000Z',
        segments: [
          {
            id: 'seg-internal',
            type: 'tool_result',
            toolCall: {
              id: 'tool-3',
              toolName: 'writeFile',
              toolArgs: { path: '/app/index.ts', content: 'hello' },
              toolResult: { success: true },
              durationMs: 1200,
              status: 'completed'
            }
          }
        ],
        toolCalls: [
          {
            id: 'tool-3',
            toolName: 'writeFile',
            toolArgs: { path: '/app/index.ts', content: 'hello' },
            toolResult: { success: true },
            durationMs: 1200,
            status: 'completed'
          }
        ]
      }
    ])

    expect(message.segments?.[0].toolCall?.name).toBe('writeFile')
    expect(message.segments?.[0].toolCall?.input).toEqual({ path: '/app/index.ts', content: 'hello' })
    expect(message.segments?.[0].toolCall?.result).toEqual({ success: true })
    expect(message.segments?.[0].toolCall?.duration).toBe(1200)

    expect(message.toolCalls?.[0].name).toBe('writeFile')
    expect(message.toolCalls?.[0].input).toEqual({ path: '/app/index.ts', content: 'hello' })
    expect(message.toolCalls?.[0].result).toEqual({ success: true })
    expect(message.toolCalls?.[0].duration).toBe(1200)
  })

  it('handles missing or invalid payloads safely', () => {
    expect(normalizeConversationMessages(undefined)).toEqual([])
    expect(normalizeConversationMessages(null as unknown as any[])).toEqual([])
  })

  it('should extract commitHash from message metadata during normalization', () => {
    const rawMessages = [{
      id: 'msg-1', sender: 'agent', content: 'Done', createdAt: Date.now(),
      metadata: { agentId: 'develop', commitHash: 'abc123def456' },
    }]
    const normalized = normalizeConversationMessages(rawMessages)
    expect(normalized[0].commitHash).toBe('abc123def456')
  })

  it('should handle messages without commitHash in metadata', () => {
    const rawMessages = [{
      id: 'msg-2', sender: 'agent', content: 'No commit', createdAt: Date.now(),
      metadata: { agentId: 'develop' },
    }]
    const normalized = normalizeConversationMessages(rawMessages)
    expect(normalized[0].commitHash).toBeUndefined()
  })
})
