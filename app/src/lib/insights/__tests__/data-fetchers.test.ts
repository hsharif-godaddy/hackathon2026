import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../clickhouse-fetchers', () => ({
  safeFetch: vi.fn(),
}))

vi.mock('../clickhouse-queries', () => ({
  buildPageViewsPerPathQuery: vi.fn(() => 'MOCK_VIEWS_PER_PATH_QUERY'),
  buildPageViewsPerHostQuery: vi.fn(() => 'MOCK_VIEWS_PER_HOST_QUERY'),
  buildClickAnalyticsHostTotalsQuery: vi.fn(() => 'MOCK_CLICK_TOTALS_QUERY'),
  buildClicksByElementQuery: vi.fn(() => 'MOCK_CLICKS_BY_ELEMENT_QUERY'),
}))

import { safeFetch } from '../clickhouse-fetchers'
import {
  fetchButtonClicks,
  fetchDailyPageViews,
  fetchLinkClicks,
  fetchRouteCount,
  fetchTotalClicks,
  fetchVisitors,
} from '../data-fetchers'

const mockedSafeFetch = vi.mocked(safeFetch)

const TEST_URL = 'https://example.test-airoapp.ai/'
const TEST_DAYS = 7

describe('data-fetchers (ClickHouse)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchRouteCount', () => {
    it('should return page view count for the root route', async () => {
      mockedSafeFetch.mockResolvedValue([
        { page_path: '/', page_views: 42 },
        { page_path: '/about', page_views: 10 },
      ])

      const result = await fetchRouteCount(TEST_URL, '/', TEST_DAYS)
      expect(result).toBe(42)
      expect(mockedSafeFetch).toHaveBeenCalledTimes(1)
    })

    it('should return page view count for a specific route', async () => {
      mockedSafeFetch.mockResolvedValue([
        { page_path: '/', page_views: 50 },
        { page_path: '/contact', page_views: 15 },
        { page_path: '/about', page_views: 8 },
      ])

      const result = await fetchRouteCount(TEST_URL, '/contact', TEST_DAYS)
      expect(result).toBe(15)
    })

    it('should normalize trailing slashes when matching', async () => {
      mockedSafeFetch.mockResolvedValue([
        { page_path: '/about/', page_views: 20 },
      ])

      const result = await fetchRouteCount(TEST_URL, '/about', TEST_DAYS)
      expect(result).toBe(20)
    })

    it('should return 0 when route is not found', async () => {
      mockedSafeFetch.mockResolvedValue([
        { page_path: '/', page_views: 50 },
      ])

      const result = await fetchRouteCount(TEST_URL, '/missing', TEST_DAYS)
      expect(result).toBe(0)
    })

    it('should return 0 on error', async () => {
      mockedSafeFetch.mockRejectedValue(new Error('Network error'))

      const result = await fetchRouteCount(TEST_URL, '/', TEST_DAYS)
      expect(result).toBe(0)
    })
  })

  describe('fetchDailyPageViews', () => {
    it('should return count and daily breakdown', async () => {
      mockedSafeFetch.mockResolvedValue([
        { event_date: '2026-03-19', host_views: 50 },
        { event_date: '2026-03-20', host_views: 50 },
      ])

      const result = await fetchDailyPageViews(TEST_URL, TEST_DAYS)
      expect(result.count).toBe(100)
      expect(result.dailyBreakdown).toHaveLength(2)
      expect(result.dailyBreakdown).toEqual([
        { date: '2026-03-19', count: 50 },
        { date: '2026-03-20', count: 50 },
      ])
    })

    it('should aggregate multiple rows for the same date', async () => {
      mockedSafeFetch.mockResolvedValue([
        { event_date: '2026-03-20', host_views: 30 },
        { event_date: '2026-03-20', host_views: 25 },
      ])

      const result = await fetchDailyPageViews(TEST_URL, TEST_DAYS)
      expect(result.count).toBe(55)
      expect(result.dailyBreakdown).toEqual([
        { date: '2026-03-20', count: 55 },
      ])
    })

    it('should return empty on error', async () => {
      mockedSafeFetch.mockRejectedValue(new Error('Fail'))

      const result = await fetchDailyPageViews(TEST_URL, TEST_DAYS)
      expect(result.count).toBe(0)
      expect(result.dailyBreakdown).toEqual([])
    })
  })

  describe('fetchTotalClicks', () => {
    it('should return click count and breakdown', async () => {
      mockedSafeFetch.mockResolvedValue([
        { event_date: '2026-03-19', clicks: 25 },
        { event_date: '2026-03-20', clicks: 50 },
      ])

      const result = await fetchTotalClicks(TEST_URL, TEST_DAYS)
      expect(result.count).toBe(75)
      expect(result.dailyBreakdown).toHaveLength(2)
    })

    it('should return empty on error', async () => {
      mockedSafeFetch.mockRejectedValue(new Error('Fail'))

      const result = await fetchTotalClicks(TEST_URL, TEST_DAYS)
      expect(result.count).toBe(0)
      expect(result.dailyBreakdown).toEqual([])
    })
  })

  describe('fetchButtonClicks', () => {
    it('should return only button click count', async () => {
      mockedSafeFetch.mockResolvedValue([
        { event_date: '2026-03-20', element_type: 'button', total_clicks: 30, total_unique_visitors: 10 },
        { event_date: '2026-03-20', element_type: 'link', total_clicks: 15, total_unique_visitors: 5 },
      ])

      const result = await fetchButtonClicks(TEST_URL, TEST_DAYS)
      expect(result.count).toBe(30)
      expect(result.dailyBreakdown).toEqual([{ date: '2026-03-20', count: 30 }])
    })

    it('should return empty on error', async () => {
      mockedSafeFetch.mockRejectedValue(new Error('Fail'))

      const result = await fetchButtonClicks(TEST_URL, TEST_DAYS)
      expect(result.count).toBe(0)
    })
  })

  describe('fetchLinkClicks', () => {
    it('should return only link click count', async () => {
      mockedSafeFetch.mockResolvedValue([
        { event_date: '2026-03-20', element_type: 'button', total_clicks: 30, total_unique_visitors: 10 },
        { event_date: '2026-03-20', element_type: 'link', total_clicks: 20, total_unique_visitors: 8 },
      ])

      const result = await fetchLinkClicks(TEST_URL, TEST_DAYS)
      expect(result.count).toBe(20)
      expect(result.dailyBreakdown).toEqual([{ date: '2026-03-20', count: 20 }])
    })

    it('should return empty on error', async () => {
      mockedSafeFetch.mockRejectedValue(new Error('Fail'))

      const result = await fetchLinkClicks(TEST_URL, TEST_DAYS)
      expect(result.count).toBe(0)
    })
  })

  describe('fetchVisitors', () => {
    it('should return summed unique visitor count', async () => {
      mockedSafeFetch.mockResolvedValue([
        { event_date: '2026-03-19', unique_visitors: 25 },
        { event_date: '2026-03-20', unique_visitors: 30 },
      ])

      const result = await fetchVisitors(TEST_URL, TEST_DAYS)
      expect(result).toBe(55)
    })

    it('should return 0 when no rows', async () => {
      mockedSafeFetch.mockResolvedValue([])

      const result = await fetchVisitors(TEST_URL, TEST_DAYS)
      expect(result).toBe(0)
    })

    it('should return 0 on error', async () => {
      mockedSafeFetch.mockRejectedValue(new Error('Fail'))

      const result = await fetchVisitors(TEST_URL, TEST_DAYS)
      expect(result).toBe(0)
    })
  })
})
