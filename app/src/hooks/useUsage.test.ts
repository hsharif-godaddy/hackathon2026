/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderHookWithProviders } from '@/tests/test-utils'
import { WarningLevel } from '@/types/usage'

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(),
}))

vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useSubscription } from '@/hooks/useSubscription'
import { useUsage } from './useUsage'

const mockUseSubscription = vi.mocked(useSubscription)
const mockUseCreditGrants = vi.mocked(useCreditGrants)

function createMockGrant(overrides: Partial<any> = {}) {
  const now = new Date()
  const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
  return {
    id: 'grant-1',
    subscriptionId: 'sub-1',
    type: 'credit-pack',
    llmBudgetUserId: 'user-1',
    llmBudgetId: 'budget-1',
    creditsMax: 100,
    creditsSpent: 0,
    isAvailable: true,
    finalState: null,
    useBefore: futureDate,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  }
}

function defaultGrantsMock(overrides = {}) {
  return {
    data: undefined,
    isFetching: false,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useCreditGrants>
}

describe('useUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSubscription.mockReturnValue({
      data: { id: 'sub-123' },
      subscriptions: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as ReturnType<typeof useSubscription>)
    mockUseCreditGrants.mockReturnValue(defaultGrantsMock())
  })

  describe('when grants are enabled', () => {
    it('calculates percentage from grants data', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          createMockGrant({ id: 'grant-1', creditsSpent: 30, creditsMax: 100 }),
          createMockGrant({ id: 'grant-2', creditsSpent: 20, creditsMax: 100 }),
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      // (30 + 20) / (100 + 100) = 50 / 200 = 25%
      expect(result.current.percentage).toBe(25)
    })

    it('returns NONE warning level below 50%', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          createMockGrant({ id: 'grant-1', creditsSpent: 40, creditsMax: 100 }),
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.percentage).toBe(40)
      expect(result.current.warningLevel).toBe(WarningLevel.NONE)
    })

    it('returns CAUTION warning level at 50-74%', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          createMockGrant({ id: 'grant-1', creditsSpent: 60, creditsMax: 100 }),
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.percentage).toBe(60)
      expect(result.current.warningLevel).toBe(WarningLevel.CAUTION)
    })

    it('returns WARNING level at 75-99%', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          createMockGrant({ id: 'grant-1', creditsSpent: 80, creditsMax: 100 }),
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.percentage).toBe(80)
      expect(result.current.warningLevel).toBe(WarningLevel.WARNING)
    })

    it('returns isWarningBannerActive true at 90-99%', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          createMockGrant({ id: 'grant-1', creditsSpent: 95, creditsMax: 100 }),
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.percentage).toBe(95)
      expect(result.current.isWarningBannerActive).toBe(true)
    })

    it('returns EXCEEDED warning level when all grants consumed (exhausted)', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          createMockGrant({ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }),
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      // 100/100 = 100%
      expect(result.current.percentage).toBe(100)
      expect(result.current.warningLevel).toBe(WarningLevel.EXCEEDED)
      expect(result.current.isWarningBannerActive).toBe(false)
    })

    it('returns 100% when grants array is empty (no usable credits)', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      // No grants at all → totalCreditsMax === 0, which returns 100% to indicate
      // "no usable credits" (matches gauge fallback behavior).
      expect(result.current.percentage).toBe(100)
      expect(result.current.warningLevel).toBe(WarningLevel.EXCEEDED)
    })

    it('passes subscription id to useCreditGrants', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(useCreditGrants).toHaveBeenCalledWith({
        subscriptionId: 'sub-123',
      })
    })
  })

  describe('loading states', () => {
    it('returns isLoading true when subscription is loading', () => {
      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof useSubscription>)

      vi.mocked(useCreditGrants).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.isLoading).toBe(true)
    })

    it('returns isLoading true when grants data is loading', () => {
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-123' },
        isLoading: false,
      } as ReturnType<typeof useSubscription>)

      vi.mocked(useCreditGrants).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.isLoading).toBe(true)
    })
  })

  describe('enabled option', () => {
    it('does not fetch grants when enabled is false', () => {
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-123' },
        isLoading: false,
      } as ReturnType<typeof useSubscription>)

      vi.mocked(useCreditGrants).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      renderHookWithProviders(() => useUsage({ appId: 'app-123', enabled: false }))

      expect(useCreditGrants).toHaveBeenCalledWith({
        subscriptionId: undefined,
      })
    })
  })

  describe('subscription missing edge case', () => {
    it('returns isLoading true when subscription is missing', () => {
      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useSubscription>)

      vi.mocked(useCreditGrants).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.isLoading).toBe(true)
      // When data is undefined, isLoading takes precedence in the return value
      // (see useUsage.ts logic for isLoading handling), but if we reach percentage calculation,
      // no active grants → returns 100% to indicate no usable credits
      expect(result.current.percentage).toBe(100)
    })
  })

  // Usage percentage must include exhausted/expired grants so banner thresholds
  // agree with the gauge and popover. See getTotalCreditsFromGrants and the
  // regression comment in UsageGauge.tsx for the underlying rationale.
  describe('multiple credit packs with consumed/expired grants', () => {
    it('includes consumed grants in percentage calculation', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          createMockGrant({
            id: 'pack-1',
            type: 'credit-pack',
            creditsSpent: 100,
            creditsMax: 100,
            isAvailable: false,
            finalState: 'consumed',
            useBefore: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          }),
          createMockGrant({
            id: 'pack-2',
            creditsSpent: 20,
            creditsMax: 100,
            isAvailable: true,
            finalState: null,
          }),
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      // (100 + 20) / (100 + 100) = 60%
      expect(result.current.percentage).toBe(60)
      expect(result.current.warningLevel).toBe(WarningLevel.CAUTION)
      expect(result.current.isWarningBannerActive).toBe(false)
    })

    it('includes expired grants in percentage calculation', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          createMockGrant({
            id: 'pack-1',
            creditsSpent: 100,
            creditsMax: 100,
            isAvailable: true,
            finalState: 'expired',
            useBefore: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          }),
          createMockGrant({
            id: 'pack-2',
            creditsSpent: 20,
            creditsMax: 100,
            isAvailable: true,
            finalState: null,
          }),
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      // (100 + 20) / (100 + 100) = 60%
      expect(result.current.percentage).toBe(60)
      expect(result.current.warningLevel).toBe(WarningLevel.CAUTION)
    })

    it('includes unavailable grants in percentage calculation', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          createMockGrant({
            id: 'pack-1',
            creditsSpent: 50,
            creditsMax: 100,
            isAvailable: false,
            finalState: null,
          }),
          createMockGrant({
            id: 'pack-2',
            creditsSpent: 30,
            creditsMax: 100,
            isAvailable: true,
            finalState: null,
          }),
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      // (50 + 30) / (100 + 100) = 40%
      expect(result.current.percentage).toBe(40)
      expect(result.current.warningLevel).toBe(WarningLevel.NONE)
    })

    it('includes expired-by-date grants in percentage calculation', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          createMockGrant({
            id: 'pack-1',
            creditsSpent: 80,
            creditsMax: 100,
            isAvailable: true,
            finalState: null,
            useBefore: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          }),
          createMockGrant({
            id: 'pack-2',
            creditsSpent: 40,
            creditsMax: 100,
            isAvailable: true,
            finalState: null,
          }),
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      // (80 + 40) / (100 + 100) = 60%
      expect(result.current.percentage).toBe(60)
      expect(result.current.warningLevel).toBe(WarningLevel.CAUTION)
      expect(result.current.isWarningBannerActive).toBe(false)
    })

    it('aggregates all packs into percentage even when only one is active', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          createMockGrant({
            id: 'pack-1',
            creditsSpent: 100,
            creditsMax: 100,
            isAvailable: false,
            finalState: 'consumed',
          }),
          createMockGrant({
            id: 'pack-2',
            creditsSpent: 100,
            creditsMax: 100,
            isAvailable: false,
            finalState: 'consumed',
          }),
          createMockGrant({
            id: 'pack-3',
            creditsSpent: 10,
            creditsMax: 100,
            isAvailable: true,
            finalState: null,
          }),
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      // (100 + 100 + 10) / (100 + 100 + 100) = 210/300 = 70%
      expect(result.current.percentage).toBe(70)
      expect(result.current.warningLevel).toBe(WarningLevel.CAUTION)
      expect(result.current.isWarningBannerActive).toBe(false)
    })

    it('fires toast banner when combined usage across grants crosses 90%', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          createMockGrant({
            id: 'pack-1',
            creditsSpent: 100,
            creditsMax: 100,
            isAvailable: false,
            finalState: 'consumed',
          }),
          createMockGrant({
            id: 'pack-2',
            creditsSpent: 95,
            creditsMax: 100,
            isAvailable: true,
            finalState: null,
          }),
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      // (100 + 95) / (100 + 100) = 97.5%
      expect(result.current.percentage).toBe(97.5)
      expect(result.current.warningLevel).toBe(WarningLevel.WARNING)
      expect(result.current.isWarningBannerActive).toBe(true)
    })
  })

  // Note: Budget path tests removed - BFF now handles source selection.
  // Client always receives CreditGrant[] format regardless of source.
})
