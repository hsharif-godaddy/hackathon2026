import '@testing-library/jest-dom'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'

import { mockAuthContext, mockParams, mockRouter, mockSearchParams } from '@/tests/mocks'
import { renderWithProviders } from '@/tests/test-utils'
import PricingSection from './PricingSection'

const PENDING_UPGRADE_KEY = 'airo-pending-pricing-upgrade'

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
    if (params?.count !== undefined) {return `${key}_${params.count}`}
    if (params?.price !== undefined) {return `${key}_${params.price}`}
    return key
  },
}))

vi.mock('@/hooks/useSsoSignIn', () => ({
  useSsoSignIn: () => ({ signIn: mockSignIn }),
}))

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: (options?: { enabled?: boolean }) => ({
    data: options?.enabled !== false ? { id: 'sub-123', builderEntitlementId: 'ent-456' } : undefined,
    refetch: mockRefetchSubscription,
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

vi.mock('@/lib/pricing', () => ({
  formatOfferPrice: vi.fn(() => '$99.99'),
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: { openUpgradeModal: typeof mockOpenUpgradeModal }) => unknown) => {
    const state = { openUpgradeModal: mockOpenUpgradeModal }
    return selector(state)
  },
}))

// Default to unauthenticated state
let authContextOverrides = { isAuthenticated: false, isAuthDisabled: false, isLoading: false }

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext(authContextOverrides),
}))

describe('PricingSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    authContextOverrides = { isAuthenticated: false, isAuthDisabled: false, isLoading: false }

    // Mock fetch for pricing data
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              newOffers: {
                offers: [
                  {
                    price: { numeric: { listing: { perTerm: { discounted: 99.99 } } } },
                    currency: 'USD',
                    marketId: 'en-US',
                  },
                ],
              },
            },
          }),
      } as Response)
    )

    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    window.scrollTo = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rendering', () => {
    it('should render the pricing section with both plans', async () => {
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
})
