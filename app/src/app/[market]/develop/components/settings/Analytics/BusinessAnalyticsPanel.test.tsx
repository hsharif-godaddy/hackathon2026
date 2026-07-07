/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import BusinessAnalyticsPanel from '@/app/[market]/develop/components/settings/Analytics/BusinessAnalyticsPanel'
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

describe('BusinessAnalyticsPanel', function panelTests() {
  it('renders section title and overview content', function section() {
    renderWithProviders(<BusinessAnalyticsPanel {...defaultProps} />)

    expect(screen.getByTestId('business-analytics-panel')).toBeInTheDocument()
    expect(screen.getByText('Business Analytics')).toBeInTheDocument()
    expect(screen.getByText('Sales Overview')).toBeInTheDocument()
  })

  it('shows loading spinner while sales data is loading', function loading() {
    renderWithProviders(
      <BusinessAnalyticsPanel
        {...defaultProps}
        isLoading
      />,
    )

    expect(screen.getByTestId('business-analytics-panel')).toBeInTheDocument()
    expect(screen.queryByText('Sales Overview')).not.toBeInTheDocument()
  })

  it('shows revenue when metrics include sales activity', function revenue() {
    renderWithProviders(
      <BusinessAnalyticsPanel
        {...defaultProps}
        metrics={{
          ...EMPTY_METRICS,
          totalRevenue: 42.5,
        }}
      />,
    )

    expect(screen.getByText('$42.50')).toBeInTheDocument()
  })
})
