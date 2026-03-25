import '@testing-library/jest-dom'

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'

import { mockAuthContext, mockParams, mockRouter, mockSearchParams } from '@/tests/mocks'
import { renderWithProviders } from '@/tests/test-utils'
import { SubscriptionPlan } from '@/types/credits'
import PricingSection from './PricingSection'

const PENDING_UPGRADE_KEY = 'airo-pending-pricing-upgrade'

let mockInViewValue = false

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return {
    ...actual,
    useInView: () => mockInViewValue,
  }
})

// Mock dependencies
const mockSignIn = vi.fn()
const mockOpenUpgradeModal = vi.fn()
const mockRefetchSubscription = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter(),
  useSearchParams: () => mockSearchParams(),
  useParams: () => mockParams(),
  usePathname: () => '/',
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params?.count !== undefined) return `${key}_${params.count}`
    if (params?.price !== undefined) return `${key}_${params.price}`
    return key
  },
}))

vi.mock('react-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-intl')>()
  return {
    ...actual,
    FormattedMessage: ({ id, values }: { id: string; values?: Record<string, React.ReactNode> }) => {
      let text = id
      if (values?.count !== undefined) text = `${id}_${values.count}`
      return (
        <span data-testid={`formatted-message-${id}`}>
          {text}
          {values?.tooltip}
        </span>
      )
    },
  }
})

vi.mock('@/hooks/useSsoSignIn', () => ({
  useSsoSignIn: () => ({ signIn: mockSignIn }),
}))

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: (options?: { enabled?: boolean }) => ({
    data: options?.enabled !== false ? { id: 'sub-123', builderEntitlementId: 'ent-456' } : undefined,
    refetch: mockRefetchSubscription,
  }),
}))

const mockPricingData = {
  [SubscriptionPlan.Starter]: {
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
  },
  [SubscriptionPlan.Professional]: {
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
        },
      },
    },
  },
  [SubscriptionPlan.Ultimate]: {
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
        },
      },
    },
  },
}

vi.mock('@/hooks/usePricingOffers', () => ({
  usePricingOffers: () => ({
    data: mockPricingData,
    isLoading: false,
    isError: false,
    error: null,
  }),
}))

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: { openUpgradeModal: typeof mockOpenUpgradeModal }) => unknown) => {
    const state = { openUpgradeModal: mockOpenUpgradeModal }
    return selector(state)
  },
}))

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (id: string) => `eid-${id}`,
}))

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: ({ content }: { content: string }) => (
    <span data-testid="info-tooltip">{content}</span>
  ),
}))

vi.mock('@/components/layout/PricingSection/PlanPriceDisplay', () => ({
  default: ({ planOffer, isLoading }: { planOffer: unknown; isLoading: boolean }) => (
    <div data-testid="plan-price-display">
      {isLoading ? 'Loading...' : planOffer ? 'Price displayed' : 'No price'}
    </div>
  ),
}))

// Default to unauthenticated state
let authContextOverrides = { isAuthenticated: false, isAuthDisabled: false, isLoading: false }

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext(authContextOverrides),
}))

describe('PricingSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInViewValue = false
    sessionStorage.clear()
    authContextOverrides = { isAuthenticated: false, isAuthDisabled: false, isLoading: false }

    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    window.scrollTo = vi.fn()
  })

  afterEach(() => {
    mockInViewValue = false
  })

  describe('onPricingViewEnd', () => {
    it('should call onPricingViewEnd once when section leaves view after being visible', async () => {
      const onPricingViewEnd = vi.fn()
      mockInViewValue = true
      const { rerender } = renderWithProviders(<PricingSection onPricingViewEnd={onPricingViewEnd} />)

      mockInViewValue = false
      rerender(<PricingSection onPricingViewEnd={onPricingViewEnd} />)

      expect(onPricingViewEnd).toHaveBeenCalledTimes(1)
      expect(onPricingViewEnd).toHaveBeenCalledWith({ viewDurationMs: expect.any(Number) })
    })
  })

  describe('2-tier layout (default)', () => {
    it('should render the pricing section with Free and Starter plans', async () => {
      renderWithProviders(<PricingSection />)

      expect(screen.getByText('builder_pricing_free_title')).toBeInTheDocument()
      expect(screen.getByText('builder_pricing_starter_title')).toBeInTheDocument()
    })

    it('should render Free plan CTA button', async () => {
      renderWithProviders(<PricingSection />)

      expect(screen.getByText('builder_pricing_free_cta')).toBeInTheDocument()
    })

    it('should render Starter plan CTA button', async () => {
      renderWithProviders(<PricingSection />)

      expect(screen.getByText('builder_pricing_starter_cta')).toBeInTheDocument()
    })

    it('should disable Starter CTA when auth is loading', async () => {
      authContextOverrides = { isAuthenticated: false, isAuthDisabled: false, isLoading: true }

      renderWithProviders(<PricingSection />)

      const starterButton = screen.getByText('builder_pricing_starter_cta').closest('button')
      expect(starterButton).toBeDisabled()
    })

    it('should not show Professional and Ultimate plans', async () => {
      renderWithProviders(<PricingSection />)

      expect(screen.queryByText('builder_pricing_professional_title')).not.toBeInTheDocument()
      expect(screen.queryByText('builder_pricing_ultimate_title')).not.toBeInTheDocument()
    })
  })

  describe('4-tier layout (showHighTierPlans=true)', () => {
    it('should render all four plans', async () => {
      renderWithProviders(<PricingSection showHighTierPlans={true} />)

      expect(screen.getByText('builder_pricing_free_title')).toBeInTheDocument()
      expect(screen.getByText('builder_pricing_starter_title')).toBeInTheDocument()
      expect(screen.getByText('builder_pricing_professional_title')).toBeInTheDocument()
      expect(screen.getByText('builder_pricing_ultimate_title')).toBeInTheDocument()
    })

    it('should render Recommended badge on Professional plan', async () => {
      renderWithProviders(<PricingSection showHighTierPlans={true} />)

      expect(screen.getByText('builder_pricing_recommended')).toBeInTheDocument()
    })

    it('should render PlanPriceDisplay for each paid plan', async () => {
      renderWithProviders(<PricingSection showHighTierPlans={true} />)

      const priceDisplays = screen.getAllByTestId('plan-price-display')
      // Starter, Professional, Ultimate = 3 price displays
      expect(priceDisplays).toHaveLength(3)
    })

    it('should render features with FormattedMessage', async () => {
      renderWithProviders(<PricingSection showHighTierPlans={true} />)

      // Check for credit features using FormattedMessage (one per plan = 4 total)
      const creditFeatures = screen.getAllByTestId('formatted-message-builder_pricing_item_credits')
      expect(creditFeatures).toHaveLength(4) // Free, Starter, Professional, Ultimate
    })
  })

  describe('unauthenticated user - Starter CTA click', () => {
    beforeEach(() => {
      authContextOverrides = { isAuthenticated: false, isAuthDisabled: false, isLoading: false }
    })

    it('should save pending upgrade flag to sessionStorage', async () => {
      const { user } = renderWithProviders(<PricingSection />)

      const starterButton = screen.getByText('builder_pricing_starter_cta')
      await user.click(starterButton)

      expect(sessionStorage.getItem(PENDING_UPGRADE_KEY)).toBe('true')
    })

    it('should call signIn when unauthenticated', async () => {
      const { user } = renderWithProviders(<PricingSection />)

      const starterButton = screen.getByText('builder_pricing_starter_cta')
      await user.click(starterButton)

      expect(mockSignIn).toHaveBeenCalled()
    })

    it('should NOT call openUpgradeModal when unauthenticated', async () => {
      const { user } = renderWithProviders(<PricingSection />)

      const starterButton = screen.getByText('builder_pricing_starter_cta')
      await user.click(starterButton)

      expect(mockOpenUpgradeModal).not.toHaveBeenCalled()
    })
  })

  describe('authenticated user - Starter CTA click', () => {
    beforeEach(() => {
      authContextOverrides = { isAuthenticated: true, isAuthDisabled: false, isLoading: false }
    })

    it('should call openUpgradeModal directly', async () => {
      const { user } = renderWithProviders(<PricingSection />)

      const starterButton = screen.getByText('builder_pricing_starter_cta')
      await user.click(starterButton)

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('pricing_section.upgrade', 'slp_airo_ai_builder')
    })

    it('should NOT save pending upgrade flag to sessionStorage', async () => {
      const { user } = renderWithProviders(<PricingSection />)

      const starterButton = screen.getByText('builder_pricing_starter_cta')
      await user.click(starterButton)

      expect(sessionStorage.getItem(PENDING_UPGRADE_KEY)).toBeNull()
    })

    it('should NOT call signIn when authenticated', async () => {
      const { user } = renderWithProviders(<PricingSection />)

      const starterButton = screen.getByText('builder_pricing_starter_cta')
      await user.click(starterButton)

      expect(mockSignIn).not.toHaveBeenCalled()
    })
  })

  describe('auth disabled - Starter CTA click', () => {
    beforeEach(() => {
      authContextOverrides = { isAuthenticated: false, isAuthDisabled: true, isLoading: false }
    })

    it('should call openUpgradeModal directly when auth is disabled', async () => {
      const { user } = renderWithProviders(<PricingSection />)

      const starterButton = screen.getByText('builder_pricing_starter_cta')
      await user.click(starterButton)

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('pricing_section.upgrade', 'slp_airo_ai_builder')
    })

    it('should NOT call signIn when auth is disabled', async () => {
      const { user } = renderWithProviders(<PricingSection />)

      const starterButton = screen.getByText('builder_pricing_starter_cta')
      await user.click(starterButton)

      expect(mockSignIn).not.toHaveBeenCalled()
    })
  })

  describe('pending upgrade restoration after login', () => {
    it('should open upgrade modal when authenticated with pending flag', async () => {
      // Set pending flag before render
      sessionStorage.setItem(PENDING_UPGRADE_KEY, 'true')
      authContextOverrides = { isAuthenticated: true, isAuthDisabled: false, isLoading: false }

      renderWithProviders(<PricingSection />)

      await waitFor(() => {
        expect(mockOpenUpgradeModal).toHaveBeenCalledWith('pricing_section.upgrade', 'slp_airo_ai_builder')
      })
    })

    it('should clear sessionStorage flag after restoration', async () => {
      sessionStorage.setItem(PENDING_UPGRADE_KEY, 'true')
      authContextOverrides = { isAuthenticated: true, isAuthDisabled: false, isLoading: false }

      renderWithProviders(<PricingSection />)

      await waitFor(() => {
        expect(sessionStorage.getItem(PENDING_UPGRADE_KEY)).toBeNull()
      })
    })

    it('should call refetchSubscription after login', async () => {
      sessionStorage.setItem(PENDING_UPGRADE_KEY, 'true')
      authContextOverrides = { isAuthenticated: true, isAuthDisabled: false, isLoading: false }

      renderWithProviders(<PricingSection />)

      await waitFor(() => {
        expect(mockRefetchSubscription).toHaveBeenCalled()
      })
    })

    it('should scroll to pricing section after login', async () => {
      sessionStorage.setItem(PENDING_UPGRADE_KEY, 'true')
      authContextOverrides = { isAuthenticated: true, isAuthDisabled: false, isLoading: false }

      renderWithProviders(<PricingSection />)

      await waitFor(() => {
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
          behavior: 'smooth',
          block: 'center',
        })
      })
    })

    it('should NOT open modal when no pending flag exists', async () => {
      authContextOverrides = { isAuthenticated: true, isAuthDisabled: false, isLoading: false }

      renderWithProviders(<PricingSection />)

      // Wait a bit to ensure effect has run
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })

      expect(mockOpenUpgradeModal).not.toHaveBeenCalled()
    })

    it('should NOT process pending flag while auth is loading', async () => {
      sessionStorage.setItem(PENDING_UPGRADE_KEY, 'true')
      authContextOverrides = { isAuthenticated: false, isAuthDisabled: false, isLoading: true }

      renderWithProviders(<PricingSection />)

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })

      // Flag should still be in storage since we didn't process it
      expect(sessionStorage.getItem(PENDING_UPGRADE_KEY)).toBe('true')
      expect(mockOpenUpgradeModal).not.toHaveBeenCalled()
    })
  })

  describe('Free plan CTA click', () => {
    it('should scroll to top of page', async () => {
      const { user } = renderWithProviders(<PricingSection />)

      const freeButton = screen.getByText('builder_pricing_free_cta')
      await user.click(freeButton)

      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    })
  })

  describe('4-tier layout CTA clicks', () => {
    beforeEach(() => {
      authContextOverrides = { isAuthenticated: true, isAuthDisabled: false, isLoading: false }
    })

    it('should disable Professional CTA when auth is loading', async () => {
      authContextOverrides = { isAuthenticated: false, isAuthDisabled: false, isLoading: true }

      renderWithProviders(<PricingSection showHighTierPlans={true} />)

      const professionalCard = screen.getByText('builder_pricing_professional_title').closest('div')
      const ctaButton = professionalCard?.querySelector('button')

      expect(ctaButton).toBeDisabled()
    })

    it('should disable Ultimate CTA when auth is loading', async () => {
      authContextOverrides = { isAuthenticated: false, isAuthDisabled: false, isLoading: true }

      renderWithProviders(<PricingSection showHighTierPlans={true} />)

      const ultimateCard = screen.getByText('builder_pricing_ultimate_title').closest('div')
      const ctaButton = ultimateCard?.querySelector('button')

      expect(ctaButton).toBeDisabled()
    })

    it('should call openUpgradeModal when clicking Professional CTA', async () => {
      const { user } = renderWithProviders(<PricingSection showHighTierPlans={true} />)

      // Professional and Ultimate both use 'builder_pricing_free_cta' as their button text
      // We need to find the one in the Professional card
      const professionalCard = screen.getByText('builder_pricing_professional_title').closest('div')
      const ctaButton = professionalCard?.querySelector('button')

      expect(ctaButton).not.toBeNull()
      await user.click(ctaButton!)
      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('pricing_section.upgrade', 'slp_airo_ai_builder')
    })

    it('should call openUpgradeModal when clicking Ultimate CTA', async () => {
      const { user } = renderWithProviders(<PricingSection showHighTierPlans={true} />)

      const ultimateCard = screen.getByText('builder_pricing_ultimate_title').closest('div')
      const ctaButton = ultimateCard?.querySelector('button')

      expect(ctaButton).not.toBeNull()
      await user.click(ctaButton!)
      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('pricing_section.upgrade', 'slp_airo_ai_builder')
    })
  })
})
