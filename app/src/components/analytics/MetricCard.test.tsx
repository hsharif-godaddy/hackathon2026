/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { MetricCard } from '@/components/analytics/MetricCard';
import { renderWithProviders } from '@/tests/test-utils';

vi.mock('@ux/tooltip', () => ({
  default: ({ children, id }: { children: ReactNode; id?: string }) => (
    <div data-testid="ux-tooltip" id={id} role="tooltip">
      {children}
    </div>
  ),
}));

describe('MetricCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show label and value when not upgrade locked', function showValue() {
    renderWithProviders(
      <MetricCard label="builder_analytics_pageviews" value={42} />,
    );

    expect(screen.getByText('builder_analytics_pageviews')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('should render caption when provided', function caption() {
    renderWithProviders(
      <MetricCard
        label="builder_analytics_pageviews"
        value={0}
        caption="builder_analytics_no_data"
      />,
    );

    expect(screen.getByText('builder_analytics_no_data')).toBeInTheDocument();
  });

  it('should not render caption when upgrade locked', function hideCaptionWhenUpgrade() {
    renderWithProviders(
      <MetricCard
        label="builder_analytics_pageviews"
        value={0}
        needsUpgrade
        onUpgrade={vi.fn()}
      />,
    );

    expect(screen.queryByText('builder_analytics_no_data')).not.toBeInTheDocument();
    expect(screen.getByText('--')).toBeInTheDocument();
  });

  it('should mask value and expose upgrade control when needsUpgrade', function upgradeChrome() {
    const onUpgrade = vi.fn();
    renderWithProviders(
      <MetricCard
        label="builder_analytics_total_clicks"
        value={99}
        description="builder_analytics_all_clicks_tracked"
        needsUpgrade
        onUpgrade={onUpgrade}
      />,
    );

    expect(screen.queryByText('99')).not.toBeInTheDocument();
    expect(screen.getByText('--')).toBeInTheDocument();

    const control = screen.getByRole('button', {
      name: /builder_analytics_total_clicks.*builder_common_tooltip_upgrade/s,
    });
    expect(control).toBeInTheDocument();

    fireEvent.click(control);
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it('should show description in tooltip when not upgrade locked', function descriptionTooltip() {
    renderWithProviders(
      <MetricCard
        label="builder_analytics_pageviews"
        value={1}
        description="builder_analytics_total_page_loads"
      />,
    );

    const trigger = screen.getByText('builder_analytics_pageviews').closest('div');
    expect(trigger).toBeTruthy();
    fireEvent.mouseEnter(trigger!);

    expect(screen.getByTestId('ux-tooltip')).toBeInTheDocument();
    expect(screen.getByText('builder_analytics_total_page_loads')).toBeInTheDocument();
  });

  it('should show upgrade copy in tooltip when upgrade locked', function upgradeTooltip() {
    renderWithProviders(
      <MetricCard
        label="builder_analytics_total_clicks"
        value={0}
        description="builder_analytics_all_clicks_tracked"
        needsUpgrade
        onUpgrade={vi.fn()}
      />,
    );

    const control = screen.getByRole('button', {
      name: /builder_analytics_total_clicks.*builder_common_tooltip_upgrade/s,
    });
    fireEvent.mouseEnter(control);

    expect(screen.getByTestId('ux-tooltip')).toBeInTheDocument();
    expect(screen.getByText('builder_common_tooltip_upgrade')).toBeInTheDocument();
    expect(screen.queryByText('builder_analytics_all_clicks_tracked')).not.toBeInTheDocument();
  });
});
