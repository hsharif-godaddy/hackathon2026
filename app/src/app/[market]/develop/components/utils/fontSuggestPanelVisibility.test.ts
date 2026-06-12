import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/stores/useStreamingConversationStore'
import type { ActiveFontThemeSuggest } from './findLatestFontThemeSuggest'
import { isFontSuggestPanelVisible } from './fontSuggestPanelVisibility'

describe('isFontSuggestPanelVisible', () => {
  const mockSuggest: ActiveFontThemeSuggest = {
    toolCallId: 'tc1',
    messageId: 'msg1',
    themes: [
      {
        id: 'theme1',
        name: 'Test Theme',
        headerFont: {
          name: 'Roboto',
          weights: ['400', '700'],
        },
        bodyFont: {
          name: 'Open Sans',
          weights: ['400', '600'],
        },
      },
    ],
  }

  it('returns false when suggest message is not found', () => {
    const messages: ChatMessage[] = [
      {
        id: 'other-msg',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Hello',
      },
    ]

    const suggest = { ...mockSuggest, messageId: 'msg1' }
    expect(isFontSuggestPanelVisible(messages, suggest)).toBe(false)
  })

  it('returns true when no user messages exist after suggest', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(true)
  })

  it('returns true when only action request user messages exist after suggest', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Show me more font options',
        metadata: { isActionRequest: true },
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(true)
  })

  it('returns true when multiple action request messages exist after suggest', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Show me more font options',
        metadata: { isActionRequest: true },
      },
      {
        id: 'msg3',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are more themes',
      },
      {
        id: 'msg4',
        role: 'user',
        timestamp: new Date(),
        content: 'Show me more font options',
        metadata: { isActionRequest: true },
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(true)
  })

  it('returns false when user message after suggest is not an action request', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Apply the first one',
        // No metadata.isActionRequest - this is a typed message
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(false)
  })

  it('returns false when any user message after suggest is not an action request', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Show me more font options',
        metadata: { isActionRequest: true },
      },
      {
        id: 'msg3',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are more themes',
      },
      {
        id: 'msg4',
        role: 'user',
        timestamp: new Date(),
        content: 'Use Roboto for headers',
        // No metadata.isActionRequest
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(false)
  })

  it('returns false when metadata.isActionRequest is explicitly false', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Show me more font options',
        metadata: { isActionRequest: false },
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(false)
  })

  it('ignores assistant messages after suggest', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
      {
        id: 'msg2',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Some other assistant message',
      },
      {
        id: 'msg3',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Another assistant message',
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(true)
  })

  it('returns false when a completed fontTheme apply tool call exists after suggest', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Apply font theme: Modern',
        metadata: { isActionRequest: true },
      },
      {
        id: 'msg3',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Applied the font',
        toolCalls: [
          {
            id: 'tc-apply',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'completed',
          },
        ],
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(false)
  })

  it('returns true when a fontTheme apply tool call is still running (not completed) after suggest', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Apply font theme: Modern',
        metadata: { isActionRequest: true },
      },
      {
        id: 'msg3',
        role: 'assistant',
        timestamp: new Date(),
        content: '',
        toolCalls: [
          {
            id: 'tc-apply',
            name: 'fontTheme',
            input: { mode: 'apply' },
            status: 'running',
          },
        ],
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(true)
  })

  it('only checks messages after the suggest message', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg0',
        role: 'user',
        timestamp: new Date(),
        content: 'Apply this font',
        // No metadata - but this is BEFORE the suggest message so it doesn't matter
      },
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(true)
  })

  it('returns false when message has no metadata object at all', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Show me more font options',
        // metadata is undefined
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(false)
  })

  it('returns false when metadata exists but isActionRequest is undefined', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Show me more font options',
        metadata: { someOtherField: 'value' },
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(false)
  })

  it('works correctly with mixed action requests and other metadata', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are font themes',
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Show me more font options',
        metadata: {
          isActionRequest: true,
          otherField: 'value',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        },
      },
    ]

    expect(isFontSuggestPanelVisible(messages, mockSuggest)).toBe(true)
  })
})
