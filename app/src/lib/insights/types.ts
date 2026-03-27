/**
 * Insights API Type Definitions
 */

/**
 * GraphQL response type for insight count query
 */
export interface InsightCountResponse {
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
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>
}

/**
 * Daily page view data
 */
export interface DailyPageView {
  date: string
  pageViews: number
  cumulativeCount: number
}

/**
 * Daily click count data
 */
export interface DailyClickCount {
  date: string
  totalClicks: number
  cumulativeCount: number
}

/**
 * Route page view data
 */
export interface RoutePageView {
  route: string
  pageViews: number
}

/**
 * Error classification for retry logic
 */
export interface ErrorClassification {
  retryable: boolean
  category: 'network' | 'timeout' | 'rate_limit' | 'server_error' | 'client_error' | 'unknown'
  message: string
}

/**
 * Options for useInsightsAnalytics hook
 */
export interface UseInsightsAnalyticsOptions {
  publishedUrl: string | null
  appId?: string | null
  days?: number
  enabled?: boolean
}

/**
 * Analytics metrics including visitors and views per visit
 */
export interface AnalyticsMetrics {
  pageViews: number
  totalClicks: number
  visitors: number
  viewsPerVisit: number
}

