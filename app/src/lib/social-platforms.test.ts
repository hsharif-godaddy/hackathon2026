import { describe, expect, it } from 'vitest'

import { SocialPlatform } from '@/types/social'
import { getPlatformStrategy, PLATFORM_STRATEGIES, usesSocialFlowsConnect } from './social-platforms'

describe('social-platforms', () => {
  describe('PLATFORM_STRATEGIES', () => {
    it('should have Facebook strategy with correct provider', () => {
      const strategy = PLATFORM_STRATEGIES[SocialPlatform.FACEBOOK]

      expect(strategy).toEqual({
        provider: SocialPlatform.FACEBOOK,
        requiresPageSelection: true
      })
    })

    it('should have Instagram strategy using Facebook provider', () => {
      const strategy = PLATFORM_STRATEGIES[SocialPlatform.INSTAGRAM]

      expect(strategy).toEqual({
        provider: SocialPlatform.FACEBOOK,
        requiresPageSelection: true
      })
    })

    it('should have Google strategy with correct provider', () => {
      const strategy = PLATFORM_STRATEGIES[SocialPlatform.GOOGLE]

      expect(strategy).toEqual({
        provider: SocialPlatform.GOOGLE,
        requiresPageSelection: true
      })
    })

    it('should have TikTok strategy without page selection', () => {
      const strategy = PLATFORM_STRATEGIES[SocialPlatform.TIKTOK]

      expect(strategy.provider).toBe(SocialPlatform.TIKTOK)
      expect(strategy.requiresPageSelection).toBe(false)
      expect(strategy.oauthParams).toEqual({ integration_type: 'SHOP' })
    })

    it('should have Yelp strategy without page selection', () => {
      const strategy = PLATFORM_STRATEGIES[SocialPlatform.YELP]

      expect(strategy).toEqual({
        provider: SocialPlatform.YELP,
        requiresPageSelection: false
      })
    })

    it('should have WhatsApp strategy without page selection', () => {
      const strategy = PLATFORM_STRATEGIES[SocialPlatform.WHATSAPP]

      expect(strategy).toEqual({
        provider: SocialPlatform.WHATSAPP,
        requiresPageSelection: false
      })
    })
  })

  describe('getPlatformStrategy', () => {
    it('should return strategy for lowercase platform', () => {
      const strategy = getPlatformStrategy('facebook')

      expect(strategy.provider).toBe(SocialPlatform.FACEBOOK)
      expect(strategy.requiresPageSelection).toBe(true)
    })

    it('should return strategy for uppercase platform', () => {
      const strategy = getPlatformStrategy('INSTAGRAM')

      expect(strategy.provider).toBe(SocialPlatform.FACEBOOK)
      expect(strategy.requiresPageSelection).toBe(true)
    })

    it('should return strategy for mixed case platform', () => {
      const strategy = getPlatformStrategy('Google')

      expect(strategy.provider).toBe(SocialPlatform.GOOGLE)
      expect(strategy.requiresPageSelection).toBe(true)
    })

    it('should return default strategy for unknown platform', () => {
      const strategy = getPlatformStrategy('unknown-platform')

      expect(strategy.provider).toBe('unknown')
      expect(strategy.requiresPageSelection).toBe(false)
    })

    it('should return default strategy for empty string', () => {
      const strategy = getPlatformStrategy('')

      expect(strategy.provider).toBe('unknown')
      expect(strategy.requiresPageSelection).toBe(false)
    })
  })

  describe('provider field consistency', () => {
    it('should use same provider for auth, validation, and pages', () => {
      Object.values(PLATFORM_STRATEGIES).forEach(strategy => {
        // Provider should be a lowercase string
        expect(typeof strategy.provider).toBe('string')
        expect(strategy.provider).toBe(strategy.provider.toLowerCase())

        // Provider is used for all three purposes:
        // 1. Auth endpoint: /platforms/${provider}/authorization_url
        // 2. Validation: /platforms/${provider}/tokens/${tokenId}
        // 3. Pages type: derived from provider + requiresPageSelection
      })
    })

    it('should derive pages type correctly from provider and requiresPageSelection', () => {
      // Facebook and Instagram should fetch Facebook pages
      expect(PLATFORM_STRATEGIES[SocialPlatform.FACEBOOK].provider).toBe(SocialPlatform.FACEBOOK)
      expect(PLATFORM_STRATEGIES[SocialPlatform.FACEBOOK].requiresPageSelection).toBe(true)

      expect(PLATFORM_STRATEGIES[SocialPlatform.INSTAGRAM].provider).toBe(SocialPlatform.FACEBOOK)
      expect(PLATFORM_STRATEGIES[SocialPlatform.INSTAGRAM].requiresPageSelection).toBe(true)

      // Google should fetch Google locations
      expect(PLATFORM_STRATEGIES[SocialPlatform.GOOGLE].provider).toBe(SocialPlatform.GOOGLE)
      expect(PLATFORM_STRATEGIES[SocialPlatform.GOOGLE].requiresPageSelection).toBe(true)

      // TikTok/Yelp/WhatsApp should not require page selection
      expect(PLATFORM_STRATEGIES[SocialPlatform.TIKTOK].requiresPageSelection).toBe(false)
      expect(PLATFORM_STRATEGIES[SocialPlatform.YELP].requiresPageSelection).toBe(false)
      expect(PLATFORM_STRATEGIES[SocialPlatform.WHATSAPP].requiresPageSelection).toBe(false)
    })

    it('should have Instagram use Facebook as OAuth provider', () => {
      // This is the key behavior - Instagram uses Facebook OAuth
      const fbStrategy = PLATFORM_STRATEGIES[SocialPlatform.FACEBOOK]
      const igStrategy = PLATFORM_STRATEGIES[SocialPlatform.INSTAGRAM]

      expect(igStrategy.provider).toBe(fbStrategy.provider)
      expect(igStrategy.provider).toBe(SocialPlatform.FACEBOOK)
    })
  })

  describe('OAuth params', () => {
    it('should include OAuth params for TikTok', () => {
      const strategy = PLATFORM_STRATEGIES[SocialPlatform.TIKTOK]

      expect(strategy.oauthParams).toBeDefined()
      expect(strategy.oauthParams).toEqual({ integration_type: 'SHOP' })
    })

    it('should not have OAuth params for other platforms', () => {
      expect(PLATFORM_STRATEGIES[SocialPlatform.FACEBOOK].oauthParams).toBeUndefined()
      expect(PLATFORM_STRATEGIES[SocialPlatform.INSTAGRAM].oauthParams).toBeUndefined()
      expect(PLATFORM_STRATEGIES[SocialPlatform.GOOGLE].oauthParams).toBeUndefined()
      expect(PLATFORM_STRATEGIES[SocialPlatform.YELP].oauthParams).toBeUndefined()
      expect(PLATFORM_STRATEGIES[SocialPlatform.WHATSAPP].oauthParams).toBeUndefined()
    })
  })

  describe('usesSocialFlowsConnect', () => {
    it('returns true for Facebook, Instagram, and Google', () => {
      expect(usesSocialFlowsConnect('facebook')).toBe(true)
      expect(usesSocialFlowsConnect('INSTAGRAM')).toBe(true)
      expect(usesSocialFlowsConnect('GOOGLE_BUSINESS_PROFILE')).toBe(true)
    })

    it('returns false for other platforms', () => {
      expect(usesSocialFlowsConnect('tiktok')).toBe(false)
      expect(usesSocialFlowsConnect('yelp')).toBe(false)
    })
  })
})
