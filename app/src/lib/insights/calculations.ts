/**
 * Analytics Data Calculations
 *
 * Provides utilities for transforming and calculating analytics data.
 */

import type { DailyPageView } from './types'

/**
 * Format date for display
 *
 * @param date - Date to format
 * @returns Formatted date string (e.g., "21 Nov")
 */
export function formatDate(date: Date): string {
  return `${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })}`
}

/**
 * Transform daily breakdown from API response to DailyPageView format
 *
 * @param dailyBreakdown - Array of daily breakdown items from API
 * @returns Array of DailyPageView objects with formatted dates and cumulative counts
 */
export function transformDailyBreakdown(
  dailyBreakdown: Array<{ date: string; count: number }>
): DailyPageView[] {
  // Sort by date (oldest first) to calculate cumulative counts correctly
  const sorted = [...dailyBreakdown].sort((a, b) => {
    return new Date(a.date).getTime() - new Date(b.date).getTime()
  })

  let cumulativeCount = 0
  return sorted.map((item) => {
    cumulativeCount += item.count
    const date = new Date(item.date)
    
    return {
      date: formatDate(date),
      pageViews: item.count,
      cumulativeCount
    }
  })
}

