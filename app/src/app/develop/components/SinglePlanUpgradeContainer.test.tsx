import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import SinglePlanUpgradeContainer from './SinglePlanUpgradeContainer';

const mockOnClose = vi.fn();
const mockOnSuccessClick = vi.fn();
const mockOnErrorClick = vi.fn();
const mockInvalidateQueries = vi.fn();
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

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => mockUseSwitchboard(),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/utils/propTypes', () => ({
  ensurePropTypes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/dynamic', () => ({
  default: () => {
    const MockComponent = (props: any) => {
      return (
        <div data-testid="upgrade-modal">
          <span data-testid="product-id">{props.productId}</span>
          <span data-testid="sub-type">{props.subType}</span>
          <span data-testid="source">{props.source}</span>
          <span data-testid="locale">{props.locale}</span>
          <span data-testid="return-app">{props.returnApp}</span>
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
    };
    return MockComponent;
  },
}));

describe('SinglePlanUpgradeContainer', function singlePlanUpgradeContainerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockUseSwitchboard.mockReturnValue({ data: false, isLoading: false, error: null });
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

      expect(mockOnSuccessClick).toHaveBeenCalled();
    });

    it('should invalidate queries on success', async function invalidateQueries() {
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

      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['subscriptions'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['active-subscription'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['paywall-feature-flags'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['entitlements'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects'] });
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

      expect(logImpressionEvent).toHaveBeenCalledWith('plan.purchase.success');
      expect(shipAnalyticsLog).toHaveBeenCalledWith('airoplus.purchase.in-app', {
        source: 'test-source',
        productId: 'AiroPlusAppBuilderProduct',
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

      expect(shipAnalyticsLog).toHaveBeenCalledWith('airoplus.purchase.in-app', {
        source: 'test-source',
        productId: 'AiroBuilderProduct',
      });
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

      expect(mockInvalidateQueries).toHaveBeenCalled();
    });
  });
});
