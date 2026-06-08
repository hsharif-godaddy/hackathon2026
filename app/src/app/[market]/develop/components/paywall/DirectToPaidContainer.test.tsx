/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { usePaywallStore } from '@/stores/usePaywallStore';
import { renderWithProviders } from '@/tests/test-utils';

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => ({
    intl: { locale: 'en-US' },
    cds: { api: { baseUrl: 'https://cds.api.test' } },
  }),
}));

vi.mock('@/hooks/useUpgradePurchase', () => ({
  useUpgradePurchase: () => ({
    handlePurchaseSuccess: vi.fn().mockResolvedValue({ planAfterPurchase: 'starter', updated: true, grantUpdated: true }),
  }),
}));

vi.mock('@/lib/itc', () => ({
  getItcOverride: () => null,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
}));

vi.mock('@/utils/focus', () => ({
  resetFocusOnModalClose: vi.fn(),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return false; }),
}));

vi.mock('./cdsLoader', () => ({
  ComponentLoader: ({ onClose, onLoadSuccess, onLoadError, onError, onCtaClick, onCheckoutStart, onCheckoutError, onPurchaseSuccess, source, subType, offerGroupId, type, loaderMode, deps }: any) => (
    <div data-testid="component-loader">
      <span data-testid="type">{type}</span>
      <span data-testid="loader-mode">{loaderMode || ''}</span>
      <span data-testid="sub-type">{subType}</span>
      <span data-testid="offer-group-id">{offerGroupId}</span>
      <span data-testid="source">{source}</span>
      <span data-testid="has-deps">{deps ? 'true' : 'false'}</span>
      <button data-testid="close-btn" onClick={onClose}>Close</button>
      <button data-testid="load-success-btn" onClick={onLoadSuccess}>Load Success</button>
      <button data-testid="load-error-btn" onClick={() => onLoadError?.(new Error('Test load error'))}>Load Error</button>
      <button data-testid="error-btn" onClick={() => onError?.(new Error('Test error'))}>Error</button>
      <button data-testid="cta-click-btn" onClick={() => onCtaClick?.('plan-123', 'buy')}>CTA Click</button>
      <button data-testid="checkout-start-btn" onClick={() => onCheckoutStart?.('basket-456')}>Checkout Start</button>
      <button data-testid="checkout-error-btn" onClick={() => onCheckoutError?.(new Error('checkout failed'))}>Checkout Error</button>
      <button data-testid="purchase-success-btn" onClick={() => onPurchaseSuccess?.({ purchaseData: { items: [{ subscriptionId: 12345, productPackageId: 'uuid.professional', label: 'Pro' }] } })}>Purchase Success</button>
      <button data-testid="purchase-no-plan-btn" onClick={() => onPurchaseSuccess?.({ purchaseData: { items: [{}] } })}>Purchase No Plan</button>
    </div>
  ),
}));

// Mock the loading modal
vi.mock('./PaywallLoadingModal', () => ({
  PaywallLoadingModal: ({ onClose }: any) => (
    <div data-testid="loading-modal">
      <button onClick={onClose}>Close Loading</button>
    </div>
  ),
  PaywallLoadingModalVariant: {
    HigherPlans: 'higher-plans',
    Credits: 'credits',
  },
}));

// Mock the error fallback
vi.mock('./PaywallErrorFallback', () => ({
  PaywallErrorFallback: ({ error, onClose }: any) => (
    <div data-testid="error-fallback">
      <span>{error?.message}</span>
      <button onClick={onClose}>Close Error</button>
    </div>
  ),
}));

import { shipAnalyticsLog } from '@/lib/logging';
import DirectToPaidContainer from './DirectToPaidContainer';

describe('DirectToPaidContainer', function directToPaidContainerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    usePaywallStore.setState({ paywallLoading: false });
  });

  it('should render ComponentLoader with DirectToPaid subType', function renderD2P() {
    renderWithProviders(
      <DirectToPaidContainer onClose={vi.fn()} source="test-source" />
    );

    expect(screen.getByTestId('component-loader')).toBeInTheDocument();
    expect(screen.getByTestId('type')).toHaveTextContent('godaddyUnifiedPlansAndPricingLibraryEsm');
    expect(screen.getByTestId('loader-mode')).toHaveTextContent('esm');
    expect(screen.getByTestId('sub-type')).toHaveTextContent('DirectToPaid');
    expect(screen.getByTestId('offer-group-id')).toHaveTextContent('airoBuilderLineup');
  });

  it('should pass source prop to ComponentLoader', function passSource() {
    renderWithProviders(
      <DirectToPaidContainer onClose={vi.fn()} source="my-custom-source" />
    );

    expect(screen.getByTestId('component-loader')).toBeInTheDocument();
    expect(screen.getByTestId('source')).toHaveTextContent('my-custom-source');
  });

  it('should use default source when not provided', function defaultSource() {
    renderWithProviders(
      <DirectToPaidContainer onClose={vi.fn()} />
    );

    expect(screen.getByTestId('component-loader')).toBeInTheDocument();
    expect(screen.getByTestId('source')).toHaveTextContent('app-builder-D2P');
  });

  it('should log analytics when modal is shown', function logAnalytics() {
    renderWithProviders(
      <DirectToPaidContainer onClose={vi.fn()} source="test" />
    );

    expect(shipAnalyticsLog).toHaveBeenCalledWith('paywall.d2p-modal.shown', expect.objectContaining({
      source: 'test',
      productId: 'AiroBuilderProduct',
      offerGroupId: 'airoBuilderLineup',
      component: 'DirectToPaidContainer',
    }));
  });

  it('should call onClose when close button is clicked', function callOnClose() {
    const mockOnClose = vi.fn();

    renderWithProviders(
      <DirectToPaidContainer onClose={mockOnClose} />
    );

    expect(screen.getByTestId('component-loader')).toBeInTheDocument();
    screen.getByTestId('close-btn').click();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should pass ESM props when umd-fallback flag is false (default)', function esmDefault() {
    renderWithProviders(
      <DirectToPaidContainer onClose={vi.fn()} source="test" />
    );

    expect(screen.getByTestId('type')).toHaveTextContent('godaddyUnifiedPlansAndPricingLibraryEsm');
    expect(screen.getByTestId('loader-mode')).toHaveTextContent('esm');
  });

  it('should pass UMD props when umd-fallback flag is true', async function umdFallback() {
    const mod = await import('@/hooks/useSwitchboard');
    vi.mocked(mod.useSwitchboard).mockReturnValue(true);

    renderWithProviders(
      <DirectToPaidContainer onClose={vi.fn()} source="test" />
    );

    expect(screen.getByTestId('type')).toHaveTextContent('godaddyUnifiedPlansAndPricingLibrary');
    expect(screen.getByTestId('loader-mode')).toHaveTextContent('');
    expect(screen.getByTestId('has-deps')).toHaveTextContent('false');

    vi.mocked(mod.useSwitchboard).mockReturnValue(false);
  });

  describe('D2P callbacks', function d2pCallbackTests() {
    it('logs cta click analytics', function logsCta() {
      renderWithProviders(
        <DirectToPaidContainer onClose={vi.fn()} source="test" />
      );

      fireEvent.click(screen.getByTestId('cta-click-btn'));
      expect(shipAnalyticsLog).toHaveBeenCalledWith('paywall.d2p-cta.click', expect.objectContaining({
        source: 'test',
        planId: 'plan-123',
        ctaType: 'buy',
      }));
    });

    it('logs checkout start analytics', function logsCheckoutStart() {
      renderWithProviders(
        <DirectToPaidContainer onClose={vi.fn()} source="test" />
      );

      fireEvent.click(screen.getByTestId('checkout-start-btn'));
      expect(shipAnalyticsLog).toHaveBeenCalledWith('paywall.d2p-checkout.start', expect.objectContaining({
        basketId: 'basket-456',
      }));
    });

    it('logs checkout error and calls onError', function logsCheckoutError() {
      const onError = vi.fn();
      renderWithProviders(
        <DirectToPaidContainer onClose={vi.fn()} onError={onError} source="test" />
      );

      fireEvent.click(screen.getByTestId('checkout-error-btn'));
      expect(shipAnalyticsLog).toHaveBeenCalledWith('paywall.d2p-checkout.error', expect.objectContaining({
        error: 'checkout failed',
      }));
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('handles purchase success with valid plan and polls', async function handlesPurchaseSuccess() {
      const onClose = vi.fn();
      renderWithProviders(
        <DirectToPaidContainer onClose={onClose} source="test" />
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId('purchase-success-btn'));
      });

      expect(onClose).toHaveBeenCalled();
      expect(shipAnalyticsLog).toHaveBeenCalledWith('airobuilder.purchase.d2p', expect.objectContaining({
        toPlan: 'professional',
      }));
      expect(shipAnalyticsLog).toHaveBeenCalledWith('plan.purchase_professional.d2p', expect.objectContaining({
        toPlan: 'professional',
      }));
    });

    it('skips polling when plan not found in purchase response', async function skipsPollWhenNoPlan() {
      const onClose = vi.fn();
      renderWithProviders(
        <DirectToPaidContainer onClose={onClose} source="test" />
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId('purchase-no-plan-btn'));
      });

      expect(shipAnalyticsLog).toHaveBeenCalledWith('airobuilder.d2p.polling-skipped', expect.objectContaining({
        reason: 'plan_not_found_in_purchase_response',
      }));
    });
  });

  describe('paywallLoading lifecycle', function paywallLoadingTests() {
    it('onLoadSuccess clears paywallLoading and ships analytics', function onLoadSuccessClearsLoading() {
      usePaywallStore.setState({ paywallLoading: true });

      renderWithProviders(
        <DirectToPaidContainer onClose={vi.fn()} source="test-source" />
      );

      fireEvent.click(screen.getByTestId('load-success-btn'));

      expect(usePaywallStore.getState().paywallLoading).toBe(false);
      expect(shipAnalyticsLog).toHaveBeenCalledWith('paywall.d2p-load.success', expect.objectContaining({
        source: 'test-source',
        component: 'DirectToPaidContainer',
      }));
    });

    it('onLoadError clears paywallLoading and calls onError', function onLoadErrorClearsLoading() {
      const mockOnError = vi.fn();
      usePaywallStore.setState({ paywallLoading: true });

      renderWithProviders(
        <DirectToPaidContainer onClose={vi.fn()} onError={mockOnError} source="test-source" />
      );

      fireEvent.click(screen.getByTestId('load-error-btn'));

      expect(usePaywallStore.getState().paywallLoading).toBe(false);
      expect(mockOnError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('onError clears paywallLoading and calls onError', function onErrorClearsLoading() {
      const mockOnError = vi.fn();
      usePaywallStore.setState({ paywallLoading: true });

      renderWithProviders(
        <DirectToPaidContainer onClose={vi.fn()} onError={mockOnError} source="test-source" />
      );

      fireEvent.click(screen.getByTestId('error-btn'));

      expect(usePaywallStore.getState().paywallLoading).toBe(false);
      expect(mockOnError).toHaveBeenCalledWith(expect.any(Error));
    });

  });
});
