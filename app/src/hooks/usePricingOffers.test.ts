import { beforeEach, describe, expect, it, vi } from 'vitest'
/**
 * @vitest-environment jsdom
 */
import { waitFor } from '@testing-library/react'

import { renderHookWithProviders } from '@/tests/test-utils'
import { SubscriptionPlan } from '@/types/credits'
import { usePricingOffers } from './usePricingOffers'

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}))

const mockStarterOffer = {
  id: 'starter',
  currency: 'USD',
  marketId: 'en-US',
  term: { count: 1, unit: 'YEAR' },
  price: {
    formatted: {
      listing: {
        perMonth: {
          full: '$12.99',
          discounted: '$9.99',
          renewal: '$12.99',
          renewalDiscounted: null,
        },
        perTerm: {
          renewal: '$155.88',
        },
      },
    },
  },
  discountPercentage: 23,
}

const mockProfessionalOffer = {
  id: 'professional',
  currency: 'USD',
  marketId: 'en-US',
  term: { count: 1, unit: 'YEAR' },
  price: {
    formatted: {
      listing: {
        perMonth: {
          full: '$29.99',
          discounted: '$24.99',
          renewal: '$29.99',
          renewalDiscounted: null,
        },
        perTerm: {
          renewal: '$359.88',
        },
      },
    },
  },
  discountPercentage: 17,
}

const mockUltimateOffer = {
  id: 'ultimate',
  currency: 'USD',
  marketId: 'en-US',
  term: { count: 1, unit: 'YEAR' },
  price: {
    formatted: {
      listing: {
        perMonth: {
          full: '$119.99',
          discounted: '$99.99',
          renewal: '$119.99',
          renewalDiscounted: null,
        },
        perTerm: {
          renewal: '$1439.88',
        },
      },
    },
  },
  discountPercentage: 17,
}

describe('usePricingOffers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('successful fetch', () => {
    it('should fetch and return pricing data for all plans', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                airoYearlyMonthly: {
                  offers: [mockStarterOffer, mockProfessionalOffer, mockUltimateOffer],
                },
              },
            }),
        } as Response)
      )

      const { result } = renderHookWithProviders(() => usePricingOffers())

      expect(result.current.isLoading).toBe(true)

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.data).toEqual({
        [SubscriptionPlan.Starter]: mockStarterOffer,
        [SubscriptionPlan.Professional]: mockProfessionalOffer,
        [SubscriptionPlan.Ultimate]: mockUltimateOffer,
      })
      expect(result.current.isError).toBe(false)
      expect(result.current.error).toBeNull()
    })

    it('should return null for missing plans', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                airoYearlyMonthly: {
                  offers: [mockStarterOffer], // Only starter
                },
              },
            }),
        } as Response)
      )

      const { result } = renderHookWithProviders(() => usePricingOffers())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.data).toEqual({
        [SubscriptionPlan.Starter]: mockStarterOffer,
        [SubscriptionPlan.Professional]: null,
        [SubscriptionPlan.Ultimate]: null,
      })
    })

    it('should handle empty offers array', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                airoYearlyMonthly: {
                  offers: [],
                },
              },
            }),
        } as Response)
      )

      const { result } = renderHookWithProviders(() => usePricingOffers())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.data).toEqual({
        [SubscriptionPlan.Starter]: null,
        [SubscriptionPlan.Professional]: null,
        [SubscriptionPlan.Ultimate]: null,
      })
    })
  })

  describe('error handling', () => {
    it('should handle HTTP error', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        } as Response)
      )

      const { result } = renderHookWithProviders(() => usePricingOffers())

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error?.message).toContain('500')
      expect(result.current.data).toBeNull()
    })

    it('should handle API error response', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: false,
              error: 'API Error',
              message: 'Something went wrong',
            }),
        } as Response)
      )

      const { result } = renderHookWithProviders(() => usePricingOffers())

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error?.message).toBe('API Error')
      expect(result.current.data).toBeNull()
    })
  })

  describe('options', () => {
    it('should not fetch when enabled is false', async () => {
      global.fetch = vi.fn()

      const { result } = renderHookWithProviders(() => usePricingOffers({ enabled: false }))

      // Wait a tick to ensure hook has settled
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(global.fetch).not.toHaveBeenCalled()
      expect(result.current.isLoading).toBe(false)
      expect(result.current.data).toBeNull()
    })
  })
})
