import { describe, expect, it } from 'vitest'

import { makeChannelType } from '@/lib/inbox/transforms/category'
import {
  RemoteCategoryVisibility,
  RemoteChannelType,
  RemoteConversationCategory,
} from '@/types/inbox/remote/category'

const makeCategory = (
  overrides: Partial<RemoteConversationCategory> = {},
): RemoteConversationCategory => ({
  id: 1,
  name: 'Support',
  slug: 'support',
  email: 'support@example.com',
  visibility: 0,
  channel_type: 1,
  ...overrides,
})

describe('makeChannelType', () => {
  describe('channel_type 1 (Email) resolves via visibility', () => {
    it('returns WebChat when visibility is public (1)', () => {
      expect(makeChannelType(makeCategory({ channel_type: 1, visibility: 1 }))).toBe('WebChat')
    })

    it('returns Email when visibility is private (0)', () => {
      expect(makeChannelType(makeCategory({ channel_type: 1, visibility: 0 }))).toBe('Email')
    })

    it('returns Unknown for any other visibility (privileged)', () => {
      expect(makeChannelType(makeCategory({ channel_type: 1, visibility: 2 }))).toBe('Unknown')
    })
  })

  describe('channel_type 18 (Internal) resolves via slug', () => {
    it('returns GuideBot for the GuideBot slug', () => {
      expect(makeChannelType(makeCategory({ channel_type: 18, slug: 'GuideBot' }))).toBe('GuideBot')
    })

    it('returns WebMessage for the WebMessage slug', () => {
      expect(makeChannelType(makeCategory({ channel_type: 18, slug: 'WebMessage' }))).toBe('WebMessage')
    })

    it('returns Unknown for an unrecognized slug', () => {
      expect(makeChannelType(makeCategory({ channel_type: 18, slug: 'other' }))).toBe('Unknown')
    })
  })

  it.each<[RemoteChannelType, string]>([
    [3, 'FacebookPage'],
    [8, 'InstagramPage'],
    [12, 'FacebookMessenger'],
    [13, 'FacebookLead'],
    [14, 'InstagramAd'],
    [15, 'Whatsapp'],
    [16, 'InstagramDM'],
    [17, 'Telephony'],
    [19, 'Google'],
  ])('maps channel_type %i to %s', (channelType, expected) => {
    expect(makeChannelType(makeCategory({ channel_type: channelType }))).toBe(expected)
  })

  it.each<RemoteChannelType>([2, 5, 6, 9, 10, 11, 20])(
    'returns Unknown for unmapped channel_type %i',
    (channelType) => {
      expect(makeChannelType(makeCategory({ channel_type: channelType }))).toBe('Unknown')
    },
  )

  it('does not depend on visibility for non-Email channel types', () => {
    const visibilities: RemoteCategoryVisibility[] = [0, 1, 2]
    for (const visibility of visibilities) {
      expect(makeChannelType(makeCategory({ channel_type: 3, visibility }))).toBe('FacebookPage')
    }
  })
})
