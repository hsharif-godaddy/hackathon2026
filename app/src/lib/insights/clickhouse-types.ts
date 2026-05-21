/**
 * ClickHouse Analytics Type Definitions
 *
 * Types for the ClickHouse-backed analytics GraphQL API (`analyticsQuery`).
 * These insights provide granular data for charts, tables, and KPI cards.
 */

// ─── Generic response shape ─────────────────────────────

/** Raw GraphQL response from `analyticsQuery` */
export interface ClickhouseGraphQLResponse {
  data?: {
    analyticsQuery?: {
      rows?: Array<{ data: string }>
    }
  }
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>
}

// ─── Chart data shapes (consumed by Recharts) ───────────

export interface ChartDataPoint {
  date: string
  value: number
  /** ISO start date for 7-day buckets; used to align padded chart axes */
  bucket_from?: string
}

export interface DualSeriesDataPoint {
  date: string
  value: number
  value2: number
}

export interface ComposedDataPoint {
  date: string
  value: number
  value2?: number
  rate?: number
}

export interface StackedBarDataPoint {
  date: string
  [key: string]: string | number
}

export interface MultiAreaDataPoint {
  date: string
  [key: string]: string | number
}

// ─── Table row shapes ───────────────────────────────────

export interface TableDataPoint {
  page: string
  visitors: number
}

export interface ReferrerLandingRow {
  referrer: string
  landingPage: string
  source: string
  visits: number
  uniqueVisitors: number
}

export interface SessionClickRow {
  element: string
  section: string
  clicks: number
  sessions: number
  cps: number
}

// ─── Row types for detail tables (geo, exit rate) ───────

export interface ExitRateRow {
  page: string
  views: number
  exits: number
  exitRate: string
}

export interface GeoTrafficRow {
  location: string
  sessions: number
  visitors: number
}

export interface CountryVisitorRow {
  country: string
  visitors: number
}

export interface ActivityHitRow {
  date: string
  pagePath: string
  pageName: string
  device: string
  referrer: string
  views: number
  uniqueVisitors: number
  country: string
  browser: string
}

export interface TopPageRow {
  pagePath: string
  pageName: string
  visitors: number
  totalViews: number
  referralVisits: number
  clicks: number
}

// ─── KPI extras ─────────────────────────────────────────

export interface KpiExtras {
  totalSessions: number
  bounceSessions: number
  bounceRate: string
  peakHour: string
  peakHourClicks: number
  peakHourVisitors: number
  avgPagesPerSession: number
  avgSessionDuration: string
}

// ─── Aggregated hook return value ───────────────────────

export interface ClickhouseAnalyticsData {
  // Host-level Pageviews (KPI tile + Live Data chart)
  totalHostPageViews: number
  totalHostUniqueVisitors: number
  dailyHostPageViews: ChartDataPoint[]

  // Daily unique visitors from airobuilder_unique_visitors_per_host
  dailyUniqueVisitors: ChartDataPoint[]
  // Daily total sessions from airobuilder_total_sessions (true session count)
  dailyTotalSessions: ChartDataPoint[]

  // Traffic Overview
  pageViewsByPathData: ChartDataPoint[]
  uniqueVisitorsByPageData: ChartDataPoint[]
  pageActivityShareData: ChartDataPoint[]

  // Click Analytics
  clickTrendsData: ChartDataPoint[]
  clicksByElementData: ChartDataPoint[]
  clicksPerPageData: ChartDataPoint[]
  clickActivityShareData: ChartDataPoint[]
  exitRateData: ComposedDataPoint[]

  // Visitor Insights
  newVsReturningData: StackedBarDataPoint[]
  browserSessionsData: MultiAreaDataPoint[]
  sessionsByDeviceData: ChartDataPoint[]

  // Geographic Insights
  countryTrafficData: DualSeriesDataPoint[]
  cityTrafficData: DualSeriesDataPoint[]

  // Navigation Patterns
  pageTransitionsTableData: TableDataPoint[]
  // Traffic Sources
  topReferrersData: DualSeriesDataPoint[]
  referrerLandingDetailData: ReferrerLandingRow[]

  // Click Deep Dive
  topCTALabelsData: DualSeriesDataPoint[]
  elementSectionData: DualSeriesDataPoint[]

  // CTA Performance
  avgClicksPerSessionData: ComposedDataPoint[]
  // Hourly Activity
  clicksByHourData: DualSeriesDataPoint[]
  hourlyPageviewVisitorData: MultiAreaDataPoint[]
  dailyTrendByPageData: MultiAreaDataPoint[]
  hourlyClicksByDeviceData: StackedBarDataPoint[]

  // Device Analytics
  deviceDistributionData: ChartDataPoint[]
  deviceMixOverTimeData: StackedBarDataPoint[]

  // Detail tables
  sessionClickData: SessionClickRow[]
  elementClicksBySectionData: StackedBarDataPoint[]

  // Activity (raw page views)
  activityHitsData: ActivityHitRow[]

  // KPIs (Row 2)
  kpiExtras: KpiExtras

  // Geo Pro Plan
  countryTrafficWithCodeData: import('./clickhouse-fetchers').CountryTrafficWithCodeRow[]
  cityTrafficWithCountryData: import('./clickhouse-fetchers').CityTrafficWithCountryRow[]

  // Device/Browser Trends
  browserTrendsOverTimeData: MultiAreaDataPoint[]

  // Loading state
  isLoading: boolean
  isFetched: boolean
  error: Error | null
}
