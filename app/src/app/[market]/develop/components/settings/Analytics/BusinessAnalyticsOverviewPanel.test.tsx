/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import BusinessAnalyticsOverviewPanel from '@/app/[market]/develop/components/settings/Analytics/BusinessAnalyticsOverviewPanel'
import type { BusinessAnalyticsMetrics } from '@/lib/analytics/commerce-reporting'
import { renderWithProviders } from '@/tests/test-utils'

const EMPTY_METRICS: BusinessAnalyticsMetrics = {
  totalRevenue: 0,
  orderCountOverTime: [
    { date: '2026-06-02', value: 0 },
    { date: '2026-06-03', value: 0 },
  ],
  revenueOverTime: [
    { date: '2026-06-02', value: 0 },
    { date: '2026-06-03', value: 0 },
  ],
}

const defaultProps = {
  metrics: EMPTY_METRICS,
  isLoading: false,
  isFetched: true,
}

describe('BusinessAnalyticsOverviewPanel', function panelTests() {
  it('should render fallback labels instead of raw i18n keys', function fallbackLabels() {
    renderWithProviders(<BusinessAnalyticsOverviewPanel {...defaultProps} />)

    expect(screen.getByText('Sales Overview')).toBeInTheDocument()
    expect(screen.getByText('Total Revenue')).toBeInTheDocument()
    expect(screen.queryByText('builder_analytics_business_total_revenue')).not.toBeInTheDocument()
  })

  it('should show empty state when both series have no activity', function emptyOrders() {
    renderWithProviders(<BusinessAnalyticsOverviewPanel {...defaultProps} />)

    expect(screen.getAllByText('No orders in this period.')).toHaveLength(2)
  })

  it('should render revenue chart when total revenue exists', function revenueOnly() {
    renderWithProviders(
      <BusinessAnalyticsOverviewPanel
        {...defaultProps}
        metrics={{
          ...EMPTY_METRICS,
          totalRevenue: 129,
        }}
      />,
    )

    expect(screen.getByText('$129.00')).toBeInTheDocument()
    expect(screen.getByText('Daily Revenue')).toBeInTheDocument()
    expect(screen.getByText('Order Count')).toBeInTheDocument()
    expect(screen.queryByText('No orders in this period.')).not.toBeInTheDocument()
  })

  it('should render revenue chart when revenue activity exists', function revenueChart() {
    renderWithProviders(
      <BusinessAnalyticsOverviewPanel
        {...defaultProps}
        metrics={{
          ...EMPTY_METRICS,
          revenueOverTime: [
            { date: '2026-06-02', value: 0 },
            { date: '2026-06-03', value: 125.5 },
          ],
        }}
      />,
    )

    expect(screen.getByText('Daily Revenue')).toBeInTheDocument()
    expect(screen.getAllByText('No orders in this period.')).toHaveLength(1)
  })

  it('should render order chart when order activity exists', function chartWithData() {
    renderWithProviders(
      <BusinessAnalyticsOverviewPanel
        {...defaultProps}
        metrics={{
          ...EMPTY_METRICS,
          orderCountOverTime: [
            { date: '2026-06-02', value: 0 },
            { date: '2026-06-03', value: 2 },
          ],
        }}
      />,
    )

    expect(screen.getByText('Order Count')).toBeInTheDocument()
    expect(screen.getAllByText('No orders in this period.')).toHaveLength(1)
  })
})
