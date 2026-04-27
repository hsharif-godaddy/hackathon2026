import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/stores/useStreamingConversationStore'
import { isColorSuggestPanelVisible } from './colorSuggestPanelVisibility'
import type { ActiveColorSchemeSuggest } from './findLatestColorSchemeSuggest'

describe('isColorSuggestPanelVisible', () => {
  const mockTranslate = (key: string) => {
    if (key === 'builder_tools_css_color_scheme_more_options') {
      return 'Show me more color scheme options'
    }
    return key
  }

  const mockSuggest: ActiveColorSchemeSuggest = {
    toolCallId: 'tc1',
    messageId: 'msg1',
    palettes: [
      {
        name: 'Test',
        palette: {
          background: '#ffffff',
          foreground: '#000000',
          primary: '#0066cc',
          primaryForeground: '#ffffff',
          secondary: '#6c757d',
          secondaryForeground: '#ffffff',
          accent: '#ff6b6b',
          accentForeground: '#ffffff',
          muted: '#f8f9fa',
          mutedForeground: '#6c757d',
          border: '#e2e8f0',
          destructive: '#ef4444',
          destructiveForeground: '#ffffff',
          success: '#10b981',
          successForeground: '#ffffff',
          warning: '#f59e0b',
          warningForeground: '#ffffff',
          chart1: '#3b82f6',
          chart2: '#8b5cf6',
          chart3: '#10b981',
          chart4: '#f59e0b',
          chart5: '#ef4444',
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
    expect(isColorSuggestPanelVisible(messages, suggest, mockTranslate)).toBe(false)
  })

  it('returns true when no user messages exist after suggest', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are color schemes',
        
      },
    ]

    expect(isColorSuggestPanelVisible(messages, mockSuggest, mockTranslate)).toBe(true)
  })

  it('returns true when only "more options" user message exists after suggest', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are color schemes',
        
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Show me more color scheme options',
        
      },
    ]

    expect(isColorSuggestPanelVisible(messages, mockSuggest, mockTranslate)).toBe(true)
  })

  it('returns true when multiple "more options" messages exist after suggest', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are color schemes',
        
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Show me more color scheme options',
        
      },
      {
        id: 'msg3',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are more schemes',
        
      },
      {
        id: 'msg4',
        role: 'user',
        timestamp: new Date(),
        content: 'Show me more color scheme options',
        
      },
    ]

    expect(isColorSuggestPanelVisible(messages, mockSuggest, mockTranslate)).toBe(true)
  })

  it('returns false when user message after suggest is not "more options"', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are color schemes',
        
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Apply the first one',
        
      },
    ]

    expect(isColorSuggestPanelVisible(messages, mockSuggest, mockTranslate)).toBe(false)
  })

  it('returns false when any user message after suggest is not "more options"', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are color schemes',
        
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: 'Show me more color scheme options',
        
      },
      {
        id: 'msg3',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are more schemes',
        
      },
      {
        id: 'msg4',
        role: 'user',
        timestamp: new Date(),
        content: 'Use Ocean Blue',
        
      },
    ]

    expect(isColorSuggestPanelVisible(messages, mockSuggest, mockTranslate)).toBe(false)
  })

  it('ignores whitespace when comparing user messages', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are color schemes',
        
      },
      {
        id: 'msg2',
        role: 'user',
        timestamp: new Date(),
        content: '  Show me more color scheme options  ',
        
      },
    ]

    expect(isColorSuggestPanelVisible(messages, mockSuggest, mockTranslate)).toBe(true)
  })

  it('ignores assistant messages after suggest', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are color schemes',
        
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

    expect(isColorSuggestPanelVisible(messages, mockSuggest, mockTranslate)).toBe(true)
  })

  it('only checks messages after the suggest message', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg0',
        role: 'user',
        timestamp: new Date(),
        content: 'Apply this theme',
        
      },
      {
        id: 'msg1',
        role: 'assistant',
        timestamp: new Date(),
        content: 'Here are color schemes',
        
      },
    ]

    expect(isColorSuggestPanelVisible(messages, mockSuggest, mockTranslate)).toBe(true)
  })
})
