import { beforeEach, describe, expect, it, vi } from 'vitest'

import { appFetch } from '@/lib/gasket-config'
import { resolveAnalyticsDateRange } from '@/lib/insights/clickhouse-queries'
import {
  aggregateBusinessAnalyticsMetrics,
  fetchBusinessAnalyticsSourceData,
  fetchReportingCube,
  fetchReportingDatasheet,
  formatCommerceCurrency,
  parseReportingPageInfo,
} from '../commerce-reporting'

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}))

vi.mock('@/lib/insights/clickhouse-queries', async () => ({
  ...(await vi.importActual<typeof import('@/lib/insights/clickhouse-queries')>('@/lib/insights/clickhouse-queries')),
  resolveAnalyticsDateRange: vi.fn(),
}))

describe('commerce-reporting', function packageTests() {
  describe('#aggregateBusinessAnalyticsMetrics', function aggregateBusinessAnalyticsMetricsTests() {
    it('sums revenue series for total revenue', function revenue() {
      const metrics = aggregateBusinessAnalyticsMetrics({
        orderCountOverTime: [
          { date: '2026-06-03', value: 1 },
          { date: '2026-06-10', value: 2 },
        ],
        revenueOverTime: [
          { date: '2026-06-03', value: 50 },
          { date: '2026-06-10', value: 100 },
        ],
      })

      expect(metrics.totalRevenue).toBe(150)
      expect(metrics.orderCountOverTime).toEqual([
        { date: '2026-06-03', value: 1 },
        { date: '2026-06-10', value: 2 },
      ])
      expect(metrics.revenueOverTime).toEqual([
        { date: '2026-06-03', value: 50 },
        { date: '2026-06-10', value: 100 },
      ])
    })

    it('returns zero revenue when cube series are empty', function empty() {
      const metrics = aggregateBusinessAnalyticsMetrics({
        orderCountOverTime: [],
        revenueOverTime: [],
      })

      expect(metrics.totalRevenue).toBe(0)
    })
  })

  describe('#parseReportingPageInfo', function parseReportingPageInfoTests() {
    it('reads cursor pagination metadata from reporting responses', function pageInfo() {
      expect(parseReportingPageInfo({
        items: [{ id: 'order-1' }],
        pageInfo: {
          hasNextPage: true,
          hasPreviousPage: false,
          startCursor: 'cursor-start',
          endCursor: 'cursor-end',
        },
      })).toEqual({
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: 'cursor-start',
        endCursor: 'cursor-end',
      })
    })

    it('returns null for invalid pagination payloads', function invalid() {
      expect(parseReportingPageInfo(null)).toBeNull()
      expect(parseReportingPageInfo({ items: [] })).toBeNull()
    })
  })

  describe('#fetchReportingDatasheet', function fetchReportingDatasheetTests() {
    beforeEach(() => {
      vi.mocked(appFetch).mockReset()
    })

    it('fetches every page until hasNextPage is false', async function pages() {
      vi.mocked(appFetch)
        .mockResolvedValueOnce(new Response(JSON.stringify({
          items: [{ id: 'pay-1', totalAmount: 100, status: 'PAID', createdAt: '2026-06-01T00:00:00.000Z' }],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          items: [{ id: 'pay-2', totalAmount: 200, status: 'PAID', createdAt: '2026-06-02T00:00:00.000Z' }],
          pageInfo: { hasNextPage: false, endCursor: 'cursor-2' },
        }), { status: 200 }))

      const rows = await fetchReportingDatasheet({
        appId: 'app-1',
        storeId: 'store-1',
        datasheet: 'payments',
        fields: ['id', 'totalAmount', 'status', 'createdAt'],
        startTime: '2020-01-01T00:00:00.000Z',
        endTime: '2026-06-10T00:00:00.000Z',
      })

      expect(rows).toHaveLength(2)
      expect(vi.mocked(appFetch)).toHaveBeenCalledTimes(2)
    })

    it('throws when the reporting request fails', async function error() {
      vi.mocked(appFetch).mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'Reporting unavailable',
      }), { status: 503 }))

      await expect(fetchReportingDatasheet({
        appId: 'app-1',
        storeId: 'store-1',
        datasheet: 'payments',
        fields: ['id'],
        startTime: '2020-01-01T00:00:00.000Z',
        endTime: '2026-06-10T00:00:00.000Z',
      })).rejects.toThrow('Reporting unavailable')
    })
  })

  describe('#fetchReportingCube', function fetchReportingCubeTests() {
    beforeEach(() => {
      vi.mocked(appFetch).mockReset()
    })

    it('fetches cube pages with query and pagination in the request body', async function cube() {
      vi.mocked(appFetch).mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ 'pgOrders.count': '3' }],
        pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
      }), { status: 200 }))

      const query = { measures: ['pgOrders.count'] }
      const rows = await fetchReportingCube({
        appId: 'app-1',
        storeId: 'store-1',
        query,
      })

      expect(rows).toHaveLength(1)
      const body = JSON.parse(String(vi.mocked(appFetch).mock.calls[0][1]?.body))
      expect(body.query).toEqual(query)
      expect(body.pagination).toEqual({ first: 10_000 })
    })
  })

  describe('#fetchBusinessAnalyticsSourceData', function fetchBusinessAnalyticsSourceDataTests() {
    beforeEach(() => {
      vi.mocked(appFetch).mockReset()
      vi.mocked(resolveAnalyticsDateRange).mockReturnValue({
        start: new Date('2026-06-01T00:00:00.000Z'),
        end: new Date('2026-06-10T12:00:00.000Z'),
      })
    })

    it('returns order metrics from ordersTimeSeries datasheet rows', async function timeSeries() {
      vi.mocked(appFetch).mockResolvedValueOnce(new Response(JSON.stringify({
        items: [
          { timeIntervalStart: '2026-06-03T00:00:00.000Z', count: 2, sumTotal: 10000 },
        ],
        pageInfo: { hasNextPage: false },
      }), { status: 200 }))

      const result = await fetchBusinessAnalyticsSourceData('app-1', 'store-1', { mode: 'rolling', days: 7 })

      expect(vi.mocked(appFetch)).toHaveBeenCalledTimes(1)
      const body = JSON.parse(String(vi.mocked(appFetch).mock.calls[0][1]?.body))
      expect(body.datasheet).toBe('ordersTimeSeries')
      expect(body.fields).toEqual(['count', 'sumTotal'])
      expect(body.interval).toBe('daily')
      expect(body.tz).toBe('UTC')
      expect(body.filters).toEqual([
        { field: 'processedAt', operation: 'gte', value: '2026-06-01T00:00:00.000Z' },
        { field: 'processedAt', operation: 'lte', value: '2026-06-10T12:00:00.000Z' },
      ])
      expect(result.orderCountOverTime.find((point) => point.date === '2026-06-03')?.value).toBe(2)
      expect(result.revenueOverTime.find((point) => point.date === '2026-06-03')?.value).toBe(100)
    })

    it('returns zero-filled series when datasheet data is empty', async function emptyDatasheet() {
      vi.mocked(appFetch).mockResolvedValueOnce(new Response(JSON.stringify({
        data: [],
        pageInfo: { hasNextPage: false },
      }), { status: 200 }))

      const result = await fetchBusinessAnalyticsSourceData('app-1', 'store-1', { mode: 'rolling', days: 7 })

      expect(result.orderCountOverTime.every((point) => point.value === 0)).toBe(true)
      expect(result.revenueOverTime.every((point) => point.value === 0)).toBe(true)
    })

    it('throws when datasheet query fails', async function datasheetFailure() {
      vi.mocked(appFetch).mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'Reporting unavailable',
      }), { status: 503 }))

      await expect(
        fetchBusinessAnalyticsSourceData('app-1', 'store-1', { mode: 'rolling', days: 7 }),
      ).rejects.toThrow('Reporting unavailable')
    })
  })

  describe('#formatCommerceCurrency', function formatCommerceCurrencyTests() {
    it('formats USD currency values', function usd() {
      expect(formatCommerceCurrency(125.5)).toBe('$125.50')
    })

    it('formats zero and negative values', function edge() {
      expect(formatCommerceCurrency(0)).toBe('$0.00')
      expect(formatCommerceCurrency(-10)).toBe('-$10.00')
    })
  })
})
