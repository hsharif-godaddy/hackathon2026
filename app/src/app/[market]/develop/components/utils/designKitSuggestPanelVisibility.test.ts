import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/stores/useStreamingConversationStore'
import { isDesignKitSuggestPanelVisible } from './designKitSuggestPanelVisibility'
import type { ActiveDesignKitSuggest } from './findLatestDesignKitSuggest'

describe('isDesignKitSuggestPanelVisible', () => {
  const suggest: ActiveDesignKitSuggest = {
    toolCallId: 'tc1',
    messageId: 'msg1',
    kits: [
      {
        slug: 'bold-studio',
        displayName: 'Bold Studio',
        thumbnailUrl: null,
        tags: [],
        palette: {},
        displayFont: null,
      },
    ],
  }

  it('returns false when the suggest message is not found', () => {
    const messages: ChatMessage[] = [{ id: 'other', role: 'assistant', content: 'Hello', timestamp: new Date() }]
    expect(isDesignKitSuggestPanelVisible(messages, suggest)).toBe(false)
  })

  it('returns true when no user messages follow the suggest', () => {
    const messages: ChatMessage[] = [{ id: 'msg1', role: 'assistant', content: 'Here are some vibes', timestamp: new Date() }]
    expect(isDesignKitSuggestPanelVisible(messages, suggest)).toBe(true)
  })

  it('returns false once the user picks (any user message after the suggest hides it)', () => {
    const messages: ChatMessage[] = [
      { id: 'msg1', role: 'assistant', content: 'Here are some vibes', timestamp: new Date() },
      { id: 'msg2', role: 'user', content: 'Use the Bold Studio design kit', timestamp: new Date() },
    ]
    expect(isDesignKitSuggestPanelVisible(messages, suggest)).toBe(false)
  })

  it('returns false once the user skips', () => {
    const messages: ChatMessage[] = [
      { id: 'msg1', role: 'assistant', content: 'Here are some vibes', timestamp: new Date() },
      { id: 'msg2', role: 'user', content: 'Skip — pick the best design kit for me', timestamp: new Date() },
    ]
    expect(isDesignKitSuggestPanelVisible(messages, suggest)).toBe(false)
  })

  it('ignores assistant messages after the suggest', () => {
    const messages: ChatMessage[] = [
      { id: 'msg1', role: 'assistant', content: 'Here are some vibes', timestamp: new Date() },
      { id: 'msg2', role: 'assistant', content: 'Still thinking', timestamp: new Date() },
    ]
    expect(isDesignKitSuggestPanelVisible(messages, suggest)).toBe(true)
  })

  it('only considers messages after the suggest, not before', () => {
    const messages: ChatMessage[] = [
      { id: 'msg0', role: 'user', content: 'a bakery called Sweet Rise', timestamp: new Date() },
      { id: 'msg1', role: 'assistant', content: 'Here are some vibes', timestamp: new Date() },
    ]
    expect(isDesignKitSuggestPanelVisible(messages, suggest)).toBe(true)
  })
})
