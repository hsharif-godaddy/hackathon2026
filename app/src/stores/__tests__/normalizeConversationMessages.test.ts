import { describe, expect, it } from 'vitest'

import { normalizeConversationMessages } from '../conversation-normalization'

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

  it('should preserve feedback metadata from persisted agent messages', () => {
    const [message] = normalizeConversationMessages([
      {
        id: 'msg-3',
        sender: 'assistant',
        content: 'Thanks',
        createdAt: Date.now(),
        metadata: { feedback: 'positive', agentId: 'develop' },
      },
    ])
    expect(message.metadata?.feedback).toBe('positive')
  })

  it('preserves wire-format completed status and widget result for askQuestion on reload', () => {
    const widgetData = {
      type: 'ask-question',
      questions: [{
        question: 'pick one',
        suggestions: [{ text: 'a' }, { text: 'b' }],
        allowOther: true,
        multiSelect: false,
      }],
      currentQuestionIndex: 0,
      answers: [],
    }

    const [message] = normalizeConversationMessages([
      {
        id: 'assistant-ask',
        sender: 'assistant',
        createdAt: '2024-01-05T00:00:00.000Z',
        toolCalls: [
          {
            id: 'tool-ask',
            name: 'askQuestion',
            status: 'completed',
            input: { questions: widgetData.questions },
            result: { success: true, widgetType: 'ask-question', widgetData },
          },
        ],
      },
    ])

    expect(message.toolCalls?.[0].status).toBe('completed')
    expect(message.toolCalls?.[0].result).toMatchObject({
      widgetType: 'ask-question',
      widgetData: { questions: widgetData.questions },
    })
  })

  it('preserves wire-format completed status on segment toolCall for the segments path', () => {
    const secretsResult = {
      success: true,
      secretsRequired: true,
      secretsRequest: {
        secrets: [{ name: 'API_KEY', label: 'API key', required: true }],
      },
    }

    const [message] = normalizeConversationMessages([
      {
        id: 'assistant-secrets',
        sender: 'assistant',
        createdAt: '2024-01-06T00:00:00.000Z',
        segments: [
          {
            id: 'seg-secrets',
            type: 'tool_call',
            timestamp: '2024-01-06T00:00:00.000Z',
            toolCall: {
              id: 'tool-secrets',
              name: 'requestSecrets',
              status: 'completed',
              input: { secrets: secretsResult.secretsRequest.secrets },
              result: secretsResult,
            },
          },
        ],
      },
    ])

    const segment = message.segments?.[0]
    expect(segment?.toolCall?.status).toBe('completed')
    expect(segment?.toolCall?.result).toEqual(secretsResult)
  })

  describe('validation folding and retry merge', function validationFoldingTests() {
    it('should fold persisted validation messages into the previous assistant message', function foldValidation() {
      const messages = normalizeConversationMessages([
        {
          id: 'assistant-1',
          sender: 'assistant',
          content: 'I edited the file.',
          createdAt: '2026-01-01T00:00:00.000Z',
          segments: [{
            id: 'segment-1',
            type: 'tool_call',
            content: '',
            toolCall: {
              id: 'tool-1',
              name: 'fileEdit',
              input: {},
              status: 'completed'
            }
          }]
        },
        {
          id: 'validation-1',
          sender: 'user',
          content: 'Fix this runtime error',
          createdAt: '2026-01-01T00:00:01.000Z',
          metadata: {
            source: 'post_stream_validator',
            displayAs: 'validation',
            validationStatus: 'failed'
          }
        }
      ])

      expect(messages).toHaveLength(1)
      expect(messages[0].segments).toHaveLength(2)
      expect(messages[0].segments?.[1]?.toolCall).toMatchObject({
        id: 'validation-1',
        name: 'validateCode',
        status: 'completed',
        result: {
          status: 'failed',
          diagnostics: 'Fix this runtime error'
        }
      })
      expect(messages[0].toolCalls?.map((toolCall) => toolCall.name)).toEqual(['fileEdit', 'validateCode'])
    });

    it('should merge the retry assistant turn after a validation message into the same display message', function mergeRetry() {
      const messages = normalizeConversationMessages([
        {
          id: 'assistant-1',
          sender: 'assistant',
          content: 'First edit',
          createdAt: '2026-01-01T00:00:00.000Z',
          segments: [{
            id: 'segment-1',
            type: 'tool_call',
            content: '',
            toolCall: {
              id: 'tool-1',
              name: 'fileEdit',
              input: {},
              status: 'completed'
            }
          }]
        },
        {
          id: 'validation-1',
          sender: 'user',
          content: 'Fix this runtime error',
          createdAt: '2026-01-01T00:00:01.000Z',
          metadata: {
            source: 'post_stream_validator',
            displayAs: 'validation',
            validationStatus: 'failed'
          }
        },
        {
          id: 'assistant-2',
          sender: 'assistant',
          content: 'Second edit',
          createdAt: '2026-01-01T00:00:02.000Z',
          segments: [{
            id: 'segment-2',
            type: 'tool_call',
            content: '',
            toolCall: {
              id: 'tool-2',
              name: 'fileEdit',
              input: {},
              status: 'completed'
            }
          }]
        },
        {
          id: 'validation-2',
          sender: 'user',
          content: 'Validation passed',
          createdAt: '2026-01-01T00:00:03.000Z',
          metadata: {
            source: 'post_stream_validator',
            displayAs: 'validation',
            validationStatus: 'completed'
          }
        }
      ])

      expect(messages).toHaveLength(1)
      expect(messages[0].segments?.map((segment) => segment.toolCall?.name)).toEqual([
        'fileEdit',
        'validateCode',
        'fileEdit',
        'validateCode'
      ])
      expect(messages[0].toolCalls?.map((toolCall) => toolCall.name)).toEqual([
        'fileEdit',
        'validateCode',
        'fileEdit',
        'validateCode'
      ])
    });

    it('should fold consecutive validation messages before merging the retry assistant turn', function mergeConsecutiveValidation() {
      const messages = normalizeConversationMessages([
        {
          id: 'assistant-1',
          sender: 'assistant',
          content: 'First edit',
          createdAt: '2026-01-01T00:00:00.000Z',
          segments: [{
            id: 'segment-1',
            type: 'tool_call',
            content: '',
            toolCall: {
              id: 'tool-1',
              name: 'fileEdit',
              input: {},
              status: 'completed'
            }
          }]
        },
        {
          id: 'validation-1',
          sender: 'user',
          content: 'Fix this TypeScript error',
          createdAt: '2026-01-01T00:00:01.000Z',
          metadata: {
            source: 'post_stream_validator',
            displayAs: 'validation',
            validationStatus: 'failed'
          }
        },
        {
          id: 'validation-2',
          sender: 'user',
          content: 'Fix this runtime error',
          createdAt: '2026-01-01T00:00:02.000Z',
          metadata: {
            source: 'post_stream_validator',
            displayAs: 'validation',
            validationStatus: 'failed'
          }
        },
        {
          id: 'assistant-2',
          sender: 'assistant',
          content: 'Second edit',
          createdAt: '2026-01-01T00:00:03.000Z',
          segments: [{
            id: 'segment-2',
            type: 'tool_call',
            content: '',
            toolCall: {
              id: 'tool-2',
              name: 'fileEdit',
              input: {},
              status: 'completed'
            }
          }]
        }
      ])

      expect(messages).toHaveLength(1)
      expect(messages[0].segments?.map((segment) => segment.toolCall?.id)).toEqual([
        'tool-1',
        'validation-1',
        'validation-2',
        'tool-2'
      ])
      expect(messages[0].toolCalls?.map((toolCall) => toolCall.id)).toEqual([
        'tool-1',
        'validation-1',
        'validation-2',
        'tool-2'
      ])
    });

    it('should dedupe tool ids that appear in both the original and retry assistant turns', function dedupeAcrossMerge() {
      // The merge across validator + retry concatenates segments and toolCalls.
      // If the persisted history happens to share a tool id across both turns
      // (e.g. an incremental save captured the live tool_call before the
      // canonical end-of-turn save wrote it again, or a turn restart re-emits
      // the same id) the merged message must collapse to one entry per id;
      // duplicate ids drive duplicate React keys in MessageContentRenderer.
      const messages = normalizeConversationMessages([
        {
          id: 'assistant-1',
          sender: 'assistant',
          content: 'First edit',
          createdAt: '2026-01-01T00:00:00.000Z',
          segments: [{
            id: 'segment-1',
            type: 'tool_call',
            content: '',
            toolCall: {
              id: 'shared-tool-id',
              name: 'fileEdit',
              input: {},
              status: 'running'
            }
          }],
          toolCalls: [{
            id: 'shared-tool-id',
            name: 'fileEdit',
            input: {},
            status: 'running'
          }]
        },
        {
          id: 'validation-1',
          sender: 'user',
          content: 'Fix this runtime error',
          createdAt: '2026-01-01T00:00:01.000Z',
          metadata: {
            source: 'post_stream_validator',
            displayAs: 'validation',
            validationStatus: 'failed'
          }
        },
        {
          id: 'assistant-2',
          sender: 'assistant',
          content: 'Retry edit',
          createdAt: '2026-01-01T00:00:02.000Z',
          segments: [{
            id: 'segment-2',
            type: 'tool_call',
            content: '',
            toolCall: {
              id: 'shared-tool-id',
              name: 'fileEdit',
              input: { path: '/app/index.ts' },
              status: 'completed',
              result: { success: true }
            }
          }],
          toolCalls: [{
            id: 'shared-tool-id',
            name: 'fileEdit',
            input: { path: '/app/index.ts' },
            status: 'completed',
            result: { success: true }
          }]
        }
      ])

      expect(messages).toHaveLength(1)

      const toolCallIds = messages[0].toolCalls?.map((toolCall) => toolCall.id) ?? []
      expect(new Set(toolCallIds).size).toBe(toolCallIds.length)

      const segmentToolIds = messages[0].segments
        ?.filter((segment) => segment.toolCall)
        .map((segment) => segment.toolCall!.id) ?? []
      expect(new Set(segmentToolIds).size).toBe(segmentToolIds.length)

      const sharedToolCall = messages[0].toolCalls?.find((tc) => tc.id === 'shared-tool-id')
      expect(sharedToolCall?.status).toBe('completed')
      expect(sharedToolCall?.result).toEqual({ success: true })
    });

    it('should keep orphan validation messages renderable as validation user messages', function orphanValidation() {
      const messages = normalizeConversationMessages([
        {
          id: 'validation-1',
          sender: 'user',
          content: 'Fix this runtime error',
          createdAt: '2026-01-01T00:00:01.000Z',
          metadata: {
            source: 'post_stream_validator',
            displayAs: 'validation',
            validationStatus: 'failed'
          }
        }
      ])

      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        id: 'validation-1',
        role: 'user',
        content: 'Fix this runtime error',
        metadata: {
          source: 'post_stream_validator',
          displayAs: 'validation',
          validationStatus: 'failed'
        }
      })
    });

    it('should not merge retry assistant turns across an intervening user message', function preserveUserBoundary() {
      const messages = normalizeConversationMessages([
        {
          id: 'assistant-1',
          sender: 'assistant',
          content: 'First edit',
          createdAt: '2026-01-01T00:00:00.000Z',
          segments: [{
            id: 'segment-1',
            type: 'tool_call',
            content: '',
            toolCall: {
              id: 'tool-1',
              name: 'fileEdit',
              input: {},
              status: 'completed'
            }
          }]
        },
        {
          id: 'validation-1',
          sender: 'user',
          content: 'Fix this runtime error',
          createdAt: '2026-01-01T00:00:01.000Z',
          metadata: {
            source: 'post_stream_validator',
            displayAs: 'validation',
            validationStatus: 'failed'
          }
        },
        {
          id: 'user-1',
          sender: 'user',
          content: 'Actually change direction',
          createdAt: '2026-01-01T00:00:02.000Z'
        },
        {
          id: 'assistant-2',
          sender: 'assistant',
          content: 'Separate edit',
          createdAt: '2026-01-01T00:00:03.000Z',
          segments: [{
            id: 'segment-2',
            type: 'tool_call',
            content: '',
            toolCall: {
              id: 'tool-2',
              name: 'fileEdit',
              input: {},
              status: 'completed'
            }
          }]
        }
      ])

      expect(messages).toHaveLength(3)
      expect(messages[0].toolCalls?.map((toolCall) => toolCall.name)).toEqual(['fileEdit', 'validateCode'])
      expect(messages[1]).toMatchObject({ id: 'user-1', role: 'user' })
      expect(messages[2]).toMatchObject({ id: 'assistant-2', role: 'assistant' })
    });

    it('should recover userStopped from finalResult.finishReason on reload', function recoverUserStopped() {
      const messages = normalizeConversationMessages([
        {
          id: 'assistant-stopped',
          sender: 'assistant',
          content: 'Partial response before stop',
          createdAt: '2026-01-01T00:00:00.000Z',
          metadata: {
            commitHash: 'abc123def4',
            finalResult: { finishReason: 'user_stopped' },
          },
        },
      ])

      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        id: 'assistant-stopped',
        role: 'assistant',
        userStopped: true,
        commitHash: 'abc123def4',
      })
    });

    it('should leave userStopped undefined when finishReason is not user_stopped', function noUserStopped() {
      const messages = normalizeConversationMessages([
        {
          id: 'assistant-complete',
          sender: 'assistant',
          content: 'Fully completed',
          createdAt: '2026-01-01T00:00:00.000Z',
          metadata: {
            finalResult: { finishReason: 'stop' },
          },
        },
      ])

      expect(messages[0].userStopped).toBeUndefined()
    });
  });
})
