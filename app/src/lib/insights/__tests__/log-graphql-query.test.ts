import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockInfo = vi.fn()

vi.mock('@/lib/request-context', () => ({
  logger: { info: (...args: unknown[]) => mockInfo(...args) },
}))

import { insightNameFromQuery, logGraphqlRequest } from '../log-graphql-query'

describe('log-graphql-query', () => {
  beforeEach(() => {
    mockInfo.mockClear()
  })

  describe('#insightNameFromQuery', () => {
    it('should return unknown when insightName is missing', function missingInsight() {
      expect(insightNameFromQuery('query { analyticsQuery { rows { data } } }')).toBe('unknown')
    })
  })

  describe('#logGraphqlRequest', () => {
    it('should not throw when filter fields are absent', function absentFields() {
      expect(() => logGraphqlRequest('app-1', 'query { analyticsQuery { rows { data } } }')).not.toThrow()
      expect(mockInfo).toHaveBeenCalledWith('analytics.graphql.request', {
        appId: 'app-1',
        insightName: 'unknown',
        queryLength: expect.any(Number),
      })
    })

    it('should not throw for empty query string', function emptyQuery() {
      expect(() => logGraphqlRequest('app-1', '')).not.toThrow()
      expect(mockInfo).toHaveBeenCalledWith('analytics.graphql.request', {
        appId: 'app-1',
        insightName: 'unknown',
        queryLength: 0,
      })
    })

    it('should omit empty string filter values', function emptyStrings() {
      logGraphqlRequest(
        'app-1',
        'query { analyticsQuery(insightName: "airobuilder_raw_page_views", filter: { url: "", fromDate: "", toDate: "" }) { rows { data } } }',
      )
      const payload = mockInfo.mock.calls[0][1] as Record<string, unknown>
      expect(payload.insightName).toBe('airobuilder_raw_page_views')
      expect(payload).not.toHaveProperty('url')
      expect(payload).not.toHaveProperty('fromDate')
      expect(payload).not.toHaveProperty('toDate')
    })

    it('should include present filter fields', function presentFields() {
      logGraphqlRequest(
        'app-1',
        'query { analyticsQuery(insightName: "airobuilder_page_views_per_host", filter: { url: "host.example.com", fromDate: "2026-04-14", toDate: "2026-05-20", bucketDays: 7, recordType: "host_stats" }) { rows { data } } }',
      )
      expect(mockInfo).toHaveBeenCalledWith('analytics.graphql.request', {
        appId: 'app-1',
        insightName: 'airobuilder_page_views_per_host',
        queryLength: expect.any(Number),
        url: 'host.example.com',
        fromDate: '2026-04-14',
        toDate: '2026-05-20',
        bucketDays: 7,
        recordType: 'host_stats',
      })
    })
  })
})
