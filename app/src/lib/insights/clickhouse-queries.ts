/**
 * ClickHouse Analytics GraphQL Query Builders
 *
 * Builds `analyticsQuery` GraphQL queries for each ClickHouse insight.
 * All queries target: brand "godaddy", namespace "experimental".
 *
 * The `url` parameter should be the bare hostname (no protocol) of the published app,
 * e.g. "70mqshlu7h.c4.test-airoapp.ai".
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

function q(insightName: string, url: string, days: number, extras: Record<string, string | number> = {}): string {
  const safeUrl = escapeGraphQL(url)
  const safeInsight = escapeGraphQL(insightName)
  const filterParts = [`url: "${safeUrl}"`, `days: ${days}`]
  for (const [k, v] of Object.entries(extras)) {
    filterParts.push(typeof v === 'string' ? `${k}: "${escapeGraphQL(v)}"` : `${k}: ${v}`)
  }
  return `query { analyticsQuery(brand: "godaddy", namespace: "experimental", insightName: "${safeInsight}", filter: { ${filterParts.join(', ')} }) { rows { data } } }`
}

// ─── Traffic Overview ───────────────────────────────────

export const buildPageViewsPerPathQuery = (url: string, days: number) =>
  q('airobuilder_page_views_per_path', url, days, { recordType: 'page_stats' })

export const buildUniqueVisitorsPerPageQuery = (url: string, days: number) =>
  q('airobuilder_unique_visitors_per_page', url, days, { recordType: 'page_stats' })

export const buildPageActivityShareQuery = (url: string, days: number) =>
  q('airobuilder_page_activity_share', url, days, { recordType: 'page_stats' })

// ─── Click Analytics ────────────────────────────────────

export const buildClickAnalyticsHostTotalsQuery = (url: string, days: number) =>
  q('airobuilder_click_analytics_host_totals', url, days, { recordType: 'host_totals', limit: 50 })

export const buildClicksByElementQuery = (url: string, days: number) =>
  q('airobuilder_clicks_by_element', url, days, { recordType: 'by_element_all_devices', limit: 50 })

export const buildClicksPerPageQuery = (url: string, days: number) =>
  q('airobuilder_clicks_per_page', url, days, { recordType: 'by_page_all_devices', limit: 50 })

export const buildClickActivityShareQuery = (url: string, days: number) =>
  q('airobuilder_click_activity_share', url, days, { recordType: 'by_page_all_devices' })

export const buildExitRateQuery = (url: string, days: number) =>
  q('airobuilder_exit_rate', url, days, { recordType: 'exit_rate' })

// ─── Visitor Insights ───────────────────────────────────

export const buildReturningVisitorsQuery = (url: string, days: number) =>
  q('airobuilder_returning_visitors', url, days, { recordType: 'new_returning' })

export const buildBrowsersForVisitorsQuery = (url: string, days: number) =>
  q('airobuilder_browsers_for_visitors', url, days, { recordType: 'host_stats_browser' })

export const buildSessionsByDeviceTypeQuery = (url: string, days: number) =>
  q('airobuilder_sessions_by_device_type', url, days, { recordType: 'session_depth' })

// ─── Geographic Insights ────────────────────────────────

export const buildCountryTrafficQuery = (url: string, days: number) =>
  q('airobuilder_country_traffic', url, days, { recordType: 'geo_country' })

export const buildCityTrafficQuery = (url: string, days: number) =>
  q('airobuilder_city_traffic', url, days, { recordType: 'geo_city' })

export const buildBounceSessionsQuery = (url: string, days: number) =>
  q('airobuilder_bounce_sessions_landing_page', url, days, { recordType: 'bounce_stats' })

// ─── Navigation Patterns ────────────────────────────────

export const buildPageTransitionsQuery = (url: string, days: number) =>
  q('airobuilder_page_transitions', url, days, { recordType: 'page_transitions' })

// ─── Traffic Sources ────────────────────────────────────

export const buildTopReferrersQuery = (url: string, days: number) =>
  q('airobuilder_top_referrers', url, days, { recordType: 'top_referrers' })

export const buildReferrerLandingPageQuery = (url: string, days: number) =>
  q('airobuilder_referrer_landing_page', url, days, { recordType: 'referrer_to_landing' })

// ─── Click Deep Dive ────────────────────────────────────

export const buildClicksByElementTextQuery = (url: string, days: number) =>
  q('airobuilder_clicks_by_element_text', url, days, { recordType: 'by_element_text' })

export const buildClicksByElementPerDeviceQuery = (url: string, days: number) =>
  q('airobuilder_clicks_by_element_per_device', url, days, { recordType: 'by_element' })

// ─── CTA / Sessions ────────────────────────────────────

export const buildClicksPerSessionQuery = (url: string, days: number) =>
  q('airobuilder_clicks_per_session', url, days, { recordType: 'sessions' })

// ─── Hourly Activity ────────────────────────────────────

export const buildClicksByHourAllDevicesQuery = (url: string, days: number) =>
  q('airobuilder_clicks_by_hour_all_devices', url, days, { recordType: 'by_hour_all_devices' })

export const buildHostHourlyPageviewsQuery = (url: string, days: number) =>
  q('airobuilder_host_hourly_pageviews', url, days, { recordType: 'host_hourly' })

export const buildHostHourlyVisitorsQuery = (url: string, days: number) =>
  q('airobuilder_host_hourly_visitors', url, days, { recordType: 'host_hourly' })

// ─── KPI Metrics ────────────────────────────────────────

export const buildTotalSessionsQuery = (url: string, days: number) =>
  q('airobuilder_total_sessions', url, days, { recordType: 'session_depth' })

export const buildAvgPagesPerSessionQuery = (url: string, days: number) =>
  q('airobuilder_avg_pages_per_session', url, days, { recordType: 'referrer_quality' })

export const buildAvgSessionDurationQuery = (url: string, days: number) =>
  q('airobuilder_avg_session_duration', url, days, { recordType: 'referrer_quality' })

// ─── Raw / Multi-report ─────────────────────────────────

export const buildPageViewsPerHostQuery = (url: string, days: number) =>
  q('airobuilder_page_views_per_host', url, days, { recordType: 'host_stats' })

export const buildRawPageViewsQuery = (url: string, days: number) =>
  q('airobuilder_raw_page_views', url, days, { limit: 20 })
