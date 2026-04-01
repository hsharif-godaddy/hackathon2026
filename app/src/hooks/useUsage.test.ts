import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * @vitest-environment jsdom
 */
import { renderHookWithProviders } from '@/tests/test-utils'
import { WarningLevel } from '@/types/usage'

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(),
}))

vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: vi.fn(),
}))

import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useSubscription } from '@/hooks/useSubscription'
import { useUsage } from './useUsage'

describe('useUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when grants are enabled', () => {
    beforeEach(() => {
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
})
