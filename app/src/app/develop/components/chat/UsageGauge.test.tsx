import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { WarningLevel } from '@/types/usage';
import UsageGauge from './UsageGauge';

const mockOpenUpgradeModal = vi.fn();
const mockOpenCreditsModal = vi.fn();

vi.mock('@/hooks/useDailyUsage', () => ({
  useDailyUsage: vi.fn(() => ({
    data: { percentage: 65 },
    isLoading: false,
    formattedResetTime: { dayKey: 'tomorrow', timeString: '4:10 PM' },
  })),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: true })),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector({
    openUpgradeModal: mockOpenUpgradeModal,
    openCreditsModal: mockOpenCreditsModal,
  }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

describe('UsageGauge', function usageGaugeTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('rendering', function renderingTests() {
    it('should render circular gauge', async function renderGauge() {
      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForGauge() {
        expect(container.querySelector('svg')).toBeInTheDocument();
      });
    });

    it('should render loading state when data is loading', async function loadingState() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      vi.mocked(useDailyUsage).mockReturnValue({
        data: null,
        isLoading: true,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);

      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('should render loading state when data is null', async function nullDataState() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      vi.mocked(useDailyUsage).mockReturnValue({
        data: null,
        isLoading: false,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);

      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });
  });

  describe('popover interaction', function popoverTests() {
    it('should render trigger button with aria-label', async function renderTrigger() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 65, resetTime: '2025-01-10T00:00:00Z' },
        isLoading: false,
        formattedResetTime: { dayKey: 'tomorrow', timeString: '4:10 PM' },
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);

      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForTrigger() {
        const button = container.querySelector('button');
        expect(button).toBeInTheDocument();
        expect(button).toHaveAttribute('aria-label');
      });
    });

    it('should open popover on click', async function openPopover() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 65, resetTime: '2025-01-10T00:00:00Z' },
        isLoading: false,
        formattedResetTime: { dayKey: 'tomorrow', timeString: '4:10 PM' },
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      const button = container.querySelector('button')!;
      await user.click(button);

      await waitFor(function waitForPopover() {
        expect(screen.getByText('builder_usage_daily_title')).toBeInTheDocument();
      });
    });
  });

  describe('purchase buttons', function purchaseButtonTests() {
    it('should render upgrade and buy tokens buttons when purchase is enabled', async function renderButtons() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 65, resetTime: '2025-01-10T00:00:00Z' },
        isLoading: false,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>);

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_upgrade')).toBeInTheDocument();
        expect(screen.getByText('builder_usage_gauge_buy_tokens')).toBeInTheDocument();
      });
    });

    it('should not render purchase buttons when purchase is disabled', async function noButtons() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 65, resetTime: '2025-01-10T00:00:00Z' },
        isLoading: false,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);
      vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>);

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForPopover() {
        expect(screen.getByText('builder_usage_daily_title')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_usage_gauge_upgrade')).not.toBeInTheDocument();
    });

    it('should call openUpgradeModal when upgrade button is clicked', async function clickUpgrade() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 65, resetTime: '2025-01-10T00:00:00Z' },
        isLoading: false,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>);

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_upgrade')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_upgrade'));

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('usage_gauge.upgrade');
    });

    it('should call openCreditsModal when buy tokens button is clicked and grants enabled', async function clickBuyTokensWithGrants() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 65, resetTime: '2025-01-10T00:00:00Z' },
        isLoading: false,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'app-builder-grants') {
          return { data: true, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>;
      });

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_buy_tokens')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_buy_tokens'));

      expect(mockOpenCreditsModal).toHaveBeenCalledWith('usage_gauge.buy_tokens');
      expect(mockOpenUpgradeModal).not.toHaveBeenCalled();
    });

    it('should call openUpgradeModal when buy tokens button is clicked and grants disabled', async function clickBuyTokensWithoutGrants() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 65, resetTime: '2025-01-10T00:00:00Z' },
        isLoading: false,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'app-builder-grants') {
          return { data: false, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>;
      });

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_buy_tokens')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_buy_tokens'));

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('usage_gauge.buy_tokens');
      expect(mockOpenCreditsModal).not.toHaveBeenCalled();
    });

    it('should close popover after clicking upgrade button', async function closePopoverAfterUpgrade() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 65, resetTime: '2025-01-10T00:00:00Z' },
        isLoading: false,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>);

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_upgrade')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_upgrade'));

      await waitFor(function waitForPopoverClosed() {
        expect(screen.queryByText('builder_usage_daily_title')).not.toBeInTheDocument();
      });
    });

    it('should close popover after clicking buy tokens button', async function closePopoverAfterBuyTokens() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 65, resetTime: '2025-01-10T00:00:00Z' },
        isLoading: false,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'app-builder-grants') {
          return { data: true, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>;
      });

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_buy_tokens')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_buy_tokens'));

      await waitFor(function waitForPopoverClosed() {
        expect(screen.queryByText('builder_usage_daily_title')).not.toBeInTheDocument();
      });
    });

    it('should log analytics when upgrade button is clicked', async function logUpgradeAnalytics() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { shipAnalyticsLog } = await import('@/lib/logging');

      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 75, resetTime: '2025-01-10T00:00:00Z' },
        isLoading: false,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>);

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app-123" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_upgrade')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_upgrade'));

      expect(shipAnalyticsLog).toHaveBeenCalledWith('usage_gauge.upgrade.clicked', {
        appId: 'test-app-123',
        percentage: 75,
      });
    });

    it('should log analytics when buy tokens button is clicked', async function logBuyTokensAnalytics() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { shipAnalyticsLog } = await import('@/lib/logging');

      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 85, resetTime: '2025-01-10T00:00:00Z' },
        isLoading: false,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'app-builder-grants') {
          return { data: true, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false, error: null } as unknown as ReturnType<typeof useSwitchboard>;
      });

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app-456" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_buy_tokens')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_buy_tokens'));

      expect(shipAnalyticsLog).toHaveBeenCalledWith('usage_gauge.buy_tokens.clicked', {
        appId: 'test-app-456',
        percentage: 85,
      });
    });
  });
});
