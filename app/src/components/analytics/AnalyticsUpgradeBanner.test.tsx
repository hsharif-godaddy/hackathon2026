/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { AnalyticsUpgradeBanner, AnalyticsUpgradeInnerBanner } from '@/components/analytics/AnalyticsUpgradeBanner';
import { renderWithProviders } from '@/tests/test-utils';

describe('AnalyticsUpgradeBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the banner title', function title() {
    renderWithProviders(<AnalyticsUpgradeBanner onUpgrade={vi.fn()} />);

    expect(screen.getByText('builder_analytics_upgrade_banner_title')).toBeInTheDocument();
  });

  it('should render the banner message', function message() {
    renderWithProviders(<AnalyticsUpgradeBanner onUpgrade={vi.fn()} />);

    expect(screen.getByText('builder_analytics_upgrade_banner_message')).toBeInTheDocument();
  });

  it('should render the upgrade button', function button() {
    renderWithProviders(<AnalyticsUpgradeBanner onUpgrade={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'builder_upgrade_button' })).toBeInTheDocument();
  });

  it('should call onUpgrade when the upgrade button is clicked', async function upgrade() {
    const onUpgrade = vi.fn();
    const { user } = renderWithProviders(<AnalyticsUpgradeBanner onUpgrade={onUpgrade} />);

    await user.click(screen.getByRole('button', { name: 'builder_upgrade_button' }));

    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });
});

describe('AnalyticsUpgradeInnerBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the inner banner message', function message() {
    renderWithProviders(<AnalyticsUpgradeInnerBanner onUpgrade={vi.fn()} />);

    expect(screen.getByText('builder_analytics_upgrade_inner_banner_message')).toBeInTheDocument();
  });

  it('should call onUpgrade when clicked', async function upgrade() {
    const onUpgrade = vi.fn();
    const { user } = renderWithProviders(<AnalyticsUpgradeInnerBanner onUpgrade={onUpgrade} />);

    await user.click(screen.getByRole('button'));

    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });
});
