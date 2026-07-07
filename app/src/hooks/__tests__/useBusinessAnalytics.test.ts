/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

import { resolveAnalyticsDateRange } from '@/lib/insights/clickhouse-queries'
import { renderHookWithProviders } from '@/tests/test-utils'

const mockFetchBusinessAnalyticsSourceData = vi.fn()
const mockUseCommerceStoreId = vi.fn()

vi.mock('@/lib/insights/clickhouse-queries', async () => ({
  ...(await vi.importActual<typeof import('@/lib/insights/clickhouse-queries')>('@/lib/insights/clickhouse-queries')),
  resolveAnalyticsDateRange: vi.fn(),
}))

vi.mock('@/lib/analytics/commerce-reporting', async () => {
  const actual = await vi.importActual<typeof import('@/lib/analytics/commerce-reporting')>('@/lib/analytics/commerce-reporting')
  return {
    ...actual,
    fetchBusinessAnalyticsSourceData: (...args: unknown[]) => mockFetchBusinessAnalyticsSourceData(...args),
  }
})

vi.mock('@/hooks/useBusinessCommerceIds', () => ({
  useCommerceStoreId: (...args: unknown[]) => mockUseCommerceStoreId(...args),
}))

import {
  useBusinessAnalyticsData,
  useBusinessAnalyticsMetrics,
} from '@/hooks/useBusinessAnalytics'

const SOURCE_DATA = {
  orderCountOverTime: [{ date: '2026-06-10', value: 1 }],
  revenueOverTime: [{ date: '2026-06-10', value: 100 }],
}

describe('useBusinessAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveAnalyticsDateRange).mockReturnValue({
      start: new Date('2026-06-01T00:00:00.000Z'),
      end: new Date('2026-06-10T12:00:00.000Z'),
    })
    mockFetchBusinessAnalyticsSourceData.mockResolvedValue(SOURCE_DATA)
    mockUseCommerceStoreId.mockReturnValue({
      data: 'store-1',
      isLoading: false,
      isError: false,
      isFetched: true,
    })
  })

  describe('#useBusinessAnalyticsMetrics', () => {
    it('does not fetch when appId or storeId is missing', async function disabled() {
      const { result } = renderHookWithProviders(() =>
        useBusinessAnalyticsMetrics(null, 'store-1', { mode: 'rolling', days: 7 }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(mockFetchBusinessAnalyticsSourceData).not.toHaveBeenCalled()
      expect(result.current.metrics.totalRevenue).toBe(0)
    })

    it('returns aggregated metrics when fetch succeeds', async function success() {
      const { result } = renderHookWithProviders(() =>
        useBusinessAnalyticsMetrics('app-1', 'store-1', { mode: 'rolling', days: 7 }),
      )

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true)
      })

      expect(mockFetchBusinessAnalyticsSourceData).toHaveBeenCalledWith(
        'app-1',
        'store-1',
        { mode: 'rolling', days: 7 },
      )
      expect(result.current.metrics.totalRevenue).toBe(100)
      expect(result.current.isError).toBe(false)
    })

    it('returns isError when fetch fails', async function error() {
      mockFetchBusinessAnalyticsSourceData.mockRejectedValue(new Error('fetch failed'))

      const { result } = renderHookWithProviders(() =>
        useBusinessAnalyticsMetrics('app-1', 'store-1', { mode: 'rolling', days: 7 }),
      )

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      }, { timeout: 5000 })

      expect(result.current.metrics.totalRevenue).toBe(0)
    })

    it('exposes refetch for retry after failure', async function refetch() {
      mockFetchBusinessAnalyticsSourceData.mockRejectedValue(new Error('fetch failed'))

      const { result } = renderHookWithProviders(() =>
        useBusinessAnalyticsMetrics('app-1', 'store-1', { mode: 'rolling', days: 7 }),
      )

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      }, { timeout: 5000 })

      expect(typeof result.current.refetch).toBe('function')
    })
  })

  describe('#useBusinessAnalyticsData', () => {
    it('hides business analytics when store id is not configured', async function noStore() {
      mockUseCommerceStoreId.mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
        isFetched: true,
      })

      const { result } = renderHookWithProviders(() =>
        useBusinessAnalyticsData('app-1', { mode: 'rolling', days: 7 }),
      )

      await waitFor(() => {
        expect(result.current.storeId).toBeNull()
      })

      expect(result.current.showBusinessAnalytics).toBe(false)
      expect(mockFetchBusinessAnalyticsSourceData).not.toHaveBeenCalled()
    })

    it('hides business analytics while store id is loading', async function storeLoading() {
      mockUseCommerceStoreId.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        isFetched: false,
      })

      const { result } = renderHookWithProviders(() =>
        useBusinessAnalyticsData('app-1', { mode: 'rolling', days: 7 }),
      )

      await waitFor(() => {
        expect(result.current.showBusinessAnalytics).toBe(false)
      })

      expect(result.current.isLoading).toBe(false)
      expect(mockFetchBusinessAnalyticsSourceData).not.toHaveBeenCalled()
    })

    it('returns metrics when store id resolves', async function withStore() {
      const { result } = renderHookWithProviders(() =>
        useBusinessAnalyticsData('app-1', { mode: 'rolling', days: 7 }),
      )

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true)
      })

      expect(result.current.showBusinessAnalytics).toBe(true)
      expect(result.current.dataReady).toBe(true)
      expect(result.current.storeId).toBe('store-1')
      expect(result.current.metrics.totalRevenue).toBe(100)
    })

    it('sets dataReady to false when metrics fetch fails', async function errorState() {
      mockFetchBusinessAnalyticsSourceData.mockRejectedValue(new Error('fetch failed'))

      const { result } = renderHookWithProviders(() =>
        useBusinessAnalyticsData('app-1', { mode: 'rolling', days: 7 }),
      )

      await waitFor(() => {
        expect(result.current.dataReady).toBe(false)
      }, { timeout: 5000 })

      expect(result.current.showBusinessAnalytics).toBe(true)
    })

    it('sets dataReady to true while metrics are still in-flight', async function inFlight() {
      let resolveMetrics: (value: typeof SOURCE_DATA) => void
      mockFetchBusinessAnalyticsSourceData.mockReturnValue(
        new Promise((resolve) => { resolveMetrics = resolve }),
      )

      const { result } = renderHookWithProviders(() =>
        useBusinessAnalyticsData('app-1', { mode: 'rolling', days: 7 }),
      )

      await waitFor(() => {
        expect(result.current.showBusinessAnalytics).toBe(true)
      })

      expect(result.current.dataReady).toBe(true)
      expect(result.current.isFetched).toBe(false)
      expect(result.current.isLoading).toBe(true)

      resolveMetrics!(SOURCE_DATA)

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true)
      })

      expect(result.current.dataReady).toBe(true)
      expect(result.current.metrics.totalRevenue).toBe(100)
    })

    it('sets dataReady to false when store id query fails', async function storeError() {
      mockUseCommerceStoreId.mockReturnValue({
        data: 'store-1',
        isLoading: false,
        isError: true,
        isFetched: true,
      })

      const { result } = renderHookWithProviders(() =>
        useBusinessAnalyticsData('app-1', { mode: 'rolling', days: 7 }),
      )

      await waitFor(() => {
        expect(result.current.dataReady).toBe(false)
      })
    })
  })
})
