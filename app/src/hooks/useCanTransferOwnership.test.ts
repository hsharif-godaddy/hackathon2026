/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { renderHookWithProviders } from '@/tests/test-utils'
import { SubscriptionPlan } from '@/types/credits'
import { useCanTransferOwnership } from './useCanTransferOwnership'

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}))

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(),
}))

describe('useCanTransferOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSwitchboard).mockReturnValue(true)
    vi.mocked(useSubscription).mockReturnValue({
      data: { plan: SubscriptionPlan.Professional } as never,
      subscriptions: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  it('allows transfer for Professional plan when the feature flag is on', () => {
    const { result } = renderHookWithProviders(() => useCanTransferOwnership())

    expect(result.current.showTransfer).toBe(true)
    expect(result.current.canInitiateTransfer).toBe(true)
    expect(result.current.isLoading).toBe(false)
  })

  it('allows transfer for Ultimate plan when the feature flag is on', () => {
    vi.mocked(useSubscription).mockReturnValue({
      data: { plan: SubscriptionPlan.Ultimate } as never,
      subscriptions: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    const { result } = renderHookWithProviders(() => useCanTransferOwnership())

    expect(result.current.showTransfer).toBe(true)
    expect(result.current.canInitiateTransfer).toBe(true)
  })

  it('shows transfer for Starter plan users but blocks initiation', () => {
    vi.mocked(useSubscription).mockReturnValue({
      data: { plan: SubscriptionPlan.Starter } as never,
      subscriptions: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    const { result } = renderHookWithProviders(() => useCanTransferOwnership())

    expect(result.current.showTransfer).toBe(true)
    expect(result.current.canInitiateTransfer).toBe(false)
  })

  it('hides transfer for Free plan users', () => {
    vi.mocked(useSubscription).mockReturnValue({
      data: { plan: SubscriptionPlan.Free } as never,
      subscriptions: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    const { result } = renderHookWithProviders(() => useCanTransferOwnership())

    expect(result.current.showTransfer).toBe(false)
    expect(result.current.canInitiateTransfer).toBe(false)
  })

  it('blocks transfer when the feature flag is off', () => {
    vi.mocked(useSwitchboard).mockReturnValue(false)

    const { result } = renderHookWithProviders(() => useCanTransferOwnership())

    expect(result.current.showTransfer).toBe(false)
    expect(result.current.canInitiateTransfer).toBe(false)
  })

  it('reports loading while subscription data is fetching', () => {
    vi.mocked(useSubscription).mockReturnValue({
      data: undefined,
      subscriptions: [],
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    const { result } = renderHookWithProviders(() => useCanTransferOwnership())

    expect(result.current.showTransfer).toBe(false)
    expect(result.current.canInitiateTransfer).toBe(false)
    expect(result.current.isLoading).toBe(true)
  })

  it('reports loading on the initial render, before the feature flag resolves', () => {
    vi.mocked(useSwitchboard).mockReturnValue(undefined as unknown as boolean)

    const { result } = renderHookWithProviders(() => useCanTransferOwnership())

    expect(result.current.showTransfer).toBe(false)
    expect(result.current.canInitiateTransfer).toBe(false)
    expect(result.current.isLoading).toBe(true)
  })

  it('hides transfer when subscription data has resolved to no plan', () => {
    vi.mocked(useSubscription).mockReturnValue({
      data: undefined,
      subscriptions: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    const { result } = renderHookWithProviders(() => useCanTransferOwnership())

    expect(result.current.showTransfer).toBe(false)
    expect(result.current.canInitiateTransfer).toBe(false)
    expect(result.current.isLoading).toBe(false)
  })
})
