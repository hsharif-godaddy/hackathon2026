/**
 * Insights Data Fetchers
 *
 * Provides functions to fetch analytics data from the GraphQL API.
 */

import { logger } from '@/lib/request-context'
import { executeGraphQLQuery } from './client'
import { buildInsightCountDailyQuery, buildInsightCountQuery, buildUniqueCountQuery, extractCountFromResponse, extractDailyBreakdownFromResponse, extractUniqueCountFromResponse } from './queries'

/**
 * Fetch route-specific page views
 *
 * @param publishedUrl - Base published URL
 * @param route - Route path (e.g., "/", "/contact")
 * @param days - Number of days to query
 * @param authToken - Authentication token
 * @returns Page view count for the route
 */
export async function fetchRouteCount(
  publishedUrl: string,
  route: string,
  days: number
): Promise<number> {
  const routeUrl = route === '/' ? publishedUrl : `${publishedUrl}${route}`
  const query = buildInsightCountQuery(routeUrl, days)

  try {
    const result = await executeGraphQLQuery(query, `fetchRouteCount(${route})`)
    return extractCountFromResponse(result)
  } catch (error) {
    logger.debug('analytics.fetch.route.no-data', {
      route,
      routeUrl,
      error: error instanceof Error ? error.message : String(error)
    })
    return 0
  }
}

/**
 * Fetch page view count with daily breakdown in a single query
 *
 * @param publishedUrl - Published URL to query
 * @param days - Number of days to look back
 * @param authToken - Authentication token
 * @returns Object with total count and daily breakdown
 */
export async function fetchDailyPageViews(
  publishedUrl: string,
  days: number
): Promise<{ count: number; dailyBreakdown: Array<{ date: string; count: number }> }> {
  const query = buildInsightCountDailyQuery(publishedUrl, days)
  const result = await executeGraphQLQuery(query, `fetchDailyPageViews(days=${days})`)
  return extractDailyBreakdownFromResponse(result)
}

/**
 * Fetch unique visitor count for a URL
 *
 * @param publishedUrl - Full URL to query (e.g., "https://example.com/")
 * @param days - Number of days to look back
 * @param authToken - Authentication token
 * @returns Unique visitor count
 */
export async function fetchVisitors(
  publishedUrl: string,
  days: number
): Promise<number> {
  const query = buildUniqueCountQuery(publishedUrl, days)

  try {
    const result = await executeGraphQLQuery(query, `fetchVisitors(${publishedUrl})`)
    return extractUniqueCountFromResponse(result)
  } catch (error) {
    logger.debug('analytics.fetch.visitors.no-data', {
      publishedUrl,
      error: error instanceof Error ? error.message : String(error)
    })
    return 0
  }
}

