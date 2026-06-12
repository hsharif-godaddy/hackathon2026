/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import type { ChatMessage, StreamingMessage, ToolCall } from '@/stores/useStreamingConversationStore'
import { useLatestNBAs } from './useLatestNBAs'

// ─── Store mocks ─────────────────────────────────────────────────────────────

let mockMessages: ChatMessage[] = []
let mockActiveStream: StreamingMessage | null = null
const mockResolvedSecretsComposerToolCallIds: Record<string, true> = {}

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useMessages: () => mockMessages,
  useActiveStream: () => mockActiveStream,
  useStreamingConversationStore: (selector: (s: { resolvedSecretsComposerToolCallIds: Record<string, true> }) => unknown) =>
    selector({ resolvedSecretsComposerToolCallIds: mockResolvedSecretsComposerToolCallIds }),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSuggestedResponseToolCall(
  overrides: Partial<ToolCall> & { widgetData?: object } = {}
): ToolCall {
  const { widgetData, ...rest } = overrides
  return {
    id: 'tc-1',
    name: 'suggestedResponse',
    status: 'completed',
    input: {},
    result: {
      output: {
        widgetData: widgetData ?? {
          question: 'What would you like to do next?',
          suggestions: [{ text: 'Option A' }, { text: 'Option B' }],
        },
      },
    },
    ...rest,
  }
}

function makeAssistantMessage(toolCalls: ToolCall[]): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: '',
    toolCalls,
    timestamp: new Date(),
  }
}

function makeUserMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-user',
    role: 'user',
    content: 'hello',
    timestamp: new Date(),
    ...overrides,
  }
}

function makeActionUserMessage(content = 'Red'): ChatMessage {
  return makeUserMessage({
    content,
    metadata: { isActionRequest: true },
  })
}

function makeSkippedAskQuestionUserMessage(content = 'Skip'): ChatMessage {
  return makeUserMessage({
    content,
    metadata: { askQuestionSkipped: true },
  })
}

function makeActiveStream(
  isComplete: boolean,
  toolCalls: ToolCall[] = []
): StreamingMessage {
  return {
    id: 'stream-1',
    role: 'assistant',
    content: '',
    segments: [],
    toolCalls,
    timestamp: new Date(),
    isComplete,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockMessages = []
  mockActiveStream = null
  Object.keys(mockResolvedSecretsComposerToolCallIds).forEach((key) => {
    delete mockResolvedSecretsComposerToolCallIds[key]
  })
})

describe('useLatestNBAs', () => {

  // ── Active incomplete stream ──────────────────────────────────────────────

  describe('when there is an active incomplete stream', () => {
    it('returns null while the stream is still in progress', () => {
      mockMessages = [makeAssistantMessage([makeSuggestedResponseToolCall()])]
      mockActiveStream = makeActiveStream(false)

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('returns null for incomplete streams even when tool calls are present', () => {
      mockActiveStream = makeActiveStream(false, [makeSuggestedResponseToolCall()])

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('returns null when active stream has a pending requestSecrets tool call', () => {
      mockActiveStream = makeActiveStream(false, [
        makeSuggestedResponseToolCall(),
        {
          id: 'tc-secrets',
          name: 'requestSecrets',
          status: 'completed',
          input: {},
          result: {
            success: true,
            secretsRequired: true,
            secretsRequest: {
              type: 'secrets_request',
              title: 'API key',
              description: 'From provider console',
              secrets: [{ name: 'OPENAI_API_KEY', required: true }],
              mode: 'add',
            },
          },
        },
      ])

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })
  })

  // ── Active completed stream ───────────────────────────────────────────────

  describe('when there is a completed active stream', () => {
    it('returns NBA data from the stream', () => {
      mockActiveStream = makeActiveStream(true, [makeSuggestedResponseToolCall()])

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toEqual({
        question: 'What would you like to do next?',
        suggestions: [{ text: 'Option A' }, { text: 'Option B' }],
        source: 'suggestedResponse',
      })
    })

    it('picks the last suggestedResponse tool call when there are multiple', () => {
      const first = makeSuggestedResponseToolCall({
        id: 'tc-first',
        widgetData: { question: 'First question?', suggestions: [{ text: 'Old' }] },
      })
      const last = makeSuggestedResponseToolCall({
        id: 'tc-last',
        widgetData: { question: 'Last question?', suggestions: [{ text: 'New' }] },
      })
      mockActiveStream = makeActiveStream(true, [first, last])

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.question).toBe('Last question?')
      expect(result.current?.suggestions).toEqual([{ text: 'New' }])
    })

    it('falls back to messages when stream has no suggestedResponse tool calls', () => {
      const otherTool: ToolCall = { id: 'other', name: 'someOtherTool', status: 'completed', input: {} }
      mockActiveStream = makeActiveStream(true, [otherTool])
      mockMessages = [makeAssistantMessage([makeSuggestedResponseToolCall({
        widgetData: { question: 'From messages', suggestions: [{ text: 'Msg option' }] },
      })])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.question).toBe('From messages')
    })

    it('returns null when stream has no tool calls and messages are empty', () => {
      mockActiveStream = makeActiveStream(true, [])

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('skips a suggestedResponse tool call that is not completed', () => {
      mockActiveStream = makeActiveStream(true, [
        makeSuggestedResponseToolCall({ status: 'running' }),
      ])

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })
  })

  // ── No active stream — falls back to messages ─────────────────────────────

  describe('when there is no active stream', () => {
    it('returns NBA data from the last assistant message', () => {
      mockMessages = [makeAssistantMessage([makeSuggestedResponseToolCall()])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toEqual({
        question: 'What would you like to do next?',
        suggestions: [{ text: 'Option A' }, { text: 'Option B' }],
        source: 'suggestedResponse',
      })
    })

    it('scans backward past user messages to find the last assistant message', () => {
      mockMessages = [
        makeAssistantMessage([makeSuggestedResponseToolCall({
          widgetData: { question: 'Assistant Q', suggestions: [{ text: 'Go' }] },
        })]),
        makeUserMessage(),
        makeUserMessage(),
      ]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.question).toBe('Assistant Q')
    })

    it('returns null when the user already answered via an action request', () => {
      mockMessages = [
        makeAssistantMessage([makeSuggestedResponseToolCall({
          widgetData: { question: 'Assistant Q', suggestions: [{ text: 'Go' }] },
        })]),
        makeActionUserMessage('Go'),
      ]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('returns null from a completed active stream when an action response followed', () => {
      mockActiveStream = makeActiveStream(true, [makeSuggestedResponseToolCall({
        widgetData: { question: 'Stream Q', suggestions: [{ text: 'Go' }] },
      })])
      mockMessages = [
        makeAssistantMessage([makeSuggestedResponseToolCall({
          widgetData: { question: 'Stream Q', suggestions: [{ text: 'Go' }] },
        })]),
        makeActionUserMessage('Go'),
      ]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('only checks the last assistant message, not earlier ones', () => {
      const olderAssistant = makeAssistantMessage([makeSuggestedResponseToolCall({
        widgetData: { question: 'Older', suggestions: [{ text: 'Old' }] },
      })])
      const newerAssistant: ChatMessage = {
        ...makeAssistantMessage([]),
        id: 'newer',
        // No toolCalls with suggestedResponse
        toolCalls: [],
      }
      mockMessages = [olderAssistant, makeUserMessage(), newerAssistant]

      const { result } = renderHook(() => useLatestNBAs())
      // newerAssistant has no suggestedResponse; older one should NOT be checked
      expect(result.current).toBeNull()
    })

    it('reuses suggestedResponse from the secrets turn when cancel is the latest message', () => {
      const secretsTurn = makeAssistantMessage([
        makeSuggestedResponseToolCall({
          widgetData: {
            question: 'What next?',
            suggestions: [{ text: 'Try again later' }],
          },
        }),
      ])
      mockMessages = [
        secretsTurn,
        { ...makeUserMessage(), content: 'I cancelled entering the requested secret(s).' },
      ]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.suggestions).toEqual([{ text: 'Try again later' }])
    })

    it('reuses suggestedResponse from the post-save assistant when save confirmation is the latest message', () => {
      const secretsTurn = makeAssistantMessage([
        {
          id: 'tc-secrets',
          name: 'requestSecrets',
          status: 'completed',
          input: {},
          result: { secretsRequired: true },
        },
      ])
      const postSaveTurn = makeAssistantMessage([
        makeSuggestedResponseToolCall({
          widgetData: {
            question: 'What next?',
            suggestions: [{ text: 'Call OpenAI from the app' }],
          },
        }),
      ])
      mockMessages = [
        secretsTurn,
        { ...makeUserMessage(), content: 'Secret added successfully: OPENAI_API_KEY' },
        postSaveTurn,
      ]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.suggestions).toEqual([{ text: 'Call OpenAI from the app' }])
    })

    it('reuses suggestedResponse from the secrets turn when save confirmation is the latest message', () => {
      const secretsTurn = makeAssistantMessage([
        makeSuggestedResponseToolCall({
          widgetData: {
            question: 'What next?',
            suggestions: [{ text: 'Wire up OpenAI calls' }],
          },
        }),
      ])
      mockMessages = [
        secretsTurn,
        { ...makeUserMessage(), content: 'Secret added successfully: OPENAI_API_KEY' },
      ]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.suggestions).toEqual([{ text: 'Wire up OpenAI calls' }])
    })

    it('picks the last suggestedResponse in the last assistant message toolCalls', () => {
      const first = makeSuggestedResponseToolCall({
        id: 'first',
        widgetData: { question: 'First', suggestions: [{ text: 'A' }] },
      })
      const last = makeSuggestedResponseToolCall({
        id: 'last',
        widgetData: { question: 'Last', suggestions: [{ text: 'B' }] },
      })
      mockMessages = [makeAssistantMessage([first, last])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.question).toBe('Last')
    })

    it('returns null when there are no messages', () => {
      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('returns null when the only messages are user messages', () => {
      mockMessages = [makeUserMessage(), makeUserMessage()]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('returns null when the last assistant message has no toolCalls', () => {
      const msg: ChatMessage = { ...makeAssistantMessage([]), toolCalls: undefined }
      mockMessages = [msg]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('returns null when the last assistant message has no suggestedResponse toolCalls', () => {
      const otherTool: ToolCall = { id: 'other', name: 'createFile', status: 'completed', input: {} }
      mockMessages = [makeAssistantMessage([otherTool])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('skips suggestedResponse tool calls that are not completed', () => {
      mockMessages = [makeAssistantMessage([
        makeSuggestedResponseToolCall({ status: 'error' }),
        makeSuggestedResponseToolCall({ id: 'tc-running', status: 'running' }),
      ])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })
  })

  // ── widgetData validation ─────────────────────────────────────────────────

  describe('widgetData validation', () => {
    it('returns null when toolCall has no result', () => {
      const tc: ToolCall = { ...makeSuggestedResponseToolCall(), result: undefined }
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('returns null when widgetData is missing', () => {
      const tc = makeSuggestedResponseToolCall({ widgetData: undefined as any })
      // Override result manually to simulate missing widgetData
      ;(tc as any).result = { output: {} }
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('returns null when question is missing', () => {
      const tc = makeSuggestedResponseToolCall({
        widgetData: { suggestions: [{ text: 'Option A' }] } as any,
      })
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('returns null when suggestions is not an array', () => {
      const tc = makeSuggestedResponseToolCall({
        widgetData: { question: 'Q?', suggestions: 'not an array' } as any,
      })
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('returns null when all suggestions have non-string text fields', () => {
      const tc = makeSuggestedResponseToolCall({
        widgetData: { question: 'Q?', suggestions: [{ text: 42 }, { text: null }, {}] } as any,
      })
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('filters out malformed suggestions and returns valid ones', () => {
      const tc = makeSuggestedResponseToolCall({
        widgetData: {
          question: 'Q?',
          suggestions: [{ text: 'Valid' }, { text: 123 }, null, { text: 'Also valid' }],
        } as any,
      })
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.suggestions).toEqual([{ text: 'Valid' }, { text: 'Also valid' }])
    })

    it('handles result shaped as top-level object (without .output wrapper)', () => {
      const tc: ToolCall = {
        ...makeSuggestedResponseToolCall(),
        result: {
          widgetData: {
            question: 'Direct Q?',
            suggestions: [{ text: 'Direct option' }],
          },
        },
      }
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.question).toBe('Direct Q?')
    })

    it('ignores rebuildWidget in result (no longer part of NBA data)', () => {
      const tc: ToolCall = {
        ...makeSuggestedResponseToolCall(),
        result: {
          output: {
            widgetData: {
              question: 'Rebuild?',
              suggestions: [{ text: 'Yes' }],
            },
            rebuildWidget: { widgetData: { availablePages: ['Home', 'About'] } },
          },
        },
      }
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.question).toBe('Rebuild?')
      expect((result.current as any)?.rebuildWidget).toBeUndefined()
    })
  })

  // ── askQuestion extraction ────────────────────────────────────────────────

  describe('askQuestion tool call extraction', () => {
    function makeAskQuestionToolCall(
      overrides: Partial<ToolCall> & { widgetData?: object } = {}
    ): ToolCall {
      const { widgetData, ...rest } = overrides
      return {
        id: 'tc-aq-1',
        name: 'askQuestion',
        status: 'completed',
        input: {},
        result: {
          output: {
            widgetData: widgetData ?? {
              questions: [{
                question: 'What should the contact section include?',
                suggestions: [{ text: 'Contact form' }, { text: 'Business info' }],
                allowOther: true,
              }],
              currentQuestionIndex: 0,
              answers: [],
            },
          },
        },
        ...rest,
      }
    }

    it('returns NBA data from an askQuestion tool call', () => {
      const tc = makeAskQuestionToolCall()
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toMatchObject({
        question: 'What should the contact section include?',
        suggestions: [{ text: 'Contact form' }, { text: 'Business info' }],
        allowOther: true,
        source: 'askQuestion',
      })
      expect(result.current?.toolResult).toEqual(tc.result)
    })

    it('returns the question at currentQuestionIndex when > 0', () => {
      const tc = makeAskQuestionToolCall({
        widgetData: {
          questions: [
            { question: 'First?', suggestions: [{ text: 'A' }], allowOther: true },
            { question: 'Second?', suggestions: [{ text: 'B' }, { text: 'C' }], allowOther: false },
          ],
          currentQuestionIndex: 1,
          answers: ['A'],
        },
      })
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.question).toBe('Second?')
      expect(result.current?.suggestions).toEqual([{ text: 'B' }, { text: 'C' }])
      expect(result.current?.allowOther).toBe(false)
    })

    it('prefers askQuestion over suggestedResponse when it comes last', () => {
      const sr = makeSuggestedResponseToolCall({
        id: 'tc-sr',
        widgetData: { question: 'What next?', suggestions: [{ text: 'Option A' }] },
      })
      const aq = makeAskQuestionToolCall({ id: 'tc-aq' })
      mockMessages = [makeAssistantMessage([sr, aq])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.source).toBe('askQuestion')
    })

    it('returns null when askQuestion has no questions', () => {
      const tc = makeAskQuestionToolCall({
        widgetData: { questions: [], currentQuestionIndex: 0, answers: [] },
      })
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('defaults allowOther to true when not specified', () => {
      const tc = makeAskQuestionToolCall({
        widgetData: {
          questions: [{
            question: 'Pick one',
            suggestions: [{ text: 'A' }],
          }],
          currentQuestionIndex: 0,
          answers: [],
        },
      })
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.allowOther).toBe(true)
    })

    it('respects allowOther: false', () => {
      const tc = makeAskQuestionToolCall({
        widgetData: {
          questions: [{
            question: 'Pick one',
            suggestions: [{ text: 'A' }],
            allowOther: false,
          }],
          currentQuestionIndex: 0,
          answers: [],
        },
      })
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.allowOther).toBe(false)
    })

    it('returns null after askQuestion when user submits an action response', () => {
      const tc = makeAskQuestionToolCall()
      mockMessages = [
        makeAssistantMessage([tc]),
        makeActionUserMessage('Yes, build the next page'),
      ]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('returns null after askQuestion when user skips the question', () => {
      const tc = makeAskQuestionToolCall()
      mockMessages = [
        makeAssistantMessage([tc]),
        makeSkippedAskQuestionUserMessage(),
      ]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })
  })
})

describe('useLatestNBAs — feedbackActive suppression', () => {
  it('returns null when feedbackActive is true regardless of NBA data', () => {
    mockMessages = [makeAssistantMessage([makeSuggestedResponseToolCall()])]
    mockActiveStream = null
    const { result } = renderHook(() => useLatestNBAs(true))
    expect(result.current).toBeNull()
  })

  it('returns NBA when feedbackActive is false', () => {
    mockMessages = [makeAssistantMessage([makeSuggestedResponseToolCall()])]
    mockActiveStream = null
    const { result } = renderHook(() => useLatestNBAs(false))
    expect(result.current).not.toBeNull()
  })
})
