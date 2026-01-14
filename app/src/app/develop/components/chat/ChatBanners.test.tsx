import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import ChatBanners from './ChatBanners';

vi.mock('@/hooks/useDailyUsage', () => ({
  useDailyUsage: vi.fn(() => ({
    isWarningBannerActive: false,
  })),
}));

// Mock child components to isolate ChatBanners logic
vi.mock('./AiroPlusUpgradeBanner', () => ({
  default: () => <div data-testid="airoplus-upgrade-banner">AiroPlusUpgradeBanner</div>,
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
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      vi.mocked(useDailyUsage).mockReturnValue({ isWarningBannerActive: true } as ReturnType<typeof useDailyUsage>);

      const { container } = renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('[data-testid="usage-warning-banner"]')).toBeInTheDocument();
        expect(container.querySelector('[data-testid="airoplus-upgrade-banner"]')).not.toBeInTheDocument();
      });
    });

    it('should show AiroPlusUpgradeBanner when usage warning is not active', async function showUpgradeBanner() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      vi.mocked(useDailyUsage).mockReturnValue({ isWarningBannerActive: false } as ReturnType<typeof useDailyUsage>);

      const { container } = renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('[data-testid="airoplus-upgrade-banner"]')).toBeInTheDocument();
        expect(container.querySelector('[data-testid="usage-warning-banner"]')).not.toBeInTheDocument();
      });
    });

    it('should pass appId to child components', async function passAppId() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      vi.mocked(useDailyUsage).mockReturnValue({ isWarningBannerActive: false } as ReturnType<typeof useDailyUsage>);

      renderWithProviders(<ChatBanners appId="my-app-id" />);

      // Verify useDailyUsage was called with correct appId
      expect(useDailyUsage).toHaveBeenCalledWith({ appId: 'my-app-id', enabled: true });
    });

    it('should disable useDailyUsage when appId is null', async function disableWithNullAppId() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      vi.mocked(useDailyUsage).mockReturnValue({ isWarningBannerActive: false } as ReturnType<typeof useDailyUsage>);

      renderWithProviders(<ChatBanners appId={null} />);

      expect(useDailyUsage).toHaveBeenCalledWith({ appId: null, enabled: false });
    });
  });
});
