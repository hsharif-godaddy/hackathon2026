import { describe, expect, it } from 'vitest'

import { isGuideBotConversation } from '@/lib/inbox/isGuideBotConversation'
import { Conversation } from '@/types/inbox/local/conversation'

function makeConversation(
  originalChannel: string,
  categoryType: string,
): Conversation {
  return {
    originalChannel,
    category: { type: categoryType },
  } as unknown as Conversation
}

describe('isGuideBotConversation', () => {
  it('returns true when originalChannel is GuideBot', () => {
    expect(isGuideBotConversation(makeConversation('GuideBot', 'Email'))).toBe(true)
  })

  it('returns true when category.type is GuideBot', () => {
    expect(isGuideBotConversation(makeConversation('Email', 'GuideBot'))).toBe(true)
  })

  it('returns true when both are GuideBot', () => {
    expect(isGuideBotConversation(makeConversation('GuideBot', 'GuideBot'))).toBe(true)
  })

  it('returns false for non-GuideBot conversations', () => {
    expect(isGuideBotConversation(makeConversation('Email', 'Email'))).toBe(false)
    expect(isGuideBotConversation(makeConversation('WebChat', 'WebChat'))).toBe(false)
  })
})
