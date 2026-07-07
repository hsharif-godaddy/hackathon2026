import { describe, expect, it } from 'vitest'

import type {
  EnrichedFacebookConnection,
  FacebookConnection,
  GoogleConnection,
  InstagramConnection,
  TikTokConnection,
  YelpConnection
} from '@/types/social'
import { SocialPlatformKey } from '@/types/social'
import { dedupeConnectionsByEntity, getConnectionEntityKey } from './social-connection-dedup'

function facebook(socialId: string, pageId: string, extra: Partial<EnrichedFacebookConnection> = {}): EnrichedFacebookConnection {
  return { socialId, platform: SocialPlatformKey.FACEBOOK, pageId, userId: 'u1', ...extra }
}

function instagram(socialId: string, igAccountId: string): InstagramConnection {
  return { socialId, platform: SocialPlatformKey.INSTAGRAM, igAccountId, facebookPageId: 'p1', userId: 'u1' }
}

function google(socialId: string, locationId: string): GoogleConnection {
  return { socialId, platform: SocialPlatformKey.GOOGLE_BUSINESS_PROFILE, locationId, userId: 'u1' }
}

function yelp(socialId: string, businessId: string): YelpConnection {
  return { socialId, platform: SocialPlatformKey.YELP, businessId }
}

function tiktok(socialId: string, shopId: string): TikTokConnection {
  return { socialId, platform: SocialPlatformKey.TIKTOK, shopId, shopCipher: 'c1', shopCode: 'code1', region: 'US' }
}

describe('social-connection-dedup', () => {
  describe('getConnectionEntityKey', () => {
    it('keys Facebook by pageId', () => {
      expect(getConnectionEntityKey(facebook('s1', '518574171543132'))).toBe('facebook:518574171543132')
    })

    it('keys Instagram by igAccountId', () => {
      expect(getConnectionEntityKey(instagram('s1', '17841408508804175'))).toBe('instagram:17841408508804175')
    })

    it('normalizes Google Business Profile to google:locationId', () => {
      expect(getConnectionEntityKey(google('s1', '589386213002319833'))).toBe('google:589386213002319833')
    })

    it('keys Yelp by businessId', () => {
      expect(getConnectionEntityKey(yelp('s1', 'brNAV97dC3vfgJUkf_zP8w'))).toBe('yelp:brNAV97dC3vfgJUkf_zP8w')
    })

    it('keys TikTok by shopId', () => {
      expect(getConnectionEntityKey(tiktok('s1', '7495143597934511111'))).toBe('tiktok:7495143597934511111')
    })

    it('falls back to socialId when the entity id is empty', () => {
      expect(getConnectionEntityKey(facebook('s1', ''))).toBe('socialid:s1')
    })
  })

  describe('dedupeConnectionsByEntity', () => {
    it('collapses Facebook connections sharing a pageId', () => {
      const result = dedupeConnectionsByEntity([
        facebook('s1', '518574171543132'),
        facebook('s2', '518574171543132'),
        facebook('s3', '437696472767706')
      ])

      expect(result.map(c => c.socialId)).toEqual(['s1', 's3'])
    })

    it('collapses Instagram connections sharing an igAccountId', () => {
      const result = dedupeConnectionsByEntity([
        instagram('s1', '17841408508804175'),
        instagram('s2', '17841408508804175')
      ])

      expect(result).toHaveLength(1)
      expect(result[0].socialId).toBe('s1')
    })

    it('collapses Google connections sharing a locationId', () => {
      const result = dedupeConnectionsByEntity([
        google('s1', '589386213002319833'),
        google('s2', '589386213002319833'),
        google('s3', '14101342760374214548')
      ])

      expect(result.map(c => c.socialId)).toEqual(['s1', 's3'])
    })

    it('collapses Yelp connections sharing a businessId', () => {
      const result = dedupeConnectionsByEntity([
        yelp('s1', 'brNAV97dC3vfgJUkf_zP8w'),
        yelp('s2', 'brNAV97dC3vfgJUkf_zP8w')
      ])

      expect(result).toHaveLength(1)
    })

    it('collapses TikTok connections sharing a shopId', () => {
      const result = dedupeConnectionsByEntity([
        tiktok('s1', '7495143597934511111'),
        tiktok('s2', '7495143597934511111'),
        tiktok('s3', '8300000000000000000')
      ])

      expect(result.map(c => c.socialId)).toEqual(['s1', 's3'])
    })

    it('prefers a linked sibling even over a richer, earlier one', () => {
      const result = dedupeConnectionsByEntity(
        [
          facebook('s1', '518574171543132', { pageName: 'My Page', category: 'Business', pictureUrl: 'https://x' }),
          facebook('s2', '518574171543132')
        ],
        { linkedConnectionIds: new Set(['s2']) }
      )

      expect(result).toHaveLength(1)
      expect(result[0].socialId).toBe('s2')
    })

    it('prefers the first-seen linked sibling when several in the group are linked', () => {
      const result = dedupeConnectionsByEntity(
        [
          facebook('s1', '518574171543132'),
          facebook('s2', '518574171543132'),
          facebook('s3', '518574171543132', { pageName: 'Rich', category: 'Business', pictureUrl: 'https://x' })
        ],
        { linkedConnectionIds: new Set(['s2', 's3']) }
      )

      expect(result).toHaveLength(1)
      expect(result[0].socialId).toBe('s2')
    })

    it('keeps the richest record regardless of position when no sibling is linked', () => {
      const richestSecond = dedupeConnectionsByEntity([
        facebook('s1', '518574171543132'),
        facebook('s2', '518574171543132', { pageName: 'My Page', category: 'Business', pictureUrl: 'https://x' })
      ])
      expect(richestSecond.map(c => c.socialId)).toEqual(['s2'])

      const richestFirst = dedupeConnectionsByEntity([
        facebook('s1', '518574171543132', { pageName: 'My Page', category: 'Business', pictureUrl: 'https://x' }),
        facebook('s2', '518574171543132')
      ])
      expect(richestFirst.map(c => c.socialId)).toEqual(['s1'])
    })

    it('ignores token ids and always-present fields when ranking richness', () => {
      const result = dedupeConnectionsByEntity([
        facebook('s1', '518574171543132', { pageName: 'My Page' }),
        facebook('s2', '518574171543132', { pageTokenId: 't1', userTokenId: 't2' })
      ])

      expect(result.map(c => c.socialId)).toEqual(['s1'])
    })

    it('breaks ties by earliest index (stable)', () => {
      const result = dedupeConnectionsByEntity([
        facebook('s1', '518574171543132'),
        facebook('s2', '518574171543132')
      ])

      expect(result[0].socialId).toBe('s1')
    })

    it('never merges rows with a missing entity id', () => {
      const result = dedupeConnectionsByEntity([facebook('s1', ''), facebook('s2', '')])

      expect(result.map(c => c.socialId)).toEqual(['s1', 's2'])
    })

    it('leaves distinct entities across platforms untouched and preserves order', () => {
      const input: Array<FacebookConnection | InstagramConnection | GoogleConnection | YelpConnection> = [
        facebook('s1', 'p1'),
        instagram('s2', 'ig1'),
        google('s3', 'l1'),
        yelp('s4', 'b1')
      ]

      const result = dedupeConnectionsByEntity(input)

      expect(result.map(c => c.socialId)).toEqual(['s1', 's2', 's3', 's4'])
    })
  })
})
