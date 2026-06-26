/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import PreviewBanners from './PreviewBanners';

const mockUseSwitchboard = vi.fn(function () { return false; });

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => mockUseSwitchboard(flag),
}));

vi.mock('@/app/[market]/develop/components/layout/DomainBar', () => ({
  default: function MockDomainBar() { return <div data-testid="domain-bar">DomainBar</div>; },
}));

vi.mock('@/app/[market]/develop/components/preview-banners/UpgradeBar', () => ({
  default: function MockUpgradeBar() { return <div data-testid="upgrade-bar">UpgradeBar</div>; },
}));

describe('PreviewBanners', function previewBannersTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  it('should render UpgradeBar unconditionally', function renderUpgradeBar() {
    mockUseSwitchboard.mockReturnValue(false);

    renderWithProviders(<PreviewBanners />);

    expect(screen.getByTestId('upgrade-bar')).toBeInTheDocument();
  });

  it('should render DomainBar when appbuilder-domain-bar flag is enabled', function renderDomainBar() {
    mockUseSwitchboard.mockReturnValue(true);

    renderWithProviders(<PreviewBanners />);

    expect(screen.getByTestId('domain-bar')).toBeInTheDocument();
    expect(screen.getByTestId('upgrade-bar')).toBeInTheDocument();
  });

  it('should not render DomainBar when appbuilder-domain-bar flag is disabled', function noDomainBar() {
    mockUseSwitchboard.mockReturnValue(false);

    renderWithProviders(<PreviewBanners />);

    expect(screen.queryByTestId('domain-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('upgrade-bar')).toBeInTheDocument();
  });

  it('should check the correct switchboard flag', function checkCorrectFlag() {
    mockUseSwitchboard.mockReturnValue(false);

    renderWithProviders(<PreviewBanners />);

    expect(mockUseSwitchboard).toHaveBeenCalledWith('appbuilder-domain-bar');
  });
});
