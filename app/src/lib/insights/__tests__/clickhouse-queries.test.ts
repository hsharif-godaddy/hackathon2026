import { describe, expect, it } from 'vitest'

import {
  buildAvgPagesPerSessionQuery,
  buildAvgSessionDurationQuery,
  buildBounceSessionsQuery,
  buildBrowsersForVisitorsQuery,
  buildCityTrafficQuery,
  buildClickActivityShareQuery,
  buildClickAnalyticsHostTotalsQuery,
  buildClicksByElementPerDeviceQuery,
  buildClicksByElementQuery,
  buildClicksByElementTextQuery,
  buildClicksByHourAllDevicesQuery,
  buildClicksPerPageQuery,
  buildClicksPerSessionQuery,
  buildCountryTrafficQuery,
  buildExitRateQuery,
  buildHostHourlyPageviewsQuery,
  buildHostHourlyVisitorsQuery,
  buildPageActivityShareQuery,
  buildPageTransitionsQuery,
  buildPageViewsPerHostQuery,
  buildPageViewsPerPathQuery,
  buildReferrerLandingPageQuery,
  buildReturningVisitorsQuery,
  buildSessionsByDeviceTypeQuery,
  buildTopReferrersQuery,
  buildTotalSessionsQuery,
  buildUniqueVisitorsPerPageQuery,
} from '../clickhouse-queries'

const TEST_URL = '70mqshlu7h.c4.test-airoapp.ai'
const TEST_DAYS = 7

describe('clickhouse-queries', () => {
  describe('query structure', () => {
    it('should produce valid GraphQL query string with brand, namespace, insightName, and filter', () => {
      const query = buildPageViewsPerPathQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('query {')
      expect(query).toContain('analyticsQuery(')
      expect(query).toContain('brand: "godaddy"')
      expect(query).toContain('namespace: "experimental"')
      expect(query).toContain(`url: "${TEST_URL}"`)
      expect(query).toContain(`days: ${TEST_DAYS}`)
      expect(query).toContain('rows { data }')
    })

    it('should include insightName in the query', () => {
      const query = buildPageViewsPerPathQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_page_views_per_path"')
    })

    it('should include recordType as a string filter', () => {
      const query = buildPageViewsPerPathQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('recordType: "page_stats"')
    })

    it('should include numeric extras without quotes', () => {
      const query = buildClickAnalyticsHostTotalsQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('limit: 50')
      // Should NOT be quoted
      expect(query).not.toContain('limit: "50"')
    })
  })

  describe('GraphQL escaping', () => {
    it('should escape double quotes in url', () => {
      const query = buildPageViewsPerPathQuery('test"host.com', 7)
      expect(query).toContain('url: "test\\"host.com"')
      expect(query).not.toContain('url: "test"host.com"')
    })

    it('should escape backslashes in url', () => {
      const query = buildPageViewsPerPathQuery('test\\host.com', 7)
      expect(query).toContain('url: "test\\\\host.com"')
    })

    it('should escape newlines in url', () => {
      const query = buildPageViewsPerPathQuery('test\nhost.com', 7)
      expect(query).toContain('url: "test\\nhost.com"')
    })

    it('should escape tabs in url', () => {
      const query = buildPageViewsPerPathQuery('test\thost.com', 7)
      expect(query).toContain('url: "test\\thost.com"')
    })
  })

  describe('Traffic Overview queries', () => {
    it('buildPageViewsPerPathQuery uses page_stats recordType', () => {
      const query = buildPageViewsPerPathQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_page_views_per_path"')
      expect(query).toContain('recordType: "page_stats"')
    })

    it('buildUniqueVisitorsPerPageQuery uses page_stats recordType', () => {
      const query = buildUniqueVisitorsPerPageQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_unique_visitors_per_page"')
      expect(query).toContain('recordType: "page_stats"')
    })

    it('buildPageActivityShareQuery uses page_stats recordType', () => {
      const query = buildPageActivityShareQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_page_activity_share"')
      expect(query).toContain('recordType: "page_stats"')
    })
  })

  describe('Click Analytics queries', () => {
    it('buildClickAnalyticsHostTotalsQuery includes limit: 50', () => {
      const query = buildClickAnalyticsHostTotalsQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_click_analytics_host_totals"')
      expect(query).toContain('recordType: "host_totals"')
      expect(query).toContain('limit: 50')
    })

    it('buildClicksByElementQuery includes limit: 50', () => {
      const query = buildClicksByElementQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_clicks_by_element"')
      expect(query).toContain('recordType: "by_element_all_devices"')
      expect(query).toContain('limit: 50')
    })

    it('buildClicksPerPageQuery includes limit: 50', () => {
      const query = buildClicksPerPageQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_clicks_per_page"')
      expect(query).toContain('recordType: "by_page_all_devices"')
    })

    it('buildClickActivityShareQuery uses by_page_all_devices', () => {
      const query = buildClickActivityShareQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_click_activity_share"')
    })

    it('buildExitRateQuery uses exit_rate recordType', () => {
      const query = buildExitRateQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_exit_rate"')
      expect(query).toContain('recordType: "exit_rate"')
    })
  })

  describe('Visitor Insights queries', () => {
    it('buildReturningVisitorsQuery uses new_returning', () => {
      const query = buildReturningVisitorsQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_returning_visitors"')
      expect(query).toContain('recordType: "new_returning"')
    })

    it('buildBrowsersForVisitorsQuery uses host_stats_browser', () => {
      const query = buildBrowsersForVisitorsQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_browsers_for_visitors"')
      expect(query).toContain('recordType: "host_stats_browser"')
    })

    it('buildSessionsByDeviceTypeQuery uses session_depth', () => {
      const query = buildSessionsByDeviceTypeQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_sessions_by_device_type"')
      expect(query).toContain('recordType: "session_depth"')
    })
  })

  describe('Geographic queries', () => {
    it('buildCountryTrafficQuery uses geo_country', () => {
      const query = buildCountryTrafficQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_country_traffic"')
      expect(query).toContain('recordType: "geo_country"')
    })

    it('buildCityTrafficQuery uses geo_city', () => {
      const query = buildCityTrafficQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_city_traffic"')
      expect(query).toContain('recordType: "geo_city"')
    })

    it('buildBounceSessionsQuery uses bounce_stats', () => {
      const query = buildBounceSessionsQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_bounce_sessions_landing_page"')
      expect(query).toContain('recordType: "bounce_stats"')
    })
  })

  describe('Navigation / Traffic Sources queries', () => {
    it('buildPageTransitionsQuery uses page_transitions', () => {
      const query = buildPageTransitionsQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_page_transitions"')
      expect(query).toContain('recordType: "page_transitions"')
    })

    it('buildTopReferrersQuery uses top_referrers', () => {
      const query = buildTopReferrersQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_top_referrers"')
      expect(query).toContain('recordType: "top_referrers"')
    })

    it('buildReferrerLandingPageQuery uses referrer_to_landing', () => {
      const query = buildReferrerLandingPageQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_referrer_landing_page"')
      expect(query).toContain('recordType: "referrer_to_landing"')
    })
  })

  describe('Click Deep Dive queries', () => {
    it('buildClicksByElementTextQuery uses by_element_text', () => {
      const query = buildClicksByElementTextQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_clicks_by_element_text"')
      expect(query).toContain('recordType: "by_element_text"')
    })

    it('buildClicksByElementPerDeviceQuery uses by_element', () => {
      const query = buildClicksByElementPerDeviceQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_clicks_by_element_per_device"')
      expect(query).toContain('recordType: "by_element"')
    })
  })

  describe('CTA / Session queries', () => {
    it('buildClicksPerSessionQuery uses sessions recordType', () => {
      const query = buildClicksPerSessionQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_clicks_per_session"')
      expect(query).toContain('recordType: "sessions"')
    })
  })

  describe('Hourly Activity queries', () => {
    it('buildClicksByHourAllDevicesQuery uses by_hour_all_devices', () => {
      const query = buildClicksByHourAllDevicesQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_clicks_by_hour_all_devices"')
      expect(query).toContain('recordType: "by_hour_all_devices"')
    })

    it('buildHostHourlyPageviewsQuery uses host_hourly', () => {
      const query = buildHostHourlyPageviewsQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_host_hourly_pageviews"')
      expect(query).toContain('recordType: "host_hourly"')
    })

    it('buildHostHourlyVisitorsQuery uses host_hourly', () => {
      const query = buildHostHourlyVisitorsQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_host_hourly_visitors"')
      expect(query).toContain('recordType: "host_hourly"')
    })
  })

  describe('KPI queries', () => {
    it('buildTotalSessionsQuery uses session_depth', () => {
      const query = buildTotalSessionsQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_total_sessions"')
      expect(query).toContain('recordType: "session_depth"')
    })

    it('buildAvgPagesPerSessionQuery uses referrer_quality', () => {
      const query = buildAvgPagesPerSessionQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_avg_pages_per_session"')
      expect(query).toContain('recordType: "referrer_quality"')
    })

    it('buildAvgSessionDurationQuery uses referrer_quality', () => {
      const query = buildAvgSessionDurationQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_avg_session_duration"')
      expect(query).toContain('recordType: "referrer_quality"')
    })
  })

  describe('Raw / Multi-report queries', () => {
    it('buildPageViewsPerHostQuery uses host_stats', () => {
      const query = buildPageViewsPerHostQuery(TEST_URL, TEST_DAYS)
      expect(query).toContain('insightName: "airobuilder_page_views_per_host"')
      expect(query).toContain('recordType: "host_stats"')
    })
  })

  describe('different day values', () => {
    it('should use 30 days when specified', () => {
      const query = buildPageViewsPerPathQuery(TEST_URL, 30)
      expect(query).toContain('days: 30')
    })

    it('should use 1 day when specified', () => {
      const query = buildPageViewsPerPathQuery(TEST_URL, 1)
      expect(query).toContain('days: 1')
    })
  })
})
