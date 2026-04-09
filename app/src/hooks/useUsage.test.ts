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

vi.mock('@/hooks/useBudgetService', () => ({
  useBudgetService: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { useBudgetService } from '@/hooks/useBudgetService'
import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useSubscription } from '@/hooks/useSubscription'
import { useUsage } from './useUsage'

const mockUseSubscription = vi.mocked(useSubscription)
const mockUseCreditGrants = vi.mocked(useCreditGrants)
const mockUseBudgetService = vi.mocked(useBudgetService)

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

function defaultBudgetMock(overrides = {}) {
  return {
    data: undefined,
    isFetching: false,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useBudgetService>
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
    mockUseBudgetService.mockReturnValue(defaultBudgetMock())
  })

  describe('when grants are enabled', () => {
    it('calculates percentage from grants data', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          { id: 'grant-1', creditsSpent: 30, creditsMax: 100 },
          { id: 'grant-2', creditsSpent: 20, creditsMax: 100 },
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
          { id: 'grant-1', creditsSpent: 40, creditsMax: 100 },
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
          { id: 'grant-1', creditsSpent: 60, creditsMax: 100 },
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
          { id: 'grant-1', creditsSpent: 80, creditsMax: 100 },
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
          { id: 'grant-1', creditsSpent: 95, creditsMax: 100 },
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.percentage).toBe(95)
      expect(result.current.isWarningBannerActive).toBe(true)
    })

    it('returns EXCEEDED warning level at 100%+', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          { id: 'grant-1', creditsSpent: 100, creditsMax: 100 },
        ],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.percentage).toBe(100)
      expect(result.current.warningLevel).toBe(WarningLevel.EXCEEDED)
      expect(result.current.isWarningBannerActive).toBe(false)
    })

    it('returns 0% when no grants data', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.percentage).toBe(0)
      expect(result.current.warningLevel).toBe(WarningLevel.NONE)
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
      expect(result.current.percentage).toBe(0)
    })
  })

  describe('budget path (flag ON)', () => {
    it('computes percentage from budget data', () => {
      mockUseBudgetService.mockReturnValue(defaultBudgetMock({
        data: {
          budgetId: 'b1',
          productKey: 'airo-builder',
          creditsTotal: '1000',
          creditsUsed: '500',
          creditsPending: '0',
          creditsTotalNumeric: 1000,
          creditsUsedNumeric: 500,
          creditsPendingNumeric: 0,
          items: [],
        },
        isFetching: false,
      }))

      const { result } = renderHookWithProviders(() =>
        useUsage({ appId: 'app-1', isBudgetServiceEnabled: true, subscriptionId: 'sub-1' })
      )

      expect(result.current.percentage).toBe(50)
      expect(result.current.warningLevel).toBe(WarningLevel.CAUTION)
      expect(result.current.isLoading).toBe(false)
    })

    it('returns exceeded when budget remaining is 0', () => {
      mockUseBudgetService.mockReturnValue(defaultBudgetMock({
        data: {
          budgetId: 'b1',
          productKey: 'airo-builder',
          creditsTotal: '1000',
          creditsUsed: '1000',
          creditsPending: '0',
          creditsTotalNumeric: 1000,
          creditsUsedNumeric: 1000,
          creditsPendingNumeric: 0,
          items: [],
        },
        isFetching: false,
      }))

      const { result } = renderHookWithProviders(() =>
        useUsage({ appId: 'app-1', isBudgetServiceEnabled: true, subscriptionId: 'sub-1' })
      )

      expect(result.current.percentage).toBe(100)
      expect(result.current.warningLevel).toBe(WarningLevel.EXCEEDED)
    })

    it('caps used at total (overspend)', () => {
      mockUseBudgetService.mockReturnValue(defaultBudgetMock({
        data: {
          budgetId: 'b1',
          productKey: 'airo-builder',
          creditsTotal: '1000',
          creditsUsed: '1200',
          creditsPending: '0',
          creditsTotalNumeric: 1000,
          creditsUsedNumeric: 1200,
          creditsPendingNumeric: 0,
          items: [],
        },
        isFetching: false,
      }))

      const { result } = renderHookWithProviders(() =>
        useUsage({ appId: 'app-1', isBudgetServiceEnabled: true, subscriptionId: 'sub-1' })
      )

      expect(result.current.percentage).toBe(100)
      expect(result.current.warningLevel).toBe(WarningLevel.EXCEEDED)
    })

    it('handles creditsTotalNumeric of 0 without division by zero', () => {
      mockUseBudgetService.mockReturnValue(defaultBudgetMock({
        data: {
          budgetId: 'b1',
          productKey: 'airo-builder',
          creditsTotal: '0',
          creditsUsed: '0',
          creditsPending: '0',
          creditsTotalNumeric: 0,
          creditsUsedNumeric: 0,
          creditsPendingNumeric: 0,
          items: [],
        },
        isFetching: false,
      }))

      const { result } = renderHookWithProviders(() =>
        useUsage({ appId: 'app-1', isBudgetServiceEnabled: true, subscriptionId: 'sub-1' })
      )

      expect(result.current.percentage).toBe(0)
      expect(Number.isNaN(result.current.percentage)).toBe(false)
    })

    it('isLoading respects enabled gate on budget path', () => {
      mockUseBudgetService.mockReturnValue(defaultBudgetMock({
        data: undefined,
        isLoading: true,
      }))

      const { result } = renderHookWithProviders(() =>
        useUsage({ appId: 'app-1', isBudgetServiceEnabled: true, subscriptionId: 'sub-1' })
      )

      expect(result.current.isLoading).toBe(true)
    })

    it('isLoading is false when enabled=false on budget path', () => {
      mockUseBudgetService.mockReturnValue(defaultBudgetMock({
        data: undefined,
        isLoading: true,
      }))

      const { result } = renderHookWithProviders(() =>
        useUsage({ appId: 'app-1', isBudgetServiceEnabled: true, subscriptionId: 'sub-1', enabled: false })
      )

      expect(result.current.isLoading).toBe(false)
    })

    it('gates useCreditGrants when budget ON', () => {
      renderHookWithProviders(() =>
        useUsage({ appId: 'app-1', isBudgetServiceEnabled: true, subscriptionId: 'sub-1' })
      )

      expect(mockUseCreditGrants).toHaveBeenCalledWith({
        subscriptionId: undefined,
      })
    })

    it('does not call useBudgetService when flag OFF', () => {
      renderHookWithProviders(() =>
        useUsage({ appId: 'app-1', isBudgetServiceEnabled: false })
      )

      expect(mockUseBudgetService).toHaveBeenCalledWith({
        subscriptionId: 'sub-123',
        enabled: false,
      })
    })

    it('warning banner active at 90%', () => {
      mockUseBudgetService.mockReturnValue(defaultBudgetMock({
        data: {
          budgetId: 'b1',
          productKey: 'airo-builder',
          creditsTotal: '1000',
          creditsUsed: '950',
          creditsPending: '0',
          creditsTotalNumeric: 1000,
          creditsUsedNumeric: 950,
          creditsPendingNumeric: 0,
          items: [],
        },
        isFetching: false,
      }))

      const { result } = renderHookWithProviders(() =>
        useUsage({ appId: 'app-1', isBudgetServiceEnabled: true, subscriptionId: 'sub-1' })
      )

      expect(result.current.percentage).toBe(95)
      expect(result.current.warningLevel).toBe(WarningLevel.WARNING)
      expect(result.current.isWarningBannerActive).toBe(true)
    })

    it('returns defaults when budget data is undefined', () => {
      mockUseBudgetService.mockReturnValue(defaultBudgetMock({
        data: undefined,
        isFetching: false,
      }))

      const { result } = renderHookWithProviders(() =>
        useUsage({ appId: 'app-1', isBudgetServiceEnabled: true, subscriptionId: 'sub-1' })
      )

      expect(result.current.percentage).toBe(0)
      expect(result.current.warningLevel).toBe(WarningLevel.NONE)
      expect(result.current.isWarningBannerActive).toBe(false)
    })
  })
})
