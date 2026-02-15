import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import SinglePlanUpgradeContainer from './SinglePlanUpgradeContainer';

const mockOnClose = vi.fn();
const mockOnSuccessClick = vi.fn();
const mockOnErrorClick = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockRefetchQueries = vi.fn().mockResolvedValue(undefined);
const mockGetQueryData = vi.fn();
const mockUseSwitchboard = vi.fn();

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => ({
    cds: 'mock-cds-url',
    intl: { locale: 'en-US' },
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    getUserInfo: () => ({ shopperId: 'test-shopper-123' }),
  }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
      refetchQueries: mockRefetchQueries,
      getQueryData: mockGetQueryData,
    }),
  };
});

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => mockUseSwitchboard(),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    data: { builderEntitlementId: 'test-entitlement-123' },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

const mockWaitForQueryUpdate = vi.fn();
vi.mock('@/lib/query-utils', () => ({
  waitForQueryUpdate: (...args: unknown[]) => mockWaitForQueryUpdate(...args),
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/utils/propTypes', () => ({
  ensurePropTypes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./cdsLoader', () => ({
  ComponentLoader: (props: any) => {
    return (
      <div data-testid="upgrade-modal">
        <span data-testid="product-id">{props.productId}</span>
        <span data-testid="sub-type">{props.subType}</span>
        <span data-testid="source">{props.source}</span>
        <span data-testid="locale">{props.locale}</span>
        <span data-testid="return-app">{props.returnApp}</span>
        <span data-testid="entitlement-id">{props.entitlementId ?? ''}</span>
        <button data-testid="close-button" onClick={props.onClose}>Close</button>
        <button
          data-testid="success-button"
          onClick={() => {
            props.onPurchaseSuccess?.();
            props.onSuccessClick?.();
          }}
        >
          Success
        </button>
        <button data-testid="error-button" onClick={props.onErrorClick}>Error</button>
      </div>
    );
  },
}));

describe('SinglePlanUpgradeContainer', function singlePlanUpgradeContainerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockUseSwitchboard.mockReturnValue({ data: false, isLoading: false, error: null });
    // Return plan for planBeforePurchase capture
    mockGetQueryData.mockReturnValue({ active: { plan: 'free' } });
    // Default: polling succeeds (plan changed)
    mockWaitForQueryUpdate.mockResolvedValue(true);
  });

  describe('renders correctly', function renderTests() {
    it('should render the upgrade modal', async function renderModal() {
      renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
        />
      );

      await waitFor(function checkModal() {
        expect(screen.getByTestId('upgrade-modal')).toBeInTheDocument();
      });
    });

    it('should use AiroPlus productId when grants feature is disabled', async function airoPlusProductId() {
      mockUseSwitchboard.mockReturnValue({ data: false, isLoading: false, error: null });

      renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
        />
      );

      await waitFor(function checkProductId() {
        expect(screen.getByTestId('product-id').textContent).toBe('AiroPlusAppBuilderProduct');
      });
    });

    it('should use AiroBuilder productId when grants feature is enabled', async function airoBuilderProductId() {
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false, error: null });

      renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
        />
      );

      await waitFor(function checkProductId() {
        expect(screen.getByTestId('product-id').textContent).toBe('AiroBuilderProduct');
      });
    });

    it('should pass entitlementId when grants feature is enabled', async function passEntitlementId() {
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false, error: null });

      renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
        />
      );

      await waitFor(function checkEntitlementId() {
        expect(screen.getByTestId('entitlement-id').textContent).toBe('test-entitlement-123');
      });
    });

    it('should not pass entitlementId when grants feature is disabled', async function noEntitlementId() {
      mockUseSwitchboard.mockReturnValue({ data: false, isLoading: false, error: null });

      renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
        />
      );

      await waitFor(function checkNoEntitlementId() {
        expect(screen.getByTestId('entitlement-id').textContent).toBe('');
      });
    });

    it('should use SinglePlanUpgrade subType', async function correctSubType() {
      renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
        />
      );

      await waitFor(function checkSubType() {
        expect(screen.getByTestId('sub-type').textContent).toBe('SinglePlanUpgrade');
      });
    });

    it('should use default source when not provided', async function defaultSource() {
      renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
        />
      );

      await waitFor(function checkSource() {
        expect(screen.getByTestId('source').textContent).toBe('app-builder');
      });
    });

    it('should pass locale from gasketData', async function passLocale() {
      renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
        />
      );

      await waitFor(function checkLocale() {
        expect(screen.getByTestId('locale').textContent).toBe('en-US');
      });
    });

    it('should pass returnApp prop', async function passReturnApp() {
      renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
        />
      );

      await waitFor(function checkReturnApp() {
        expect(screen.getByTestId('return-app').textContent).toBe('airo-builder');
      });
    });
  });

  describe('callbacks', function callbackTests() {
    it('should call onClose when close button clicked', async function closeCallback() {
      const { user } = renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('close-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('close-button'));

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onSuccessClick when purchase succeeds', async function successCallback() {
      const { user } = renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
          onSuccessClick={mockOnSuccessClick}
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      // onSuccessClick is called synchronously after onPurchaseSuccess in the mock
      await waitFor(function checkCallback() {
        expect(mockOnSuccessClick).toHaveBeenCalled();
      });
    });

    it('should poll subscriptions and invalidate other queries on success', async function invalidateQueries() {
      const { user } = renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
          onSuccessClick={mockOnSuccessClick}
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      // Wait for async handleSuccess to complete
      await waitFor(function checkPolling() {
        expect(mockWaitForQueryUpdate).toHaveBeenCalledWith(
          expect.anything(),
          ['subscriptions'],
          expect.any(Function),
          { maxAttempts: 15, intervalMs: 2000 }
        );
      });

      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['active-subscription'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['paywall-feature-flags'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['entitlements'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects'] });
    });

    it('should log timeout when polling fails to detect plan change', async function pollingTimeout() {
      const { shipAnalyticsLog } = await import('@/lib/logging');
      mockWaitForQueryUpdate.mockResolvedValue(false); // Simulate timeout

      const { user } = renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
          source="test-source"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      await waitFor(function checkTimeoutLog() {
        expect(shipAnalyticsLog).toHaveBeenCalledWith('airoplus.purchase.polling-timeout', {
          source: 'test-source',
          productId: 'AiroPlusAppBuilderProduct',
          planBeforePurchase: 'free',
        });
      });

      // Should still invalidate queries even on timeout
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['active-subscription'] });
    });

    it('should call onErrorClick when error button clicked', async function errorCallback() {
      const { user } = renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
          onErrorClick={mockOnErrorClick}
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('error-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('error-button'));

      expect(mockOnErrorClick).toHaveBeenCalled();
    });
  });

  describe('analytics', function analyticsTests() {
    it('should log analytics on success', async function logAnalytics() {
      const { shipAnalyticsLog } = await import('@/lib/logging');
      const { logImpressionEvent } = await import('@/utils/instrumentation');

      mockUseSwitchboard.mockReturnValue({ data: false, isLoading: false, error: null });

      const { user } = renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
          onSuccessClick={mockOnSuccessClick}
          source="test-source"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      // Wait for async handleSuccess to complete
      await waitFor(function checkAnalytics() {
        expect(logImpressionEvent).toHaveBeenCalledWith('plan.purchase.success');
      });

      expect(shipAnalyticsLog).toHaveBeenCalledWith('airoplus.purchase.in-app', {
        source: 'test-source',
        productId: 'AiroPlusAppBuilderProduct',
        fromPlan: 'free',
      });
    });

    it('should log analytics with AiroBuilder productId when grants enabled', async function logAnalyticsWithGrants() {
      const { shipAnalyticsLog } = await import('@/lib/logging');

      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false, error: null });

      const { user } = renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
          onSuccessClick={mockOnSuccessClick}
          source="test-source"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      // Wait for async handleSuccess to complete
      await waitFor(function checkAnalytics() {
        expect(shipAnalyticsLog).toHaveBeenCalledWith('airoplus.purchase.in-app', {
          source: 'test-source',
          productId: 'AiroBuilderProduct',
          fromPlan: 'free',
        });
      });
    });

    it('should log upgrade success analytics when plan changes after polling', async function logUpgradeSuccess() {
      const { shipAnalyticsLog } = await import('@/lib/logging');
      const { logImpressionEvent } = await import('@/utils/instrumentation');

      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false, error: null });
      // First call returns 'free' (before purchase), second call returns 'starter' (after purchase)
      mockGetQueryData
        .mockReturnValueOnce({ active: { plan: 'free' } })
        .mockReturnValueOnce({ active: { plan: 'starter' } });
      mockWaitForQueryUpdate.mockResolvedValue(true);

      const { user } = renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
          onSuccessClick={mockOnSuccessClick}
          source="test-source"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      // Wait for async handleSuccess to complete
      await waitFor(function checkUpgradeAnalytics() {
        // Plan-specific impression with underscore format (parseEID requires 2 dots)
        expect(logImpressionEvent).toHaveBeenCalledWith('plan.upgrade_starter.success');
      });

      expect(shipAnalyticsLog).toHaveBeenCalledWith('airoplus.upgrade.success', {
        source: 'test-source',
        productId: 'AiroBuilderProduct',
        fromPlan: 'free',
        toPlan: 'starter',
      });
    });

    it('should not log upgrade success when polling times out', async function noUpgradeSuccessOnTimeout() {
      const { shipAnalyticsLog } = await import('@/lib/logging');
      const { logImpressionEvent } = await import('@/utils/instrumentation');

      mockWaitForQueryUpdate.mockResolvedValue(false); // Polling timed out
      // Plan stays the same (polling didn't detect change)
      mockGetQueryData.mockReturnValue({ active: { plan: 'free' } });

      const { user } = renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
          source="test-source"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      // Wait for async handleSuccess to complete
      await waitFor(function checkTimeoutLog() {
        expect(shipAnalyticsLog).toHaveBeenCalledWith('airoplus.purchase.polling-timeout', expect.any(Object));
      });

      // Should NOT log upgrade success
      expect(logImpressionEvent).not.toHaveBeenCalledWith(expect.stringContaining('plan.upgrade_'));
      expect(shipAnalyticsLog).not.toHaveBeenCalledWith('airoplus.upgrade.success', expect.any(Object));
    });
  });

  describe('edge cases', function edgeCaseTests() {
    it('should handle missing shopperId gracefully', async function missingShopperId() {
      renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('upgrade-modal')).toBeInTheDocument();
      });
    });

    it('should handle success callback when onSuccessClick is not provided', async function noOnSuccessClick() {
      const { user } = renderWithProviders(
        <SinglePlanUpgradeContainer
          onClose={mockOnClose}
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      // Wait for async handleSuccess to complete
      await waitFor(function checkPolling() {
        expect(mockWaitForQueryUpdate).toHaveBeenCalled();
      });

      expect(mockInvalidateQueries).toHaveBeenCalled();
    });
  });
});
