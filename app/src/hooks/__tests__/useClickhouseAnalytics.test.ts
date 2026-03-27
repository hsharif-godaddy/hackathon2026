// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'

// Mock dependencies
vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const mockFetchAll = vi.fn()
vi.mock('@/lib/insights/clickhouse-fetchers', () => ({
  fetchAllClickhouseAnalytics: (...args: unknown[]) => mockFetchAll(...args),
}))

import { useClickhouseAnalytics } from '@/hooks/useClickhouseAnalytics'

/** Create a fresh QueryClient for each test to avoid shared cache */
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })
}

/** Wrapper providing QueryClientProvider for renderHook */
function createWrapper() {
  const queryClient = createTestQueryClient()
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

function makeEmptyResult() {
  return {
    totalHostPageViews: 0,
    totalHostUniqueVisitors: 0,
    dailyHostPageViews: [],
    pageViewsByPathData: [],
    uniqueVisitorsByPageData: [],
    pageActivityShareData: [],
    clickTrendsData: [],
    clicksByElementData: [],
    clicksPerPageData: [],
    clickActivityShareData: [],
    exitRateData: [],
    newVsReturningData: [],
    browserSessionsData: [],
    sessionsByDeviceData: [],
    countryTrafficData: [],
    cityTrafficData: [],
    pageTransitionsTableData: [],
    topReferrersData: [],
    referrerLandingDetailData: [],
    topCTALabelsData: [],
    elementSectionData: [],
    avgClicksPerSessionData: [],
    clicksByHourData: [],
    hourlyPageviewVisitorData: [],
    dailyTrendByPageData: [],
    hourlyClicksByDeviceData: [],
    deviceDistributionData: [],
    deviceMixOverTimeData: [],
    sessionClickData: [],
    elementClicksBySectionData: [],
    activityHitsData: [],
    kpiExtras: {
      totalSessions: 0,
      bounceSessions: 0,
      bounceRate: '0%',
      peakHour: '0:00',
      peakHourClicks: 0,
      peakHourVisitors: 0,
      avgPagesPerSession: 0,
      avgSessionDuration: '0m 0s',
    },
  }
}

describe('useClickhouseAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchAll.mockResolvedValue(makeEmptyResult())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should not fetch when enabled is false', async () => {
    const { result } = renderHook(() =>
      useClickhouseAnalytics({
        publishedUrl: 'https://test.example.com',
        days: 7,
        enabled: false,
      }),
      { wrapper: createWrapper() }
    )

    // Wait a tick to make sure nothing fires
    await new Promise(r => setTimeout(r, 50))
    expect(mockFetchAll).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
  })

  it('should not fetch when publishedUrl is null', async () => {
    const { result } = renderHook(() =>
      useClickhouseAnalytics({
        publishedUrl: null,
        days: 7,
        enabled: true,
      }),
      { wrapper: createWrapper() }
    )

    await new Promise(r => setTimeout(r, 50))
    expect(mockFetchAll).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
  })

  it('should not fetch when publishedUrl is empty string', async () => {
    renderHook(() =>
      useClickhouseAnalytics({
        publishedUrl: '  ',
        days: 7,
        enabled: true,
      }),
      { wrapper: createWrapper() }
    )

    await new Promise(r => setTimeout(r, 50))
    expect(mockFetchAll).not.toHaveBeenCalled()
  })

  it('should fetch data when enabled and publishedUrl is provided', async () => {
    const { result } = renderHook(() =>
      useClickhouseAnalytics({
        publishedUrl: 'https://test.example.com',
        days: 7,
        enabled: true,
      }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(mockFetchAll).toHaveBeenCalledTimes(1)
    })

    // Should extract hostname
    expect(mockFetchAll).toHaveBeenCalledWith('test.example.com', 7, undefined)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
  })

  it('should extract hostname from URL', async () => {
    renderHook(() =>
      useClickhouseAnalytics({
        publishedUrl: 'https://70mqshlu7h.c4.test-airoapp.ai/',
        days: 7,
        enabled: true,
      }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(mockFetchAll).toHaveBeenCalledWith('70mqshlu7h.c4.test-airoapp.ai', 7, undefined)
    })
  })

  it('should set error state when fetch fails', async () => {
    // Reset all mocks and set up rejection only
    mockFetchAll.mockReset()
    mockFetchAll.mockRejectedValue(new Error('Connection failed'))

    const { result } = renderHook(() =>
      useClickhouseAnalytics({
        publishedUrl: 'https://error-test.example.com',
        days: 7,
        enabled: true,
      }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    }, { timeout: 5000 })
    expect(result.current.error).toBeTruthy()
    expect(result.current.error?.message).toBe('Connection failed')
  })

  it('should populate data state after successful fetch', async () => {
    const mockData = makeEmptyResult()
    mockData.pageViewsByPathData = [{ date: '/', value: 100 }]
    mockData.kpiExtras.totalSessions = 50
    mockFetchAll.mockResolvedValue(mockData)

    const { result } = renderHook(() =>
      useClickhouseAnalytics({
        publishedUrl: 'https://test.example.com',
        days: 7,
        enabled: true,
      }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.pageViewsByPathData).toHaveLength(1)
    })
    expect(result.current.pageViewsByPathData[0]).toEqual({ date: '/', value: 100 })
    expect(result.current.kpiExtras.totalSessions).toBe(50)
  })

  it('should refetch when days changes', async () => {
    const wrapper = createWrapper()
    const { rerender } = renderHook(
      ({ days }) =>
        useClickhouseAnalytics({
          publishedUrl: 'https://test.example.com',
          days,
          enabled: true,
        }),
      { initialProps: { days: 7 }, wrapper }
    )

    await waitFor(() => expect(mockFetchAll).toHaveBeenCalledTimes(1))

    rerender({ days: 30 })

    await waitFor(() => expect(mockFetchAll).toHaveBeenCalledTimes(2))
    expect(mockFetchAll).toHaveBeenLastCalledWith('test.example.com', 30, undefined)
  })

  it('should return all expected data fields', async () => {
    const { result } = renderHook(() =>
      useClickhouseAnalytics({
        publishedUrl: 'https://test.example.com',
        days: 7,
        enabled: true,
      }),
      { wrapper: createWrapper() }
    )

    // Check that all state fields exist
    expect(result.current).toHaveProperty('pageViewsByPathData')
    expect(result.current).toHaveProperty('uniqueVisitorsByPageData')
    expect(result.current).toHaveProperty('clickTrendsData')
    expect(result.current).toHaveProperty('exitRateData')
    expect(result.current).toHaveProperty('newVsReturningData')
    expect(result.current).toHaveProperty('countryTrafficData')
    expect(result.current).toHaveProperty('kpiExtras')
    expect(result.current).toHaveProperty('isLoading')
    expect(result.current).toHaveProperty('error')
  })
})
