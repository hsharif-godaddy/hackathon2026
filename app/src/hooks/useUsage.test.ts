import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * @vitest-environment jsdom
 */
import { renderHookWithProviders } from '@/tests/test-utils'
import { WarningLevel } from '@/types/usage'

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}))

vi.mock('@/hooks/useDailyUsage', () => ({
  useDailyUsage: vi.fn(),
  TOAST_THRESHOLD: 90,
}))

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(),
}))

vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: vi.fn(),
}))

import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useDailyUsage } from '@/hooks/useDailyUsage'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useUsage } from './useUsage'

describe('useUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when grants are disabled (legacy mode)', () => {
    beforeEach(() => {
      vi.mocked(useSwitchboard).mockReturnValue({
        data: false,
        isLoading: false,
      } as ReturnType<typeof useSwitchboard>)

      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useSubscription>)

      vi.mocked(useCreditGrants).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)
    })

    it('returns legacy usage data when grants disabled', () => {
      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 45, resetTime: null },
        isLoading: false,
        warningLevel: WarningLevel.NONE,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.percentage).toBe(45)
      expect(result.current.warningLevel).toBe(WarningLevel.NONE)
      expect(result.current.isWarningBannerActive).toBe(false)
      expect(result.current.isGrantsEnabled).toBe(false)
    })

    it('returns caution warning level at 50%', () => {
      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 55, resetTime: null },
        isLoading: false,
        warningLevel: WarningLevel.CAUTION,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.warningLevel).toBe(WarningLevel.CAUTION)
    })

    it('returns warning level at 75%', () => {
      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 80, resetTime: null },
        isLoading: false,
        warningLevel: WarningLevel.WARNING,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.warningLevel).toBe(WarningLevel.WARNING)
    })

    it('returns isWarningBannerActive true at 90%', () => {
      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 92, resetTime: null },
        isLoading: false,
        warningLevel: WarningLevel.WARNING,
        isWarningBannerActive: true,
      } as ReturnType<typeof useDailyUsage>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.isWarningBannerActive).toBe(true)
    })

    it('returns exceeded warning level at 100%', () => {
      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 100, resetTime: null },
        isLoading: false,
        warningLevel: WarningLevel.EXCEEDED,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(result.current.warningLevel).toBe(WarningLevel.EXCEEDED)
      expect(result.current.isWarningBannerActive).toBe(false)
    })

    it('passes enabled=false to useDailyUsage when disabled', () => {
      vi.mocked(useDailyUsage).mockReturnValue({
        data: undefined,
        isLoading: false,
        warningLevel: WarningLevel.NONE,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

      renderHookWithProviders(() => useUsage({ appId: 'app-123', enabled: false }))

      expect(useDailyUsage).toHaveBeenCalledWith({
        appId: 'app-123',
        enabled: false,
      })
    })
  })

  describe('when grants are enabled', () => {
    beforeEach(() => {
      vi.mocked(useSwitchboard).mockReturnValue({
        data: true,
        isLoading: false,
      } as ReturnType<typeof useSwitchboard>)

      vi.mocked(useDailyUsage).mockReturnValue({
        data: undefined,
        isLoading: false,
        warningLevel: WarningLevel.NONE,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-123' },
        isLoading: false,
      } as ReturnType<typeof useSubscription>)
    })

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
      expect(result.current.isGrantsEnabled).toBe(true)
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

    it('disables useDailyUsage when grants enabled', () => {
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(useDailyUsage).toHaveBeenCalledWith({
        appId: 'app-123',
        enabled: false,
      })
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
    it('returns isLoading true when switchboard is loading', () => {
      vi.mocked(useSwitchboard).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof useSwitchboard>)

      vi.mocked(useDailyUsage).mockReturnValue({
        data: undefined,
        isLoading: false,
        warningLevel: WarningLevel.NONE,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

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
    })

    it('returns isLoading true when legacy data is loading (grants disabled)', () => {
      vi.mocked(useSwitchboard).mockReturnValue({
        data: false,
        isLoading: false,
      } as ReturnType<typeof useSwitchboard>)

      vi.mocked(useDailyUsage).mockReturnValue({
        data: undefined,
        isLoading: true,
        warningLevel: WarningLevel.NONE,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

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
    })

    it('returns isLoading true when subscription is loading (grants enabled)', () => {
      vi.mocked(useSwitchboard).mockReturnValue({
        data: true,
        isLoading: false,
      } as ReturnType<typeof useSwitchboard>)

      vi.mocked(useDailyUsage).mockReturnValue({
        data: undefined,
        isLoading: false,
        warningLevel: WarningLevel.NONE,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

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

    it('returns isLoading true when grants data is loading (grants enabled)', () => {
      vi.mocked(useSwitchboard).mockReturnValue({
        data: true,
        isLoading: false,
      } as ReturnType<typeof useSwitchboard>)

      vi.mocked(useDailyUsage).mockReturnValue({
        data: undefined,
        isLoading: false,
        warningLevel: WarningLevel.NONE,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

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
      vi.mocked(useSwitchboard).mockReturnValue({
        data: true,
        isLoading: false,
      } as ReturnType<typeof useSwitchboard>)

      vi.mocked(useDailyUsage).mockReturnValue({
        data: undefined,
        isLoading: false,
        warningLevel: WarningLevel.NONE,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

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

  describe('grants flag loading transition', () => {
    it('does not fetch legacy data while grants flag is still loading', () => {
      vi.mocked(useSwitchboard).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof useSwitchboard>)

      vi.mocked(useDailyUsage).mockReturnValue({
        data: undefined,
        isLoading: false,
        warningLevel: WarningLevel.NONE,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useSubscription>)

      vi.mocked(useCreditGrants).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      // Should not enable legacy fetch when grants flag is undefined (still loading)
      expect(useDailyUsage).toHaveBeenCalledWith({
        appId: 'app-123',
        enabled: false,
      })
    })

    it('fetches legacy data only when grants flag is explicitly false', () => {
      vi.mocked(useSwitchboard).mockReturnValue({
        data: false,
        isLoading: false,
      } as ReturnType<typeof useSwitchboard>)

      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 50, resetTime: null },
        isLoading: false,
        warningLevel: WarningLevel.CAUTION,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useSubscription>)

      vi.mocked(useCreditGrants).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      expect(useDailyUsage).toHaveBeenCalledWith({
        appId: 'app-123',
        enabled: true,
      })
    })
  })

  describe('subscription missing edge case', () => {
    it('returns isLoading true when grants enabled but subscription is missing', () => {
      vi.mocked(useSwitchboard).mockReturnValue({
        data: true,
        isLoading: false,
      } as ReturnType<typeof useSwitchboard>)

      vi.mocked(useDailyUsage).mockReturnValue({
        data: undefined,
        isLoading: false,
        warningLevel: WarningLevel.NONE,
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>)

      // Subscription finished loading but returned undefined (missing)
      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useSubscription>)

      vi.mocked(useCreditGrants).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useCreditGrants>)

      const { result } = renderHookWithProviders(() => useUsage({ appId: 'app-123' }))

      // Should still be loading to prevent showing incorrect 0%
      expect(result.current.isLoading).toBe(true)
      expect(result.current.percentage).toBe(0)
    })
  })
})
