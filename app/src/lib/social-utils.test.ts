import { describe, expect, it } from 'vitest'

import type { FacebookPage, GoogleLocation } from '@/lib/social'
import type { EnrichedSocialConnection } from '@/types/social'
import { getSocialConnectionDisplayInfo } from './social-utils'

describe('getSocialConnectionDisplayInfo', () => {
  describe('EnrichedSocialConnection (settings page)', () => {
    it('returns Facebook page name and category', () => {
      const connection = {
        socialId: 'fb-123',
        pageName: 'My Business Page',
        category: 'Restaurant',
        pictureUrl: 'https://example.com/pic.jpg'
      } as EnrichedSocialConnection

      const result = getSocialConnectionDisplayInfo(connection)

      expect(result).toEqual({
        name: 'My Business Page',
        subtitle: 'Restaurant',
        pictureUrl: 'https://example.com/pic.jpg'
      })
    })

    it('returns Instagram username as subtitle when available', () => {
      const connection = {
        socialId: 'ig-123',
        pageName: 'My Instagram',
        username: 'myinsta',
        pictureUrl: 'https://example.com/ig.jpg'
      } as EnrichedSocialConnection

      const result = getSocialConnectionDisplayInfo(connection)

      expect(result).toEqual({
        name: 'My Instagram',
        subtitle: '@myinsta',
        pictureUrl: 'https://example.com/ig.jpg'
      })
    })

    it('returns Google location name and address', () => {
      const connection = {
        socialId: 'google-123',
        locationName: 'My Store',
        address: '123 Main St'
      } as EnrichedSocialConnection

      const result = getSocialConnectionDisplayInfo(connection)

      expect(result).toEqual({
        name: 'My Store',
        subtitle: '123 Main St',
        pictureUrl: undefined
      })
    })

    it('falls back through name fields', () => {
      const connection = {
        socialId: 'shop-123',
        shopName: 'My TikTok Shop'
      } as EnrichedSocialConnection

      const result = getSocialConnectionDisplayInfo(connection)

      expect(result.name).toBe('My TikTok Shop')
    })
  })

  describe('FacebookPage (OAuth flow)', () => {
    it('returns page name and category', () => {
      const page: FacebookPage = {
        id: 'page-123',
        name: 'My FB Page',
        category: 'Local Business',
        picture: { data: { url: 'https://example.com/fb.jpg' } }
      }

      const result = getSocialConnectionDisplayInfo(page)

      expect(result).toEqual({
        name: 'My FB Page',
        subtitle: 'Local Business',
        pictureUrl: 'https://example.com/fb.jpg'
      })
    })

    it('returns Instagram account info when isInstagramFlow is true', () => {
      const page: FacebookPage = {
        id: 'page-123',
        name: 'FB Page Name',
        category: 'Business',
        instagram_business_account: {
          id: 'ig-456',
          name: 'My Instagram Account',
          username: 'myinstahandle',
          profile_picture_url: 'https://example.com/ig-profile.jpg'
        }
      }

      const result = getSocialConnectionDisplayInfo(page, { isInstagramFlow: true })

      expect(result).toEqual({
        name: 'My Instagram Account',
        subtitle: '@myinstahandle',
        pictureUrl: 'https://example.com/ig-profile.jpg'
      })
    })

    it('falls back to FB page name when IG account has no name', () => {
      const page: FacebookPage = {
        id: 'page-123',
        name: 'FB Page Name',
        category: 'Business',
        instagram_business_account: {
          id: 'ig-456'
        }
      }

      const result = getSocialConnectionDisplayInfo(page, { isInstagramFlow: true })

      expect(result.name).toBe('FB Page Name')
    })

    it('returns FB page info when isInstagramFlow is false', () => {
      const page: FacebookPage = {
        id: 'page-123',
        name: 'FB Page Name',
        category: 'Business',
        instagram_business_account: {
          id: 'ig-456',
          name: 'My Instagram'
        }
      }

      const result = getSocialConnectionDisplayInfo(page, { isInstagramFlow: false })

      expect(result.name).toBe('FB Page Name')
      expect(result.subtitle).toBe('Business')
    })
  })

  describe('GoogleLocation (OAuth flow)', () => {
    it('returns location title and formatted address', () => {
      const location: GoogleLocation = {
        id: 'loc-123',
        accountId: 'acc-123',
        name: 'locations/123',
        title: 'My Business Location',
        storefrontAddress: {
          addressLines: ['123 Main St'],
          locality: 'San Francisco',
          administrativeArea: 'CA',
          postalCode: '94102'
        }
      }

      const result = getSocialConnectionDisplayInfo(location)

      expect(result).toEqual({
        name: 'My Business Location',
        subtitle: '123 Main St, San Francisco, CA, 94102',
        pictureUrl: undefined
      })
    })

    it('handles missing address parts', () => {
      const location: GoogleLocation = {
        id: 'loc-123',
        accountId: 'acc-123',
        name: 'locations/123',
        title: 'My Location',
        storefrontAddress: {
          locality: 'San Francisco'
        }
      }

      const result = getSocialConnectionDisplayInfo(location)

      expect(result.subtitle).toBe('San Francisco')
    })
  })
})
