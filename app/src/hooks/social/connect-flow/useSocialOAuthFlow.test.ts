import { describe, expect, it } from 'vitest'

import type { FacebookPage, GoogleLocation } from '@/lib/social'
import { SocialPlatform } from '@/types/social'
import { getPlatformPages } from './useSocialOAuthFlow'

describe('useSocialOAuthFlow helpers', () => {
  describe('getPlatformPages', () => {
    const mockFacebookPages: FacebookPage[] = [
      { id: '1', name: 'FB Page 1' },
      { id: '2', name: 'FB Page 2', instagram_business_account: { id: 'ig1', username: 'test' } }
    ]

    const mockGoogleLocations: GoogleLocation[] = [
      { id: 'g1', accountId: 'acc-g1', name: 'locations/123', title: 'Location 1' },
      { id: 'g2', accountId: 'acc-g2', name: 'locations/456', title: 'Location 2' }
    ]

    it('should return filtered Instagram pages for Instagram platform', () => {
      const result = getPlatformPages(
        SocialPlatform.INSTAGRAM,
        SocialPlatform.FACEBOOK,
        mockFacebookPages,
        mockGoogleLocations
      )

      expect(result).toHaveLength(1)
      expect((result as FacebookPage[])[0].id).toBe('2')
    })

    it('should return all Facebook pages for Facebook platform', () => {
      const result = getPlatformPages(
        SocialPlatform.FACEBOOK,
        SocialPlatform.FACEBOOK,
        mockFacebookPages,
        mockGoogleLocations
      )

      expect(result).toHaveLength(2)
      expect(result).toBe(mockFacebookPages)
    })

    it('should return Google locations for Google platform', () => {
      const result = getPlatformPages(
        SocialPlatform.GOOGLE,
        SocialPlatform.GOOGLE,
        mockFacebookPages,
        mockGoogleLocations
      )

      expect(result).toBe(mockGoogleLocations)
    })

    it('should return empty array for unknown provider', () => {
      const result = getPlatformPages(
        SocialPlatform.TIKTOK,
        'unknown',
        mockFacebookPages,
        mockGoogleLocations
      )

      expect(result).toEqual([])
    })

    it('should filter Instagram pages correctly', () => {
      const pagesWithIg: FacebookPage[] = [
        { id: '1', name: 'Page with IG', instagram_business_account: { id: 'ig123', username: 'test' } },
        { id: '2', name: 'Page without IG' },
        { id: '3', name: 'Page with empty IG', instagram_business_account: {} as any },
      ]

      const result = getPlatformPages(
        SocialPlatform.INSTAGRAM,
        SocialPlatform.FACEBOOK,
        pagesWithIg,
        []
      )

      expect(result).toHaveLength(1)
      expect((result as FacebookPage[])[0].id).toBe('1')
    })

    it('should filter out Instagram pages with empty string IDs', () => {
      const pagesWithEmptyId: FacebookPage[] = [
        { id: '1', name: 'Valid IG page', instagram_business_account: { id: 'ig123', username: 'valid' } },
        { id: '2', name: 'Empty string ID', instagram_business_account: { id: '', username: 'invalid' } },
        { id: '3', name: 'Whitespace ID', instagram_business_account: { id: '  ', username: 'invalid2' } },
        { id: '4', name: 'No IG account' }
      ]

      const result = getPlatformPages(
        SocialPlatform.INSTAGRAM,
        SocialPlatform.FACEBOOK,
        pagesWithEmptyId,
        []
      )

      expect(result).toHaveLength(1)
      expect((result as FacebookPage[])[0].id).toBe('1')
      expect((result as FacebookPage[])[0].name).toBe('Valid IG page')
    })
  })
})
