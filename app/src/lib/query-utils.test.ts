import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'

import { invalidatePlanQueries, waitForQueryUpdate } from './query-utils'

describe('invalidatePlanQueries', () => {
  it('invalidates all plan-related query keys', () => {
    const mockQueryClient = {
      invalidateQueries: vi.fn(),
    } as unknown as QueryClient

    invalidatePlanQueries(mockQueryClient)

    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledTimes(4)
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['subscriptions'] })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['active-subscription'] })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['paywall-feature-flags'] })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['credit-grants'] })
  })
})

describe('waitForQueryUpdate', () => {
  let mockQueryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryClient = {
      refetchQueries: vi.fn().mockResolvedValue(undefined),
      getQueryData: vi.fn(),
    } as unknown as QueryClient
  })

  it('should return true when condition is met on first attempt', async () => {
    vi.mocked(mockQueryClient.getQueryData).mockReturnValue({ plan: 'starter' })

    const result = await waitForQueryUpdate(
      mockQueryClient,
      ['subscriptions'],
      (data: { plan: string } | undefined) => data?.plan === 'starter'
    )

    expect(result).toBe(true)
    expect(mockQueryClient.refetchQueries).toHaveBeenCalledTimes(1)
    expect(mockQueryClient.refetchQueries).toHaveBeenCalledWith({ queryKey: ['subscriptions'] })
  })

  it('should poll until condition is met', async () => {
    vi.mocked(mockQueryClient.getQueryData)
      .mockReturnValueOnce({ plan: 'free' })
      .mockReturnValueOnce({ plan: 'free' })
      .mockReturnValueOnce({ plan: 'starter' })

    const result = await waitForQueryUpdate(
      mockQueryClient,
      ['subscriptions'],
      (data: { plan: string } | undefined) => data?.plan === 'starter',
      { maxAttempts: 5, intervalMs: 10 }
    )

    expect(result).toBe(true)
    expect(mockQueryClient.refetchQueries).toHaveBeenCalledTimes(3)
  })

  it('should return false when condition is never met within maxAttempts', async () => {
    vi.mocked(mockQueryClient.getQueryData).mockReturnValue({ plan: 'free' })

    const result = await waitForQueryUpdate(
      mockQueryClient,
      ['subscriptions'],
      (data: { plan: string } | undefined) => data?.plan === 'starter',
      { maxAttempts: 3, intervalMs: 10 }
    )

    expect(result).toBe(false)
    expect(mockQueryClient.refetchQueries).toHaveBeenCalledTimes(3)
  })

  it('should use default options when not provided', async () => {
    vi.mocked(mockQueryClient.getQueryData).mockReturnValue({ plan: 'starter' })

    const result = await waitForQueryUpdate(
      mockQueryClient,
      ['test-key'],
      () => true
    )

    expect(result).toBe(true)
    expect(mockQueryClient.refetchQueries).toHaveBeenCalledWith({ queryKey: ['test-key'] })
  })

  it('should handle undefined data gracefully', async () => {
    vi.mocked(mockQueryClient.getQueryData)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ plan: 'starter' })

    const result = await waitForQueryUpdate(
      mockQueryClient,
      ['subscriptions'],
      (data: { plan: string } | undefined) => data?.plan === 'starter',
      { maxAttempts: 5, intervalMs: 10 }
    )

    expect(result).toBe(true)
    expect(mockQueryClient.refetchQueries).toHaveBeenCalledTimes(2)
  })
})
