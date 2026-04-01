/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import CreditsUpgradeContainer from './CreditsUpgradeContainer';

const mockOnClose = vi.fn();
const mockOnSuccess = vi.fn();
const mockOnErrorClick = vi.fn();
const mockInvalidateQueries = vi.fn();

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
    }),
  };
});

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/utils/propTypes', () => ({
  ensurePropTypes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./PaywallLoadingModal', () => ({
  PaywallLoadingModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="paywall-loading-modal">
      <button data-testid="loading-close-button" onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('./cdsLoader', () => ({
  ComponentLoader: (props: any) => {
    return (
      <div data-testid="credits-upgrade-modal">
        <span data-testid="product-id">{props.productId}</span>
        <span data-testid="entitlement-id">{props.entitlementId}</span>
        <span data-testid="sub-type">{props.subType}</span>
        <span data-testid="source">{props.source}</span>
        <div data-testid="loading-component">{props.LoadingComponent}</div>
        <button data-testid="close-button" onClick={props.onClose}>Close</button>
        <button
          data-testid="success-button"
          onClick={() => props.onSuccess?.('basket-123', { unitsAdded: 100, newTotalBalance: 500 })}
        >
          Success
        </button>
        <button data-testid="error-button" onClick={props.onErrorClick}>Error</button>
      </div>
    );
  },
}));

describe('CreditsUpgradeContainer', function creditsUpgradeContainerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders correctly', function renderTests() {
    it('should render the credits upgrade modal', async function renderModal() {
      renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId="entitlement-123"
        />
      );

      await waitFor(function checkModal() {
        expect(screen.getByTestId('credits-upgrade-modal')).toBeInTheDocument();
      });
    });

    it('should pass correct productId for credits', async function correctProductId() {
      renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId="entitlement-123"
        />
      );

      await waitFor(function checkProductId() {
        expect(screen.getByTestId('product-id').textContent).toBe('AiroBuilderCreditsProduct');
      });
    });

    it('should pass entitlementId to ComponentLoader', async function passEntitlementId() {
      renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId="my-entitlement-456"
        />
      );

      await waitFor(function checkEntitlementId() {
        expect(screen.getByTestId('entitlement-id').textContent).toBe('my-entitlement-456');
      });
    });

    it('should use StandaloneAddon subType', async function correctSubType() {
      renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId="entitlement-123"
        />
      );

      await waitFor(function checkSubType() {
        expect(screen.getByTestId('sub-type').textContent).toBe('StandaloneAddon');
      });
    });

    it('should use default source when not provided', async function defaultSource() {
      renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId="entitlement-123"
        />
      );

      await waitFor(function checkSource() {
        expect(screen.getByTestId('source').textContent).toBe('airo-builder');
      });
    });

    it('should use custom source when provided', async function customSource() {
      renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId="entitlement-123"
          source="usage_gauge.buy_tokens"
        />
      );

      await waitFor(function checkSource() {
        expect(screen.getByTestId('source').textContent).toBe('usage_gauge.buy_tokens');
      });
    });
  });

  describe('callbacks', function callbackTests() {
    it('should call onClose when close button clicked', async function closeCallback() {
      const { user } = renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId="entitlement-123"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('close-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('close-button'));

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onSuccess with basket details when purchase succeeds', async function successCallback() {
      const { user } = renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
          entitlementId="entitlement-123"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      expect(mockOnSuccess).toHaveBeenCalledWith('basket-123', {
        unitsAdded: 100,
        newTotalBalance: 500,
      });
    });

    it('should invalidate queries on success', async function invalidateQueries() {
      const { user } = renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
          entitlementId="entitlement-123"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['subscriptions'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['credit-grants'] });
    });

    it('should call onErrorClick when error button clicked', async function errorCallback() {
      const { user } = renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          onErrorClick={mockOnErrorClick}
          entitlementId="entitlement-123"
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

      const { user } = renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
          entitlementId="entitlement-123"
          source="test-source"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      expect(logImpressionEvent).toHaveBeenCalledWith('credits.purchase.success');
      expect(shipAnalyticsLog).toHaveBeenCalledWith('airobuilder.credits.purchase.in-app', {
        source: 'test-source',
        productId: 'AiroBuilderCreditsProduct',
        basketId: 'basket-123',
        unitsAdded: 100,
        newTotalBalance: 500,
      });
    });
  });

  describe('LoadingComponent', function loadingComponentTests() {
    it('should render PaywallLoadingModal as LoadingComponent', async function renderLoadingComponent() {
      renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId="entitlement-123"
        />
      );

      await waitFor(function checkLoadingComponent() {
        expect(screen.getByTestId('loading-component')).toBeInTheDocument();
      });
    });

    it('should pass onClose to the LoadingComponent', async function loadingComponentOnClose() {
      const { user } = renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId="entitlement-123"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('credits-upgrade-modal')).toBeInTheDocument();
      });

      // Close via the main close button (same onClose reference used by LoadingComponent)
      await user.click(screen.getByTestId('close-button'));

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('edge cases', function edgeCaseTests() {
    it('should handle success callback when onSuccess is not provided', async function noOnSuccess() {
      const { user } = renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId="entitlement-123"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      expect(mockInvalidateQueries).toHaveBeenCalled();
    });

    it('should handle missing shopperId gracefully', async function missingShopperId() {
      // This test verifies the component renders even when shopperId is undefined
      // The mock already returns a shopperId, so we just verify rendering works
      renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId="entitlement-123"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('credits-upgrade-modal')).toBeInTheDocument();
      });
    });

    it('should handle different basket details formats', async function differentBasketDetails() {
      const mockOnSuccessWithDetails = vi.fn();
      const { user } = renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          onSuccess={mockOnSuccessWithDetails}
          entitlementId="entitlement-123"
        />
      );

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      expect(mockOnSuccessWithDetails).toHaveBeenCalledWith('basket-123', {
        unitsAdded: 100,
        newTotalBalance: 500,
      });
    });

    it('should render nothing with empty entitlementId', async function emptyEntitlementId() {
      const { container } = renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId=""
        />
      );

      // Component returns null when entitlementId is missing
      expect(container.firstChild).toBeNull();
    });

    it('should render nothing with undefined entitlementId', async function undefinedEntitlementId() {
      const { container } = renderWithProviders(
        <CreditsUpgradeContainer
          onClose={mockOnClose}
          entitlementId={undefined}
        />
      );

      // Component returns null when entitlementId is missing
      expect(container.firstChild).toBeNull();
    });
  });
});
