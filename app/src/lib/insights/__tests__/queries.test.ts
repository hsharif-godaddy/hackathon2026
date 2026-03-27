import { describe, expect, it } from 'vitest'

import {
  buildButtonClicksDailyQuery,
  buildClickEventsDailyQuery,
  buildInsightCountDailyQuery,
  buildInsightCountQuery,
  buildLinkClicksDailyQuery,
  buildUniqueCountQuery,
  extractCountFromResponse,
  extractDailyBreakdownFromResponse,
  extractUniqueCountFromResponse,
} from '../queries'

const TEST_URL = 'https://example.test-airoapp.ai'
const TEST_DAYS = 7

describe('queries', () => {
  describe('buildInsightCountQuery', () => {
    it('should produce a valid GraphQL query with normalized URL', () => {
      const query = buildInsightCountQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightCountByValue')
      expect(query).toContain(`keyByValue: "${TEST_URL}/"`)
      expect(query).toContain(`days: ${TEST_DAYS}`)
      expect(query).toContain('brand: "godaddy"')
      expect(query).toContain('namespace: "experimental"')
    })

    it('should not double-add trailing slash if already present', () => {
      const query = buildInsightCountQuery(`${TEST_URL}/`, TEST_DAYS)
      expect(query).toContain(`keyByValue: "${TEST_URL}/"`)
      expect(query).not.toContain(`keyByValue: "${TEST_URL}//"`)
    })

    it('should use default insight name airo_builder_c2_page_view', () => {
      const query = buildInsightCountQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insight: "airo_builder_c2_page_view"')
    })

    it('should accept custom insight name', () => {
      const query = buildInsightCountQuery(TEST_URL, TEST_DAYS, 'custom_insight')
      expect(query).toContain('insight: "custom_insight"')
    })
  })

  describe('buildUniqueCountQuery', () => {
    it('should produce a uniqueCountByValue query', () => {
      const query = buildUniqueCountQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('uniqueCountByValue')
      expect(query).toContain(`keyByValue: "${TEST_URL}/"`)
      expect(query).toContain(`days: ${TEST_DAYS}`)
    })
  })

  describe('buildInsightCountDailyQuery', () => {
    it('should produce an insightCountByValueDaily query', () => {
      const query = buildInsightCountDailyQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightCountByValueDaily')
      expect(query).toContain('dailyBreakdown')
      expect(query).toContain(`keyByValue: "${TEST_URL}/"`)
    })
  })

  describe('buildClickEventsDailyQuery', () => {
    it('should produce a wildcard query with https origin', () => {
      const query = buildClickEventsDailyQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightCountByValueDailyAnyWildcard')
      expect(query).toContain('airo.website.click~~~https://example.test-airoapp.ai/*~~~*')
      expect(query).toContain('airo_builder_c2_click_events')
    })

    it('should convert http to https origin', () => {
      const query = buildClickEventsDailyQuery('http://example.test-airoapp.ai', TEST_DAYS)
      expect(query).toContain('airo.website.click~~~https://example.test-airoapp.ai/*~~~*')
    })
  })

  describe('buildButtonClicksDailyQuery', () => {
    it('should include button in wildcard pattern', () => {
      const query = buildButtonClicksDailyQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('airo.website.click~~~https://example.test-airoapp.ai/*~~~button~~~*')
    })
  })

  describe('buildLinkClicksDailyQuery', () => {
    it('should include link in wildcard pattern', () => {
      const query = buildLinkClicksDailyQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('airo.website.click~~~https://example.test-airoapp.ai/*~~~link~~~*')
    })
  })

  describe('GraphQL escaping', () => {
    it('should escape double quotes in URL', () => {
      const query = buildInsightCountQuery('https://test"site.com', 7)
      // Should not produce malformed GraphQL
      expect(query).toContain('keyByValue: "https://test\\"site.com/"')
    })

    it('should escape backslashes in URL', () => {
      const query = buildInsightCountQuery('https://test\\site.com', 7)
      expect(query).toContain('test\\\\site.com')
    })

    it('should escape newlines in URL', () => {
      const query = buildInsightCountQuery('https://test\nsite.com', 7)
      expect(query).toContain('test\\nsite.com')
    })

    it('should escape special chars in custom insight names', () => {
      const query = buildInsightCountQuery(TEST_URL, 7, 'my"insight')
      expect(query).toContain('insight: "my\\"insight"')
    })
  })

  describe('extractCountFromResponse', () => {
    it('should extract count from valid response', () => {
      const response = {
        data: {
          insightCountByValue: {
            brand: {
              namespace: {
                insightName: {
                  count: 42
                }
              }
            }
          }
        }
      }
      expect(extractCountFromResponse(response)).toBe(42)
    })

    it('should return 0 for missing data', () => {
      expect(extractCountFromResponse({})).toBe(0)
    })

    it('should return 0 for partial response', () => {
      expect(extractCountFromResponse({ data: {} })).toBe(0)
      expect(extractCountFromResponse({ data: { insightCountByValue: {} } })).toBe(0)
    })

    it('should return 0 when count is 0', () => {
      const response = {
        data: {
          insightCountByValue: {
            brand: {
              namespace: {
                insightName: {
                  count: 0
                }
              }
            }
          }
        }
      }
      expect(extractCountFromResponse(response)).toBe(0)
    })
  })

  describe('extractUniqueCountFromResponse', () => {
    it('should extract count from valid response', () => {
      const response = {
        data: {
          uniqueCountByValue: {
            brand: {
              namespace: {
                insightName: {
                  count: 15
                }
              }
            }
          }
        }
      }
      expect(extractUniqueCountFromResponse(response)).toBe(15)
    })

    it('should return 0 for missing data', () => {
      expect(extractUniqueCountFromResponse({})).toBe(0)
    })
  })

  describe('extractDailyBreakdownFromResponse', () => {
    it('should extract from insightCountByValueDaily response', () => {
      const response = {
        data: {
          insightCountByValueDaily: {
            brand: {
              namespace: {
                insightName: {
                  count: 100,
                  dailyBreakdown: [
                    { date: '2026-03-01', count: 50 },
                    { date: '2026-03-02', count: 50 },
                  ]
                }
              }
            }
          }
        }
      }
      const result = extractDailyBreakdownFromResponse(response)
      expect(result.count).toBe(100)
      expect(result.dailyBreakdown).toHaveLength(2)
      expect(result.dailyBreakdown[0]).toEqual({ date: '2026-03-01', count: 50 })
    })

    it('should extract from wildcard response', () => {
      const response = {
        data: {
          insightCountByValueDailyAnyWildcard: {
            brand: {
              namespace: {
                insightName: {
                  count: 75,
                  dailyBreakdown: [{ date: '2026-03-01', count: 75 }]
                }
              }
            }
          }
        }
      }
      const result = extractDailyBreakdownFromResponse(response)
      expect(result.count).toBe(75)
      expect(result.dailyBreakdown).toHaveLength(1)
    })

    it('should return empty defaults for missing data', () => {
      const result = extractDailyBreakdownFromResponse({})
      expect(result.count).toBe(0)
      expect(result.dailyBreakdown).toEqual([])
    })
  })
})
