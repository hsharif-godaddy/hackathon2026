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

  it('handles missing or invalid payloads safely', () => {
    expect(normalizeConversationMessages(undefined)).toEqual([])
    expect(normalizeConversationMessages(null as unknown as any[])).toEqual([])
  })
})
