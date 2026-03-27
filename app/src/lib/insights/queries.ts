/**
 * Insights GraphQL Query Builders
 *
 * Provides type-safe GraphQL query construction for insights API.
 */

/**
 * Escape a string for safe inclusion inside a GraphQL double-quoted string literal.
 * Handles backslashes, double quotes, and control characters.
 */
function escapeGraphQL(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

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

const INSIGHT_PAGE_VIEW = 'airo_builder_c2_page_view'

/**
 * Build GraphQL query for page view count with daily breakdown by URL (non-wildcard).
 *
 * @param keyByValue - Published URL to query (normalized to trailing slash)
 * @param days - Number of days to look back
 * @returns GraphQL query string
 */
function buildPageViewsDailyQuery(keyByValue: string, days: number): string {
  const normalizedUrl = escapeGraphQL(normalizeUrl(keyByValue))
  return `
    query PageViewsByValueDaily {
      insightCountByValueDaily(
        filter: {
          operationType: ITEMIZE
          keyByValue: "${normalizedUrl}"
          days: ${days}
        }
      ) {
        brand(brand: "godaddy") {
          namespace(namespace: "experimental") {
            insightName(insight: "${escapeGraphQL(INSIGHT_PAGE_VIEW)}") {
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

function buildClickEventsWildcardQuery(publishedUrl: string, days: number): string {
  const origin = new URL(normalizeUrl(publishedUrl)).origin
  const httpsOrigin = origin.replace(/^http:\/\//, 'https://')
  const keyByValueWildcard = escapeGraphQL(`airo.website.click~~~${httpsOrigin}/*~~~*`)
  return `
  query clickCountDailyWildCard {
    insightCountByValueDailyAnyWildcard(
      filter: {
        days: ${days}
        keyByValueWildcard: "${keyByValueWildcard}"
        operationType: ITEMIZE
      }
    ) {
      brand(brand: "godaddy") {
        namespace(namespace: "experimental") {
          insightName(insight: "airo_builder_c2_click_events") {
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

function buildClickTypeWildcardQuery(publishedUrl: string, days: number, clickType: 'button' | 'link'): string {
  const origin = new URL(normalizeUrl(publishedUrl)).origin
  const httpsOrigin = origin.replace(/^http:\/\//, 'https://')
  const keyByValueWildcard = escapeGraphQL(`airo.website.click~~~${httpsOrigin}/*~~~${clickType}~~~*`)
  return `
  query clickCountDailyWildCard {
    insightCountByValueDailyAnyWildcard(
      filter: {
        days: ${days}
        keyByValueWildcard: "${keyByValueWildcard}"
        operationType: ITEMIZE
      }
    ) {
      brand(brand: "godaddy") {
        namespace(namespace: "experimental") {
          insightName(insight: "airo_builder_c2_click_events") {
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
 * Build GraphQL query for insight count by value
 *
 * @param keyByValue - URL or route to query (will be normalized to end with /)
 * @param days - Number of days to look back
 * @param insightName - Insight name to query
 * @returns GraphQL query string
 */
export function buildInsightCountQuery(keyByValue: string, days: number, insightName = INSIGHT_PAGE_VIEW): string {
  const normalizedUrl = escapeGraphQL(normalizeUrl(keyByValue))
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
            insightName(insight: "${escapeGraphQL(insightName)}") {
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
  const normalizedUrl = escapeGraphQL(normalizeUrl(keyByValue))
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
            insightName(insight: "${escapeGraphQL(INSIGHT_PAGE_VIEW)}") {
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
 * Build GraphQL query for page view count by value with daily breakdown (non-wildcard).
 *
 * @param keyByValue - Published URL to query (normalized to trailing slash)
 * @param days - Number of days to look back
 * @param insightName - Insight name (default INSIGHT_PAGE_VIEW; kept for API compatibility)
 * @returns GraphQL query string
 */
export function buildInsightCountDailyQuery(keyByValue: string, days: number, insightName = INSIGHT_PAGE_VIEW): string {
  void insightName
  return buildPageViewsDailyQuery(keyByValue, days)
}

/**
 * Build GraphQL query for click events with daily breakdown.
 * Uses wildcard query filtered by published app origin.
 *
 * @param keyByValue - Published app URL (origin used in wildcard filter)
 * @param days - Number of days to look back
 * @returns GraphQL query string
 */
export function buildClickEventsDailyQuery(keyByValue: string, days: number): string {
  return buildClickEventsWildcardQuery(keyByValue, days)
}

/**
 * Build GraphQL query for button clicks with daily breakdown.
 * Uses wildcard: airo.website.click~~~{origin}/*~~~button~~~*
 */
export function buildButtonClicksDailyQuery(keyByValue: string, days: number): string {
  return buildClickTypeWildcardQuery(keyByValue, days, 'button')
}

/**
 * Build GraphQL query for link clicks with daily breakdown.
 * Uses wildcard: airo.website.click~~~{origin}/*~~~link~~~*
 */
export function buildLinkClicksDailyQuery(keyByValue: string, days: number): string {
  return buildClickTypeWildcardQuery(keyByValue, days, 'link')
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
    insightCountByValueDailyAnyWildcard?: {
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
    ?? response.data?.insightCountByValueDailyAnyWildcard?.brand?.namespace?.insightName
  return {
    count: insightName?.count || 0,
    dailyBreakdown: insightName?.dailyBreakdown || []
  }
}

