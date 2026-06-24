/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { AnalyticsPieChart } from '@/components/analytics/AnalyticsPieChart';
import { renderWithProviders } from '@/tests/test-utils';

interface MockDonutSlice {
  id: string;
  name: string;
  value: number;
}

vi.mock('@godaddy/antares', () => ({
  DonutChart: ({
    data,
    label,
    subLabel,
    'aria-label': ariaLabel,
  }: {
    data: MockDonutSlice[];
    label?: string;
    subLabel?: string;
    'aria-label'?: string;
  }) => (
    <div data-testid="donut-chart" aria-label={ariaLabel}>
      {label ? <span data-testid="donut-center-label">{label}</span> : null}
      {subLabel ? <span data-testid="donut-sublabel">{subLabel}</span> : null}
      <ul>
        {data.map(function renderSlice(slice) {
          return <li key={slice.id}>{slice.name}</li>;
        })}
      </ul>
    </div>
  ),
}));

vi.mock('@ux/tooltip', () => ({
  default: ({ children, id }: { children: ReactNode; id?: string }) => (
    <div data-testid="ux-tooltip" id={id} role="tooltip">
      {children}
    </div>
  ),
}));

const sampleData = [
  { date: 'Mobile', value: 75 },
  { date: 'Desktop', value: 25 },
];

describe('AnalyticsPieChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('empty states', function emptyStates() {
    it('should show no-data message when data is empty and not fetched', function emptyNotFetched() {
      renderWithProviders(<AnalyticsPieChart data={[]} label="builder_analytics_sessions_by_device" />);

      expect(screen.getByText('builder_analytics_sessions_by_device')).toBeInTheDocument();
      expect(screen.getByText('builder_analytics_no_data')).toBeInTheDocument();
      expect(screen.queryByTestId('donut-chart')).not.toBeInTheDocument();
    });

    it('should show zero when data is empty and fetched', function emptyFetched() {
      renderWithProviders(
        <AnalyticsPieChart data={[]} label="builder_analytics_sessions_by_device" fetched />,
      );

      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.queryByText('builder_analytics_no_data')).not.toBeInTheDocument();
      expect(screen.queryByTestId('donut-chart')).not.toBeInTheDocument();
    });

    it('should show empty state when all values are zero', function allZeroValues() {
      renderWithProviders(
        <AnalyticsPieChart
          data={[
            { date: 'Mobile', value: 0 },
            { date: 'Desktop', value: 0 },
          ]}
          label="builder_analytics_sessions_by_device"
        />,
      );

      expect(screen.getByText('builder_analytics_no_data')).toBeInTheDocument();
      expect(screen.queryByTestId('donut-chart')).not.toBeInTheDocument();
    });
  });

  describe('chart rendering', function chartRendering() {
    it('should render donut chart with label and formatted slices', function withData() {
      renderWithProviders(
        <AnalyticsPieChart
          data={sampleData}
          label="builder_analytics_sessions_by_device"
          subLabel="builder_analytics_sessions"
        />,
      );

      expect(screen.getByTestId('donut-chart')).toHaveAttribute(
        'aria-label',
        'builder_analytics_sessions_by_device',
      );
      expect(screen.getByTestId('donut-center-label')).toHaveTextContent('100');
      expect(screen.getByTestId('donut-sublabel')).toHaveTextContent('builder_analytics_sessions');
      expect(screen.getByText('75% Mobile')).toBeInTheDocument();
      expect(screen.getByText('25% Desktop')).toBeInTheDocument();
    });

    it('should use default label when none is provided', function defaultLabel() {
      renderWithProviders(<AnalyticsPieChart data={sampleData} />);

      expect(screen.getByText('Distribution')).toBeInTheDocument();
      expect(screen.getByTestId('donut-chart')).toHaveAttribute('aria-label', 'Distribution');
    });

    it('should exclude zero-value slices from the chart', function filterZeroValues() {
      renderWithProviders(
        <AnalyticsPieChart
          data={[
            { date: 'Mobile', value: 0 },
            { date: 'Desktop', value: 40 },
          ]}
          label="builder_analytics_sessions_by_device"
        />,
      );

      expect(screen.getByText('100% Desktop')).toBeInTheDocument();
      expect(screen.queryByText(/Mobile/)).not.toBeInTheDocument();
    });
  });

  describe('tooltip', function tooltipTests() {
    it('should render info tooltip trigger when tooltip is provided', function withTooltip() {
      renderWithProviders(
        <AnalyticsPieChart
          data={sampleData}
          label="builder_analytics_sessions_by_device"
          tooltip="builder_analytics_tooltip_device_breakdown"
        />,
      );

      expect(
        screen.getByRole('button', { name: 'builder_common_more_info' }),
      ).toBeInTheDocument();
    });

    it('should not render info tooltip trigger when tooltip is omitted', function withoutTooltip() {
      renderWithProviders(
        <AnalyticsPieChart data={sampleData} label="builder_analytics_sessions_by_device" />,
      );

      expect(
        screen.queryByRole('button', { name: 'builder_common_more_info' }),
      ).not.toBeInTheDocument();
    });
  });
});
