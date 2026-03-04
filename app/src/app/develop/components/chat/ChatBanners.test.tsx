import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { WarningLevel } from '@/types/usage';
import ChatBanners from './ChatBanners';

vi.mock('@/hooks/useUsage', () => ({
  useUsage: vi.fn(() => ({
    isWarningBannerActive: false,
    percentage: 0,
    warningLevel: 'none',
    isLoading: false,
    isGrantsEnabled: false,
  })),
}));

// Mock child components to isolate ChatBanners logic
vi.mock('./UpgradeBanner', () => ({
  default: () => <div data-testid="upgrade-banner">UpgradeBanner</div>,
}));

vi.mock('./UsageWarningBanner', () => ({
  default: () => <div data-testid="usage-warning-banner">UsageWarningBanner</div>,
}));

describe('ChatBanners', function chatBannersTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('banner priority', function priorityTests() {
    it('should show UsageWarningBanner when usage warning is active', async function showWarningBanner() {
      const { useUsage } = await import('@/hooks/useUsage');
      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: true,
        percentage: 92,
        warningLevel: WarningLevel.WARNING,
        isLoading: false,
        isGrantsEnabled: false,
      });

      const { container } = renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('[data-testid="usage-warning-banner"]')).toBeInTheDocument();
        expect(container.querySelector('[data-testid="upgrade-banner"]')).not.toBeInTheDocument();
      });
    });

    it('should show UpgradeBanner when usage warning is not active', async function showUpgradeBanner() {
      const { useUsage } = await import('@/hooks/useUsage');
      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 50,
        warningLevel: WarningLevel.CAUTION,
        isLoading: false,
        isGrantsEnabled: false,
      });

      const { container } = renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('[data-testid="upgrade-banner"]')).toBeInTheDocument();
        expect(container.querySelector('[data-testid="usage-warning-banner"]')).not.toBeInTheDocument();
      });
    });

    it('should pass appId to useUsage hook', async function passAppId() {
      const { useUsage } = await import('@/hooks/useUsage');
      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 0,
        warningLevel: WarningLevel.NONE,
        isLoading: false,
        isGrantsEnabled: false,
      });

      renderWithProviders(<ChatBanners appId="my-app-id" />);

      expect(useUsage).toHaveBeenCalledWith({ appId: 'my-app-id', enabled: true });
    });

    it('should disable useUsage when appId is null', async function disableWithNullAppId() {
      const { useUsage } = await import('@/hooks/useUsage');
      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 0,
        warningLevel: WarningLevel.NONE,
        isLoading: false,
        isGrantsEnabled: false,
      });

      renderWithProviders(<ChatBanners appId={null} />);

      expect(useUsage).toHaveBeenCalledWith({ appId: null, enabled: false });
    });
  });
});
