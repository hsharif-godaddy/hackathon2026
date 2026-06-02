/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'

import { EXPERIMENT_IDS } from '@/config/experiments'
import { useIsInCohort } from '@/hooks/useHivemind'
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
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
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

import { logImpressionEvent } from '@/utils/instrumentation'

// Default to unauthenticated state
let authContextOverrides = { isAuthenticated: false, isLoading: false }

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext(authContextOverrides),
}))

vi.mock('@/hooks/useHivemind', () => ({
  useIsInCohort: vi.fn(function () { return false; }),
}));

const mockUseIsUpgradePolling = vi.fn(function () { return false; })
vi.mock('@/hooks/useUpgradePurchase', () => ({
  useIsUpgradePolling: () => mockUseIsUpgradePolling(),
}));

vi.mock('@/app/[market]/develop/components/paywall', () => ({
  UpgradePollingModal: () => <div data-testid="upgrade-polling-modal">Updating your plan...</div>,
}));

describe('PricingSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useIsInCohort).mockReturnValue(false)
    mockUseIsUpgradePolling.mockReturnValue(false)
    mockInViewValue = false
    sessionStorage.clear()
    authContextOverrides = { isAuthenticated: false, isLoading: false }

    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    window.scrollTo = vi.fn()
  })

  afterEach(() => {
    mockInViewValue = false
  })

  describe('logImpressionEvent', () => {
    it('should call logImpressionEvent when section enters view', async () => {
      mockInViewValue = true
      const { rerender } = renderWithProviders(<PricingSection />)
      rerender(<PricingSection />)

      expect(logImpressionEvent).toHaveBeenCalledWith('homepage.pricing.view')
    })
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

  describe('4-tier layout (default)', () => {
    it('should render the pricing section with all four plans', async () => {
      renderWithProviders(<PricingSection />)

      expect(screen.getByText('builder_pricing_free_title')).toBeInTheDocument()
      expect(screen.getByText('builder_pricing_starter_title')).toBeInTheDocument()
      expect(screen.getByText('builder_pricing_professional_title')).toBeInTheDocument()
      expect(screen.getByText('builder_pricing_ultimate_title')).toBeInTheDocument()
    })

    it('should render Free plan CTA button', async () => {
      renderWithProviders(<PricingSection />)

      expect(screen.getAllByText('builder_pricing_free_cta').length).toBeGreaterThan(0)
    })

    it('should render Starter plan CTA button', async () => {
      renderWithProviders(<PricingSection />)

      expect(screen.getByText('builder_pricing_starter_cta')).toBeInTheDocument()
    })

    it('should disable Starter CTA when auth is loading', async () => {
      authContextOverrides = { isAuthenticated: false, isLoading: true }

      renderWithProviders(<PricingSection />)

      const starterButton = screen.getByText('builder_pricing_starter_cta').closest('button')
      expect(starterButton).toBeDisabled()
    })

    it('should render Recommended badge on Professional plan (control cohort)', async () => {
      vi.mocked(useIsInCohort).mockReturnValue(false)
      renderWithProviders(<PricingSection />)

      expect(useIsInCohort).toHaveBeenCalledWith(EXPERIMENT_IDS.recommendedPlan, 'treatment')
      expect(screen.getByText('builder_pricing_recommended')).toBeInTheDocument()
      const professionalCard = screen.getByText('builder_pricing_professional_title').parentElement?.parentElement
      expect(professionalCard).toBeTruthy()
      expect(within(professionalCard!).getByText('builder_pricing_recommended')).toBeInTheDocument()
      const ultimateCard = screen.getByText('builder_pricing_ultimate_title').parentElement?.parentElement
      expect(ultimateCard).toBeTruthy()
      expect(within(ultimateCard!).queryByText('builder_pricing_recommended')).not.toBeInTheDocument()
    })

    it('should render Recommended badge on Ultimate plan (treatment cohort)', async () => {
      vi.mocked(useIsInCohort).mockReturnValue(true)
      renderWithProviders(<PricingSection />)

      expect(useIsInCohort).toHaveBeenCalledWith(EXPERIMENT_IDS.recommendedPlan, 'treatment')
      expect(screen.getByText('builder_pricing_recommended')).toBeInTheDocument()
      const professionalCard = screen.getByText('builder_pricing_professional_title').parentElement?.parentElement
      expect(professionalCard).toBeTruthy()
      expect(within(professionalCard!).queryByText('builder_pricing_recommended')).not.toBeInTheDocument()
      const ultimateCard = screen.getByText('builder_pricing_ultimate_title').parentElement?.parentElement
      expect(ultimateCard).toBeTruthy()
      expect(within(ultimateCard!).getByText('builder_pricing_recommended')).toBeInTheDocument()
    })

    it('should render PlanPriceDisplay for each paid plan', async () => {
      renderWithProviders(<PricingSection />)

      const priceDisplays = screen.getAllByTestId('plan-price-display')
      // Starter, Professional, Ultimate = 3 price displays
      expect(priceDisplays).toHaveLength(3)
    })

    it('should render features with FormattedMessage', async () => {
      renderWithProviders(<PricingSection />)

      // Check for credit features using FormattedMessage (one per plan = 4 total)
      const creditFeatures = screen.getAllByTestId('formatted-message-builder_pricing_item_credits')
      expect(creditFeatures).toHaveLength(4) // Free, Starter, Professional, Ultimate
    })
  })

  describe('unauthenticated user - Starter CTA click', () => {
    beforeEach(() => {
      authContextOverrides = { isAuthenticated: false, isLoading: false }
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
      authContextOverrides = { isAuthenticated: true, isLoading: false }
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

  describe('pending upgrade restoration after login', () => {
    it('should open upgrade modal when authenticated with pending flag', async () => {
      // Set pending flag before render
      sessionStorage.setItem(PENDING_UPGRADE_KEY, 'true')
      authContextOverrides = { isAuthenticated: true, isLoading: false }

      renderWithProviders(<PricingSection />)

      await waitFor(() => {
        expect(mockOpenUpgradeModal).toHaveBeenCalledWith('pricing_section.upgrade', 'slp_airo_ai_builder')
      })
    })

    it('should clear sessionStorage flag after restoration', async () => {
      sessionStorage.setItem(PENDING_UPGRADE_KEY, 'true')
      authContextOverrides = { isAuthenticated: true, isLoading: false }

      renderWithProviders(<PricingSection />)

      await waitFor(() => {
        expect(sessionStorage.getItem(PENDING_UPGRADE_KEY)).toBeNull()
      })
    })

    it('should call refetchSubscription after login', async () => {
      sessionStorage.setItem(PENDING_UPGRADE_KEY, 'true')
      authContextOverrides = { isAuthenticated: true, isLoading: false }

      renderWithProviders(<PricingSection />)

      await waitFor(() => {
        expect(mockRefetchSubscription).toHaveBeenCalled()
      })
    })

    it('should scroll to pricing section after login', async () => {
      sessionStorage.setItem(PENDING_UPGRADE_KEY, 'true')
      authContextOverrides = { isAuthenticated: true, isLoading: false }

      renderWithProviders(<PricingSection />)

      await waitFor(() => {
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
          behavior: 'smooth',
          block: 'center',
        })
      })
    })

    it('should NOT open modal when no pending flag exists', async () => {
      authContextOverrides = { isAuthenticated: true, isLoading: false }

      renderWithProviders(<PricingSection />)

      // Wait a bit to ensure effect has run
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })

      expect(mockOpenUpgradeModal).not.toHaveBeenCalled()
    })

    it('should NOT process pending flag while auth is loading', async () => {
      sessionStorage.setItem(PENDING_UPGRADE_KEY, 'true')
      authContextOverrides = { isAuthenticated: false, isLoading: true }

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

      const freeButtons = screen.getAllByText('builder_pricing_free_cta')
      await user.click(freeButtons[0])

      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    })
  })

  describe('4-tier layout CTA clicks', () => {
    beforeEach(() => {
      authContextOverrides = { isAuthenticated: true, isLoading: false }
    })

    it('should disable Professional CTA when auth is loading', async () => {
      authContextOverrides = { isAuthenticated: false, isLoading: true }

      renderWithProviders(<PricingSection />)

      const professionalCard = screen.getByText('builder_pricing_professional_title').closest('div')
      const ctaButton = professionalCard?.querySelector('button')

      expect(ctaButton).toBeDisabled()
    })

    it('should disable Ultimate CTA when auth is loading', async () => {
      authContextOverrides = { isAuthenticated: false, isLoading: true }

      renderWithProviders(<PricingSection />)

      const ultimateCard = screen.getByText('builder_pricing_ultimate_title').closest('div')
      const ctaButton = ultimateCard?.querySelector('button')

      expect(ctaButton).toBeDisabled()
    })

    it('should call openUpgradeModal when clicking Professional CTA', async () => {
      const { user } = renderWithProviders(<PricingSection />)

      // Professional and Ultimate both use 'builder_pricing_free_cta' as their button text
      // We need to find the one in the Professional card
      const professionalCard = screen.getByText('builder_pricing_professional_title').closest('div')
      const ctaButton = professionalCard?.querySelector('button')

      expect(ctaButton).not.toBeNull()
      await user.click(ctaButton!)
      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('pricing_section.upgrade', 'slp_airo_ai_builder')
    })

    it('should call openUpgradeModal when clicking Ultimate CTA', async () => {
      const { user } = renderWithProviders(<PricingSection />)

      const ultimateCard = screen.getByText('builder_pricing_ultimate_title').closest('div')
      const ctaButton = ultimateCard?.querySelector('button')

      expect(ctaButton).not.toBeNull()
      await user.click(ctaButton!)
      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('pricing_section.upgrade', 'slp_airo_ai_builder')
    })
  })

  describe('upgrade polling modal', () => {
    it('should render UpgradePollingModal when useIsUpgradePolling returns true', () => {
      mockUseIsUpgradePolling.mockReturnValue(true)

      renderWithProviders(<PricingSection />)

      expect(screen.getByTestId('upgrade-polling-modal')).toBeInTheDocument()
    })

    it('should not render UpgradePollingModal when useIsUpgradePolling returns false', () => {
      mockUseIsUpgradePolling.mockReturnValue(false)

      renderWithProviders(<PricingSection />)

      expect(screen.queryByTestId('upgrade-polling-modal')).not.toBeInTheDocument()
    })
  })
})
