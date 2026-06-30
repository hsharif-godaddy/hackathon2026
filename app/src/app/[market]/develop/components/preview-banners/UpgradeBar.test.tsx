/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { ESM_MONETIZATION_BANNER } from '@/app/[market]/develop/components/paywall/cdsConfig';
import { ComponentLoader } from '@/app/[market]/develop/components/paywall/cdsLoader';
import { useSubscription } from '@/hooks/useSubscription';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { renderWithProviders } from '@/tests/test-utils';
import { SubscriptionPlan } from '@/types/credits';
import UpgradeBar from './UpgradeBar';

const mockDismiss = vi.fn();
const mockOpenUpgradeModal = vi.fn();

const mockSubscription = {
  id: 'sub-123',
  customerId: 'customer-123',
  builderEntitlementId: 'ent-456',
  plan: SubscriptionPlan.Starter,
  productId: 'AiroBuilderProduct',
  status: 'active',
  isTrial: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockUseUpgradeBannerExperiment = vi.fn(function () {
  return { showChatBanner: false, showPreviewBar: true, dismiss: mockDismiss };
});

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/en-US/develop/app-1'),
}));

vi.mock('@/hooks/useUpgradeBannerExperiment', () => ({
  useUpgradeBannerExperiment: function mockHook() {
    return mockUseUpgradeBannerExperiment();
  },
  markDismissedToday: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    getUserInfo: () => ({ shopperId: 'shopper-789' }),
  })),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({
    data: mockSubscription,
    isLoading: false,
  })),
}));

vi.mock('@/stores/usePaywallStore', () => ({
  usePaywallStore: (selector: (state: { openUpgradeModal: typeof mockOpenUpgradeModal }) => unknown) =>
    selector({ openUpgradeModal: mockOpenUpgradeModal }),
}));

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: vi.fn(() => ({
    cds: { registry: { [ESM_MONETIZATION_BANNER]: { js: 'test.es.js' } } },
    intl: { locale: 'en-US' },
  })),
}));

vi.mock('@/lib/itc', () => ({
  getItcOverride: vi.fn(() => 'test-itc'),
}));

vi.mock('@/app/[market]/develop/components/paywall/cdsLoader', () => ({
  ComponentLoader: vi.fn(function MockComponentLoader(props: Record<string, unknown>) {
    return (
      <div
        data-testid="cds-monetization-banner"
        data-type={props.type as string}
        data-app-name={props.appName as string}
        data-account-id={props.accountId as string}
        data-subscription-id={props.subscriptionId as string}
      >
        <button type="button" onClick={props.onViewPlansClick as () => void}>
          builder_preview_upgrade_cta
        </button>
        <button
          type="button"
          data-testid="cds-load-error-trigger"
          onClick={() => (props.onLoadError as (error: Error) => void)?.(new Error('load failed'))}
        />
      </div>
    );
  }),
}));

const mockShipAnalyticsLog = vi.fn();

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}));

const mockLogImpressionEvent = vi.fn(function (_eid: string) { return vi.fn(); });
const mockLogClickEvent = vi.fn(function (_eid: string) { return vi.fn(); });

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (eid: string) => mockLogImpressionEvent(eid) as unknown,
  logClickEvent: (eid: string) => mockLogClickEvent(eid) as unknown,
  generateClickEID: (eid: string) => eid,
}));

describe('UpgradeBar', function upgradeBarTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockUseUpgradeBannerExperiment.mockReturnValue({
      showChatBanner: false,
      showPreviewBar: true,
      dismiss: mockDismiss,
    });
  });

  describe('rendering', function renderingTests() {
    it('should render monetization banner with required CDS props when eligible', function renderForTreatment() {
      renderWithProviders(<UpgradeBar />);

      const banner = screen.getByTestId('cds-monetization-banner');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveAttribute('data-type', ESM_MONETIZATION_BANNER);
      expect(banner).toHaveAttribute('data-app-name', 'airo-builder');
      expect(banner).toHaveAttribute('data-account-id', 'ent-456');
      expect(banner).toHaveAttribute('data-subscription-id', 'sub-123');
    });

    it('should not render when showPreviewBar is false', function noRenderForControl() {
      mockUseUpgradeBannerExperiment.mockReturnValue({
        showChatBanner: true,
        showPreviewBar: false,
        dismiss: mockDismiss,
      });

      renderWithProviders(<UpgradeBar />);

      expect(screen.queryByTestId('cds-monetization-banner')).not.toBeInTheDocument();
    });

    it('should render fallback bar while subscription context is loading', function fallbackWhileLoading() {
      vi.mocked(useSubscription).mockReturnValueOnce({
        data: undefined,
        isLoading: true,
        isFetching: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
        subscriptions: [],
      });

      renderWithProviders(<UpgradeBar />);

      expect(screen.queryByTestId('cds-monetization-banner')).not.toBeInTheDocument();
      expect(screen.getByText('builder_airoplus_upgrade_message')).toBeInTheDocument();
    });

    it('should render fallback bar when subscription lacks CDS-required ids', function fallbackWithoutIds() {
      vi.mocked(useSubscription).mockReturnValueOnce({
        data: {
          ...mockSubscription,
          id: undefined as unknown as string,
          builderEntitlementId: undefined,
        },
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        subscriptions: [],
      });

      renderWithProviders(<UpgradeBar />);

      expect(screen.queryByTestId('cds-monetization-banner')).not.toBeInTheDocument();
      expect(screen.getByText('builder_airoplus_upgrade_message')).toBeInTheDocument();
    });
  });

  describe('analytics', function analyticsTests() {
    it('should log impression event when banner is shown', function logImpressionOnShow() {
      renderWithProviders(<UpgradeBar />);

      expect(mockLogImpressionEvent).toHaveBeenCalledWith('preview.upgradeBanner.view');
    });

    it('should log fallback impression while subscription context is loading', function fallbackImpressionWhileLoading() {
      vi.mocked(useSubscription).mockReturnValueOnce({
        data: undefined,
        isLoading: true,
        isFetching: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
        subscriptions: [],
      });

      renderWithProviders(<UpgradeBar />);

      expect(mockLogImpressionEvent).toHaveBeenCalledWith('preview.upgradeBanner.fallback.view');
    });

    it('should open upgrade modal when CTA is clicked', async function clickCta() {
      const { user } = renderWithProviders(<UpgradeBar />);

      await user.click(screen.getByRole('button', { name: 'builder_preview_upgrade_cta' }));

      expect(mockLogClickEvent).toHaveBeenCalledWith('preview.upgradeBanner.upgrade');
      expect(mockOpenUpgradeModal).toHaveBeenCalledWith(
        'preview.upgradeBanner.upgrade',
        PAYWALL_ITC.UPGRADE
      );
    });

    it('should wire loader and banner error handlers for CDS failures', function errorHandlerProps() {
      renderWithProviders(<UpgradeBar />);

      const props = vi.mocked(ComponentLoader).mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(props.errorCallback).toEqual(expect.any(Function));
      expect(props.onLoadError).toEqual(expect.any(Function));
    });

    it('should log paywall load error when onLoadError fires', async function loadErrorAnalytics() {
      const { user } = renderWithProviders(<UpgradeBar />);

      await user.click(screen.getByTestId('cds-load-error-trigger'));

      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('paywall.cds.load.error', {
        source: 'AiroAppBuilder',
        productId: expect.any(String),
        error: 'load failed',
        errorType: 'banner_upgrade',
        component: 'UpgradeBar',
      });
    });
  });
});
