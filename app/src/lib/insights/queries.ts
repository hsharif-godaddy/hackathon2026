/**
 * Insights GraphQL Query Builders
 *
 * Provides type-safe GraphQL query construction for insights API.
 */

/**
 * Normalize URL to ensure it ends with a trailing slash
 *
 * @param url - URL to normalize
 * @returns URL with trailing slash
 */
function normalizeUrl(url: string): string {
  // If URL doesn't end with /, add it
  return url.endsWith('/') ? url : `${url}/`
}

/**
 * Build GraphQL query for insight count by value
 *
 * @param keyByValue - URL or route to query (will be normalized to end with /)
 * @param days - Number of days to look back
 * @returns GraphQL query string
 */
export function buildInsightCountQuery(keyByValue: string, days: number): string {
  const normalizedUrl = normalizeUrl(keyByValue)
  return `
    query InsightCountByValue {
      insightCountByValue(
        filter: {
          operationType: ITEMIZE
          keyByValue: "${normalizedUrl}"
          days: ${days}
        }
      ) {
        brand(brand: "godaddy") {
          namespace(namespace: "experimental") {
            insightName(insight: "airo_builder_c2_page_view") {
              count
            }
          }
        }
      }
    }
  `
}

/**
 * Build GraphQL query for unique count by value (visitors)
 *
 * @param keyByValue - Full URL to query (will be normalized to end with /)
 * @param days - Number of days to look back
 * @returns GraphQL query string
 */
export function buildUniqueCountQuery(keyByValue: string, days: number): string {
  const normalizedUrl = normalizeUrl(keyByValue)
  return `
    query UniqueCountByValue {
      uniqueCountByValue(
        filter: {
          keyByValue: "${normalizedUrl}"
          days: ${days}
        }
      ) {
        brand(brand: "godaddy") {
          namespace(namespace: "experimental") {
            insightName(insight: "airo_builder_c2_page_view") {
              count
            }
          }
        }
      }
    }
  `
}

/**
 * Extract count from GraphQL response
 *
 * @param response - GraphQL response
 * @returns Page view count or 0 if not found
 */
export function extractCountFromResponse(response: {
  data?: {
    insightCountByValue?: {
      brand?: {
        namespace?: {
          insightName?: {
            count?: number
          }
        }
      }
    }
  }
}): number {
  return response.data?.insightCountByValue?.brand?.namespace?.insightName?.count || 0
}

/**
 * Build GraphQL query for insight count by value with daily breakdown
 *
 * @param keyByValue - URL or route to query (will be normalized to end with /)
 * @param days - Number of days to look back
 * @returns GraphQL query string
 */
export function buildInsightCountDailyQuery(keyByValue: string, days: number): string {
  const normalizedUrl = normalizeUrl(keyByValue)
  return `
    query InsightCountByValue {
      insightCountByValueDaily(
        filter: {
          operationType: ITEMIZE
          keyByValue: "${normalizedUrl}"
          days: ${days}
        }
      ) {
        brand(brand: "godaddy") {
          namespace(namespace: "experimental") {
            insightName(insight: "airo_builder_c2_page_view") {
              count
              dailyBreakdown {
                date
                count
              }
            }
          }
        }
      }
    }
  `
}

/**
 * Extract unique count from GraphQL response (visitors)
 *
 * @param response - GraphQL response
 * @returns Visitor count or 0 if not found
 */
export function extractUniqueCountFromResponse(response: {
  data?: {
    uniqueCountByValue?: {
      brand?: {
        namespace?: {
          insightName?: {
            count?: number
          }
        }
      }
    }
  }
}): number {
  return response.data?.uniqueCountByValue?.brand?.namespace?.insightName?.count || 0
}

/**
 * Extract daily breakdown from GraphQL response
 *
 * @param response - GraphQL response with daily breakdown
 * @returns Object with total count and daily breakdown array
 */
export function extractDailyBreakdownFromResponse(response: {
  data?: {
    insightCountByValueDaily?: {
      brand?: {
        namespace?: {
          insightName?: {
            count?: number
            dailyBreakdown?: Array<{
              date: string
              count: number
            }>
          }
        }
      }
    }
    insightCountByValue?: unknown
    uniqueCountByValue?: unknown
  }
}): { count: number; dailyBreakdown: Array<{ date: string; count: number }> } {
  const insightName = response.data?.insightCountByValueDaily?.brand?.namespace?.insightName
  return {
    count: insightName?.count || 0,
    dailyBreakdown: insightName?.dailyBreakdown || []
  }
}

