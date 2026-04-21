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

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useMessages: () => mockMessages,
  useActiveStream: () => mockActiveStream,
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

function makeUserMessage(): ChatMessage {
  return {
    id: 'msg-user',
    role: 'user',
    content: 'hello',
    timestamp: new Date(),
  }
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
})

describe('useLatestNBAs', () => {

  // ── Active incomplete stream ──────────────────────────────────────────────

  describe('when there is an active incomplete stream', () => {
    it('returns null even if previous messages have NBA data', () => {
      mockMessages = [makeAssistantMessage([makeSuggestedResponseToolCall()])]
      mockActiveStream = makeActiveStream(false)

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current).toBeNull()
    })

    it('returns null when the active stream itself has a suggestedResponse tool call', () => {
      mockActiveStream = makeActiveStream(false, [makeSuggestedResponseToolCall()])

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
        rebuildWidget: undefined,
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
        rebuildWidget: undefined,
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

    it('includes rebuildWidget when present', () => {
      const rebuildWidget = { widgetData: { availablePages: ['Home', 'About'] } }
      const tc: ToolCall = {
        ...makeSuggestedResponseToolCall(),
        result: {
          output: {
            widgetData: {
              question: 'Rebuild?',
              suggestions: [{ text: 'Yes' }],
            },
            rebuildWidget,
          },
        },
      }
      mockMessages = [makeAssistantMessage([tc])]

      const { result } = renderHook(() => useLatestNBAs())
      expect(result.current?.rebuildWidget).toEqual(rebuildWidget)
    })
  })
})
