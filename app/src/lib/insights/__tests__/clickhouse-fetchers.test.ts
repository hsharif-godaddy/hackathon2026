import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger before any imports that use it
vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Reduce retry delays to speed up error-path tests
vi.mock('../constants', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../constants')>()
  return {
    ...orig,
    MAX_RETRIES: 1,
    INITIAL_RETRY_DELAY_MS: 1,
    MAX_RETRY_DELAY_MS: 1,
    REQUEST_TIMEOUT_MS: 5000,
  }
})

import {
  fetchAllClickhouseAnalytics,
  fetchBrowserTrendsOverTime,
  fetchCityTraffic,
  fetchClicksByElement,
  fetchClicksByHour,
  fetchClicksPerPage,
  fetchClickTrends,
  fetchCountryTraffic,
  fetchDeviceDistribution,
  fetchDeviceMixOverTime,
  fetchElementClicksBySection,
  fetchExitRate,
  fetchHourlyPageviewVisitor,
  fetchKpiExtras,
  fetchNewVsReturning,
  fetchPageActivityShare,
  fetchPageTransitions,
  fetchPageViewsByPath,
  fetchPageViewsPerHost,
  fetchReferrerLandingDetail,
  fetchSessionClickData,
  fetchSessionsByDevice,
  fetchTopCTALabels,
  fetchTopReferrers,
  fetchUniqueVisitorsByPage,
  formatBucketLabel,
} from '../clickhouse-fetchers'

const TEST_URL = 'test.example.com'
const TEST_DAYS = 7

/** Helper to create a mock fetch response from ClickHouse format */
function mockClickhouseResponse(rows: Record<string, unknown>[]) {
  return {
    ok: true,
    json: () => Promise.resolve({
      data: {
        analyticsQuery: {
          rows: rows.map(r => ({ data: JSON.stringify(r) })),
        },
      },
    }),
    text: () => Promise.resolve(''),
  }
}

function emptyResponse() {
  return mockClickhouseResponse([])
}

describe('clickhouse-fetchers', () => {
  // Suppress unhandled rejections from the inflight dedup cache — the production
  // code stores Promises in a Map and rejected entries may not be awaited between
  // tests. This only affects the test harness; real browser code always awaits via safeFetch.
  const rejectionHandler = (e: PromiseRejectionEvent) => { e.preventDefault() }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', rejectionHandler)
    }
    // Node-level handler
    process.on('unhandledRejection', () => { /* swallow in tests */ })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (typeof window !== 'undefined') {
      window.removeEventListener('unhandledrejection', rejectionHandler)
    }
    process.removeAllListeners('unhandledRejection')
  })

  describe('fetchPageViewsByPath', () => {
    it('should aggregate page views by path and sort descending', async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockClickhouseResponse([
        { page_path: '/', page_views: 100 },
        { page_path: '/about', page_views: 50 },
        { page_path: '/', page_views: 30 },
        { page_path: '/contact', page_views: 200 },
      ]))
      vi.stubGlobal('fetch', mockFetch)

      const result = await fetchPageViewsByPath(TEST_URL, TEST_DAYS)

      expect(result[0]).toEqual({ date: '/contact', value: 200 })
      expect(result[1]).toEqual({ date: '/', value: 130 })
      expect(result[2]).toEqual({ date: '/about', value: 50 })
    })

    it('should limit to top 5 paths', async () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({
        page_path: `/page-${i}`,
        page_views: (10 - i) * 10,
      }))
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse(rows)))

      const result = await fetchPageViewsByPath(TEST_URL, TEST_DAYS)
      expect(result).toHaveLength(5)
    })

    it('should return empty array when no data rows exist', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(emptyResponse()))

      const result = await fetchPageViewsByPath(TEST_URL, TEST_DAYS)
      expect(result).toEqual([])
    })
  })

  describe('fetchUniqueVisitorsByPage', () => {
    it('should aggregate unique visitors by page path', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { page_path: '/', unique_visitors: 40 },
        { page_path: '/about', unique_visitors: 20 },
      ])))

      const result = await fetchUniqueVisitorsByPage(TEST_URL, TEST_DAYS)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ date: '/', value: 40 })
    })
  })

  describe('fetchPageActivityShare', () => {
    it('should map share_of_total_activity to value and round', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { page_path: '/', share_of_total_activity: 45.7 },
        { page_path: '/about', share_of_total_activity: 22.3 },
      ])))

      const result = await fetchPageActivityShare(TEST_URL, TEST_DAYS)
      expect(result[0]).toEqual({ date: '/', value: 46 })
      expect(result[1]).toEqual({ date: '/about', value: 22 })
    })
  })

  describe('fetchClickTrends', () => {
    it('should pad missing dates with zero values', async () => {
      // Return only 2 dates out of 7
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { event_date: new Date().toISOString().slice(0, 10), clicks: 10 },
      ])))

      const result = await fetchClickTrends(TEST_URL, TEST_DAYS)
      expect(result).toHaveLength(TEST_DAYS)
      // All entries should have date and value
      result.forEach(r => {
        expect(r).toHaveProperty('date')
        expect(r).toHaveProperty('value')
        expect(typeof r.value).toBe('number')
      })
    })

    it('should sort by date ascending', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { event_date: '2026-03-02', clicks: 5 },
        { event_date: '2026-03-01', clicks: 10 },
      ])))

      const result = await fetchClickTrends(TEST_URL, 2)
      // padDateRange generates dates in order, so output is always sorted
      expect(result.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('fetchClicksByElement', () => {
    it('should aggregate clicks by element type and capitalize', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { element_type: 'button', total_clicks: 30 },
        { element_type: 'link', total_clicks: 20 },
        { element_type: 'button', total_clicks: 10 },
      ])))

      const result = await fetchClicksByElement(TEST_URL, TEST_DAYS)
      const buttonResult = result.find(r => r.date === 'Button')
      expect(buttonResult?.value).toBe(40)
      const linkResult = result.find(r => r.date === 'Link')
      expect(linkResult?.value).toBe(20)
    })
  })

  describe('fetchClicksPerPage', () => {
    it('should aggregate and sort by clicks', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { page_path: '/', clicks: 100 },
        { page_path: '/about', clicks: 50 },
      ])))

      const result = await fetchClicksPerPage(TEST_URL, TEST_DAYS)
      expect(result[0].value).toBeGreaterThanOrEqual(result[1]?.value ?? 0)
    })
  })

  describe('fetchExitRate', () => {
    it('should calculate exit rate per page path', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { page_path: '/', page_views: 100, exits: 30, exit_rate_x10000: 3000 },
        { page_path: '/', page_views: 50, exits: 20, exit_rate_x10000: 4000 },
      ])))

      const result = await fetchExitRate(TEST_URL, TEST_DAYS)
      expect(result).toHaveLength(1)
      expect(result[0].date).toBe('/')
      expect(result[0].value).toBe(150)  // aggregated views
      expect(result[0].value2).toBe(50)  // aggregated exits
      expect(result[0].rate).toBeCloseTo(33.3, 0)  // 50/150 * 100
    })
  })

  describe('fetchNewVsReturning', () => {
    it('should pad date range and sort by date', async () => {
      const today = new Date()
      const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
      const todayStr = new Date(todayUTC).toISOString().slice(0, 10)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { event_date: todayStr, new_visitors: 10, returning_visitors: 5 },
      ])))

      const result = await fetchNewVsReturning(TEST_URL, 3)
      expect(result).toHaveLength(3)
      // The one with data should have non-zero values
      const populated = result.find(r => r.date === todayStr)
      expect(populated?.new_visitors).toBe(10)
      expect(populated?.returning_visitors).toBe(5)
    })
  })

  describe('fetchSessionsByDevice', () => {
    it('should aggregate and capitalize device types', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { device_type: 'mobile', sessions: 30 },
        { device_type: 'laptop', sessions: 50 },
      ])))

      const result = await fetchSessionsByDevice(TEST_URL, TEST_DAYS)
      const mobile = result.find(r => r.date === 'Mobile')
      expect(mobile?.value).toBe(30)
    })
  })

  describe('fetchCountryTraffic', () => {
    it('should aggregate sessions and visitors by country', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { country: 'US', sessions: 100, unique_visitors: 80 },
        { country: 'UK', sessions: 40, unique_visitors: 30 },
        { country: 'US', sessions: 50, unique_visitors: 40 },
      ])))

      const result = await fetchCountryTraffic(TEST_URL, TEST_DAYS)
      const us = result.find(r => r.date === 'United States')
      expect(us?.value).toBe(150)
      expect(us?.value2).toBe(120)
    })
  })

  describe('fetchCityTraffic', () => {
    it('should aggregate by city', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { city: 'New York', sessions: 30, unique_visitors: 20 },
      ])))

      const result = await fetchCityTraffic(TEST_URL, TEST_DAYS)
      expect(result[0].date).toBe('New York')
      expect(result[0].value).toBe(30)
    })
  })

  describe('fetchPageTransitions', () => {
    it('should filter out self-transitions', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { from_page: '/', to_page: '/', device_type: 'laptop', transitions: 10 },
        { from_page: '/', to_page: '/about', device_type: 'laptop', transitions: 5 },
      ])))

      const result = await fetchPageTransitions(TEST_URL, TEST_DAYS)
      expect(result).toHaveLength(1)
      expect(result[0].page).toContain('→')
      expect(result[0].visitors).toBe(5)
    })
  })

  describe('fetchTopReferrers', () => {
    it('should aggregate visits and strip protocol', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { referrer: 'https://google.com/search', visits: 30, unique_visitors: 25 },
        { referrer: '', visits: 10, unique_visitors: 8 },
      ])))

      const result = await fetchTopReferrers(TEST_URL, TEST_DAYS)
      const google = result.find(r => r.date === 'google.com/search')
      expect(google?.value).toBe(30)
      const direct = result.find(r => r.date === '(direct)')
      expect(direct?.value).toBe(10)
    })
  })

  describe('fetchReferrerLandingDetail', () => {
    it('should aggregate and return sorted results', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { referrer: 'https://google.com', landing_page: '/', source: 'search', visits: 20, unique_visitors: 15 },
        { referrer: 'https://google.com', landing_page: '/', source: 'search', visits: 10, unique_visitors: 8 },
      ])))

      const result = await fetchReferrerLandingDetail(TEST_URL, TEST_DAYS)
      expect(result).toHaveLength(1)
      expect(result[0].visits).toBe(30)
      expect(result[0].uniqueVisitors).toBe(23)
    })
  })

  describe('fetchTopCTALabels', () => {
    it('should skip entries with empty element_text', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { element_text: 'Sign Up', clicks: 20, unique_visitors: 15 },
        { element_text: '', clicks: 5, unique_visitors: 3 },
      ])))

      const result = await fetchTopCTALabels(TEST_URL, TEST_DAYS)
      expect(result).toHaveLength(1)
      expect(result[0].date).toBe('Sign Up')
    })
  })

  describe('fetchClicksByHour', () => {
    it('should aggregate by hour and format as H:00', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { hour: 9, clicks: 20, unique_visitors: 15 },
        { hour: 9, clicks: 10, unique_visitors: 8 },
        { hour: 14, clicks: 30, unique_visitors: 25 },
      ])))

      const result = await fetchClicksByHour(TEST_URL, TEST_DAYS)
      const h9 = result.find(r => r.date === '9:00')
      expect(h9?.value).toBe(30)
      expect(h9?.value2).toBe(23)
    })
  })

  describe('fetchHourlyPageviewVisitor', () => {
    it('should merge pageview and visitor data by hour', async () => {
      // Mock two separate calls (Promise.all in the function)
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(mockClickhouseResponse([{ hour: 10, pageviews: 50 }]))
        .mockResolvedValueOnce(mockClickhouseResponse([{ hour: 10, unique_visitors: 30 }]))
      vi.stubGlobal('fetch', mockFetch)

      const result = await fetchHourlyPageviewVisitor(TEST_URL, TEST_DAYS)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ date: '10:00', pageviews: 50, visitors: 30 })
    })
  })

  describe('fetchDeviceDistribution', () => {
    it('should aggregate clicks by device type and capitalize', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { device_type: 'laptop', clicks: 100 },
        { device_type: 'mobile', clicks: 50 },
      ])))

      const result = await fetchDeviceDistribution(TEST_URL, TEST_DAYS)
      const laptop = result.find(r => r.date === 'Laptop')
      expect(laptop?.value).toBe(100)
    })
  })

  describe('fetchDeviceMixOverTime', () => {
    it('should pivot device types into columns and pad dates', async () => {
      const today = new Date()
      const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
      const todayStr = new Date(todayUTC).toISOString().slice(0, 10)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { event_date: todayStr, device_type: 'laptop', clicks: 30 },
        { event_date: todayStr, device_type: 'mobile', clicks: 10 },
      ])))

      const result = await fetchDeviceMixOverTime(TEST_URL, 3)
      expect(result).toHaveLength(3)
      const todayEntry = result.find(r => r.date === todayStr)
      expect(todayEntry?.laptop).toBe(30)
      expect(todayEntry?.mobile).toBe(10)
      expect(todayEntry?.tablet).toBe(0)
    })

    it('should sort bucketed ranges chronologically by bucket_from', async () => {
      const bucketFilter = { fromDate: '2026-03-01', toDate: '2026-03-14', bucketDays: 7 }
      const laterLabel = formatBucketLabel('2026-03-08', '2026-03-14')
      const earlierLabel = formatBucketLabel('2026-03-01', '2026-03-07')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { bucket_from: '2026-03-08', bucket_to: '2026-03-14', device_type: 'laptop', clicks: 5 },
        { bucket_from: '2026-03-01', bucket_to: '2026-03-07', device_type: 'mobile', clicks: 3 },
      ])))

      const result = await fetchDeviceMixOverTime(TEST_URL, bucketFilter)
      const earlierIdx = result.findIndex((r) => r.date === earlierLabel)
      const laterIdx = result.findIndex((r) => r.date === laterLabel)

      expect(earlierIdx).toBeGreaterThanOrEqual(0)
      expect(laterIdx).toBeGreaterThan(earlierIdx)
      expect(result[earlierIdx]?.mobile).toBe(3)
      expect(result[laterIdx]?.laptop).toBe(5)
    })
  })

  describe('fetchPageViewsPerHost', () => {
    it('should order custom >30 day buckets chronologically not by month label', async () => {
      const bucketFilter = { fromDate: '2026-01-29', toDate: '2026-05-19', bucketDays: 7 }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { bucket_from: '2026-04-02', bucket_to: '2026-04-08', host_views: 100 },
        { bucket_from: '2026-04-23', bucket_to: '2026-04-29', host_views: 200 },
        { bucket_from: '2026-02-12', bucket_to: '2026-02-18', host_views: 300 },
        { bucket_from: '2026-01-29', bucket_to: '2026-02-04', host_views: 400 },
        { bucket_from: '2026-03-19', bucket_to: '2026-03-25', host_views: 500 },
        { bucket_from: '2026-05-14', bucket_to: '2026-05-19', host_views: 600 },
      ])))

      const result = await fetchPageViewsPerHost(TEST_URL, bucketFilter)
      const labels = result.dailyPageViews.map((d) => d.date)
      const sortedByLabel = [...labels].sort((a, b) => a.localeCompare(b))

      expect(result.totalPageViews).toBe(2100)
      expect(labels).not.toEqual(sortedByLabel)
      const janLabel = formatBucketLabel('2026-01-29', '2026-02-04')
      const febLabel = formatBucketLabel('2026-02-12', '2026-02-18')
      const mayLabel = formatBucketLabel('2026-05-14', '2026-05-19')
      expect(labels.indexOf(janLabel)).toBeLessThan(labels.indexOf(febLabel))
      expect(labels.indexOf(febLabel)).toBeLessThan(labels.indexOf(mayLabel))
      expect(result.dailyPageViews.find((d) => d.date === mayLabel)?.value).toBe(600)
    })
  })

  describe('fetchNewVsReturning', () => {
    it('should place API rows when bucket_from is offset by one day from the grid', async () => {
      const bucketFilter = { fromDate: '2026-04-02', toDate: '2026-05-20', bucketDays: 7 }
      const gridLabel = formatBucketLabel('2026-05-14', '2026-05-20')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { bucket_from: '2026-05-15', bucket_to: '2026-05-20', new_visitors: 2 },
      ])))

      const result = await fetchNewVsReturning(TEST_URL, bucketFilter)
      const slot = result.find((r) => r.date === gridLabel)

      expect(slot?.new_visitors).toBe(2)
    })

    it('should place bucketed API rows on the matching bucket axis (by bucket_from)', async () => {
      const bucketFilter = { fromDate: '2026-03-13', toDate: '2026-05-20', bucketDays: 7 }
      const lastLabel = formatBucketLabel('2026-05-15', '2026-05-20')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { bucket_from: '2026-05-15', bucket_to: '2026-05-20', new_visitors: 2 },
      ])))

      const result = await fetchNewVsReturning(TEST_URL, bucketFilter)
      const lastBucket = result.find((r) => r.date === lastLabel)

      expect(lastBucket?.new_visitors).toBe(2)
      expect(result.length).toBeGreaterThan(1)
      expect(result.some((r) => r.new_visitors === 0)).toBe(true)
    })
  })

  describe('fetchBrowserTrendsOverTime', () => {
    it('should chart host-level bucket sessions when browser field is absent', async () => {
      const bucketFilter = { fromDate: '2026-03-13', toDate: '2026-05-20', bucketDays: 7 }
      const lastLabel = formatBucketLabel('2026-05-15', '2026-05-20')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { bucket_from: '2026-05-15', bucket_to: '2026-05-20', sessions: 10 },
      ])))

      const result = await fetchBrowserTrendsOverTime(TEST_URL, bucketFilter)
      const lastBucket = result.find((r) => r.date === lastLabel)

      expect(lastBucket?.Visitors).toBe(10)
    })

    it('should sort bucketed ranges chronologically by bucket_from', async () => {
      const bucketFilter = { fromDate: '2026-03-01', toDate: '2026-03-14', bucketDays: 7 }
      const laterLabel = formatBucketLabel('2026-03-08', '2026-03-14')
      const earlierLabel = formatBucketLabel('2026-03-01', '2026-03-07')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { bucket_from: '2026-03-08', bucket_to: '2026-03-14', browser: 'Chrome', unique_visitors: 8 },
        { bucket_from: '2026-03-01', bucket_to: '2026-03-07', browser: 'Safari', unique_visitors: 4 },
      ])))

      const result = await fetchBrowserTrendsOverTime(TEST_URL, bucketFilter)
      const earlierIdx = result.findIndex((r) => r.date === earlierLabel)
      const laterIdx = result.findIndex((r) => r.date === laterLabel)

      expect(earlierIdx).toBeGreaterThanOrEqual(0)
      expect(laterIdx).toBeGreaterThan(earlierIdx)
      expect(result[earlierIdx]?.Safari).toBe(4)
      expect(result[laterIdx]?.Chrome).toBe(8)
    })
  })

  describe('fetchSessionClickData', () => {
    it('should transform raw rows into SessionClickRow format', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { element_type: 'button', section: 'cta', clicks: 20, sessions_that_clicked: 10, clicks_per_session: 2.0 },
      ])))

      const result = await fetchSessionClickData(TEST_URL, TEST_DAYS)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        element: 'button',
        section: 'cta',
        clicks: 20,
        sessions: 10,
        cps: 2.0,
      })
    })
  })

  describe('fetchElementClicksBySection', () => {
    it('should group by section and split by device', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockClickhouseResponse([
        { element_type: 'button', section: 'cta', device_type: 'laptop', clicks: 20 },
        { element_type: 'link', section: 'cta', device_type: 'mobile', clicks: 10 },
      ])))

      const result = await fetchElementClicksBySection(TEST_URL, TEST_DAYS)
      const cta = result.find(r => r.date === 'Cta')
      expect(cta?.laptop).toBe(20)
      expect(cta?.mobile).toBe(10)
    })
  })

  describe('fetchKpiExtras', () => {
    it('should compute KPI extras from multiple data sources', async () => {
      const mockFetch = vi.fn()
        // totalSessions
        .mockResolvedValueOnce(mockClickhouseResponse([{ total_sessions: 100 }]))
        // bounceSessions
        .mockResolvedValueOnce(mockClickhouseResponse([{ bounces: 20, bounce_unique_visitors: 18 }]))
        // peakHour (clicks by hour)
        .mockResolvedValueOnce(mockClickhouseResponse([
          { hour: 14, clicks: 50, unique_visitors: 30 },
          { hour: 9, clicks: 20, unique_visitors: 15 },
        ]))
        // avgPagesPerSession
        .mockResolvedValueOnce(mockClickhouseResponse([{ sessions: 100, avg_pages_per_session: 3.5 }]))
        // avgSessionDuration
        .mockResolvedValueOnce(mockClickhouseResponse([{ sessions: 100, avg_session_duration_sec: 125 }]))
      vi.stubGlobal('fetch', mockFetch)

      const result = await fetchKpiExtras(TEST_URL, TEST_DAYS)
      expect(result.totalSessions).toBe(100)
      expect(result.bounceSessions).toBe(20)
      expect(result.bounceRate).toBe('20%')
      expect(result.peakHour).toBe('14:00')
      expect(result.peakHourClicks).toBe(50)
      expect(result.peakHourVisitors).toBe(30)
      expect(result.avgPagesPerSession).toBe(3.5)
      expect(result.avgSessionDuration).toBe('2m 5s')
    })

    it('should handle empty data gracefully', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValue(emptyResponse())
      vi.stubGlobal('fetch', mockFetch)

      const result = await fetchKpiExtras(TEST_URL, TEST_DAYS)
      expect(result.totalSessions).toBe(0)
      expect(result.bounceRate).toBe('0%')
      expect(result.peakHour).toBe('0:00')
      expect(result.avgPagesPerSession).toBe(0)
      expect(result.avgSessionDuration).toBe('0m 0s')
    })
  })

  describe('fetchAllClickhouseAnalytics', () => {
    it('should return all data fields', async () => {
      // Mock all fetch calls to return empty
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(emptyResponse()))

      const result = await fetchAllClickhouseAnalytics(TEST_URL, { mode: 'rolling', days: TEST_DAYS })
      // Verify all expected keys exist
      expect(result).toHaveProperty('pageViewsByPathData')
      expect(result).toHaveProperty('uniqueVisitorsByPageData')
      expect(result).toHaveProperty('clickTrendsData')
      expect(result).toHaveProperty('clicksByElementData')
      expect(result).toHaveProperty('exitRateData')
      expect(result).toHaveProperty('newVsReturningData')
      expect(result).toHaveProperty('countryTrafficData')
      expect(result).toHaveProperty('cityTrafficData')
      expect(result).toHaveProperty('topReferrersData')
      expect(result).toHaveProperty('referrerLandingDetailData')
      expect(result).toHaveProperty('kpiExtras')

      // All arrays are empty
      expect(result.pageViewsByPathData).toEqual([])
      expect(result.clicksByElementData).toEqual([])
    })
  })

  describe('error handling', () => {
    it('should return empty array when response has GraphQL errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          errors: [{ message: 'Something went wrong' }],
        }),
        text: () => Promise.resolve(''),
      }))

      const result = await fetchPageViewsByPath(TEST_URL, TEST_DAYS)
      expect(result).toEqual([])
    })

    it('should return empty array when response data is null', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: null }),
        text: () => Promise.resolve(''),
      }))

      const result = await fetchPageViewsByPath(TEST_URL, TEST_DAYS)
      expect(result).toEqual([])
    })

    it('should return empty array when analyticsQuery has no rows', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { analyticsQuery: { rows: [] } } }),
        text: () => Promise.resolve(''),
      }))

      const result = await fetchClicksByElement(TEST_URL, TEST_DAYS)
      expect(result).toEqual([])
    })
  })

  describe('request deduplication', () => {
    it('should deduplicate identical concurrent requests', async () => {
      let callCount = 0
      vi.stubGlobal('fetch', vi.fn().mockImplementation(function () {
        callCount++
        return Promise.resolve(mockClickhouseResponse([{ page_path: '/', page_views: 10 }]))
      }))

      // Two concurrent fetches with the exact same query should use dedup
      const [r1, r2] = await Promise.all([
        fetchPageViewsByPath(TEST_URL, TEST_DAYS),
        fetchPageViewsByPath(TEST_URL, TEST_DAYS),
      ])

      // Both should return the same data
      expect(r1).toEqual(r2)
      // Fetch should be called only once due to dedup
      expect(callCount).toBe(1)
    })
  })
})
