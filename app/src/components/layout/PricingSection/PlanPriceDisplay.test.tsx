import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { type PlanOffer } from '@/types/credits'
import PlanPriceDisplay from './PlanPriceDisplay'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params?.price !== undefined) return `${key}_${params.price}`
    return key
  },
}))

const mockPlanOffer: PlanOffer = {
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
      },
    },
  },
}

describe('PlanPriceDisplay', () => {
  describe('loading state', () => {
    it('should render loading skeletons when isLoading is true', () => {
      const { container } = renderWithProviders(
        <PlanPriceDisplay planOffer={null} isLoading={true} />
      )

      // Check for skeleton elements
      const skeletons = container.querySelectorAll('[class*="skeleton"]')
      expect(skeletons.length).toBeGreaterThan(0)
    })

    it('should not render price content when loading', () => {
      renderWithProviders(<PlanPriceDisplay planOffer={mockPlanOffer} isLoading={true} />)

      expect(screen.queryByText(/builder_pricing_per_month/)).not.toBeInTheDocument()
    })
  })

  describe('with plan offer data', () => {
    it('should render the discounted price', () => {
      renderWithProviders(<PlanPriceDisplay planOffer={mockPlanOffer} isLoading={false} />)

      expect(screen.getByText('builder_pricing_per_month_$9.99')).toBeInTheDocument()
    })

    it('should render the pay today text', () => {
      renderWithProviders(<PlanPriceDisplay planOffer={mockPlanOffer} isLoading={false} />)

      expect(screen.getByText('builder_pricing_pay_today')).toBeInTheDocument()
    })
  })

  describe('without plan offer data', () => {
    it('should render nothing when planOffer is null', () => {
      const { container } = renderWithProviders(
        <PlanPriceDisplay planOffer={null} isLoading={false} />
      )

      expect(container.firstChild).toBeNull()
    })

    it('should render nothing when discounted price is missing', () => {
      const offerWithoutDiscount: PlanOffer = {
        ...mockPlanOffer,
        price: {
          formatted: {
            listing: {
              perMonth: {
                full: '$12.99',
                discounted: '',
                renewal: '$12.99',
                renewalDiscounted: null,
              },
            },
          },
        },
      }

      const { container } = renderWithProviders(
        <PlanPriceDisplay planOffer={offerWithoutDiscount} isLoading={false} />
      )

      expect(container.firstChild).toBeNull()
    })
  })
})
