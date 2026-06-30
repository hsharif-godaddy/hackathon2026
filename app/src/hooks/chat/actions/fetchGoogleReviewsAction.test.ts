/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchGoogleReviewsAction } from './fetchGoogleReviewsAction'
import type { ClientActionContext } from './types'

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const mockGetConnectionById = vi.fn()
const mockGetGoogleLocations = vi.fn()
const mockGetGoogleReviews = vi.fn()

vi.mock('@/lib/social', () => ({
  socialV2Client: {
    getConnectionById: (...args: unknown[]) => mockGetConnectionById(...args),
    getGoogleLocations: (...args: unknown[]) => mockGetGoogleLocations(...args),
    getGoogleReviews: (...args: unknown[]) => mockGetGoogleReviews(...args),
  },
}))

const mockIsGoogleConnection = vi.fn()

vi.mock('@/lib/utils/social-type-guards', () => ({
  isGoogleConnection: (...args: unknown[]) => mockIsGoogleConnection(...args),
}))

describe('fetchGoogleReviewsAction', () => {
  const mockContext = {} as ClientActionContext

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parameter validation', () => {
    it('throws if socialId is missing', async () => {
      await expect(fetchGoogleReviewsAction({}, mockContext)).rejects.toThrow(
        'socialId is required and must be a string'
      )
    })

    it('throws if socialId is not a string', async () => {
      await expect(fetchGoogleReviewsAction({ socialId: 123 }, mockContext)).rejects.toThrow(
        'socialId is required and must be a string'
      )
    })
  })

  describe('connection validation', () => {
    it('throws if connection is not a Google connection', async () => {
      mockGetConnectionById.mockResolvedValue({ platform: 'FACEBOOK' })
      mockIsGoogleConnection.mockReturnValue(false)

      await expect(
        fetchGoogleReviewsAction({ socialId: 'social-1' }, mockContext)
      ).rejects.toThrow('Expected GOOGLE_BUSINESS_PROFILE connection, got FACEBOOK')
    })

    it('throws if userTokenId is missing', async () => {
      mockGetConnectionById.mockResolvedValue({
        platform: 'GOOGLE_BUSINESS_PROFILE',
        userTokenId: null,
        locationId: 'loc-1',
        accountId: 'acc-1',
      })
      mockIsGoogleConnection.mockReturnValue(true)

      await expect(
        fetchGoogleReviewsAction({ socialId: 'social-1' }, mockContext)
      ).rejects.toThrow('No user token found for this Google connection')
    })

    it('throws if locationId is missing', async () => {
      mockGetConnectionById.mockResolvedValue({
        platform: 'GOOGLE_BUSINESS_PROFILE',
        userTokenId: 'token-1',
        locationId: null,
        accountId: 'acc-1',
      })
      mockIsGoogleConnection.mockReturnValue(true)

      await expect(
        fetchGoogleReviewsAction({ socialId: 'social-1' }, mockContext)
      ).rejects.toThrow('Google Business Profile connection is missing a location')
    })
  })

  describe('accountId resolution', () => {
    it('looks up accountId from locations if not present on connection', async () => {
      mockGetConnectionById.mockResolvedValue({
        platform: 'GOOGLE_BUSINESS_PROFILE',
        userTokenId: 'token-1',
        locationId: 'loc-1',
        accountId: null,
      })
      mockIsGoogleConnection.mockReturnValue(true)
      mockGetGoogleLocations.mockResolvedValue([
        { id: 'loc-1', accountId: 'resolved-acc' },
        { id: 'loc-2', accountId: 'other-acc' },
      ])
      mockGetGoogleReviews.mockResolvedValue([])

      await fetchGoogleReviewsAction({ socialId: 'social-1' }, mockContext)

      expect(mockGetGoogleLocations).toHaveBeenCalledWith('token-1')
      expect(mockGetGoogleReviews).toHaveBeenCalledWith('token-1', 'resolved-acc', 'loc-1')
    })

    it('throws if accountId cannot be resolved from locations', async () => {
      mockGetConnectionById.mockResolvedValue({
        platform: 'GOOGLE_BUSINESS_PROFILE',
        userTokenId: 'token-1',
        locationId: 'loc-unknown',
        accountId: null,
      })
      mockIsGoogleConnection.mockReturnValue(true)
      mockGetGoogleLocations.mockResolvedValue([
        { id: 'loc-1', accountId: 'acc-1' },
      ])

      await expect(
        fetchGoogleReviewsAction({ socialId: 'social-1' }, mockContext)
      ).rejects.toThrow('Google Business Profile connection is missing account info')
    })
  })

  describe('rating arithmetic', () => {
    it('computes average rating from star ratings', async () => {
      mockGetConnectionById.mockResolvedValue({
        platform: 'GOOGLE_BUSINESS_PROFILE',
        userTokenId: 'token-1',
        locationId: 'loc-1',
        accountId: 'acc-1',
      })
      mockIsGoogleConnection.mockReturnValue(true)
      mockGetGoogleReviews.mockResolvedValue([
        { starRating: 'FIVE', reviewer: { displayName: 'A' }, comment: 'Great' },
        { starRating: 'THREE', reviewer: { displayName: 'B' }, comment: 'Ok' },
        { starRating: 'FOUR', reviewer: { displayName: 'C' }, comment: 'Good' },
      ])

      const result = await fetchGoogleReviewsAction({ socialId: 'social-1' }, mockContext) as {
        reviews: unknown[]
        averageRating: number
        totalReviewCount: number
      }

      expect(result.averageRating).toBe(4)
      expect(result.totalReviewCount).toBe(3)
    })

    it('returns undefined averageRating for empty reviews', async () => {
      mockGetConnectionById.mockResolvedValue({
        platform: 'GOOGLE_BUSINESS_PROFILE',
        userTokenId: 'token-1',
        locationId: 'loc-1',
        accountId: 'acc-1',
      })
      mockIsGoogleConnection.mockReturnValue(true)
      mockGetGoogleReviews.mockResolvedValue([])

      const result = await fetchGoogleReviewsAction({ socialId: 'social-1' }, mockContext) as {
        reviews: unknown[]
        averageRating: undefined
        totalReviewCount: number
      }

      expect(result.averageRating).toBeUndefined()
      expect(result.totalReviewCount).toBe(0)
    })

    it('treats unknown star ratings as 0', async () => {
      mockGetConnectionById.mockResolvedValue({
        platform: 'GOOGLE_BUSINESS_PROFILE',
        userTokenId: 'token-1',
        locationId: 'loc-1',
        accountId: 'acc-1',
      })
      mockIsGoogleConnection.mockReturnValue(true)
      mockGetGoogleReviews.mockResolvedValue([
        { starRating: 'FIVE', reviewer: { displayName: 'A' }, comment: 'Great' },
        { starRating: 'UNKNOWN_RATING' as any, reviewer: { displayName: 'B' }, comment: '?' },
      ])

      const result = await fetchGoogleReviewsAction({ socialId: 'social-1' }, mockContext) as {
        reviews: unknown[]
        averageRating: number
        totalReviewCount: number
      }

      expect(result.averageRating).toBe(2.5)
      expect(result.totalReviewCount).toBe(2)
    })
  })
})
