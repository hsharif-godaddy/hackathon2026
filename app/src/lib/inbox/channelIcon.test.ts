import { describe, expect, it } from 'vitest'

import { ChannelIconKind,channelIconKindFor } from '@/lib/inbox/channelIcon'
import { Conversation } from '@/types/inbox/local/conversation'

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    originalChannel: 'Email',
    messageType: 'email',
    category: { id: '1', type: 'Email', name: 'Support', slug: 'support', provider: 'custom', email: 'test@example.com', wsbConnectable: false },
    c2: [],
    form: undefined,
    ...overrides,
  } as unknown as Conversation
}

describe('channelIconKindFor', () => {
  it('returns guidebot when originalChannel is GuideBot', () => {
    const result: ChannelIconKind = channelIconKindFor(
      makeConversation({ originalChannel: 'GuideBot' }),
    )
    expect(result).toBe('guidebot')
  })

  it('returns guidebot when category.type is GuideBot', () => {
    const result: ChannelIconKind = channelIconKindFor(
      makeConversation({
        category: { id: '1', type: 'GuideBot', name: 'GuideBot', slug: 'guidebot' } as Conversation['category'],
      }),
    )
    expect(result).toBe('guidebot')
  })

  it('returns contact when messageType is contactForm', () => {
    const result: ChannelIconKind = channelIconKindFor(
      makeConversation({ messageType: 'contactForm' }),
    )
    expect(result).toBe('contact')
  })

  it('returns contact when form.title is truthy', () => {
    const result: ChannelIconKind = channelIconKindFor(
      makeConversation({
        messageType: 'chat',
        form: { type: 'contact', title: 'Contact Us', form: [] },
      }),
    )
    expect(result).toBe('contact')
  })

  it('returns chat as fallback', () => {
    const result: ChannelIconKind = channelIconKindFor(
      makeConversation({ messageType: 'chat' }),
    )
    expect(result).toBe('chat')
  })

  it('returns chat when form exists but title is empty', () => {
    const result: ChannelIconKind = channelIconKindFor(
      makeConversation({
        messageType: 'chat',
        form: { type: 'contact', title: '', form: [] },
      }),
    )
    expect(result).toBe('chat')
  })
})
